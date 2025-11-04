import { ChromeMessageClient } from './base/ChromeMessageClient.ts';
import { MessageType, ChatMessage, ImageExplanation } from '../../shared/types/index.ts';
import type { ScreenCaptureEntry } from '../../shared/utils/dbService.ts';
import { logger } from '../../shared/utils/logger.ts';

/**
 * Response interfaces for chat operations
 */
export interface SendChatMessageResponse {
  success: boolean;
  error?: string;
}

export interface UpdateChatHistoryResponse {
  success: boolean;
  error?: string;
}

export interface GetChatHistoryResponse {
  success: boolean;
  error?: string;
  chatHistory?: ChatMessage[];
}

export interface SendImageChatMessageResponse {
  success: boolean;
  error?: string;
}

export interface GetImageChatHistoryResponse {
  success: boolean;
  error?: string;
  chatHistory?: ChatMessage[];
}

export interface UpdateImageChatHistoryResponse {
  success: boolean;
  error?: string;
}

export interface StoreImageExplanationResponse {
  success: boolean;
  error?: string;
  explanation?: ImageExplanation;
}

export interface GetImageExplanationResponse {
  success: boolean;
  error?: string;
  explanation?: ImageExplanation | null;
}

export interface GetImageExplanationsByPaperResponse {
  success: boolean;
  error?: string;
  explanations?: ImageExplanation[];
}

export interface StoreScreenCaptureResponse {
  success: boolean;
  error?: string;
  entry?: ScreenCaptureEntry;
}

export interface GetScreenCaptureResponse {
  success: boolean;
  error?: string;
  entry?: ScreenCaptureEntry | null;
}

/**
 * ChatServiceClient - Handles all chat-related operations
 *
 * Responsibilities:
 * - Text chat operations (send, get history, update history, clear)
 * - Image chat operations (multimodal chat about specific images)
 * - Chat history management for both text and image chats
 */
export class ChatServiceClient extends ChromeMessageClient {
  /**
   * Send a chat message about a paper
   * Returns immediately - streaming responses are sent via CHAT_STREAM_CHUNK messages
   *
   * @param paperUrl - URL of the paper
   * @param message - Chat message text
   * @returns Promise resolving to SendChatMessageResponse
   */
  async sendChatMessage(paperUrl: string, message: string): Promise<SendChatMessageResponse> {
    logger.debug('CHAT_CLIENT', 'Sending chat message:', message);

    try {
      const response = await this.sendMessage<{ success: boolean; error?: string }>(
        MessageType.SEND_CHAT_MESSAGE,
        {
          paperUrl,
          message: message.trim(),
        }
      );

      if (response.success) {
        logger.debug('CHAT_CLIENT', '✓ Chat message sent successfully');
        return { success: true };
      } else {
        logger.error('CHAT_CLIENT', 'Chat message failed:', response.error);
        return { success: false, error: response.error };
      }
    } catch (error) {
      logger.error('CHAT_CLIENT', 'Error sending chat message:', error);
      return { success: false, error: String(error) };
    }
  }

  /**
   * Update chat history for a paper in IndexedDB
   *
   * @param paperUrl - URL of the paper
   * @param chatHistory - Array of ChatMessage objects
   * @returns Promise resolving to UpdateChatHistoryResponse
   */
  async updateChatHistory(paperUrl: string, chatHistory: ChatMessage[]): Promise<UpdateChatHistoryResponse> {
    logger.debug('CHAT_CLIENT', 'Updating chat history for paper:', paperUrl);

    try {
      const response = await this.sendMessage<{ success: boolean; error?: string }>(
        MessageType.UPDATE_CHAT_HISTORY,
        { paperUrl, chatHistory }
      );

      if (response.success) {
        logger.debug('CHAT_CLIENT', '✓ Chat history updated successfully');
        return { success: true };
      } else {
        logger.error('CHAT_CLIENT', 'Failed to update chat history:', response.error);
        return { success: false, error: response.error };
      }
    } catch (error) {
      logger.error('CHAT_CLIENT', 'Error updating chat history:', error);
      return { success: false, error: String(error) };
    }
  }

  /**
   * Get chat history for a paper from IndexedDB
   *
   * @param paperUrl - URL of the paper
   * @returns Promise resolving to GetChatHistoryResponse
   */
  async getChatHistory(paperUrl: string): Promise<GetChatHistoryResponse> {
    logger.debug('CHAT_CLIENT', 'Getting chat history for paper:', paperUrl);

    try {
      const response = await this.sendMessage<{ success: boolean; error?: string; chatHistory?: ChatMessage[] }>(
        MessageType.GET_CHAT_HISTORY,
        { paperUrl }
      );

      if (response.success) {
        logger.debug('CHAT_CLIENT', '✓ Chat history retrieved successfully');
        return { success: true, chatHistory: response.chatHistory || [] };
      } else {
        logger.error('CHAT_CLIENT', 'Failed to get chat history:', response.error);
        return { success: false, error: response.error };
      }
    } catch (error) {
      logger.error('CHAT_CLIENT', 'Error getting chat history:', error);
      return { success: false, error: String(error) };
    }
  }

  /**
   * Clear chat history for a paper
   *
   * @param paperUrl - URL of the paper
   * @returns Promise resolving to UpdateChatHistoryResponse
   */
  async clearChatHistory(paperUrl: string): Promise<UpdateChatHistoryResponse> {
    logger.debug('CHAT_CLIENT', 'Clearing chat history for paper:', paperUrl);

    try {
      const response = await this.sendMessage<{ success: boolean; error?: string }>(
        MessageType.CLEAR_CHAT_HISTORY,
        { paperUrl }
      );

      if (response.success) {
        logger.debug('CHAT_CLIENT', '✓ Chat history cleared successfully');
        return { success: true };
      } else {
        logger.error('CHAT_CLIENT', 'Failed to clear chat history:', response.error);
        return { success: false, error: response.error };
      }
    } catch (error) {
      logger.error('CHAT_CLIENT', 'Error clearing chat history:', error);
      return { success: false, error: String(error) };
    }
  }

  /**
   * Send an image chat message (multimodal chat about a specific image)
   * Returns immediately - streaming responses are sent via IMAGE_CHAT_STREAM_CHUNK messages
   *
   * @param paperId - ID of the paper
   * @param imageUrl - URL of the image
   * @param imageBlob - Blob data of the image
   * @param message - Chat message text
   * @returns Promise resolving to SendImageChatMessageResponse
   */
  async sendImageChatMessage(
    paperId: string,
    imageUrl: string,
    imageBlob: Blob,
    message: string
  ): Promise<SendImageChatMessageResponse> {
    logger.debug('CHAT_CLIENT', 'Sending image chat message:', message);

    try {
      // Convert Blob to Base64 for Chrome messaging (Chrome uses JSON serialization, not structured cloning)
      const arrayBuffer = await imageBlob.arrayBuffer();
      const uint8Array = new Uint8Array(arrayBuffer);
      const imageMimeType = imageBlob.type;

      // Convert Uint8Array to Base64 string (chunk to avoid call stack overflow on large images)
      const chunkSize = 0x8000; // 32KB chunks
      let binaryString = '';
      for (let i = 0; i < uint8Array.length; i += chunkSize) {
        const chunk = uint8Array.subarray(i, Math.min(i + chunkSize, uint8Array.length));
        binaryString += String.fromCharCode.apply(null, Array.from(chunk));
      }
      const imageDataBase64 = btoa(binaryString);

      logger.debug('CHAT_CLIENT', 'Converted blob to Base64:', imageDataBase64.length, 'chars, type:', imageMimeType);

      const response = await this.sendMessage<{ success: boolean; error?: string }>(MessageType.IMAGE_CHAT_MESSAGE, {
        paperId,
        imageUrl,
        imageDataBase64,
        imageMimeType,
        message: message.trim(),
      });

      if (response.success) {
        logger.debug('CHAT_CLIENT', '✓ Image chat message sent successfully');
        return { success: true };
      } else {
        logger.error('CHAT_CLIENT', 'Image chat message failed:', response.error);
        return { success: false, error: response.error };
      }
    } catch (error) {
      logger.error('CHAT_CLIENT', 'Error sending image chat message:', error);
      return { success: false, error: String(error) };
    }
  }

  /**
   * Get image chat history from IndexedDB
   *
   * @param paperId - ID of the paper
   * @param imageUrl - URL of the image
   * @returns Promise resolving to GetImageChatHistoryResponse
   */
  async getImageChatHistory(paperId: string, imageUrl: string): Promise<GetImageChatHistoryResponse> {
    logger.debug('CHAT_CLIENT', 'Getting image chat history for image:', imageUrl);

    try {
      const response = await this.sendMessage<{ success: boolean; error?: string; chatHistory?: ChatMessage[] }>(
        MessageType.GET_IMAGE_CHAT_HISTORY,
        { paperId, imageUrl }
      );

      if (response.success) {
        logger.debug('CHAT_CLIENT', '✓ Image chat history retrieved successfully');
        return { success: true, chatHistory: response.chatHistory || [] };
      } else {
        logger.error('CHAT_CLIENT', 'Failed to get image chat history:', response.error);
        return { success: false, error: response.error };
      }
    } catch (error) {
      logger.error('CHAT_CLIENT', 'Error getting image chat history:', error);
      return { success: false, error: String(error) };
    }
  }

  /**
   * Update image chat history in IndexedDB
   *
   * @param paperId - ID of the paper
   * @param imageUrl - URL of the image
   * @param chatHistory - Array of ChatMessage objects
   * @returns Promise resolving to UpdateImageChatHistoryResponse
   */
  async updateImageChatHistory(
    paperId: string,
    imageUrl: string,
    chatHistory: ChatMessage[]
  ): Promise<UpdateImageChatHistoryResponse> {
    logger.debug('CHAT_CLIENT', 'Updating image chat history for image:', imageUrl);

    try {
      const response = await this.sendMessage<{ success: boolean; error?: string }>(
        MessageType.UPDATE_IMAGE_CHAT_HISTORY,
        { paperId, imageUrl, chatHistory }
      );

      if (response.success) {
        logger.debug('CHAT_CLIENT', '✓ Image chat history updated successfully');
        return { success: true };
      } else {
        logger.error('CHAT_CLIENT', 'Failed to update image chat history:', response.error);
        return { success: false, error: response.error };
      }
    } catch (error) {
      logger.error('CHAT_CLIENT', 'Error updating image chat history:', error);
      return { success: false, error: String(error) };
    }
  }

  /**
   * Clear image chat history from IndexedDB
   *
   * @param paperId - ID of the paper
   * @param imageUrl - URL of the image
   * @returns Promise resolving to UpdateImageChatHistoryResponse
   */
  async clearImageChatHistory(paperId: string, imageUrl: string): Promise<UpdateImageChatHistoryResponse> {
    logger.debug('CHAT_CLIENT', 'Clearing image chat history for image:', imageUrl);

    try {
      const response = await this.sendMessage<{ success: boolean; error?: string }>(
        MessageType.CLEAR_IMAGE_CHAT_HISTORY,
        { paperId, imageUrl }
      );

      if (response.success) {
        logger.debug('CHAT_CLIENT', '✓ Image chat history cleared successfully');
        return { success: true };
      } else {
        logger.error('CHAT_CLIENT', 'Failed to clear image chat history:', response.error);
        return { success: false, error: response.error };
      }
    } catch (error) {
      logger.error('CHAT_CLIENT', 'Error clearing image chat history:', error);
      return { success: false, error: String(error) };
    }
  }

  /**
   * Store an image explanation in IndexedDB
   *
   * @param paperId - ID of the paper
   * @param imageUrl - URL of the image
   * @param title - Title of the explanation
   * @param explanation - Explanation text
   * @param imageHash - Optional hash of the image
   * @returns Promise resolving to StoreImageExplanationResponse
   */
  async storeImageExplanation(
    paperId: string,
    imageUrl: string,
    title: string,
    explanation: string,
    imageHash?: string
  ): Promise<StoreImageExplanationResponse> {
    logger.debug('CHAT_CLIENT', 'Storing image explanation for:', imageUrl);

    try {
      const response = await this.sendMessage<StoreImageExplanationResponse>(
        MessageType.STORE_IMAGE_EXPLANATION,
        { paperId, imageUrl, title, explanation, imageHash }
      );

      if (response.success) {
        logger.debug('CHAT_CLIENT', '✓ Image explanation stored successfully');
        return response;
      } else {
        logger.error('CHAT_CLIENT', 'Failed to store image explanation:', response.error);
        return response;
      }
    } catch (error) {
      logger.error('CHAT_CLIENT', 'Error storing image explanation:', error);
      return { success: false, error: String(error) };
    }
  }

  /**
   * Get an image explanation from IndexedDB
   *
   * @param paperId - ID of the paper
   * @param imageUrl - URL of the image
   * @returns Promise resolving to GetImageExplanationResponse
   */
  async getImageExplanation(paperId: string, imageUrl: string): Promise<GetImageExplanationResponse> {
    logger.debug('CHAT_CLIENT', 'Getting image explanation for:', imageUrl);

    try {
      const response = await this.sendMessage<GetImageExplanationResponse>(
        MessageType.GET_IMAGE_EXPLANATION,
        { paperId, imageUrl }
      );

      if (response.success) {
        logger.debug('CHAT_CLIENT', '✓ Image explanation retrieved');
        return response;
      } else {
        logger.error('CHAT_CLIENT', 'Failed to get image explanation:', response.error);
        return response;
      }
    } catch (error) {
      logger.error('CHAT_CLIENT', 'Error getting image explanation:', error);
      return { success: false, error: String(error) };
    }
  }

  /**
   * Get all image explanations for a paper from IndexedDB
   *
   * @param paperId - ID of the paper
   * @returns Promise resolving to GetImageExplanationsByPaperResponse
   */
  async getImageExplanationsByPaper(paperId: string): Promise<GetImageExplanationsByPaperResponse> {
    logger.debug('CHAT_CLIENT', 'Getting all image explanations for paper:', paperId);

    try {
      const response = await this.sendMessage<GetImageExplanationsByPaperResponse>(
        MessageType.GET_IMAGE_EXPLANATIONS_BY_PAPER,
        { paperId }
      );

      if (response.success) {
        logger.debug('CHAT_CLIENT', '✓ Retrieved', response.explanations?.length || 0, 'image explanations');
        return response;
      } else {
        logger.error('CHAT_CLIENT', 'Failed to get image explanations:', response.error);
        return response;
      }
    } catch (error) {
      logger.error('CHAT_CLIENT', 'Error getting image explanations:', error);
      return { success: false, error: String(error), explanations: [] };
    }
  }

  /**
   * Delete an image explanation from IndexedDB
   *
   * @param paperId - ID of the paper
   * @param imageUrl - URL of the image
   * @returns Promise resolving to response with success status
   */
  async deleteImageExplanation(paperId: string, imageUrl: string): Promise<{ success: boolean; error?: string }> {
    logger.debug('CHAT_CLIENT', 'Deleting image explanation for:', imageUrl);

    try {
      const response = await this.sendMessage<{ success: boolean; error?: string }>(
        MessageType.DELETE_IMAGE_EXPLANATION,
        { paperId, imageUrl }
      );

      if (response.success) {
        logger.debug('CHAT_CLIENT', '✓ Image explanation deleted successfully');
        return response;
      } else {
        logger.error('CHAT_CLIENT', 'Failed to delete image explanation:', response.error);
        return response;
      }
    } catch (error) {
      logger.error('CHAT_CLIENT', 'Error deleting image explanation:', error);
      return { success: false, error: String(error) };
    }
  }

  /**
   * Store a screen capture blob in IndexedDB
   *
   * @param paperId - ID of the paper
   * @param imageUrl - URL of the image
   * @param blob - Blob data of the screen capture
   * @param overlayPosition - Optional position data for the overlay
   * @returns Promise resolving to StoreScreenCaptureResponse
   */
  async storeScreenCapture(
    paperId: string,
    imageUrl: string,
    blob: Blob,
    overlayPosition?: { pageX: number; pageY: number; width: number; height: number }
  ): Promise<StoreScreenCaptureResponse> {
    logger.debug('CHAT_CLIENT', 'Storing screen capture:', imageUrl);

    try {
      // Convert Blob to Base64 for Chrome messaging (Chrome uses JSON serialization, not structured cloning)
      const arrayBuffer = await blob.arrayBuffer();
      const uint8Array = new Uint8Array(arrayBuffer);
      const mimeType = blob.type;

      // Convert Uint8Array to Base64 string (chunk to avoid call stack overflow on large images)
      const chunkSize = 0x8000; // 32KB chunks
      let binaryString = '';
      for (let i = 0; i < uint8Array.length; i += chunkSize) {
        const chunk = uint8Array.subarray(i, Math.min(i + chunkSize, uint8Array.length));
        binaryString += String.fromCharCode.apply(null, Array.from(chunk));
      }
      const blobDataBase64 = btoa(binaryString);

      logger.debug('CHAT_CLIENT', 'Converted blob to Base64:', blobDataBase64.length, 'chars, type:', mimeType);

      const response = await this.sendMessage<StoreScreenCaptureResponse>(MessageType.STORE_SCREEN_CAPTURE, {
        paperId,
        imageUrl,
        blobDataBase64,
        mimeType,
        overlayPosition,
      });

      if (response.success) {
        logger.debug('CHAT_CLIENT', '✓ Screen capture stored successfully');
        return response;
      } else {
        logger.error('CHAT_CLIENT', 'Failed to store screen capture:', response.error);
        return response;
      }
    } catch (error) {
      logger.error('CHAT_CLIENT', 'Error storing screen capture:', error);
      return { success: false, error: String(error) };
    }
  }

  /**
   * Get a screen capture blob from IndexedDB
   *
   * @param paperId - ID of the paper
   * @param imageUrl - URL of the image
   * @returns Promise resolving to GetScreenCaptureResponse with reconstructed Blob
   */
  async getScreenCapture(paperId: string, imageUrl: string): Promise<GetScreenCaptureResponse> {
    logger.debug('CHAT_CLIENT', 'Getting screen capture:', imageUrl);

    try {
      const response = await this.sendMessage<{
        success: boolean;
        error?: string;
        entry?: {
          paperId: string;
          imageUrl: string;
          timestamp: number;
          blobDataBase64: string;
          mimeType: string;
          overlayPosition?: { pageX: number; pageY: number; width: number; height: number };
        };
      }>(MessageType.GET_SCREEN_CAPTURE, { paperId, imageUrl });

      if (response.success && response.entry) {
        // Reconstruct Blob from Base64 string (Chrome messaging uses JSON serialization)
        const binaryString = atob(response.entry.blobDataBase64);
        const bytes = new Uint8Array(binaryString.length);
        for (let i = 0; i < binaryString.length; i++) {
          bytes[i] = binaryString.charCodeAt(i);
        }
        const blob = new Blob([bytes], { type: response.entry.mimeType });
        logger.debug('CHAT_CLIENT', '✓ Screen capture retrieved and reconstructed blob:', blob.size, 'bytes');

        return {
          success: true,
          entry: {
            paperId: response.entry.paperId,
            imageUrl: response.entry.imageUrl,
            timestamp: response.entry.timestamp,
            blob,
            overlayPosition: response.entry.overlayPosition,
          },
        };
      } else if (response.success) {
        logger.debug('CHAT_CLIENT', 'Screen capture not found');
        return response;
      } else {
        logger.error('CHAT_CLIENT', 'Failed to get screen capture:', response.error);
        return response;
      }
    } catch (error) {
      logger.error('CHAT_CLIENT', 'Error getting screen capture:', error);
      return { success: false, error: String(error) };
    }
  }

  /**
   * Delete a screen capture from IndexedDB
   *
   * @param paperId - ID of the paper
   * @param imageUrl - URL of the image
   * @returns Promise resolving to response with success status
   */
  async deleteScreenCapture(paperId: string, imageUrl: string): Promise<{ success: boolean; error?: string }> {
    logger.debug('CHAT_CLIENT', 'Deleting screen capture:', imageUrl);

    try {
      const response = await this.sendMessage<{ success: boolean; error?: string }>(
        MessageType.DELETE_SCREEN_CAPTURE,
        { paperId, imageUrl }
      );

      if (response.success) {
        logger.debug('CHAT_CLIENT', '✓ Screen capture deleted successfully');
        return response;
      } else {
        logger.error('CHAT_CLIENT', 'Failed to delete screen capture:', response.error);
        return response;
      }
    } catch (error) {
      logger.error('CHAT_CLIENT', 'Error deleting screen capture:', error);
      return { success: false, error: String(error) };
    }
  }
}
