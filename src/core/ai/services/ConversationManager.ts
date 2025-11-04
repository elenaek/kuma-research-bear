import { AISessionManager } from '../core/AISessionManager.ts';
import { ConversationState, ChatMessage, AISessionOptions } from '../../../shared/types/index.ts';
import { logger } from '../../../shared/utils/logger.ts';
import { getOutputLanguage } from '../../../shared/utils/settingsService.ts';

/**
 * ConversationManager - Manages conversation state and history
 *
 * Responsibilities:
 * - Summarize conversation history to save tokens
 * - Clone sessions with conversation history
 * - Manage conversation state (summary + recent messages)
 * - Handle context window management
 */
export class ConversationManager {
  constructor(
    private sessionManager: AISessionManager,
    private createSummarizerFn: (options: any) => Promise<any>
  ) {}

  /**
   * Summarize a conversation to reduce token usage
   * Uses Chrome's Summarization API for efficient summarization
   *
   * @param messages - Array of chat messages to summarize
   * @param paperTitle - Optional paper title for context
   * @returns Summary string or null if summarization fails
   */
  async summarizeConversation(
    messages: ChatMessage[],
    paperTitle?: string
  ): Promise<string | null> {
    try {
      logger.debug('CONVERSATION_MANAGER', '[Summarize] Starting summarization of', messages.length, 'messages');

      // Format messages as conversation text
      const conversationText = messages
        .map(msg => `${msg.role === 'user' ? 'User' : 'Assistant'}: ${msg.content}`)
        .join('\n\n');

      // Create summarizer with conversation-appropriate settings
      const summarizer = await this.createSummarizerFn({
        type: 'tldr',
        format: 'plain-text',
        length: 'medium',
        sharedContext: paperTitle ? `Research paper discussion: ${paperTitle}` : 'Research paper discussion',
      });

      if (!summarizer) {
        logger.warn('CONVERSATION_MANAGER', '[Summarize] Failed to create summarizer');
        return null;
      }

      // Generate summary
      const summary = await summarizer.summarize(conversationText);
      summarizer.destroy();

      logger.debug('CONVERSATION_MANAGER', '[Summarize] ✓ Summary created:', summary.length, 'chars');
      return summary;
    } catch (error) {
      logger.error('CONVERSATION_MANAGER', '[Summarize] Error summarizing conversation:', error);
      return null;
    }
  }

  /**
   * Clone a session with conversation history
   * Used when token usage approaches limit - resets tokens while preserving context
   *
   * @param contextId - Context ID for the session to clone
   * @param conversationState - Current conversation state (summary + recent messages)
   * @param systemPrompt - System prompt for the session
   * @param options - Additional session options
   * @returns New cloned session
   */
  async cloneSessionWithHistory(
    contextId: string,
    conversationState: ConversationState,
    systemPrompt: string,
    options?: AISessionOptions
  ): Promise<any> {
    logger.debug('CONVERSATION_MANAGER', '[Clone] Cloning session for', contextId);
    logger.debug('CONVERSATION_MANAGER', '[Clone] Conversation state:', {
      hasSummary: !!conversationState.summary,
      recentMessages: conversationState.recentMessages.length,
    });

    // Build initialPrompts array with system prompt, summary, and recent messages
    // Combine system prompt and conversation summary into single system message
    // (Prompt API only allows one system message at the first position)
    let systemPromptContent = systemPrompt;
    if (conversationState.summary) {
      systemPromptContent += `\n\nPrevious conversation summary: ${conversationState.summary}`;
    }

    const initialPrompts: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [
      { role: 'system', content: systemPromptContent }
    ];

    // Add recent messages
    for (const msg of conversationState.recentMessages) {
      initialPrompts.push({
        role: msg.role,
        content: msg.content
      });
    }

    logger.debug('CONVERSATION_MANAGER', '[Clone] Creating new session with', initialPrompts.length, 'initial prompts');

    // Destroy old session using sessionManager
    await this.sessionManager.destroySession(contextId);

    // Get output language if not already in options
    const outputLanguage = await getOutputLanguage();

    // Create new session with conversation history
    const newSession = await LanguageModel.create({
      ...options,
      initialPrompts,
      expectedInputs: [{ type: 'text', languages: ["en", "es", "ja"] }],
      expectedOutputs: [{ type: 'text', languages: [outputLanguage || "en"] }],
      temperature: 0.0,
      topK: 1
    });

    // Register new session with sessionManager
    this.sessionManager.registerSession(contextId, newSession);

    logger.debug('CONVERSATION_MANAGER', '[Clone] ✓ Session cloned successfully');
    return newSession;
  }

  /**
   * Check if conversation needs summarization based on token usage
   *
   * @param contextId - Context ID to check
   * @param threshold - Usage percentage threshold (default: 70%)
   * @returns True if summarization is needed
   */
  needsSummarization(contextId: string, threshold: number = 0.7): boolean {
    const session = this.sessionManager.getSession(contextId);
    if (!session) return false;

    const inputUsage = session.inputUsage ?? 0;
    const inputQuota = session.inputQuota ?? 0;

    if (inputQuota === 0) return false;

    const usageRatio = inputUsage / inputQuota;
    return usageRatio >= threshold;
  }

  /**
   * Get conversation usage statistics
   *
   * @param contextId - Context ID to check
   * @returns Usage stats or null if session not found
   */
  getUsageStats(contextId: string): {
    inputUsage: number;
    inputQuota: number;
    usagePercentage: number;
  } | null {
    const session = this.sessionManager.getSession(contextId);
    if (!session) return null;

    const inputUsage = session.inputUsage ?? 0;
    const inputQuota = session.inputQuota ?? 0;
    const usagePercentage = inputQuota > 0 ? (inputUsage / inputQuota) * 100 : 0;

    return {
      inputUsage,
      inputQuota,
      usagePercentage
    };
  }
}
