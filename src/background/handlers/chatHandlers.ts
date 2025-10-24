import { MessageType, ChatMessage, ConversationState } from '../../types/index.ts';
import { getPaperByUrl, getRelevantChunksSemantic, updatePaper } from '../../utils/dbService.ts';
import { aiService } from '../../utils/aiService.ts';

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

    // Get relevant chunks based on the message (top 4 chunks)
    const relevantChunks = await getRelevantChunksSemantic(storedPaper.id, message, 4);

    if (relevantChunks.length === 0) {
      return {
        success: false,
        error: 'No relevant content found to answer this question.',
      };
    }

    console.log(`[ChatHandlers] Found ${relevantChunks.length} relevant chunks for chat message`);

    // Format context from chunks
    const contextChunks = relevantChunks.map(chunk => ({
      content: chunk.content,
      section: chunk.section || 'Unknown section',
    }));

    const sources = Array.from(new Set(contextChunks.map(c => c.section)));

    // Build context string
    const contextString = contextChunks
      .map((chunk, idx) => `[Section: ${chunk.section}]\n${chunk.content}`)
      .join('\n\n---\n\n');

    // Context ID for this paper's chat session
    const contextId = `chat-${storedPaper.id}`;

    // Get existing chat history and conversation state
    const chatHistory = storedPaper.chatHistory || [];
    const conversationState = storedPaper.conversationState || {
      summary: null,
      recentMessages: [],
      lastSummarizedIndex: -1,
      summaryCount: 0,
    };

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

    if (!session && chatHistory.length > 0) {
      // Perform pre-summarization check to avoid quota errors
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
    } else if (!session) {
      // First message - create fresh session
      console.log('[ChatHandlers] Creating fresh session (first message)');
      session = await aiService.getOrCreateSession(contextId, {
        initialPrompts: [{ role: 'system', content: systemPrompt }]
      });
    }

    // Stream the response
    // Include RAG context in the actual prompt (not in initialPrompts) to save quota
    const promptWithContext = `Context from the paper:
${contextString}

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
    await sendChatEnd(tabId, fullResponse, sources);

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
            { role: 'assistant', content: fullResponse, timestamp: Date.now(), sources }
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
