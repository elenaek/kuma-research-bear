import type { ChatMessage, ConversationState, SourceInfo } from '../../../shared/types/index.ts';
import { getPaperByUrl, updatePaper } from '../../../shared/utils/dbService.ts';
import { aiService } from '../../../shared/utils/aiService.ts';
import { JSONSchema } from '../../../shared/utils/typeToSchema.ts';
import { logger } from '../../../shared/utils/logger.ts';
import { buildChatPrompt } from '../../../shared/prompts/templates/chat.ts';
import { getOutputLanguage, getPersona, getPurpose, getVerbosity } from '../../../shared/utils/settingsService.ts';
import type { PromptLanguage } from '../../../shared/prompts/types.ts';
import { LatexProcessingService } from '../LatexProcessingService.ts';
import { ChatRAGService, type ContextChunk } from '../ChatRAGService.ts';
import { ChatStreamingUtility } from './ChatStreamingUtility.ts';
import { ChatContextService } from './ChatContextService.ts';

/**
 * PaperChatStreamProcessor
 *
 * Handles paper chat streaming operations including:
 * - RAG context retrieval
 * - Session management and recreation
 * - Progressive context validation
 * - Streaming response with LaTeX protection
 * - Timeout handling with retries
 * - Post-stream summarization
 *
 * This is the core processor for paper-based chat conversations.
 */
export class PaperChatStreamProcessor {
  private readonly CHAT_TIMEOUT_MS = 10000; // 10 seconds
  private readonly MAX_CHAT_RETRIES = 3; // Total attempts (initial + 2 retries)
  private readonly MAX_QUOTA_RETRIES = 3;

  /**
   * JSON Schema for structured chat responses
   * LLM returns: { answer: string, sources: string[] }
   */
  private readonly CHAT_RESPONSE_SCHEMA: JSONSchema = {
    type: "object",
    properties: {
      answer: {
        type: "string",
        description: `Your conversational response to the user's question.
Be friendly and helpful like a supportive colleague. Explain complex concepts in simple, everyday language avoiding unnecessary jargon.
Keep responses concise but detailed enough to answer the user's question. Be encouraging and supportive.

#IMPORTANT:
FOR ALL MATH USE LATEX

Math formatting with LaTeX:
- Use $expr$ for inline math, $$expr$$ for display equations

Use markdown formatting to make your response easier to read (e.g., **bold**, *italic*, bullet points, numbered lists, etc.).
Reference specific sections when used in producing answer. Remember conversation context for coherent follow-ups.`
      },
      sources: {
        type: "array",
        items: { type: "string" },
        description: "Array of hierarchical citations actually used (e.g., 'Section: Methods > Data Collection > P 3')"
      }
    },
    required: ["answer", "sources"]
  };

  constructor(
    private ragService: ChatRAGService,
    private latexService: LatexProcessingService,
    private streamingUtility: ChatStreamingUtility,
    private contextService: ChatContextService
  ) {}

  /**
   * Process and stream a paper chat response
   */
  async processAndStream(
    paperUrl: string,
    message: string,
    tabId: number
  ): Promise<void> {
    try {
      logger.debug('CHATBOX', `[PaperChatStreamProcessor] Processing chat message for paper: ${paperUrl}`);

      // Retrieve paper from IndexedDB
      const storedPaper = await getPaperByUrl(paperUrl);

      if (!storedPaper) {
        await this.streamingUtility.sendPaperChatEnd(
          tabId,
          'Paper not found in storage. Please store the paper first.',
          []
        );
        return;
      }

      // Get conversation state for accurate token calculation
      const chatHistory = storedPaper.chatHistory || [];
      const conversationState = storedPaper.conversationState || {
        summary: null,
        recentMessages: [],
        lastSummarizedIndex: -1,
        summaryCount: 0,
      };

      // Prepare conversation state for RAG (with recent messages)
      const recentMessages = chatHistory.slice(-6);
      const ragConversationState = {
        summary: conversationState.summary,
        recentMessages: recentMessages,
      };

      // Get relevant chunks using RAG service
      const { contextChunks, contextString, sourceInfoMap, sources } = await this.ragService.getRelevantChunksForChat(
        storedPaper.id,
        message,
        'chat'
      );

      // Context ID for this paper's chat session
      const contextId = `chat-${storedPaper.id}`;

      // System prompt for the chat session (WITHOUT RAG context to save quota)
      // RAG context will be included in the actual user prompt instead
      const persona = await getPersona();
      const purpose = await getPurpose();
      const verbosity = await getVerbosity();
      const language = (await getOutputLanguage()) as PromptLanguage;
      const systemPrompt = buildChatPrompt(storedPaper.title, persona, purpose, language, verbosity);

      // Get or create session with conversation history
      let session = await this.getOrCreateSessionWithHistory(
        contextId,
        systemPrompt,
        chatHistory,
        conversationState,
        storedPaper
      );

      // Outer retry loop for timeout handling
      let timeoutAttempt = 0;
      let answer = '';
      let extractedSources: string[] = [];
      let sourceInfoArray: SourceInfo[] = [];
      let currentChunks = contextChunks;
      let promptWithContext = '';
      let timeoutHandle: NodeJS.Timeout | null = null;

      while (timeoutAttempt < this.MAX_CHAT_RETRIES) {
        try {
          // Check if tab still exists before attempting
          if (!await this.streamingUtility.isTabValid(tabId)) {
            logger.warn('CHATBOX', '[PaperChatStreamProcessor] Tab closed, aborting chat request');
            return;
          }

          // Validate prompt size before sending (with progressive trimming strategies)
          const validationResult = await this.contextService.prepareContextWithValidation(
            session,
            currentChunks,
            message,
            chatHistory,
            conversationState,
            systemPrompt,
            contextId,
            storedPaper.title,
            {
              expectedInputs: [{ type: 'text', languages: ["en", "es", "ja"] }],
              expectedOutputs: [{ type: 'text', languages: [await getOutputLanguage() || "en"] }]
            }
          );

          // Check if validation failed
          if (validationResult.errorMessage) {
            logger.error('CHATBOX', '[PaperChatStreamProcessor] Context validation failed:', validationResult.errorMessage);
            await this.streamingUtility.sendPaperChatEnd(tabId, validationResult.errorMessage, []);
            return;
          }

          // Use validated context and updated session
          session = validationResult.session;
          promptWithContext = validationResult.validatedContext;

          // Setup timeout detection for first chunk
          timeoutHandle = null;
          let resolveFirstChunk: (() => void) | null = null;
          let firstChunkReceived = false;

          const timeoutPromise = new Promise<never>((_, reject) => {
            timeoutHandle = setTimeout(() => reject(new Error('CHAT_TIMEOUT')), this.CHAT_TIMEOUT_MS);
          });

          const firstChunkPromise = new Promise<void>((resolve) => {
            resolveFirstChunk = resolve;
          });

          // Perform streaming with quota retry logic
          const performStreaming = async () => {
            let retryCount = 0;

            while (retryCount <= this.MAX_QUOTA_RETRIES) {
              try {
                // Stream response with structured output constraint
                let fullResponseJSON = '';
                const stream = session.promptStreaming(promptWithContext, { responseConstraint: this.CHAT_RESPONSE_SCHEMA });

                // Lookahead buffer to prevent showing closing JSON pattern
                const CLOSING_PATTERN = '", "sources';
                const LOOKAHEAD_SIZE = CLOSING_PATTERN.length;
                let lastSentLength = 0;
                let shouldStopDisplaying = false;

                logger.debug('CHATBOX', '[PaperChatStreamProcessor] 🔄 Starting structured streaming...');

                for await (const chunk of stream) {
                  fullResponseJSON += chunk;

                  // Find the answer field boundaries
                  if (!fullResponseJSON.includes('"answer"')) continue;

                  const answerStart = fullResponseJSON.indexOf('"answer"');
                  const colonIndex = fullResponseJSON.indexOf(':', answerStart);
                  const openQuoteIndex = fullResponseJSON.indexOf('"', colonIndex + 1);

                  if (openQuoteIndex === -1) continue;

                  // Extract current answer content
                  const currentAnswer = fullResponseJSON.substring(openQuoteIndex + 1);

                  // Check if closing pattern appears
                  if (!shouldStopDisplaying && currentAnswer.includes(CLOSING_PATTERN)) {
                    const patternIndex = currentAnswer.indexOf(CLOSING_PATTERN);
                    const rawAnswer = currentAnswer.substring(0, patternIndex);

                    // Protect LaTeX from JSON escape sequence corruption
                    const { content: rawWithPlaceholders, latex: extractedLatex } = this.latexService.extractLatexFromRawJson(rawAnswer);
                    const unescapedWithPlaceholders = this.latexService.unescapeJsonString(rawWithPlaceholders);
                    answer = this.latexService.rehydrateLatex(unescapedWithPlaceholders, extractedLatex);

                    // Send any remaining content
                    const finalDelta = answer.substring(lastSentLength);
                    if (finalDelta) {
                      await this.streamingUtility.sendPaperChatChunk(tabId, finalDelta);
                      if (!firstChunkReceived && resolveFirstChunk) {
                        firstChunkReceived = true;
                        resolveFirstChunk();
                        if (timeoutHandle) clearTimeout(timeoutHandle);
                      }
                    }

                    shouldStopDisplaying = true;
                  }

                  // Continue streaming with lookahead buffer
                  if (!shouldStopDisplaying && currentAnswer.length > LOOKAHEAD_SIZE) {
                    let visibleContent = currentAnswer.substring(0, currentAnswer.length - LOOKAHEAD_SIZE);

                    // Hold back trailing backslash to prevent incomplete escape sequences
                    if (visibleContent.endsWith('\\')) {
                      visibleContent = visibleContent.slice(0, -1);
                    }

                    // Protect LaTeX from JSON escape sequence corruption
                    const { content: visibleWithPlaceholders, latex: extractedLatex } = this.latexService.extractLatexFromRawJson(visibleContent);
                    const unescapedWithPlaceholders = this.latexService.unescapeJsonString(visibleWithPlaceholders);
                    const unescapedVisible = this.latexService.rehydrateLatex(unescapedWithPlaceholders, extractedLatex);

                    const newDelta = unescapedVisible.substring(lastSentLength);

                    if (newDelta) {
                      await this.streamingUtility.sendPaperChatChunk(tabId, newDelta);
                      lastSentLength = unescapedVisible.length;
                      if (!firstChunkReceived && resolveFirstChunk) {
                        firstChunkReceived = true;
                        resolveFirstChunk();
                        if (timeoutHandle) clearTimeout(timeoutHandle);
                      }
                    }
                  }
                }

                logger.debug('CHATBOX', '[PaperChatStreamProcessor] ✓ Chat response streamed successfully');

                // Parse final JSON to extract sources
                try {
                  const parsed = JSON.parse(fullResponseJSON);
                  if (!answer) {
                    const rawAnswer = parsed.answer || '';
                    const { content: rawWithPlaceholders, latex: extractedLatex } = this.latexService.extractLatexFromRawJson(rawAnswer);
                    const unescapedWithPlaceholders = this.latexService.unescapeJsonString(rawWithPlaceholders);
                    answer = this.latexService.rehydrateLatex(unescapedWithPlaceholders, extractedLatex);
                  }
                  extractedSources = parsed.sources || [];
                  logger.debug('CHATBOX', '[PaperChatStreamProcessor] Parsed sources:', extractedSources);
                } catch (error) {
                  logger.error('CHATBOX', '[PaperChatStreamProcessor] Failed to parse final JSON:', error);
                  extractedSources = [];
                }

                // Map extracted sources to sourceInfo
                sourceInfoArray = extractedSources
                  .map(sourceText => {
                    const normalized = sourceText.replace(/\s*>\s*P\s+\d+(\s*>\s*Sentences)?$/, '');
                    return sourceInfoMap.get(normalized);
                  })
                  .filter((info): info is SourceInfo => info !== undefined);

                logger.debug('CHATBOX', '[PaperChatStreamProcessor] Mapped sourceInfo:', sourceInfoArray.length, 'out of', extractedSources.length);

                // Send end signal with final answer and sources
                await this.streamingUtility.sendPaperChatEnd(tabId, answer.trim(), extractedSources, sourceInfoArray);

                // Success - exit retry loop
                break;

              } catch (error) {
                // Check if this is a QuotaExceededError and we have retries left
                if (this.streamingUtility.isQuotaExceededError(error) && retryCount < this.MAX_QUOTA_RETRIES) {
                  logger.warn('CHATBOX', `[PaperChatStreamProcessor] QuotaExceededError (attempt ${retryCount + 1}/${this.MAX_QUOTA_RETRIES}), retrying with reduced context...`);

                  // Reduce chunks for retry
                  currentChunks = currentChunks.slice(0, Math.max(1, currentChunks.length - 2));

                  // Re-validate with reduced chunks
                  const retryResult = await this.contextService.prepareContextWithValidation(
                    session,
                    currentChunks,
                    message,
                    chatHistory,
                    conversationState,
                    systemPrompt,
                    contextId,
                    storedPaper.title,
                    {
                      expectedInputs: [{ type: 'text', languages: ["en", "es", "ja"] }],
                      expectedOutputs: [{ type: 'text', languages: [await getOutputLanguage() || "en"] }]
                    }
                  );

                  if (retryResult.errorMessage) {
                    logger.error('CHATBOX', '[PaperChatStreamProcessor] Failed to reduce context further');
                    await this.streamingUtility.sendPaperChatEnd(tabId, 'Unable to process your question due to context size limitations. Please try a shorter question.', []);
                    return;
                  }

                  session = retryResult.session;
                  promptWithContext = retryResult.validatedContext;
                  retryCount++;
                  continue;
                }

                // Not a quota error or out of retries - rethrow
                throw error;
              }
            }
          };

          // Start streaming
          const streamingPromise = performStreaming();

          // Race for first chunk vs timeout
          await Promise.race([firstChunkPromise, timeoutPromise]);

          // First chunk received - wait for completion
          if (timeoutHandle) clearTimeout(timeoutHandle);
          await streamingPromise;

          // Success - exit timeout retry loop
          break;

        } catch (error) {
          // Clear timeout if active
          if (timeoutHandle) clearTimeout(timeoutHandle);

          // Check if this is a timeout error and we have retries left
          const errorMessage = error instanceof Error ? error.message : String(error);
          if (errorMessage === 'CHAT_TIMEOUT' && timeoutAttempt < this.MAX_CHAT_RETRIES - 1) {
            logger.warn('CHATBOX', `[PaperChatStreamProcessor] Timeout after ${this.CHAT_TIMEOUT_MS}ms (attempt ${timeoutAttempt + 1}/${this.MAX_CHAT_RETRIES}). Recreating session...`);

            // Destroy the potentially stuck session
            await aiService.destroySessionForContext(contextId);

            // Clone session with conversation history
            const outputLanguage = await getOutputLanguage();
            await aiService.cloneSessionWithHistory(
              contextId,
              conversationState,
              systemPrompt,
              {
                expectedInputs: [{ type: 'text', languages: ["en", "es", "ja"] }],
                expectedOutputs: [{ type: 'text', languages: [outputLanguage || "en"] }],
                temperature: 0.0,
                topK: 1
              }
            );

            // Get the new session reference
            session = aiService.getSessionForContext(contextId)!;

            logger.debug('CHATBOX', '[PaperChatStreamProcessor] Session cloned successfully. Retrying...');

            // Small delay before retry
            await new Promise(resolve => setTimeout(resolve, 1000));
            timeoutAttempt++;
            continue;
          }

          // If this is a timeout error and we're out of retries
          if (errorMessage === 'CHAT_TIMEOUT') {
            logger.error('CHATBOX', '[PaperChatStreamProcessor] Chat request timed out after multiple attempts');
            await this.streamingUtility.sendPaperChatEnd(tabId, 'Chat request timed out after multiple attempts. Please try again.', []);
            return;
          }

          // Not a timeout error - rethrow
          throw error;
        }
      }

      // Post-stream processing: token tracking and summarization
      await this.performPostStreamProcessing(
        contextId,
        storedPaper,
        chatHistory,
        conversationState,
        message,
        answer,
        extractedSources,
        sourceInfoArray,
        systemPrompt
      );

    } catch (error) {
      logger.error('CHATBOX', '[PaperChatStreamProcessor] Error processing chat message:', error);
      await this.streamingUtility.sendPaperChatEnd(
        tabId,
        'Sorry, I encountered an error processing your message. Please try again.',
        []
      );
    }
  }

  /**
   * Get or create session with conversation history
   */
  private async getOrCreateSessionWithHistory(
    contextId: string,
    systemPrompt: string,
    chatHistory: ChatMessage[],
    conversationState: ConversationState,
    storedPaper: any
  ): Promise<any> {
    let session = aiService.getSessionForContext(contextId);

    // If session exists, check if it needs summarization based on actual usage
    if (session) {
      const currentUsage = session.inputUsage ?? 0;
      const quota = session.inputQuota ?? 0;
      const usagePercentage = quota > 0 ? (currentUsage / quota) * 100 : 0;

      logger.debug('CHATBOX', `[PaperChatStreamProcessor] Existing session usage: ${currentUsage}/${quota} (${usagePercentage.toFixed(1)}%)`);

      // If session usage is high (>70%), summarize and recreate session
      if (usagePercentage > 70 && chatHistory.length > 0) {
        logger.debug('CHATBOX', '[PaperChatStreamProcessor] Session usage >70%, triggering summarization and session recreation...');

        // Perform summarization
        const updatedConversationState = await this.contextService.performPreSummarization(
          chatHistory,
          conversationState,
          storedPaper.title,
          storedPaper.id
        );

        // Update stored paper with new conversation state
        await chrome.storage.local.set({
          [`papers.${storedPaper.id}`]: {
            ...storedPaper,
            conversationState: updatedConversationState,
          },
        });

        // Destroy old session
        await aiService.destroySessionForContext(contextId);

        // Create new session with summarized history
        session = await this.createSessionWithHistory(contextId, systemPrompt, updatedConversationState, chatHistory);
        logger.debug('CHATBOX', '[PaperChatStreamProcessor] ✓ Session recreated after summarization');
      }
    } else if (chatHistory.length > 0) {
      // No session but have history - create with pre-summarization
      const updatedConversationState = await this.contextService.performPreSummarization(
        chatHistory,
        conversationState,
        storedPaper.title,
        storedPaper.id
      );

      session = await this.createSessionWithHistory(contextId, systemPrompt, updatedConversationState, chatHistory);
    } else {
      // First message - create fresh session
      logger.debug('CHATBOX', '[PaperChatStreamProcessor] Creating fresh session (first message)');
      const outputLanguage = await getOutputLanguage();
      session = await aiService.getOrCreateSession(contextId, {
        expectedInputs: [{ type: 'text', languages: ["en", "es", "ja"] }],
        expectedOutputs: [{ type: 'text', languages: [outputLanguage || "en"] }],
        initialPrompts: [{ role: 'system', content: systemPrompt }],
        temperature: 0.0,
        topK: 1
      });
    }

    return session;
  }

  /**
   * Create session with conversation history
   */
  private async createSessionWithHistory(
    contextId: string,
    systemPrompt: string,
    conversationState: ConversationState,
    chatHistory: ChatMessage[]
  ): Promise<any> {
    logger.debug('CHATBOX', '[PaperChatStreamProcessor] Creating session with', chatHistory.length, 'historical messages');

    let systemPromptContent = systemPrompt;
    if (conversationState.summary) {
      systemPromptContent += `\n\nPrevious conversation summary: ${conversationState.summary}`;
    }

    const initialPrompts: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [
      { role: 'system', content: systemPromptContent }
    ];

    // Add recent messages (up to last 6 messages)
    const recentMessages = chatHistory.slice(-6);
    for (const msg of recentMessages) {
      initialPrompts.push({
        role: msg.role,
        content: msg.content
      });
    }

    const outputLanguage = await getOutputLanguage();
    return await aiService.getOrCreateSession(contextId, {
      initialPrompts,
      expectedInputs: [{ type: 'text', languages: ["en", "es", "ja"] }],
      expectedOutputs: [{ type: 'text', languages: [outputLanguage || "en"] }],
      temperature: 0.0,
      topK: 1
    });
  }

  /**
   * Perform post-stream processing: token tracking and summarization
   */
  private async performPostStreamProcessing(
    contextId: string,
    storedPaper: any,
    chatHistory: ChatMessage[],
    conversationState: ConversationState,
    message: string,
    answer: string,
    extractedSources: string[],
    sourceInfoArray: SourceInfo[],
    systemPrompt: string
  ): Promise<void> {
    try {
      // Track token usage
      const metadata = aiService.getSessionMetadata(contextId);

      if (metadata) {
        logger.debug('CHATBOX', `[PaperChatStreamProcessor] Token usage: ${metadata.usagePercentage.toFixed(2)}% (${metadata.inputUsage}/${metadata.inputQuota})`);

        // Check if we need to summarize and clone session
        if (metadata.needsSummarization) {
          logger.debug('CHATBOX', '[PaperChatStreamProcessor] Token threshold reached (>= 80%), triggering summarization...');

          // Update chat history with new messages
          const newChatHistory: ChatMessage[] = [
            ...chatHistory,
            { role: 'user', content: message, timestamp: Date.now() },
            { role: 'assistant', content: answer.trim(), timestamp: Date.now(), sources: extractedSources, sourceInfo: sourceInfoArray }
          ];

          // Determine which messages to summarize (all except last 6)
          const messagesToSummarize = newChatHistory.slice(
            conversationState.lastSummarizedIndex + 1,
            -6
          );

          if (messagesToSummarize.length > 0) {
            logger.debug('CHATBOX', `[PaperChatStreamProcessor] Summarizing ${messagesToSummarize.length} messages...`);

            const newSummary = await aiService.summarizeConversation(
              messagesToSummarize,
              storedPaper.title
            );

            // Handle summary growth: re-summarize after 2 summaries to prevent unbounded growth
            let finalSummary: string;
            let summaryCount: number;

            if (conversationState.summary && conversationState.summaryCount >= 2) {
              logger.debug('CHATBOX', '[PaperChatStreamProcessor] Re-summarizing combined summaries (count >= 2)');
              const combinedText = `${conversationState.summary}\n\n${newSummary}`;

              const tempMessages: ChatMessage[] = [
                { role: 'assistant', content: combinedText, timestamp: Date.now() }
              ];

              const reSummarized = await aiService.summarizeConversation(tempMessages, storedPaper.title);
              finalSummary = reSummarized || newSummary;
              summaryCount = 1;
            } else if (conversationState.summary) {
              finalSummary = `${conversationState.summary}\n\n${newSummary}`;
              summaryCount = conversationState.summaryCount + 1;
            } else {
              finalSummary = newSummary;
              summaryCount = 1;
            }

            // Update conversation state
            const newConversationState: ConversationState = {
              summary: finalSummary,
              recentMessages: newChatHistory.slice(-6),
              lastSummarizedIndex: newChatHistory.length - 7,
              summaryCount
            };

            const outputLanguage = await getOutputLanguage();
            // Clone session with updated history
            await aiService.cloneSessionWithHistory(
              contextId,
              newConversationState,
              systemPrompt,
              {
                expectedInputs: [{ type: 'text', languages: ["en", "es", "ja"] }],
                expectedOutputs: [{ type: 'text', languages: [outputLanguage || "en"] }]
              }
            );

            // Save updated state to database
            await updatePaper(storedPaper.id, {
              chatHistory: newChatHistory,
              conversationState: newConversationState,
            });

            logger.debug('CHATBOX', '[PaperChatStreamProcessor] ✓ Session cloned with summarized history');
          }
        }
      }
    } catch (postProcessError) {
      // Log post-processing errors but don't fail the request
      logger.error('CHATBOX', '[PaperChatStreamProcessor] Post-stream processing error (non-critical):', postProcessError);
    }
  }
}
