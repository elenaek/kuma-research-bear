import { AILanguageModelSession, AISessionOptions, SessionMetadata } from '../../../shared/types/index.ts';
import { logger } from '../../../shared/utils/logger.ts';

/**
 * AISessionManager - Manages AI session lifecycle
 *
 * Responsibilities:
 * - Create and destroy AI sessions
 * - Track sessions by context ID (tab-specific)
 * - Manage session metadata (token usage)
 * - Handle session cleanup and timeouts
 * - Support multiple concurrent sessions
 */
export class AISessionManager {
  // Multiple sessions support - one per context (tab)
  private sessions: Map<string, AILanguageModelSession> = new Map();
  private sessionMetadata: Map<string, SessionMetadata> = new Map();
  private activeRequests: Map<string, AbortController> = new Map();

  // Token estimation constant: ~500 chars average / 4 chars per token = 125 tokens
  private readonly ESTIMATED_TOKENS_PER_CHUNK = 125;

  /**
   * Create a new AI session for a context
   *
   * @param contextId - Context identifier (e.g., 'tab-123-explain')
   * @param options - Session options (system prompt, temperature, etc.)
   * @param onDownloadProgress - Optional callback for model download progress
   * @returns True if session created successfully
   */
  async createSession(
    contextId: string,
    options?: AISessionOptions,
    onDownloadProgress?: (progress: number) => void
  ): Promise<boolean> {
    try {
      // Check if session already exists for this context
      if (this.sessions.has(contextId)) {
        logger.debug('SESSION_MANAGER', `Session already exists for context: ${contextId}`);
        return true;
      }

      logger.debug('SESSION_MANAGER', `Creating new session for context: ${contextId}`);

      // Check if LanguageModel is available
      if (typeof LanguageModel === 'undefined') {
        throw new Error('LanguageModel API not available');
      }

      // Track download progress if callback provided
      let downloadProgressMonitor: NodeJS.Timeout | null = null;

      if (onDownloadProgress) {
        downloadProgressMonitor = setInterval(async () => {
          try {
            const availability = await LanguageModel.availability();
            if (availability === 'after-download') {
              // Model is being downloaded, estimate progress
              // (Chrome doesn't provide real progress, so we simulate)
              onDownloadProgress(0.5); // Midpoint estimate
            }
          } catch (error) {
            logger.warn('SESSION_MANAGER', 'Error checking download progress:', error);
          }
        }, 1000);
      }

      // Create session with options
      const session = await LanguageModel.create(options);

      // Clear progress monitor
      if (downloadProgressMonitor) {
        clearInterval(downloadProgressMonitor);
        if (onDownloadProgress) {
          onDownloadProgress(1.0); // Complete
        }
      }

      // Store session
      this.sessions.set(contextId, session);

      // Initialize metadata
      this.sessionMetadata.set(contextId, {
        contextId,
        createdAt: Date.now(),
        tokensUsed: 0,
        tokensSoFar: 0,
        maxTokens: session.maxTokens || 4096,
        temperature: session.temperature,
        topK: session.topK,
      });

      logger.debug('SESSION_MANAGER', `✓ Session created for context: ${contextId}`);
      return true;
    } catch (error) {
      logger.error('SESSION_MANAGER', `Failed to create session for context ${contextId}:`, error);
      return false;
    }
  }

  /**
   * Register an externally-created session
   * Used for backward compatibility during migration
   *
   * @param contextId - Context identifier
   * @param session - The session to register
   */
  registerSession(contextId: string, session: AILanguageModelSession): void {
    this.sessions.set(contextId, session);

    // Initialize metadata
    this.sessionMetadata.set(contextId, {
      contextId,
      createdAt: Date.now(),
      tokensUsed: 0,
      tokensSoFar: 0,
      maxTokens: session.maxTokens || 4096,
      temperature: session.temperature,
      topK: session.topK,
    });

    logger.debug('SESSION_MANAGER', `✓ Session registered for context: ${contextId}`);
  }

  /**
   * Get existing session for a context
   *
   * @param contextId - Context identifier
   * @returns Session or null if not found
   */
  getSession(contextId: string): AILanguageModelSession | null {
    return this.sessions.get(contextId) || null;
  }

  /**
   * Get session metadata
   *
   * @param contextId - Context identifier
   * @returns Metadata or null if not found
   */
  getSessionMetadata(contextId: string): SessionMetadata | null {
    return this.sessionMetadata.get(contextId) || null;
  }

  /**
   * Update session metadata (token usage)
   *
   * @param contextId - Context identifier
   * @param updates - Partial metadata updates
   */
  updateSessionMetadata(contextId: string, updates: Partial<SessionMetadata>): void {
    const existing = this.sessionMetadata.get(contextId);
    if (existing) {
      this.sessionMetadata.set(contextId, { ...existing, ...updates });
    }
  }

  /**
   * Destroy session and cleanup
   *
   * @param contextId - Context identifier
   */
  async destroySession(contextId: string): Promise<void> {
    try {
      const session = this.sessions.get(contextId);
      if (session) {
        // Destroy the session
        await session.destroy();
        logger.debug('SESSION_MANAGER', `✓ Session destroyed for context: ${contextId}`);
      }

      // Cleanup maps
      this.sessions.delete(contextId);
      this.sessionMetadata.delete(contextId);

      // Cancel any active requests
      const abortController = this.activeRequests.get(contextId);
      if (abortController) {
        abortController.abort();
        this.activeRequests.delete(contextId);
      }
    } catch (error) {
      logger.error('SESSION_MANAGER', `Error destroying session for context ${contextId}:`, error);
    }
  }

  /**
   * Destroy all sessions
   */
  async destroyAllSessions(): Promise<void> {
    logger.debug('SESSION_MANAGER', `Destroying all sessions (${this.sessions.size} total)`);

    const contextIds = Array.from(this.sessions.keys());
    await Promise.all(contextIds.map(contextId => this.destroySession(contextId)));

    logger.debug('SESSION_MANAGER', '✓ All sessions destroyed');
  }

  /**
   * Check if session exists
   *
   * @param contextId - Context identifier
   * @returns True if session exists
   */
  hasSession(contextId: string): boolean {
    return this.sessions.has(contextId);
  }

  /**
   * Get all active context IDs
   *
   * @returns Array of context IDs
   */
  getActiveContexts(): string[] {
    return Array.from(this.sessions.keys());
  }

  /**
   * Estimate tokens used for text
   *
   * @param text - Text to estimate
   * @returns Estimated token count
   */
  estimateTokens(text: string): number {
    // Rough estimation: ~4 characters per token
    return Math.ceil(text.length / 4);
  }

  /**
   * Check if session is approaching token limit
   *
   * @param contextId - Context identifier
   * @param threshold - Threshold percentage (default: 0.8 = 80%)
   * @returns True if approaching limit
   */
  isApproachingTokenLimit(contextId: string, threshold: number = 0.8): boolean {
    const metadata = this.sessionMetadata.get(contextId);
    if (!metadata) return false;

    const usageRatio = metadata.tokensSoFar / metadata.maxTokens;
    return usageRatio >= threshold;
  }

  /**
   * Get token usage summary for a session
   *
   * @param contextId - Context identifier
   * @returns Usage summary
   */
  getTokenUsage(contextId: string): {
    used: number;
    max: number;
    percentage: number;
  } | null {
    const metadata = this.sessionMetadata.get(contextId);
    if (!metadata) return null;

    return {
      used: metadata.tokensSoFar,
      max: metadata.maxTokens,
      percentage: (metadata.tokensSoFar / metadata.maxTokens) * 100,
    };
  }

  /**
   * Register an abort controller for a context
   * (used for cancelling long-running prompts)
   *
   * @param contextId - Context identifier
   * @param controller - AbortController instance
   */
  registerAbortController(contextId: string, controller: AbortController): void {
    this.activeRequests.set(contextId, controller);
  }

  /**
   * Unregister abort controller
   *
   * @param contextId - Context identifier
   */
  unregisterAbortController(contextId: string): void {
    this.activeRequests.delete(contextId);
  }

  /**
   * Abort active request for a context
   *
   * @param contextId - Context identifier
   */
  abortRequest(contextId: string): void {
    const controller = this.activeRequests.get(contextId);
    if (controller) {
      controller.abort();
      this.activeRequests.delete(contextId);
      logger.debug('SESSION_MANAGER', `Aborted request for context: ${contextId}`);
    }
  }

  /**
   * Get session count
   *
   * @returns Number of active sessions
   */
  getSessionCount(): number {
    return this.sessions.size;
  }

  /**
   * Cleanup old sessions (e.g., from closed tabs)
   * Call this periodically to prevent memory leaks
   *
   * @param maxAgeMs - Maximum age in milliseconds (default: 1 hour)
   */
  async cleanupOldSessions(maxAgeMs: number = 3600000): Promise<number> {
    const now = Date.now();
    const contextIds = Array.from(this.sessionMetadata.keys());
    let cleaned = 0;

    for (const contextId of contextIds) {
      const metadata = this.sessionMetadata.get(contextId);
      if (metadata && (now - metadata.createdAt) > maxAgeMs) {
        await this.destroySession(contextId);
        cleaned++;
      }
    }

    if (cleaned > 0) {
      logger.debug('SESSION_MANAGER', `Cleaned up ${cleaned} old sessions`);
    }

    return cleaned;
  }
}
