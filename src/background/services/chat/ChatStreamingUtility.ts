import { MessageType, SourceInfo } from '../../../shared/types/index.ts';
import { logger } from '../../../shared/utils/logger.ts';

/**
 * ChatStreamingUtility
 *
 * Utility service for streaming chat messages to content scripts.
 * Handles tab validation and message sending for both paper and image chats.
 *
 * Responsibilities:
 * - Tab validation (ensure tab exists before sending)
 * - Send chat stream chunks
 * - Send chat stream end messages
 * - Token estimation
 * - Quota error detection
 */
export class ChatStreamingUtility {
  /**
   * Validate that a tab exists and is still available
   */
  async isTabValid(tabId: number): Promise<boolean> {
    try {
      const tab = await chrome.tabs.get(tabId);
      return !!tab;
    } catch (error) {
      // Tab was closed or doesn't exist
      return false;
    }
  }

  /**
   * Send a streaming chat message chunk to content script (paper chat)
   */
  async sendPaperChatChunk(tabId: number, chunk: string): Promise<void> {
    try {
      // Validate tab exists before sending
      if (!await this.isTabValid(tabId)) {
        logger.warn('CHATBOX', '[ChatStreamingUtility] Tab', tabId, 'no longer exists, skipping chunk');
        return;
      }

      await chrome.tabs.sendMessage(tabId, {
        type: MessageType.CHAT_STREAM_CHUNK,
        payload: chunk,
      });
    } catch (error) {
      logger.error('CHATBOX', '[ChatStreamingUtility] Error sending chat chunk to tab:', error);
    }
  }

  /**
   * Send chat stream end message to content script (paper chat)
   */
  async sendPaperChatEnd(
    tabId: number,
    fullMessage: string,
    sources?: string[],
    sourceInfo?: SourceInfo[]
  ): Promise<void> {
    try {
      // Validate tab exists before sending
      if (!await this.isTabValid(tabId)) {
        logger.warn('CHATBOX', '[ChatStreamingUtility] Tab', tabId, 'no longer exists, skipping stream end');
        return;
      }

      await chrome.tabs.sendMessage(tabId, {
        type: MessageType.CHAT_STREAM_END,
        payload: { fullMessage, sources, sourceInfo },
      });
    } catch (error) {
      logger.error('CHATBOX', '[ChatStreamingUtility] Error sending chat end to tab:', error);
    }
  }

  /**
   * Send a streaming image chat message chunk to content script
   */
  async sendImageChatChunk(tabId: number, chunk: string): Promise<void> {
    try {
      if (!await this.isTabValid(tabId)) {
        logger.warn('CHATBOX', '[ChatStreamingUtility] Tab', tabId, 'no longer exists, skipping chunk');
        return;
      }

      await chrome.tabs.sendMessage(tabId, {
        type: MessageType.IMAGE_CHAT_STREAM_CHUNK,
        payload: chunk,
      });
    } catch (error) {
      logger.error('CHATBOX', '[ChatStreamingUtility] Error sending image chat chunk:', error);
    }
  }

  /**
   * Send image chat stream end to content script
   */
  async sendImageChatEnd(
    tabId: number,
    fullMessage: string,
    sources?: string[],
    sourceInfo?: SourceInfo[]
  ): Promise<void> {
    try {
      if (!await this.isTabValid(tabId)) {
        logger.warn('CHATBOX', '[ChatStreamingUtility] Tab', tabId, 'no longer exists, skipping stream end');
        return;
      }

      await chrome.tabs.sendMessage(tabId, {
        type: MessageType.IMAGE_CHAT_STREAM_END,
        payload: { fullMessage, sources, sourceInfo },
      });
    } catch (error) {
      logger.error('CHATBOX', '[ChatStreamingUtility] Error sending image chat end:', error);
    }
  }

  /**
   * Estimate token usage for a given text
   * Rough estimate: ~4 characters per token
   */
  estimateTokenUsage(text: string): number {
    return Math.ceil(text.length / 4);
  }

  /**
   * Detect if an error is a QuotaExceededError from Chrome's LanguageModel API
   */
  isQuotaExceededError(error: Error | unknown): boolean {
    const errorMessage = error instanceof Error ? error.message : String(error);
    const errorLower = errorMessage.toLowerCase();

    return errorLower.includes('quotaexceedederror') ||
           errorLower.includes('quota exceeded') ||
           errorLower.includes('input is too large') ||
           errorLower.includes('quota');
  }
}
