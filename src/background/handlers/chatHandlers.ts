import { MessageType, ChatMessage } from '../../types/index.ts';
import { getPaperByUrl, getRelevantChunksSemantic, updatePaper } from '../../utils/dbService.ts';

/**
 * Chat Message Handlers
 * Handles chat-related operations with streaming support
 */

/**
 * Send a streaming chat message chunk to content script
 */
async function sendChatChunk(tabId: number, chunk: string): Promise<void> {
  try {
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
    await chrome.tabs.sendMessage(tabId, {
      type: MessageType.CHAT_STREAM_END,
      payload: { fullMessage, sources },
    });
  } catch (error) {
    console.error('[ChatHandlers] Error sending chat end to tab:', error);
  }
}

/**
 * Handle sending a chat message with streaming response
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

    // Get relevant chunks based on the message (top 5 chunks)
    // Uses semantic search with automatic fallback to keyword search
    const relevantChunks = await getRelevantChunksSemantic(storedPaper.id, message, 5);

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

    // Create streaming session using Chrome's Prompt API (LanguageModel)
    const session = await LanguageModel.create({
      initialPrompts: [
        {
          role: 'system',
          content: `You are Kuma, a friendly research bear assistant helping users understand research papers.

Your role:
- Answer questions about the research paper based on the provided context
- Be conversational and friendly, like a helpful colleague
- Explain complex concepts in simple terms
- Reference specific sections when relevant
- If the context doesn't contain enough information, say so honestly

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

Paper title: ${storedPaper.title}

Context from the paper:
${contextString}`
        }
      ]
    });

    // Stream the response
    let fullResponse = '';
    const stream = session.promptStreaming(message);

    // Process the stream
    for await (const chunk of stream) {
      fullResponse += chunk;
      // Send incremental updates (send the accumulated deltas)
      await sendChatChunk(tabId, chunk);
    }

    // Clean up session
    session.destroy();

    console.log('[ChatHandlers] ✓ Chat response streamed successfully');

    // Send end signal with sources
    await sendChatEnd(tabId, fullResponse, sources);

    return { success: true };
  } catch (error) {
    console.error('[ChatHandlers] Error processing chat message:', error);

    // Send error as a message to the chat
    await sendChatEnd(
      tabId,
      'Sorry, I encountered an error processing your message. Please try again.',
      []
    );

    return {
      success: false,
      error: `Failed to process chat message: ${String(error)}`,
    };
  }
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

    // Clear the chat history
    await updatePaper(storedPaper.id, { chatHistory: [] });

    console.log('[ChatHandlers] ✓ Chat history cleared successfully');
    return { success: true };
  } catch (error) {
    console.error('[ChatHandlers] Error clearing chat history:', error);
    return {
      success: false,
      error: `Failed to clear chat history: ${String(error)}`,
    };
  }
}
