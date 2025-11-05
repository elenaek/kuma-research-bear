import type { ChatMessage, ConversationState } from '../../../shared/types/index.ts';
import { aiService } from '../../../shared/utils/aiService.ts';
import { updatePaper } from '../../../shared/utils/dbService.ts';
import { inputQuotaService } from '../../../shared/utils/inputQuotaService.ts';
import { getOutputLanguage } from '../../../shared/utils/settingsService.ts';
import { logger } from '../../../shared/utils/logger.ts';

/**
 * ChatContextService
 *
 * Handles context preparation, validation, and conversation summarization
 * for chat operations.
 *
 * Responsibilities:
 * - Context validation with progressive trimming
 * - Pre-summarization checks and execution
 * - Token estimation and quota management
 * - Session recreation with summarized history
 */
export class ChatContextService {
  /**
   * Estimate token usage for a given text
   * Rough estimate: ~4 characters per token
   */
  estimateTokenUsage(text: string): number {
    return Math.ceil(text.length / 4);
  }

  /**
   * Prepare and validate context with progressive trimming strategies
   * Attempts multiple strategies to fit context within quota:
   * 1. Summarize conversation history
   * 2. Trim chunks progressively
   * 3. Use minimal chunks as fallback
   *
   * Returns validated context or error message if all strategies fail
   */
  async prepareContextWithValidation(
    session: any,
    contextChunks: any[],
    message: string,
    chatHistory: ChatMessage[],
    conversationState: ConversationState,
    systemPrompt: string,
    contextId: string,
    paperTitleOrId: string, // Paper title for regular chat, paper ID for image chat
    sessionOptions?: { expectedInputs?: any[]; expectedOutputs?: any[] }, // Session configuration for recreating sessions
    maxAttempts: number = 500
  ): Promise<{
    validatedContext: string;
    finalChunkCount: number;
    session: any;
    errorMessage?: string;
  }> {
    let finalContextChunks = contextChunks;
    let hasSummarized = false;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      // Build context string from current chunks
      const finalContextString = finalContextChunks
        .map((chunk: any) => {
          const hierarchy = chunk.parentSection
            ? `${chunk.parentSection} > ${chunk.section}`
            : chunk.section;

          let citation = `[Section: ${hierarchy}`;
          if (chunk.paragraphIndex !== undefined) {
            citation += ` > P ${chunk.paragraphIndex + 1}`;
            if (chunk.sentenceGroupIndex !== undefined) {
              citation += ` > Sentences`;
            }
          }
          citation += `]`;

          return `${citation}\n${chunk.content}`;
        })
        .join('\n\n---\n\n');

      const promptWithContext = `Context from the paper:
${finalContextString}

User question: ${message}`;

      // Validate prompt size using Chrome AI's measureInputUsage()
      const validation = await aiService.validatePromptSize(session, promptWithContext);

      if (validation.fits) {
        logger.debug('CHATBOX', `[ChatContextService] ✓ Validation passed on attempt ${attempt} (${validation.actualUsage} tokens)`);
        return {
          validatedContext: promptWithContext,
          finalChunkCount: finalContextChunks.length,
          session
        };
      }

      // Prompt too large - try strategies in order
      logger.warn('CHATBOX', `[ChatContextService] Prompt too large (${validation.actualUsage} > ${validation.available}) on attempt ${attempt}/${maxAttempts}`);

      // Strategy 1: Summarize conversation (attempt 1 only, if we have history and haven't summarized yet)
      if (attempt === 1 && chatHistory.length > 3 && !hasSummarized) {
        logger.debug('CHATBOX', '[ChatContextService] Attempting summarization to free up space for RAG context...');

        // Perform summarization
        const updatedConversationState = await this.performPreSummarization(
          chatHistory,
          conversationState,
          paperTitleOrId,
          paperTitleOrId // Using as both title and ID (works for both use cases)
        );

        // Destroy old session and create new one with summarized history
        await aiService.destroySessionForContext(contextId);

        let systemPromptContent = systemPrompt;
        if (updatedConversationState.summary) {
          systemPromptContent += `\n\nPrevious conversation summary: ${updatedConversationState.summary}`;
        }

        const initialPrompts: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [
          { role: 'system', content: systemPromptContent }
        ];

        // Add recent messages (up to last 6 messages)
        const recentHistoryMessages = chatHistory.slice(-6);
        for (const msg of recentHistoryMessages) {
          initialPrompts.push({
            role: msg.role,
            content: msg.content
          });
        }

        const outputLanguage = await getOutputLanguage();
        session = await aiService.getOrCreateSession(contextId, {
          initialPrompts,
          expectedInputs: sessionOptions?.expectedInputs || [{ type: 'text', languages: ["en", "es", "ja"] }],
          expectedOutputs: sessionOptions?.expectedOutputs || [{ type: 'text', languages: [outputLanguage || "en"] }],
          temperature: 0.0,
          topK: 1
        });
        hasSummarized = true;
        logger.debug('CHATBOX', '[ChatContextService] ✓ Summarization complete, session recreated. Retrying validation...');
        continue; // Retry validation with same chunks but new session
      }

      // Strategy 2: Trim chunks (attempts 2-3)
      if (attempt < maxAttempts) {
        logger.debug('CHATBOX', `[ChatContextService] Trimming chunks (attempt ${attempt})...`);
        // Remove last 2 chunks and retry (but keep at least 1 chunk)
        const newLength = Math.max(1, finalContextChunks.length - 2);
        finalContextChunks = finalContextChunks.slice(0, newLength);
      } else {
        // Strategy 3: Final fallback - use minimal chunks (just 1-2 most relevant)
        logger.error('CHATBOX', `[ChatContextService] Max retries reached, using minimal chunks`);
        finalContextChunks = contextChunks.slice(0, Math.min(2, contextChunks.length));
      }

      if (finalContextChunks.length === 0) {
        logger.error('CHATBOX', '[ChatContextService] No chunks remaining after trimming');
        return {
          validatedContext: '',
          finalChunkCount: 0,
          session,
          errorMessage: 'Context too large even after aggressive trimming. Try a shorter question or use a model with larger context.'
        };
      }
    }

    // Should never reach here, but return error just in case
    return {
      validatedContext: '',
      finalChunkCount: 0,
      session,
      errorMessage: 'Failed to validate context after all attempts'
    };
  }

  /**
   * Perform pre-summarization check before creating a session
   * If the estimated token usage exceeds threshold, summarize chat history
   * Returns updated conversation state (or original if no summarization needed)
   */
  async performPreSummarization(
    chatHistory: ChatMessage[],
    conversationState: ConversationState,
    paperTitle: string,
    paperId: string
  ): Promise<ConversationState> {
    // If no chat history, no summarization needed
    if (chatHistory.length === 0) {
      return conversationState;
    }

    // Estimate token usage from chat history
    const recentMessages = chatHistory.slice(-6);
    const recentMessagesText = recentMessages.map(m => m.content).join('\n');
    const summaryText = conversationState.summary || '';

    const estimatedTokens = this.estimateTokenUsage(recentMessagesText) + this.estimateTokenUsage(summaryText);

    // Get device-specific input quota and calculate 80% threshold
    const inputQuota = await inputQuotaService.getInputQuota();
    const QUOTA_THRESHOLD = Math.floor(inputQuota * 0.80);

    logger.debug('CHATBOX', `[ChatContextService] Pre-Summarization - Estimated tokens: ${estimatedTokens}, Threshold: ${QUOTA_THRESHOLD} (80% of ${inputQuota})`);

    // If estimated usage is below threshold, no summarization needed
    if (estimatedTokens < QUOTA_THRESHOLD) {
      logger.debug('CHATBOX', '[ChatContextService] Below threshold, no summarization needed');
      return conversationState;
    }

    logger.debug('CHATBOX', '[ChatContextService] Above threshold, performing summarization...');

    // Determine which messages to summarize
    // If we have a summary, only summarize messages after lastSummarizedIndex
    // Otherwise, summarize all except last 6
    const messagesToSummarize = conversationState.lastSummarizedIndex >= 0
      ? chatHistory.slice(conversationState.lastSummarizedIndex + 1, -6)
      : chatHistory.slice(0, -6);

    if (messagesToSummarize.length === 0) {
      logger.debug('CHATBOX', '[ChatContextService] No messages to summarize');
      return conversationState;
    }

    logger.debug('CHATBOX', `[ChatContextService] Summarizing ${messagesToSummarize.length} messages...`);

    // Perform summarization
    const newSummary = await aiService.summarizeConversation(messagesToSummarize, paperTitle);

    if (!newSummary) {
      logger.warn('CHATBOX', '[ChatContextService] Summarization failed, using original state');
      return conversationState;
    }

    // Check if we need to re-summarize combined summaries
    let finalSummary: string;
    let summaryCount: number;

    if (conversationState.summary && conversationState.summaryCount >= 2) {
      // Re-summarize the combined summary to prevent unbounded growth
      logger.debug('CHATBOX', '[ChatContextService] Re-summarizing combined summaries (count >= 2)');
      const combinedText = `${conversationState.summary}\n\n${newSummary}`;

      // Create a temporary array with combined summary for re-summarization
      const tempMessages: ChatMessage[] = [
        { role: 'assistant', content: combinedText, timestamp: Date.now() }
      ];

      const reSummarized = await aiService.summarizeConversation(tempMessages, paperTitle);
      finalSummary = reSummarized || newSummary;
      summaryCount = 1; // Reset count after re-summarization
    } else if (conversationState.summary) {
      // Append new summary to existing one
      finalSummary = `${conversationState.summary}\n\n${newSummary}`;
      summaryCount = conversationState.summaryCount + 1;
    } else {
      // First summary
      finalSummary = newSummary;
      summaryCount = 1;
    }

    const newConversationState: ConversationState = {
      summary: finalSummary,
      recentMessages: chatHistory.slice(-6),
      lastSummarizedIndex: chatHistory.length - 7,
      summaryCount
    };

    // Save to database
    await updatePaper(paperId, {
      conversationState: newConversationState,
    });

    logger.debug('CHATBOX', `[ChatContextService] ✓ Summarization complete (summaryCount: ${summaryCount})`);

    return newConversationState;
  }
}
