import { getPaperByUrl, updatePaper } from '../../shared/utils/dbService.ts';
import { aiService } from '../../shared/utils/aiService.ts';
import { logger } from '../../shared/utils/logger.ts';
import { LatexProcessingService } from '../services/LatexProcessingService.ts';
import { ChatRAGService } from '../services/ChatRAGService.ts';
import { ChatStreamingUtility } from '../services/chat/ChatStreamingUtility.ts';
import { ChatContextService } from '../services/chat/ChatContextService.ts';
import { PaperChatStreamProcessor } from '../services/chat/PaperChatStreamProcessor.ts';
import { ImageChatStreamProcessor } from '../services/chat/ImageChatStreamProcessor.ts';

/**
 * Chat Message Handlers (Coordinator)
 *
 * Thin coordinator that delegates chat operations to specialized services:
 * - PaperChatStreamProcessor: Handles paper chat streaming
 * - ImageChatStreamProcessor: Handles image chat streaming (multimodal)
 * - ChatContextService: Context validation and summarization
 * - ChatStreamingUtility: Tab communication
 *
 * This file maintains the public API for chat handlers while delegating
 * implementation to focused service classes.
 */

// Initialize services (singletons for all chat operations)
const latexService = new LatexProcessingService();
const ragService = new ChatRAGService();
const streamingUtility = new ChatStreamingUtility();
const contextService = new ChatContextService();

// Initialize processors with dependencies
const paperChatProcessor = new PaperChatStreamProcessor(
  ragService,
  latexService,
  streamingUtility,
  contextService
);

const imageChatProcessor = new ImageChatStreamProcessor(
  ragService,
  latexService,
  streamingUtility,
  contextService
);

/**
 * =============================================================================
 * PAPER CHAT HANDLERS
 * =============================================================================
 */

/**
 * Handle sending a chat message with streaming response
 * Returns immediately to prevent message channel timeout
 * Actual streaming happens asynchronously via PaperChatStreamProcessor
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

  // Delegate to PaperChatStreamProcessor (runs in background)
  paperChatProcessor.processAndStream(paperUrl, message, tabId).catch(error => {
    logger.error('CHATBOX', '[ChatHandlers] Unhandled streaming error:', error);
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
    logger.debug('CHATBOX', `[ChatHandlers] Updating chat history for paper: ${paperUrl}`);

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

    logger.debug('CHATBOX', '[ChatHandlers] ✓ Chat history updated successfully');
    return { success: true };
  } catch (error) {
    logger.error('CHATBOX', '[ChatHandlers] Error updating chat history:', error);
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
    logger.debug('CHATBOX', `[ChatHandlers] Getting chat history for paper: ${paperUrl}`);

    // Get the paper
    const storedPaper = await getPaperByUrl(paperUrl);

    if (!storedPaper) {
      return {
        success: false,
        error: 'Paper not found in storage',
      };
    }

    const chatHistory = storedPaper.chatHistory || [];
    logger.debug('CHATBOX', `[ChatHandlers] ✓ Retrieved ${chatHistory.length} chat messages`);

    return { success: true, chatHistory };
  } catch (error) {
    logger.error('CHATBOX', '[ChatHandlers] Error getting chat history:', error);
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
    logger.debug('CHATBOX', `[ChatHandlers] Clearing chat history for paper: ${paperUrl}`);

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
    await aiService.destroySessionForContext(contextId);

    logger.debug('CHATBOX', '[ChatHandlers] ✓ Chat history cleared and session destroyed');
    return { success: true };
  } catch (error) {
    logger.error('CHATBOX', '[ChatHandlers] Error clearing chat history:', error);
    return {
      success: false,
      error: `Failed to clear chat history: ${String(error)}`,
    };
  }
}

/**
 * =============================================================================
 * IMAGE CHAT HANDLERS (Multi-tabbed Chatbox)
 * =============================================================================
 */

/**
 * Handle sending an image chat message with streaming response
 * Supports multimodal input (image + text)
 * Returns immediately to prevent message channel timeout
 * Actual streaming happens asynchronously via ImageChatStreamProcessor
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
  logger.debug('CHATBOX', '[ChatHandlers] Reconstructed blob from Base64:', imageBlob.size, 'bytes, type:', imageBlob.type);

  // Delegate to ImageChatStreamProcessor (runs in background)
  imageChatProcessor.processAndStream(paperId, imageUrl, imageBlob, message, tabId).catch(error => {
    logger.error('CHATBOX', '[ChatHandlers] Unhandled streaming error:', error);
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
    logger.debug('CHATBOX', `[ChatHandlers] Getting image chat history for image: ${imageUrl}`);

    const { getImageChat } = await import('../../shared/utils/dbService.ts');
    const imageChat = await getImageChat(paperId, imageUrl);

    const chatHistory = imageChat?.chatHistory || [];
    logger.debug('CHATBOX', `[ChatHandlers] ✓ Retrieved ${chatHistory.length} image chat messages`);

    return { success: true, chatHistory };
  } catch (error) {
    logger.error('CHATBOX', '[ChatHandlers] Error getting image chat history:', error);
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
    logger.debug('CHATBOX', `[ChatHandlers] Updating image chat history for image: ${imageUrl}`);

    const { updateImageChat } = await import('../../shared/utils/dbService.ts');
    await updateImageChat(paperId, imageUrl, { chatHistory });

    logger.debug('CHATBOX', '[ChatHandlers] ✓ Image chat history updated successfully');
    return { success: true };
  } catch (error) {
    logger.error('CHATBOX', '[ChatHandlers] Error updating image chat history:', error);
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
    logger.debug('CHATBOX', `[ChatHandlers] Clearing image chat history for image: ${imageUrl}`);

    const { deleteImageChat } = await import('../../shared/utils/dbService.ts');
    await deleteImageChat(paperId, imageUrl);

    // Destroy the session
    let hash = 0;
    for (let i = 0; i < imageUrl.length; i++) {
      const char = imageUrl.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    const contextId = `image-chat-${paperId}-img_${Math.abs(hash)}`;
    await aiService.destroySessionForContext(contextId);

    logger.debug('CHATBOX', '[ChatHandlers] ✓ Image chat history cleared and session destroyed');
    return { success: true };
  } catch (error) {
    logger.error('CHATBOX', '[ChatHandlers] Error clearing image chat history:', error);
    return {
      success: false,
      error: `Failed to clear image chat history: ${String(error)}`,
    };
  }
}
