import { logger } from '../../../shared/utils/logger.ts';

/**
 * ChromeMessageClient - Base class for all messaging clients
 *
 * Provides:
 * - Type-safe message sending with chrome.runtime.sendMessage
 * - Consistent error handling
 * - Promise-based API
 * - Logging integration
 *
 * All specific clients (Paper, AI, Chat, etc.) extend this base class.
 */
export abstract class ChromeMessageClient {
  /**
   * Send a message to the background service worker
   *
   * @param type - Message type (e.g., 'GET_PAPER_BY_URL')
   * @param payload - Message payload (optional)
   * @returns Promise resolving to the response
   * @throws Error if message fails or chrome.runtime.lastError occurs
   */
  protected async sendMessage<T>(type: string, payload?: any): Promise<T> {
    logger.debug('MESSAGE_CLIENT', `[${this.constructor.name}] Sending message:`, type);

    return new Promise((resolve, reject) => {
      try {
        chrome.runtime.sendMessage({ type, payload }, (response) => {
          // Check for Chrome runtime errors
          if (chrome.runtime.lastError) {
            const error = new Error(
              `Message failed: ${chrome.runtime.lastError.message}`
            );
            logger.error(
              'MESSAGE_CLIENT',
              `[${this.constructor.name}] Error sending message ${type}:`,
              chrome.runtime.lastError
            );
            reject(error);
            return;
          }

          // Check for application-level errors in response
          if (response && response.error) {
            const error = new Error(response.error);
            logger.error(
              'MESSAGE_CLIENT',
              `[${this.constructor.name}] Response error for ${type}:`,
              response.error
            );
            reject(error);
            return;
          }

          logger.debug(
            'MESSAGE_CLIENT',
            `[${this.constructor.name}] Message ${type} successful`
          );
          resolve(response);
        });
      } catch (error) {
        logger.error(
          'MESSAGE_CLIENT',
          `[${this.constructor.name}] Exception sending message ${type}:`,
          error
        );
        reject(error);
      }
    });
  }

  /**
   * Send a message with a timeout
   *
   * @param type - Message type
   * @param payload - Message payload
   * @param timeoutMs - Timeout in milliseconds (default: 30000)
   * @returns Promise resolving to the response
   * @throws Error if message fails or times out
   */
  protected async sendMessageWithTimeout<T>(
    type: string,
    payload?: any,
    timeoutMs: number = 30000
  ): Promise<T> {
    return Promise.race([
      this.sendMessage<T>(type, payload),
      new Promise<T>((_, reject) =>
        setTimeout(
          () => reject(new Error(`Message ${type} timed out after ${timeoutMs}ms`)),
          timeoutMs
        )
      ),
    ]);
  }
}
