import { AILanguageModelSession, AISessionOptions } from '../../../shared/types/index.ts';
import { PromptExecutor } from '../PromptExecutor.ts';
import { AISessionManager } from '../AISessionManager.ts';
import { logger } from '../../../shared/utils/logger.ts';

/**
 * Base class for AI strategy implementations
 * Provides common functionality for prompt execution and session management
 */
export abstract class BaseAIStrategy {
  protected promptExecutor: PromptExecutor;
  protected sessionManager: AISessionManager;

  constructor(promptExecutor: PromptExecutor, sessionManager: AISessionManager) {
    this.promptExecutor = promptExecutor;
    this.sessionManager = sessionManager;
  }

  /**
   * Execute a prompt with the given parameters
   * Creates session with proper options, then delegates to PromptExecutor
   */
  protected async executePrompt(
    input: string,
    systemPrompt: string,
    schema: any | undefined,
    contextId: string,
    expectedInputs?: any[],
    expectedOutputs?: any[],
    temperature?: number,
    topK?: number,
    timeoutConfig?: {
      timeoutMs?: number;
      maxRetries?: number;
      retryDelayMs?: number;
      recreateSessionOnTimeout?: boolean;
    }
  ): Promise<string> {
    // Merge timeout config with defaults
    const config = {
      timeoutMs: timeoutConfig?.timeoutMs ?? 60000,
      maxRetries: timeoutConfig?.maxRetries ?? 2,
      retryDelayMs: timeoutConfig?.retryDelayMs ?? 1000,
      recreateSessionOnTimeout: timeoutConfig?.recreateSessionOnTimeout ?? true
    };

    this.logDebug(`[Prompt] contextId: ${contextId}`);
    this.logDebug(`[Prompt] expectedOutputs: ${JSON.stringify(expectedOutputs)}`);

    let lastError: any;

    // Retry loop (handles session recreation)
    for (let attempt = 1; attempt <= config.maxRetries; attempt++) {
      try {
        // Ensure session exists with correct options
        // Only include defined properties to avoid passing undefined to Chrome API
        const sessionOpts: AISessionOptions = {};
        if (systemPrompt !== undefined) sessionOpts.systemPrompt = systemPrompt;
        if (expectedInputs !== undefined) sessionOpts.expectedInputs = expectedInputs;
        if (expectedOutputs !== undefined) sessionOpts.expectedOutputs = expectedOutputs;
        if (temperature !== undefined) sessionOpts.temperature = temperature;
        if (topK !== undefined) sessionOpts.topK = topK;

        await this.getOrCreateSession(contextId, sessionOpts);

        // Delegate to PromptExecutor (single attempt, no retry at this level)
        return await this.promptExecutor.executeWithTimeout(
          contextId,
          input,
          { timeoutMs: config.timeoutMs, maxRetries: 1, retryDelayMs: 0, recreateSessionOnTimeout: false },
          { responseConstraint: schema }
        );

      } catch (error: any) {
        lastError = error;

        // Check if it was a timeout
        const isTimeout = error.message?.includes('PROMPT_TIMEOUT') || error.message?.includes('timeout');

        if (isTimeout && attempt < config.maxRetries) {
          this.logWarn(`[Prompt] Timeout on attempt ${attempt}/${config.maxRetries}`);

          // Optionally destroy and recreate session
          if (config.recreateSessionOnTimeout) {
            this.logDebug(`[Prompt] Recreating session for context: ${contextId}`);
            await this.destroySession(contextId);
          }

          // Wait before retry
          this.logDebug(`[Prompt] Waiting ${config.retryDelayMs}ms before retry...`);
          await this.sleep(config.retryDelayMs);

          continue;
        }

        // Not a timeout or final attempt - throw
        throw error;
      }
    }

    // All retries exhausted
    this.logError(`[Prompt] Failed after ${config.maxRetries} attempts for context ${contextId}`);
    throw lastError;
  }

  /**
   * Sleep utility for retry delays
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Get or create a session for the given context
   */
  protected async getOrCreateSession(
    contextId: string,
    options?: AISessionOptions,
    onDownloadProgress?: (progress: number) => void
  ): Promise<AILanguageModelSession> {
    // Check if session already exists
    const existingSession = this.sessionManager.getSession(contextId);
    if (existingSession) {
      return existingSession;
    }

    // Create new session
    const created = await this.sessionManager.createSession(contextId, options, onDownloadProgress);
    if (!created) {
      throw new Error(`Failed to create session for context: ${contextId}`);
    }

    // Get and return the newly created session
    const newSession = this.sessionManager.getSession(contextId);
    if (!newSession) {
      throw new Error(`Session not found after creation for context: ${contextId}`);
    }

    return newSession;
  }

  /**
   * Get existing session for a context (doesn't create new one)
   */
  protected getSession(contextId: string): AILanguageModelSession | null {
    return this.sessionManager.getSession(contextId);
  }

  /**
   * Destroy session for a specific context
   */
  protected async destroySession(contextId: string): Promise<void> {
    return this.sessionManager.destroySession(contextId);
  }

  /**
   * Log debug message
   */
  protected logDebug(message: string, ...args: any[]): void {
    logger.debug('AI_STRATEGY', message, ...args);
  }

  /**
   * Log warning message
   */
  protected logWarn(message: string, ...args: any[]): void {
    logger.warn('AI_STRATEGY', message, ...args);
  }

  /**
   * Log error message
   */
  protected logError(message: string, ...args: any[]): void {
    logger.error('AI_STRATEGY', message, ...args);
  }

  /**
   * Validate if a prompt fits within session quota
   * Uses Chrome AI's measureInputUsage() to get actual token count
   */
  protected async validatePromptSize(
    session: AILanguageModelSession,
    prompt: string,
    safetyThreshold: number = 0.80
  ): Promise<{
    fits: boolean;
    actualUsage: number;
    quota: number;
    available: number;
    error?: string;
  }> {
    try {
      // Use Chrome AI's measureInputUsage() to get actual token count
      const actualUsage = await session.measureInputUsage(prompt);
      const quota = session.inputQuota ?? 0;

      // Calculate available space (quota - what's already in session)
      const currentUsage = session.inputUsage ?? 0;
      const available = quota - currentUsage;

      // Apply safety threshold (80%) to prevent QuotaExceededError during streaming
      const safeAvailable = Math.floor(available * safetyThreshold);
      const fits = actualUsage <= safeAvailable;

      this.logDebug(`[Prompt Validation] Actual usage: ${actualUsage}, Available: ${safeAvailable}/${quota} (${Math.round(safetyThreshold * 100)}% threshold), Fits: ${fits}`);

      return {
        fits,
        actualUsage,
        quota,
        available: safeAvailable
      };
    } catch (error: any) {
      this.logError('[Prompt Validation] Error during validation:', error);
      return {
        fits: false,
        actualUsage: 0,
        quota: 0,
        available: 0,
        error: error?.message || String(error)
      };
    }
  }
}
