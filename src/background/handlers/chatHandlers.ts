import { MessageType, ChatMessage, ConversationState } from '../../types/index.ts';
import { getPaperByUrl, getRelevantChunksSemantic, updatePaper } from '../../utils/dbService.ts';
import { aiService } from '../../utils/aiService.ts';
import { getOptimalRAGChunkCount } from '../../utils/adaptiveRAGService.ts';

/**
 * Chat Message Handlers
 * Handles chat-related operations with streaming support
 */

/**
 * Validate that a tab exists and is still available
 */
async function isTabValid(tabId: number): Promise<boolean> {
  try {
    const tab = await chrome.tabs.get(tabId);
    return !!tab;
  } catch (error) {
    // Tab was closed or doesn't exist
    return false;
  }
}

/**
 * Send a streaming chat message chunk to content script
 */
async function sendChatChunk(tabId: number, chunk: string): Promise<void> {
  try {
    // Validate tab exists before sending
    if (!await isTabValid(tabId)) {
      console.warn('[ChatHandlers] Tab', tabId, 'no longer exists, skipping chunk');
      return;
    }

    await chrome.tabs.sendMessage(tabId, {
      type: MessageType.CHAT_STREAM_CHUNK,
      payload: chunk,
    });
  } catch (error) {
    console.error('[ChatHandlers] Error sending chat chunk to tab:', error);
  }
}

/**
 * Send chat stream end message to content script
 */
async function sendChatEnd(tabId: number, fullMessage: string, sources?: string[]): Promise<void> {
  try {
    // Validate tab exists before sending
    if (!await isTabValid(tabId)) {
      console.warn('[ChatHandlers] Tab', tabId, 'no longer exists, skipping stream end');
      return;
    }

    await chrome.tabs.sendMessage(tabId, {
      type: MessageType.CHAT_STREAM_END,
      payload: { fullMessage, sources },
    });
  } catch (error) {
    console.error('[ChatHandlers] Error sending chat end to tab:', error);
  }
}

/**
 * Estimate token usage for a given text
 * Rough estimate: ~4 characters per token
 */
function estimateTokenUsage(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Perform pre-summarization check before creating a session
 * If the estimated token usage exceeds threshold, summarize chat history
 * Returns updated conversation state (or original if no summarization needed)
 */
async function performPreSummarization(
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

  const estimatedTokens = estimateTokenUsage(recentMessagesText) + estimateTokenUsage(summaryText);

  // Default quota is typically ~4000 tokens, 80% threshold = ~3200 tokens
  const QUOTA_THRESHOLD = 3200;

  console.log(`[Pre-Summarization] Estimated tokens: ${estimatedTokens}, Threshold: ${QUOTA_THRESHOLD}`);

  // If estimated usage is below threshold, no summarization needed
  if (estimatedTokens < QUOTA_THRESHOLD) {
    console.log('[Pre-Summarization] Below threshold, no summarization needed');
    return conversationState;
  }

  console.log('[Pre-Summarization] Above threshold, performing summarization...');

  // Determine which messages to summarize
  // If we have a summary, only summarize messages after lastSummarizedIndex
  // Otherwise, summarize all except last 6
  const messagesToSummarize = conversationState.lastSummarizedIndex >= 0
    ? chatHistory.slice(conversationState.lastSummarizedIndex + 1, -6)
    : chatHistory.slice(0, -6);

  if (messagesToSummarize.length === 0) {
    console.log('[Pre-Summarization] No messages to summarize');
    return conversationState;
  }

  console.log(`[Pre-Summarization] Summarizing ${messagesToSummarize.length} messages...`);

  // Perform summarization
  const newSummary = await aiService.summarizeConversation(messagesToSummarize, paperTitle);

  if (!newSummary) {
    console.warn('[Pre-Summarization] Summarization failed, using original state');
    return conversationState;
  }

  // Check if we need to re-summarize combined summaries
  let finalSummary: string;
  let summaryCount: number;

  if (conversationState.summary && conversationState.summaryCount >= 2) {
    // Re-summarize the combined summary to prevent unbounded growth
    console.log('[Pre-Summarization] Re-summarizing combined summaries (count >= 2)');
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

  console.log(`[Pre-Summarization] ✓ Summarization complete (summaryCount: ${summaryCount})`);

  return newConversationState;
}

/**
 * Process and stream chat response asynchronously
 * This runs in the background without blocking the message response
 */
async function processAndStreamResponse(
  paperUrl: string,
  message: string,
  tabId: number
): Promise<void> {
  try {
    console.log(`[ChatHandlers] Processing chat message for paper: ${paperUrl}`);

    // Retrieve paper from IndexedDB
    const storedPaper = await getPaperByUrl(paperUrl);

    if (!storedPaper) {
      return {
        success: false,
        error: 'Paper not found in storage. Please store the paper first.',
      };
    }

    // Get relevant chunks with adaptive oversampling based on paper's chunk size
    const { getAdaptiveChunkLimit, trimChunksWithProgressiveFallback } = await import('../../utils/adaptiveRAGService.ts');
    const adaptiveLimit = await getAdaptiveChunkLimit(storedPaper.id, 'chat');
    const relevantChunks = await getRelevantChunksSemantic(storedPaper.id, message, adaptiveLimit);

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

    // Trim chunks with progressive conversation fallback
    const { chunks: trimmedChunks, budgetStatus, reducedRecentMessages } = await trimChunksWithProgressiveFallback(
      relevantChunks,
      'chat',
      ragConversationState
    );

    // Log if conversation was reduced
    if (reducedRecentMessages !== undefined) {
      console.log(`[ChatHandlers] Conversation reduced: ${recentMessages.length} → ${reducedRecentMessages} messages to fit RAG chunks`);
    }

    // If still not enough space, try summarization as last resort
    if (!budgetStatus.minTokensFit && chatHistory.length > 0) {
      console.log('[ChatHandlers] Progressive fallback exhausted, triggering summarization...');
      console.log(`[ChatHandlers] Budget: ${budgetStatus.usedTokens}/${budgetStatus.availableTokens} tokens, minTokensFit=${budgetStatus.minTokensFit}`);

      const updatedConversationState = await performPreSummarization(
        chatHistory,
        conversationState,
        storedPaper.title
      );

      // Update stored paper with new conversation state
      await chrome.storage.local.set({
        [`papers.${storedPaper.id}`]: {
          ...storedPaper,
          conversationState: updatedConversationState,
        },
      });

      console.log('[ChatHandlers] ✓ Summarization complete as last resort');
    }

    if (trimmedChunks.length === 0) {
      return {
        success: false,
        error: 'No relevant content found to answer this question.',
      };
    }

    console.log(`[ChatHandlers] Found ${trimmedChunks.length} relevant chunks for chat message (retrieved ${relevantChunks.length}, trimmed by token budget)`);

    // Format context from chunks with position and hierarchy
    const contextChunks = trimmedChunks.map(chunk => ({
      content: chunk.content,
      section: chunk.section || 'Unknown section',
      index: chunk.index,
      parentSection: chunk.parentSection,
      paragraphIndex: chunk.paragraphIndex,
      sentenceGroupIndex: chunk.sentenceGroupIndex,
    }));

    // Sort chunks by document order (index) for better context
    contextChunks.sort((a, b) => a.index - b.index);

    const sources = Array.from(new Set(contextChunks.map(c => c.section)));

    // Build context string with position and natural boundary hierarchy
    const contextString = contextChunks
      .map((chunk) => {
        // Build hierarchical citation path
        const hierarchy = chunk.parentSection
          ? `${chunk.parentSection} > ${chunk.section}`
          : chunk.section;

        // Add paragraph/sentence info if available (natural boundaries)
        let citation = `[${hierarchy}`;
        if (chunk.paragraphIndex !== undefined) {
          citation += ` > Para ${chunk.paragraphIndex + 1}`;
          if (chunk.sentenceGroupIndex !== undefined) {
            citation += ` > Sentences`;
          }
        }
        citation += `]`;

        return `${citation}\n${chunk.content}`;
      })
      .join('\n\n---\n\n');

    // Context ID for this paper's chat session
    const contextId = `chat-${storedPaper.id}`;

    // chatHistory and conversationState already retrieved above (lines 202-208)

    // System prompt for the chat session (WITHOUT RAG context to save quota)
    // RAG context will be included in the actual user prompt instead
    const systemPrompt = `You are Kuma, a friendly research bear assistant helping users understand research papers.

Your role:
- Answer questions about the research paper based on the provided context
- Be conversational and friendly, like a helpful colleague
- Explain complex concepts in simple terms
- Reference specific sections when relevant
- If the context doesn't contain enough information, say so honestly
- Remember previous conversation context to provide coherent follow-up answers

Important:
- Keep responses concise and conversational (2-4 sentences for simple questions, more for complex ones)
- Use everyday language, avoid unnecessary jargon
- Be encouraging and supportive
- If you cite information, mention which section it's from

Mathematical expressions:
- Use $expression$ for inline math (e.g., $E = mc^2$, $p < 0.05$)
- Use $$expression$$ for display equations on separate lines
- Alternative: \\(expression\\) for inline, \\[expression\\] for display
- Use proper LaTeX syntax (e.g., \\frac{a}{b}, \\sum_{i=1}^{n}, Greek letters like \\alpha, \\beta)

Paper title: ${storedPaper.title}`;

    // Check if we need to create a new session with conversation history
    let session = aiService['sessions'].get(contextId);

    // If session exists, check if it needs summarization based on actual usage
    if (session) {
      const currentUsage = session.inputUsage ?? 0;
      const quota = session.inputQuota ?? 0;
      const usagePercentage = quota > 0 ? (currentUsage / quota) * 100 : 0;

      console.log(`[ChatHandlers] Existing session usage: ${currentUsage}/${quota} (${usagePercentage.toFixed(1)}%)`);

      // If session usage is high (>70%), summarize and recreate session
      if (usagePercentage > 70 && chatHistory.length > 0) {
        console.log('[ChatHandlers] Session usage >70%, triggering summarization and session recreation...');

        // Perform summarization
        const updatedConversationState = await performPreSummarization(
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
        aiService.destroySessionForContext(contextId);

        // Create new session with summarized history
        let systemPromptContent = systemPrompt;
        if (updatedConversationState.summary) {
          systemPromptContent += `\n\nPrevious conversation summary: ${updatedConversationState.summary}`;
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

        session = await aiService.getOrCreateSession(contextId, { initialPrompts });
        console.log('[ChatHandlers] ✓ Session recreated after summarization');
      }
    } else if (chatHistory.length > 0) {
      // No session but have history - create with pre-summarization
      const updatedConversationState = await performPreSummarization(
        chatHistory,
        conversationState,
        storedPaper.title,
        storedPaper.id
      );

      // Create new session with conversation history
      console.log('[ChatHandlers] Creating new session with', chatHistory.length, 'historical messages');

      // Combine system prompt and conversation summary into single system message
      // (Prompt API only allows one system message at the first position)
      let systemPromptContent = systemPrompt;
      if (updatedConversationState.summary) {
        systemPromptContent += `\n\nPrevious conversation summary: ${updatedConversationState.summary}`;
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

      session = await aiService.getOrCreateSession(contextId, { initialPrompts });
    } else {
      // First message - create fresh session
      console.log('[ChatHandlers] Creating fresh session (first message)');
      session = await aiService.getOrCreateSession(contextId, {
        initialPrompts: [{ role: 'system', content: systemPrompt }]
      });
    }

    // Validate prompt size before sending (with retry logic)
    let finalContextChunks = contextChunks;
    let finalContextString = contextString;
    const MAX_RETRIES = 3;

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      const promptWithContext = `Context from the paper:
${finalContextString}

User question: ${message}`;

      // Validate prompt size using Chrome AI's measureInputUsage()
      const validation = await aiService.validatePromptSize(session, promptWithContext);

      if (validation.fits) {
        console.log(`[ChatHandlers] ✓ Prompt validation passed on attempt ${attempt} (${validation.actualUsage} tokens)`);
        break;
      }

      // Prompt too large - try trimming more chunks
      console.warn(`[ChatHandlers] Prompt too large (${validation.actualUsage} > ${validation.available}), trimming chunks... (attempt ${attempt}/${MAX_RETRIES})`);

      if (attempt >= MAX_RETRIES) {
        // Last attempt - use minimal chunks (just 1-2 most relevant)
        console.error(`[ChatHandlers] Max retries reached, using minimal chunks`);
        finalContextChunks = contextChunks.slice(0, Math.min(2, contextChunks.length));
      } else {
        // Remove last 2 chunks and retry (but keep at least 1 chunk)
        const newLength = Math.max(1, finalContextChunks.length - 2);
        finalContextChunks = finalContextChunks.slice(0, newLength);
      }

      if (finalContextChunks.length === 0) {
        console.error('[ChatHandlers] No chunks remaining after trimming');
        return {
          success: false,
          error: 'Context too large even after aggressive trimming. Try a shorter question or use a model with larger context.'
        };
      }

      // Rebuild context string with fewer chunks
      finalContextString = finalContextChunks
        .map((chunk) => {
          const hierarchy = chunk.parentSection
            ? `${chunk.parentSection} > ${chunk.section}`
            : chunk.section;

          let citation = `[${hierarchy}`;
          if (chunk.paragraphIndex !== undefined) {
            citation += ` > Para ${chunk.paragraphIndex + 1}`;
            if (chunk.sentenceGroupIndex !== undefined) {
              citation += ` > Sentences`;
            }
          }
          citation += `]`;

          return `${citation}\n${chunk.content}`;
        })
        .join('\n\n---\n\n');
    }

    // Update sources based on final context chunks used
    const finalSources = Array.from(new Set(finalContextChunks.map(c => c.section)));

    // Stream the response
    // Include RAG context in the actual prompt (not in initialPrompts) to save quota
    const promptWithContext = `Context from the paper:
${finalContextString}

User question: ${message}`;

    let fullResponse = '';
    const stream = session.promptStreaming(promptWithContext);

    // Process the stream
    for await (const chunk of stream) {
      fullResponse += chunk;
      await sendChatChunk(tabId, chunk);
    }

    console.log('[ChatHandlers] ✓ Chat response streamed successfully');

    // Send end signal immediately after streaming completes
    // This ensures user gets their response even if post-processing fails
    await sendChatEnd(tabId, fullResponse, finalSources);

    // Post-stream processing: token tracking and summarization
    // Wrapped in try-catch to prevent failures from affecting the successful stream
    try {
      // Track token usage
      const metadata = aiService.getSessionMetadata(contextId);

      if (metadata) {
        console.log(`[ChatHandlers] Token usage: ${metadata.usagePercentage.toFixed(2)}% (${metadata.inputUsage}/${metadata.inputQuota})`);

        // Check if we need to summarize and clone session
        if (metadata.needsSummarization) {
          console.log('[ChatHandlers] Token threshold reached (>= 80%), triggering summarization...');

          // Update chat history with new messages
          const newChatHistory: ChatMessage[] = [
            ...chatHistory,
            { role: 'user', content: message, timestamp: Date.now() },
            { role: 'assistant', content: fullResponse, timestamp: Date.now(), sources: finalSources }
          ];

          // Determine which messages to summarize (all except last 6)
          const messagesToSummarize = newChatHistory.slice(
            conversationState.lastSummarizedIndex + 1,
            -6
          );

          if (messagesToSummarize.length > 0) {
            console.log(`[ChatHandlers] Summarizing ${messagesToSummarize.length} messages...`);

            const newSummary = await aiService.summarizeConversation(
              messagesToSummarize,
              storedPaper.title
            );

            // Handle summary growth: re-summarize after 2 summaries to prevent unbounded growth
            let finalSummary: string;
            let summaryCount: number;

            if (conversationState.summary && conversationState.summaryCount >= 2) {
              // Re-summarize the combined summary to prevent unbounded growth
              console.log('[Post-Stream] Re-summarizing combined summaries (count >= 2)');
              const combinedText = `${conversationState.summary}\n\n${newSummary}`;

              // Create a temporary array with combined summary for re-summarization
              const tempMessages: ChatMessage[] = [
                { role: 'assistant', content: combinedText, timestamp: Date.now() }
              ];

              const reSummarized = await aiService.summarizeConversation(tempMessages, storedPaper.title);
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

            // Update conversation state
            const newConversationState: ConversationState = {
              summary: finalSummary,
              recentMessages: newChatHistory.slice(-6),
              lastSummarizedIndex: newChatHistory.length - 7, // Index of last summarized message
              summaryCount
            };

            // Clone session with updated history
            await aiService.cloneSessionWithHistory(
              contextId,
              newConversationState,
              systemPrompt
            );

            // Save updated state to database
            await updatePaper(storedPaper.id, {
              chatHistory: newChatHistory,
              conversationState: newConversationState,
            });

            console.log('[ChatHandlers] ✓ Session cloned with summarized history');
          }
        }
      }
    } catch (postProcessError) {
      // Log post-processing errors but don't fail the request
      // The stream was successful and user already received their response
      console.error('[ChatHandlers] Post-stream processing error (non-critical):', postProcessError);
      console.error('[ChatHandlers] Token tracking or summarization failed, but message was delivered successfully');
    }

  } catch (error) {
    console.error('[ChatHandlers] Error processing chat message:', error);

    // Send error as a message to the chat
    await sendChatEnd(
      tabId,
      'Sorry, I encountered an error processing your message. Please try again.',
      []
    );
  }
}

/**
 * Handle sending a chat message with streaming response
 * Returns immediately to prevent message channel timeout
 * Actual streaming happens asynchronously
 */
export async function handleSendChatMessage(payload: any, sender: chrome.runtime.MessageSender): Promise<any> {
  const { paperUrl, message } = payload;
  const tabId = sender.tab?.id;

  if (!paperUrl || !message) {
    return {
      success: false,
      error: 'Paper URL and message are required',
    };
  }

  if (!tabId) {
    return {
      success: false,
      error: 'Tab ID is required for streaming responses',
    };
  }

  // Start streaming in background (don't block on it)
  processAndStreamResponse(paperUrl, message, tabId).catch(error => {
    console.error('[ChatHandlers] Unhandled streaming error:', error);
  });

  // Return success immediately to prevent message channel timeout
  // Actual response will come via CHAT_STREAM_CHUNK and CHAT_STREAM_END messages
  return { success: true };
}

/**
 * Update chat history for a paper
 */
export async function handleUpdateChatHistory(payload: any): Promise<any> {
  const { paperUrl, chatHistory } = payload;

  if (!paperUrl || !chatHistory) {
    return {
      success: false,
      error: 'Paper URL and chat history are required',
    };
  }

  try {
    console.log(`[ChatHandlers] Updating chat history for paper: ${paperUrl}`);

    // Get the paper
    const storedPaper = await getPaperByUrl(paperUrl);

    if (!storedPaper) {
      return {
        success: false,
        error: 'Paper not found in storage',
      };
    }

    // Update the chat history
    await updatePaper(storedPaper.id, { chatHistory });

    console.log('[ChatHandlers] ✓ Chat history updated successfully');
    return { success: true };
  } catch (error) {
    console.error('[ChatHandlers] Error updating chat history:', error);
    return {
      success: false,
      error: `Failed to update chat history: ${String(error)}`,
    };
  }
}

/**
 * Get chat history for a paper
 */
export async function handleGetChatHistory(payload: any): Promise<any> {
  const { paperUrl } = payload;

  if (!paperUrl) {
    return {
      success: false,
      error: 'Paper URL is required',
    };
  }

  try {
    console.log(`[ChatHandlers] Getting chat history for paper: ${paperUrl}`);

    // Get the paper
    const storedPaper = await getPaperByUrl(paperUrl);

    if (!storedPaper) {
      return {
        success: false,
        error: 'Paper not found in storage',
      };
    }

    const chatHistory = storedPaper.chatHistory || [];
    console.log(`[ChatHandlers] ✓ Retrieved ${chatHistory.length} chat messages`);

    return { success: true, chatHistory };
  } catch (error) {
    console.error('[ChatHandlers] Error getting chat history:', error);
    return {
      success: false,
      error: `Failed to get chat history: ${String(error)}`,
    };
  }
}

/**
 * Clear chat history for a paper
 * Also destroys the session to start fresh
 */
export async function handleClearChatHistory(payload: any): Promise<any> {
  const { paperUrl } = payload;

  if (!paperUrl) {
    return {
      success: false,
      error: 'Paper URL is required',
    };
  }

  try {
    console.log(`[ChatHandlers] Clearing chat history for paper: ${paperUrl}`);

    // Get the paper
    const storedPaper = await getPaperByUrl(paperUrl);

    if (!storedPaper) {
      return {
        success: false,
        error: 'Paper not found in storage',
      };
    }

    // Clear the chat history and conversation state
    await updatePaper(storedPaper.id, {
      chatHistory: [],
      conversationState: {
        summary: null,
        recentMessages: [],
        lastSummarizedIndex: -1,
        summaryCount: 0,
      },
    });

    // Destroy the session to start fresh
    const contextId = `chat-${storedPaper.id}`;
    aiService.destroySessionForContext(contextId);

    console.log('[ChatHandlers] ✓ Chat history cleared and session destroyed');
    return { success: true };
  } catch (error) {
    console.error('[ChatHandlers] Error clearing chat history:', error);
    return {
      success: false,
      error: `Failed to clear chat history: ${String(error)}`,
    };
  }
}

/**
 * IMAGE CHAT HANDLERS (Multi-tabbed Chatbox)
 * Handle multimodal chat about specific images with reduced RAG context
 */

/**
 * Process and stream image chat response asynchronously
 * Similar to processAndStreamResponse but with multimodal support and reduced RAG
 */
async function processAndStreamImageChatResponse(
  paperId: string,
  imageUrl: string,
  imageBlob: Blob,
  message: string,
  tabId: number
): Promise<void> {
  try {
    console.log(`[ImageChatHandlers] Processing image chat message for paper: ${paperId}, image: ${imageUrl}`);

    // Retrieve paper from IndexedDB
    const storedPaper = await getPaperByUrl(imageUrl); // Will fail, need to get by ID
    // Actually, we need to get paper by ID, not URL
    const { getPaperById } = await import('../../utils/dbService.ts');
    const paper = await getPaperById(paperId);

    if (!paper) {
      await sendImageChatEnd(tabId, 'Paper not found in storage. Please store the paper first.', []);
      return;
    }

    // Get relevant chunks with adaptive oversampling based on paper's chunk size
    const { getAdaptiveChunkLimit, trimChunksWithProgressiveFallback } = await import('../../utils/adaptiveRAGService.ts');
    const adaptiveLimit = await getAdaptiveChunkLimit(paperId, 'chat');
    const relevantChunks = await getRelevantChunksSemantic(paperId, message, adaptiveLimit);

    // Get conversation state for accurate token calculation
    const chatHistory = paper.chatHistory || [];
    const conversationState = paper.conversationState || {
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

    // Trim chunks with progressive conversation fallback
    const { chunks: trimmedChunks, budgetStatus, reducedRecentMessages } = await trimChunksWithProgressiveFallback(
      relevantChunks,
      'chat',
      ragConversationState
    );

    // Log if conversation was reduced
    if (reducedRecentMessages !== undefined) {
      console.log(`[ImageChatHandlers] Conversation reduced: ${recentMessages.length} → ${reducedRecentMessages} messages to fit RAG chunks`);
    }

    // If still not enough space, try summarization as last resort
    if (!budgetStatus.minTokensFit && chatHistory.length > 0) {
      console.log('[ImageChatHandlers] Progressive fallback exhausted, triggering summarization...');
      console.log(`[ImageChatHandlers] Budget: ${budgetStatus.usedTokens}/${budgetStatus.availableTokens} tokens, minTokensFit=${budgetStatus.minTokensFit}`);

      const updatedConversationState = await performPreSummarization(
        chatHistory,
        conversationState,
        paper.title
      );

      // Update stored paper with new conversation state
      await chrome.storage.local.set({
        [`papers.${paperId}`]: {
          ...paper,
          conversationState: updatedConversationState,
        },
      });

      console.log('[ImageChatHandlers] ✓ Summarization complete as last resort');
    }

    if (trimmedChunks.length === 0) {
      await sendImageChatEnd(tabId, 'No relevant content found to answer this question.', []);
      return;
    }

    console.log(`[ImageChatHandlers] Found ${trimmedChunks.length} relevant chunks (retrieved ${relevantChunks.length}, trimmed by token budget)`);

    // Format context from chunks with position and hierarchy
    const contextChunks = trimmedChunks.map(chunk => ({
      content: chunk.content,
      section: chunk.section || 'Unknown section',
      index: chunk.index,
      parentSection: chunk.parentSection,
      paragraphIndex: chunk.paragraphIndex,
      sentenceGroupIndex: chunk.sentenceGroupIndex,
    }));

    // Sort chunks by document order (index) for better context
    contextChunks.sort((a, b) => a.index - b.index);

    const sources = Array.from(new Set(contextChunks.map(c => c.section)));

    // Build context string with position and natural boundary hierarchy
    const contextString = contextChunks
      .map((chunk) => {
        // Build hierarchical citation path
        const hierarchy = chunk.parentSection
          ? `${chunk.parentSection} > ${chunk.section}`
          : chunk.section;

        // Add paragraph/sentence info if available (natural boundaries)
        let citation = `[${hierarchy}`;
        if (chunk.paragraphIndex !== undefined) {
          citation += ` > Para ${chunk.paragraphIndex + 1}`;
          if (chunk.sentenceGroupIndex !== undefined) {
            citation += ` > Sentences`;
          }
        }
        citation += `]`;

        return `${citation}\n${chunk.content}`;
      })
      .join('\n\n---\n\n');

    // Context ID for this image's chat session
    const { getImageChat, updateImageChat } = await import('../../utils/dbService.ts');

    // Generate hash for image URL (same logic as in dbService)
    let hash = 0;
    for (let i = 0; i < imageUrl.length; i++) {
      const char = imageUrl.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    const contextId = `image-chat-${paperId}-img_${Math.abs(hash)}`;

    // chatHistory and conversationState already retrieved above for RAG (lines 824-830)
    // But for imageChat, we need to get from imageChat object, not paper object
    const imageChat = await getImageChat(paperId, imageUrl);
    const imageChatHistory = imageChat?.chatHistory || [];
    const imageChatConversationState = imageChat?.conversationState || {
      summary: null,
      recentMessages: [],
      lastSummarizedIndex: -1,
      summaryCount: 0,
    };

    // System prompt for image chat (multimodal)
    const systemPrompt = `You are Kuma, a friendly research bear assistant helping users understand images from research papers.

Your role:
- Answer questions about the image and how it relates to the paper
- Be conversational and friendly, like a helpful colleague
- Explain complex concepts in simple terms
- Reference specific sections of the paper when relevant
- If the context doesn't contain enough information, say so honestly
- Remember previous conversation context to provide coherent follow-up answers

Important:
- Keep responses concise and conversational (2-4 sentences for simple questions, more for complex ones)
- Use everyday language, avoid unnecessary jargon
- Be encouraging and supportive
- If you cite information from the paper, mention which section it's from

Mathematical expressions:
- Use $expression$ for inline math (e.g., $E = mc^2$, $p < 0.05$)
- Use $$expression$$ for display equations on separate lines
- Alternative: \\(expression\\) for inline, \\[expression\\] for display
- Use proper LaTeX syntax (e.g., \\frac{a}{b}, \\sum_{i=1}^{n}, Greek letters like \\alpha, \\beta)

Paper title: ${paper.title}`;

    // Check if we need to create a new session with conversation history
    let session = aiService['sessions'].get(contextId);

    // If session exists, check if it needs summarization based on actual usage
    if (session) {
      const currentUsage = session.inputUsage ?? 0;
      const quota = session.inputQuota ?? 0;
      const usagePercentage = quota > 0 ? (currentUsage / quota) * 100 : 0;

      console.log(`[ImageChatHandlers] Existing session usage: ${currentUsage}/${quota} (${usagePercentage.toFixed(1)}%)`);

      // If session usage is high (>70%), summarize and recreate session
      if (usagePercentage > 70 && imageChatHistory.length > 0) {
        console.log('[ImageChatHandlers] Session usage >70%, triggering summarization and session recreation...');

        // Perform summarization
        const updatedConversationState = await performPreSummarization(
          imageChatHistory,
          imageChatConversationState,
          paper.title,
          paperId
        );

        // Update stored image chat with new conversation state
        await updateImageChat(paperId, imageUrl, {
          conversationState: updatedConversationState,
        });

        // Destroy old session
        aiService.destroySessionForContext(contextId);

        // Create new session with summarized history
        let systemPromptContent = systemPrompt;
        if (updatedConversationState.summary) {
          systemPromptContent += `\n\nPrevious conversation summary: ${updatedConversationState.summary}`;
        }

        const initialPrompts: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [
          { role: 'system', content: systemPromptContent }
        ];

        // Add recent messages (up to last 6)
        const recentMessages = imageChatHistory.slice(-6);
        for (const msg of recentMessages) {
          initialPrompts.push({
            role: msg.role,
            content: msg.content
          });
        }

        session = await aiService.getOrCreateSession(contextId, {
          initialPrompts,
          expectedInputs: [{ type: 'image', languages: ['en'] }]
        });
        console.log('[ImageChatHandlers] ✓ Session recreated after summarization');
      }
    } else if (imageChatHistory.length > 0) {
      // No session but have history - create with pre-summarization
      const updatedConversationState = await performPreSummarization(
        imageChatHistory,
        imageChatConversationState,
        paper.title,
        paperId
      );

      // Create new multimodal session with conversation history
      console.log('[ImageChatHandlers] Creating new multimodal session with', imageChatHistory.length, 'historical messages');

      let systemPromptContent = systemPrompt;
      if (updatedConversationState.summary) {
        systemPromptContent += `\n\nPrevious conversation summary: ${updatedConversationState.summary}`;
      }

      const initialPrompts: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [
        { role: 'system', content: systemPromptContent }
      ];

      // Add recent messages (up to last 6)
      const recentMessages = imageChatHistory.slice(-6);
      for (const msg of recentMessages) {
        initialPrompts.push({
          role: msg.role,
          content: msg.content
        });
      }

      session = await aiService.getOrCreateSession(contextId, {
        initialPrompts,
        expectedInputs: [{ type: 'image', languages: ['en'] }] // Enable multimodal
      });
    } else {
      // First message - create fresh multimodal session
      console.log('[ImageChatHandlers] Creating fresh multimodal session (first message)');
      session = await aiService.getOrCreateSession(contextId, {
        initialPrompts: [{ role: 'system', content: systemPrompt }],
        expectedInputs: [{ type: 'image', languages: ['en'] }] // Enable multimodal
      });
    }

    // Validate prompt size before sending (with retry logic)
    let finalContextChunks = contextChunks;
    let finalContextString = contextString;
    const MAX_RETRIES = 3;

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      const promptWithContext = `Context from the paper:
${finalContextString}

User question: ${message}`;

      // Validate prompt size using Chrome AI's measureInputUsage()
      // Note: For multimodal, we validate the text part (image tokens are fixed)
      const validation = await aiService.validatePromptSize(session, promptWithContext);

      if (validation.fits) {
        console.log(`[ImageChatHandlers] ✓ Prompt validation passed on attempt ${attempt} (${validation.actualUsage} tokens)`);
        break;
      }

      // Prompt too large - try trimming more chunks
      console.warn(`[ImageChatHandlers] Prompt too large (${validation.actualUsage} > ${validation.available}), trimming chunks... (attempt ${attempt}/${MAX_RETRIES})`);

      if (attempt >= MAX_RETRIES) {
        // Last attempt - use minimal chunks (just 1-2 most relevant)
        console.error(`[ImageChatHandlers] Max retries reached, using minimal chunks`);
        finalContextChunks = contextChunks.slice(0, Math.min(2, contextChunks.length));
      } else {
        // Remove last 2 chunks and retry (but keep at least 1 chunk)
        const newLength = Math.max(1, finalContextChunks.length - 2);
        finalContextChunks = finalContextChunks.slice(0, newLength);
      }

      if (finalContextChunks.length === 0) {
        console.error('[ImageChatHandlers] No chunks remaining after trimming');
        await sendImageChatEnd(tabId, 'Context too large even after aggressive trimming. Try a shorter question or use a model with larger context.', []);
        return;
      }

      // Rebuild context string with fewer chunks
      finalContextString = finalContextChunks
        .map((chunk) => {
          const hierarchy = chunk.parentSection
            ? `${chunk.parentSection} > ${chunk.section}`
            : chunk.section;

          let citation = `[${hierarchy}`;
          if (chunk.paragraphIndex !== undefined) {
            citation += ` > Para ${chunk.paragraphIndex + 1}`;
            if (chunk.sentenceGroupIndex !== undefined) {
              citation += ` > Sentences`;
            }
          }
          citation += `]`;

          return `${citation}\n${chunk.content}`;
        })
        .join('\n\n---\n\n');
    }

    // Update sources based on final context chunks used
    const finalSources = Array.from(new Set(finalContextChunks.map(c => c.section)));

    // Prepare multimodal message with image and text
    const promptWithContext = `Context from the paper:
${finalContextString}

User question: ${message}`;

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

    // Get streaming response
    let fullResponse = '';
    const stream = session.promptStreaming('');  // Empty prompt since we already appended the message

    // Process the stream
    for await (const chunk of stream) {
      fullResponse += chunk;
      await sendImageChatChunk(tabId, chunk);
    }

    console.log('[ImageChatHandlers] ✓ Image chat response streamed successfully');

    // Send end signal
    await sendImageChatEnd(tabId, fullResponse, finalSources);

    // Post-stream processing: save history and check for summarization
    try {
      // Update chat history with new messages
      const newChatHistory = [
        ...imageChatHistory,
        { role: 'user' as const, content: message, timestamp: Date.now() },
        { role: 'assistant' as const, content: fullResponse, timestamp: Date.now(), sources: finalSources }
      ];

      // Save to IndexedDB
      await updateImageChat(paperId, imageUrl, {
        chatHistory: newChatHistory,
        conversationState: imageChatConversationState,
      });

      // Track token usage
      const metadata = aiService.getSessionMetadata(contextId);

      if (metadata && metadata.needsSummarization) {
        console.log('[ImageChatHandlers] Token threshold reached, triggering summarization...');

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

          // Clone session with updated history (preserve multimodal image support)
          await aiService.cloneSessionWithHistory(
            contextId,
            newConversationState,
            systemPrompt,
            {
              expectedInputs: [{ type: 'image', languages: ['en'] }]
            }
          );

          // Save updated state
          await updateImageChat(paperId, imageUrl, {
            chatHistory: newChatHistory,
            conversationState: newConversationState,
          });

          console.log('[ImageChatHandlers] ✓ Session cloned with summarized history');
        }
      }
    } catch (postProcessError) {
      console.error('[ImageChatHandlers] Post-stream processing error:', postProcessError);
    }

  } catch (error) {
    console.error('[ImageChatHandlers] Error processing image chat message:', error);
    await sendImageChatEnd(tabId, 'Sorry, I encountered an error processing your message. Please try again.', []);
  }
}

/**
 * Send image chat stream chunk to content script
 */
async function sendImageChatChunk(tabId: number, chunk: string): Promise<void> {
  try {
    if (!await isTabValid(tabId)) {
      console.warn('[ImageChatHandlers] Tab', tabId, 'no longer exists, skipping chunk');
      return;
    }

    await chrome.tabs.sendMessage(tabId, {
      type: MessageType.IMAGE_CHAT_STREAM_CHUNK,
      payload: chunk,
    });
  } catch (error) {
    console.error('[ImageChatHandlers] Error sending image chat chunk:', error);
  }
}

/**
 * Send image chat stream end to content script
 */
async function sendImageChatEnd(tabId: number, fullMessage: string, sources?: string[]): Promise<void> {
  try {
    if (!await isTabValid(tabId)) {
      console.warn('[ImageChatHandlers] Tab', tabId, 'no longer exists, skipping stream end');
      return;
    }

    await chrome.tabs.sendMessage(tabId, {
      type: MessageType.IMAGE_CHAT_STREAM_END,
      payload: { fullMessage, sources },
    });
  } catch (error) {
    console.error('[ImageChatHandlers] Error sending image chat end:', error);
  }
}

/**
 * Handle sending an image chat message with streaming response
 */
export async function handleSendImageChatMessage(payload: any, sender: chrome.runtime.MessageSender): Promise<any> {
  const { paperId, imageUrl, imageDataBase64, imageMimeType, message } = payload;
  const tabId = sender.tab?.id;

  if (!paperId || !imageUrl || !imageDataBase64 || !imageMimeType || !message) {
    return {
      success: false,
      error: 'Paper ID, image URL, image data (Base64), image MIME type, and message are required',
    };
  }

  if (!tabId) {
    return {
      success: false,
      error: 'Tab ID is required for streaming responses',
    };
  }

  // Reconstruct Blob from Base64 string (Chrome messaging uses JSON serialization)
  const binaryString = atob(imageDataBase64);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  const imageBlob = new Blob([bytes], { type: imageMimeType });
  console.log('[ImageChatHandlers] Reconstructed blob from Base64:', imageBlob.size, 'bytes, type:', imageBlob.type);

  // Start streaming in background
  processAndStreamImageChatResponse(paperId, imageUrl, imageBlob, message, tabId).catch(error => {
    console.error('[ImageChatHandlers] Unhandled streaming error:', error);
  });

  // Return success immediately
  return { success: true };
}

/**
 * Get image chat history
 */
export async function handleGetImageChatHistory(payload: any): Promise<any> {
  const { paperId, imageUrl } = payload;

  if (!paperId || !imageUrl) {
    return {
      success: false,
      error: 'Paper ID and image URL are required',
    };
  }

  try {
    console.log(`[ImageChatHandlers] Getting image chat history for image: ${imageUrl}`);

    const { getImageChat } = await import('../../utils/dbService.ts');
    const imageChat = await getImageChat(paperId, imageUrl);

    const chatHistory = imageChat?.chatHistory || [];
    console.log(`[ImageChatHandlers] ✓ Retrieved ${chatHistory.length} image chat messages`);

    return { success: true, chatHistory };
  } catch (error) {
    console.error('[ImageChatHandlers] Error getting image chat history:', error);
    return {
      success: false,
      error: `Failed to get image chat history: ${String(error)}`,
    };
  }
}

/**
 * Update image chat history
 */
export async function handleUpdateImageChatHistory(payload: any): Promise<any> {
  const { paperId, imageUrl, chatHistory } = payload;

  if (!paperId || !imageUrl || !chatHistory) {
    return {
      success: false,
      error: 'Paper ID, image URL, and chat history are required',
    };
  }

  try {
    console.log(`[ImageChatHandlers] Updating image chat history for image: ${imageUrl}`);

    const { updateImageChat } = await import('../../utils/dbService.ts');
    await updateImageChat(paperId, imageUrl, { chatHistory });

    console.log('[ImageChatHandlers] ✓ Image chat history updated successfully');
    return { success: true };
  } catch (error) {
    console.error('[ImageChatHandlers] Error updating image chat history:', error);
    return {
      success: false,
      error: `Failed to update image chat history: ${String(error)}`,
    };
  }
}

/**
 * Clear image chat history
 */
export async function handleClearImageChatHistory(payload: any): Promise<any> {
  const { paperId, imageUrl } = payload;

  if (!paperId || !imageUrl) {
    return {
      success: false,
      error: 'Paper ID and image URL are required',
    };
  }

  try {
    console.log(`[ImageChatHandlers] Clearing image chat history for image: ${imageUrl}`);

    const { deleteImageChat } = await import('../../utils/dbService.ts');
    await deleteImageChat(paperId, imageUrl);

    // Destroy the session
    let hash = 0;
    for (let i = 0; i < imageUrl.length; i++) {
      const char = imageUrl.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    const contextId = `image-chat-${paperId}-img_${Math.abs(hash)}`;
    aiService.destroySessionForContext(contextId);

    console.log('[ImageChatHandlers] ✓ Image chat history cleared and session destroyed');
    return { success: true };
  } catch (error) {
    console.error('[ImageChatHandlers] Error clearing image chat history:', error);
    return {
      success: false,
      error: `Failed to clear image chat history: ${String(error)}`,
    };
  }
}
