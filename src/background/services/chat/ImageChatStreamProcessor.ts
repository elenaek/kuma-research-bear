import type { ChatMessage, ConversationState, SourceInfo } from '../../../shared/types/index.ts';
import { updatePaper } from '../../../shared/utils/dbService.ts';
import { aiService } from '../../../shared/utils/aiService.ts';
import { JSONSchema } from '../../../shared/utils/typeToSchema.ts';
import { logger } from '../../../shared/utils/logger.ts';
import { buildImageChatPrompt } from '../../../shared/prompts/templates/chat.ts';
import { getOutputLanguage, getPersona, getPurpose, getVerbosity } from '../../../shared/utils/settingsService.ts';
import type { PromptLanguage } from '../../../shared/prompts/types.ts';
import { LatexProcessingService } from '../LatexProcessingService.ts';
import { ChatRAGService } from '../ChatRAGService.ts';
import { ChatStreamingUtility } from './ChatStreamingUtility.ts';
import { ChatContextService } from './ChatContextService.ts';

/**
 * ImageChatStreamProcessor
 *
 * Handles image chat streaming operations including:
 * - Multimodal input (image + text)
 * - RAG context retrieval
 * - Session management and recreation
 * - Progressive context validation
 * - Streaming response with LaTeX protection
 * - Timeout handling with retries
 * - Post-stream summarization
 *
 * This is the core processor for image-based chat conversations.
 */
export class ImageChatStreamProcessor {
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
   * Process and stream an image chat response
   */
  async processAndStream(
    paperId: string,
    imageUrl: string,
    imageBlob: Blob,
    message: string,
    tabId: number
  ): Promise<void> {
    try {
      logger.debug('CHATBOX', `[ImageChatStreamProcessor] Processing image chat message for paper: ${paperId}, image: ${imageUrl}`);

      // Get paper by ID
      const { getPaperById } = await import('../../../shared/utils/dbService.ts');
      const paper = await getPaperById(paperId);

      if (!paper) {
        await this.streamingUtility.sendImageChatEnd(tabId, 'Paper not found in storage. Please store the paper first.', []);
        return;
      }

      // Get relevant chunks using RAG service
      const { contextChunks, contextString, sourceInfoMap, sources } = await this.ragService.getRelevantChunksForChat(
        paperId,
        message,
        'chat'
      );

      // Context ID for this image's chat session
      // Generate hash for image URL (same logic as in dbService)
      let hash = 0;
      for (let i = 0; i < imageUrl.length; i++) {
        const char = imageUrl.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash = hash & hash;
      }
      const contextId = `image-chat-${paperId}-img_${Math.abs(hash)}`;

      // Get image chat history and conversation state
      const { getImageChat, updateImageChat } = await import('../../../shared/utils/dbService.ts');
      const imageChat = await getImageChat(paperId, imageUrl);
      const imageChatHistory = imageChat?.chatHistory || [];
      const imageChatConversationState = imageChat?.conversationState || {
        summary: null,
        recentMessages: [],
        lastSummarizedIndex: -1,
        summaryCount: 0,
      };

      // System prompt for image chat (multimodal)
      const persona = await getPersona();
      const purpose = await getPurpose();
      const verbosity = await getVerbosity();
      const language = (await getOutputLanguage()) as PromptLanguage;
      const systemPrompt = buildImageChatPrompt(paper.title, persona, purpose, language, verbosity);

      // Get or create session with conversation history
      let session = await this.getOrCreateSessionWithHistory(
        contextId,
        systemPrompt,
        imageChatHistory,
        imageChatConversationState,
        paper,
        paperId,
        imageUrl
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
            logger.warn('CHATBOX', '[ImageChatStreamProcessor] Tab closed, aborting image chat request');
            return;
          }

          // Validate prompt size before sending (with progressive trimming strategies)
          const outputLanguage = await getOutputLanguage();
          const validationResult = await this.contextService.prepareContextWithValidation(
            session,
            currentChunks,
            message,
            imageChatHistory,
            imageChatConversationState,
            systemPrompt,
            contextId,
            paper.title,
            {
              expectedInputs: [{ type: 'image', languages: ['en', 'es', 'ja'] }],
              expectedOutputs: [{ type: 'text', languages: [outputLanguage || "en"] }]
            }
          );

          // Check if validation failed
          if (validationResult.errorMessage) {
            logger.error('CHATBOX', '[ImageChatStreamProcessor] Context validation failed:', validationResult.errorMessage);
            await this.streamingUtility.sendImageChatEnd(tabId, validationResult.errorMessage, []);
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
                // Use append() for multimodal input (image + text)
                await session.append([
                  {
                    role: 'user',
                    content: [
                      { type: 'image', value: imageBlob },
                      { type: 'text', value: promptWithContext }
                    ]
                  }
                ]);

                // Get streaming response with structured output constraint
                let fullResponseJSON = '';
                const stream = session.promptStreaming('', { responseConstraint: this.CHAT_RESPONSE_SCHEMA });

                // Lookahead buffer to prevent showing closing JSON pattern
                const CLOSING_PATTERN = '", "sources';
                const LOOKAHEAD_SIZE = CLOSING_PATTERN.length;
                let lastSentLength = 0;
                let shouldStopDisplaying = false;

                logger.debug('CHATBOX', '[ImageChatStreamProcessor] 🔄 Starting structured streaming...');

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
                      await this.streamingUtility.sendImageChatChunk(tabId, finalDelta);
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
                      await this.streamingUtility.sendImageChatChunk(tabId, newDelta);
                      lastSentLength = unescapedVisible.length;
                      if (!firstChunkReceived && resolveFirstChunk) {
                        firstChunkReceived = true;
                        resolveFirstChunk();
                        if (timeoutHandle) clearTimeout(timeoutHandle);
                      }
                    }
                  }
                }

                logger.debug('CHATBOX', '[ImageChatStreamProcessor] ✓ Image chat response streamed successfully');

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
                  logger.debug('CHATBOX', '[ImageChatStreamProcessor] Parsed sources:', extractedSources);
                } catch (error) {
                  logger.error('CHATBOX', '[ImageChatStreamProcessor] Failed to parse final JSON:', error);
                  extractedSources = [];
                }

                // Map extracted sources to sourceInfo
                sourceInfoArray = extractedSources
                  .map(sourceText => {
                    const normalized = sourceText.replace(/\s*>\s*P\s+\d+(\s*>\s*Sentences)?$/, '');
                    return sourceInfoMap.get(normalized);
                  })
                  .filter((info): info is SourceInfo => info !== undefined);

                logger.debug('CHATBOX', '[ImageChatStreamProcessor] Mapped sourceInfo:', sourceInfoArray.length, 'out of', extractedSources.length);

                // Send end signal with final answer and sources
                await this.streamingUtility.sendImageChatEnd(tabId, answer.trim(), extractedSources, sourceInfoArray);

                // Success - exit retry loop
                break;

              } catch (error) {
                // Check if this is a QuotaExceededError and we have retries left
                if (this.streamingUtility.isQuotaExceededError(error) && retryCount < this.MAX_QUOTA_RETRIES) {
                  logger.warn('CHATBOX', `[ImageChatStreamProcessor] QuotaExceededError (attempt ${retryCount + 1}/${this.MAX_QUOTA_RETRIES}), retrying with reduced context...`);

                  // Reduce chunks for retry
                  currentChunks = currentChunks.slice(0, Math.max(1, currentChunks.length - 2));

                  // Re-validate with reduced chunks
                  const outputLanguage = await getOutputLanguage();
                  const retryResult = await this.contextService.prepareContextWithValidation(
                    session,
                    currentChunks,
                    message,
                    imageChatHistory,
                    imageChatConversationState,
                    systemPrompt,
                    contextId,
                    paper.title,
                    {
                      expectedInputs: [{ type: 'image', languages: ['en', 'es', 'ja'] }],
                      expectedOutputs: [{ type: 'text', languages: [outputLanguage || "en"] }]
                    }
                  );

                  if (retryResult.errorMessage) {
                    logger.error('CHATBOX', '[ImageChatStreamProcessor] Failed to reduce context further');
                    await this.streamingUtility.sendImageChatEnd(tabId, 'Unable to process your question due to context size limitations. Please try a shorter question.', []);
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
            logger.warn('CHATBOX', `[ImageChatStreamProcessor] Timeout after ${this.CHAT_TIMEOUT_MS}ms (attempt ${timeoutAttempt + 1}/${this.MAX_CHAT_RETRIES}). Recreating session...`);

            // Destroy the potentially stuck session
            await aiService.destroySessionForContext(contextId);

            // Clone session with conversation history
            const outputLanguage = await getOutputLanguage();
            await aiService.cloneSessionWithHistory(
              contextId,
              imageChatConversationState,
              systemPrompt,
              {
                expectedInputs: [{ type: 'image', languages: ['en', 'es', 'ja'] }],
                expectedOutputs: [{ type: 'text', languages: [outputLanguage || "en"] }],
                temperature: 0.0,
                topK: 1
              }
            );

            // Get the new session reference
            session = aiService.getSessionForContext(contextId)!;

            logger.debug('CHATBOX', '[ImageChatStreamProcessor] Session cloned successfully. Retrying...');

            // Small delay before retry
            await new Promise(resolve => setTimeout(resolve, 1000));
            timeoutAttempt++;
            continue;
          }

          // If this is a timeout error and we're out of retries
          if (errorMessage === 'CHAT_TIMEOUT') {
            logger.error('CHATBOX', '[ImageChatStreamProcessor] Image chat request timed out after multiple attempts');
            await this.streamingUtility.sendImageChatEnd(tabId, 'Chat request timed out after multiple attempts. Please try again.', []);
            return;
          }

          // Not a timeout error - rethrow
          throw error;
        }
      }

      // Post-stream processing: save history and check for summarization
      await this.performPostStreamProcessing(
        contextId,
        paperId,
        imageUrl,
        imageChatHistory,
        imageChatConversationState,
        message,
        answer,
        extractedSources,
        sourceInfoArray,
        systemPrompt,
        paper
      );

    } catch (error) {
      logger.error('CHATBOX', '[ImageChatStreamProcessor] Error processing image chat message:', error);
      await this.streamingUtility.sendImageChatEnd(
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
    imageChatHistory: ChatMessage[],
    imageChatConversationState: ConversationState,
    paper: any,
    paperId: string,
    imageUrl: string
  ): Promise<any> {
    let session = aiService.getSessionForContext(contextId);

    // If session exists, check if it needs summarization based on actual usage
    if (session) {
      const currentUsage = session.inputUsage ?? 0;
      const quota = session.inputQuota ?? 0;
      const usagePercentage = quota > 0 ? (currentUsage / quota) * 100 : 0;

      logger.debug('CHATBOX', `[ImageChatStreamProcessor] Existing session usage: ${currentUsage}/${quota} (${usagePercentage.toFixed(1)}%)`);

      // If session usage is high (>70%), summarize and recreate session
      if (usagePercentage > 70 && imageChatHistory.length > 0) {
        logger.debug('CHATBOX', '[ImageChatStreamProcessor] Session usage >70%, triggering summarization and session recreation...');

        // Perform summarization
        const updatedConversationState = await this.contextService.performPreSummarization(
          imageChatHistory,
          imageChatConversationState,
          paper.title,
          paperId
        );

        // Update stored image chat with new conversation state
        const { updateImageChat } = await import('../../../shared/utils/dbService.ts');
        await updateImageChat(paperId, imageUrl, {
          conversationState: updatedConversationState,
        });

        // Destroy old session
        await aiService.destroySessionForContext(contextId);

        // Create new session with summarized history
        session = await this.createSessionWithHistory(contextId, systemPrompt, updatedConversationState, imageChatHistory);
        logger.debug('CHATBOX', '[ImageChatStreamProcessor] ✓ Session recreated after summarization');
      }
    } else if (imageChatHistory.length > 0) {
      // No session but have history - create with pre-summarization
      const updatedConversationState = await this.contextService.performPreSummarization(
        imageChatHistory,
        imageChatConversationState,
        paper.title,
        paperId
      );

      session = await this.createSessionWithHistory(contextId, systemPrompt, updatedConversationState, imageChatHistory);
    } else {
      // First message - create fresh multimodal session
      logger.debug('CHATBOX', '[ImageChatStreamProcessor] Creating fresh multimodal session (first message)');
      const outputLanguage = await getOutputLanguage();
      session = await aiService.getOrCreateSession(contextId, {
        initialPrompts: [{ role: 'system', content: systemPrompt }],
        expectedInputs: [{ type: 'image', languages: ['en', 'es', 'ja'] }], // Enable multimodal
        expectedOutputs: [{ type: 'text', languages: [outputLanguage || "en"] }],
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
    imageChatHistory: ChatMessage[]
  ): Promise<any> {
    logger.debug('CHATBOX', '[ImageChatStreamProcessor] Creating multimodal session with', imageChatHistory.length, 'historical messages');

    let systemPromptContent = systemPrompt;
    if (conversationState.summary) {
      systemPromptContent += `\n\nPrevious conversation summary: ${conversationState.summary}`;
    }

    const initialPrompts: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [
      { role: 'system', content: systemPromptContent }
    ];

    // Add recent messages (up to last 6 messages)
    const recentMessages = imageChatHistory.slice(-6);
    for (const msg of recentMessages) {
      initialPrompts.push({
        role: msg.role,
        content: msg.content
      });
    }

    const outputLanguage = await getOutputLanguage();
    return await aiService.getOrCreateSession(contextId, {
      initialPrompts,
      expectedInputs: [{ type: 'image', languages: ['en', 'es', 'ja'] }], // Enable multimodal
      expectedOutputs: [{ type: 'text', languages: [outputLanguage || "en"] }],
      temperature: 0.0,
      topK: 1
    });
  }

  /**
   * Perform post-stream processing: save history and check for summarization
   */
  private async performPostStreamProcessing(
    contextId: string,
    paperId: string,
    imageUrl: string,
    imageChatHistory: ChatMessage[],
    imageChatConversationState: ConversationState,
    message: string,
    answer: string,
    extractedSources: string[],
    sourceInfoArray: SourceInfo[],
    systemPrompt: string,
    paper: any
  ): Promise<void> {
    try {
      // Import updateImageChat function
      const { updateImageChat } = await import('../../../shared/utils/dbService.ts');


      // Update chat history with new messages
      const newChatHistory = [
        ...imageChatHistory,
        { role: 'user' as const, content: message, timestamp: Date.now() },
        { role: 'assistant' as const, content: answer.trim(), timestamp: Date.now(), sources: extractedSources, sourceInfo: sourceInfoArray }
      ];

      // Save to IndexedDB
      await updateImageChat(paperId, imageUrl, {
        chatHistory: newChatHistory,
        conversationState: imageChatConversationState,
      });

      // Track token usage
      const metadata = aiService.getSessionMetadata(contextId);

      if (metadata && metadata.needsSummarization) {
        logger.debug('CHATBOX', '[ImageChatStreamProcessor] Token threshold reached, triggering summarization...');

        // Summarize messages
        const messagesToSummarize = newChatHistory.slice(
          imageChatConversationState.lastSummarizedIndex + 1,
          -6
        );

        if (messagesToSummarize.length > 0) {
          const newSummary = await aiService.summarizeConversation(messagesToSummarize, paper.title);

          let finalSummary: string;
          let summaryCount: number;

          if (imageChatConversationState.summary && imageChatConversationState.summaryCount >= 2) {
            // Re-summarize combined summaries
            const combinedText = `${imageChatConversationState.summary}\n\n${newSummary}`;
            const tempMessages = [
              { role: 'assistant' as const, content: combinedText, timestamp: Date.now() }
            ];
            const reSummarized = await aiService.summarizeConversation(tempMessages, paper.title);
            finalSummary = reSummarized || newSummary;
            summaryCount = 1;
          } else if (imageChatConversationState.summary) {
            finalSummary = `${imageChatConversationState.summary}\n\n${newSummary}`;
            summaryCount = imageChatConversationState.summaryCount + 1;
          } else {
            finalSummary = newSummary;
            summaryCount = 1;
          }

          const newConversationState = {
            summary: finalSummary,
            recentMessages: newChatHistory.slice(-6),
            lastSummarizedIndex: newChatHistory.length - 7,
            summaryCount
          };

          const outputLanguage = await getOutputLanguage();
          // Clone session with updated history (preserve multimodal image support)
          await aiService.cloneSessionWithHistory(
            contextId,
            newConversationState,
            systemPrompt,
            {
              expectedInputs: [{ type: 'image', languages: ['en', 'es', 'ja'] }],
              expectedOutputs: [{ type: 'text', languages: [outputLanguage || "en"] }]
            }
          );

          // Save updated state
          await updateImageChat(paperId, imageUrl, {
            chatHistory: newChatHistory,
            conversationState: newConversationState,
          });

          logger.debug('CHATBOX', '[ImageChatStreamProcessor] ✓ Session cloned with summarized history');
        }
      }
    } catch (postProcessError) {
      logger.error('CHATBOX', '[ImageChatStreamProcessor] Post-stream processing error:', postProcessError);
    }
  }
}
