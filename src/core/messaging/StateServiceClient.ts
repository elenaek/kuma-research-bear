import { ChromeMessageClient } from './base/ChromeMessageClient.ts';
import { MessageType } from '../../shared/types/index.ts';
import { logger } from '../../shared/utils/logger.ts';

/**
 * Response interface for operation state operations
 */
export interface OperationStateResponse {
  success: boolean;
  error?: string;
  state?: any;
}

/**
 * StateServiceClient - Handles all operation state queries
 *
 * Responsibilities:
 * - Query operation state by tab ID
 * - Query operation state by paper URL
 * - Provide operation status information for UI components
 */
export class StateServiceClient extends ChromeMessageClient {
  /**
   * Get current operation state for a tab
   *
   * @param tabId - Tab ID to get operation state for
   * @returns Promise resolving to OperationStateResponse
   */
  async getOperationState(tabId: number): Promise<OperationStateResponse> {
    logger.debug('STATE_CLIENT', 'Getting operation state for tab:', tabId);

    try {
      const response = await this.sendMessage<{ success: boolean; error?: string; state?: any }>(
        MessageType.GET_OPERATION_STATE,
        { tabId }
      );

      if (response.success) {
        logger.debug('STATE_CLIENT', '✓ Operation state retrieved successfully');
        return { success: true, state: response.state };
      } else {
        logger.error('STATE_CLIENT', 'Failed to get operation state:', response.error);
        return { success: false, error: response.error };
      }
    } catch (error) {
      logger.error('STATE_CLIENT', 'Error getting operation state:', error);
      return { success: false, error: String(error) };
    }
  }

  /**
   * Get operation state for a specific paper by URL
   * Used by sidepanel which tracks papers independently of tabs
   *
   * @param paperUrl - URL of the paper to get operation state for
   * @returns Promise resolving to OperationStateResponse
   */
  async getOperationStateByPaper(paperUrl: string): Promise<OperationStateResponse> {
    logger.debug('STATE_CLIENT', 'Getting operation state for paper:', paperUrl);

    try {
      const response = await this.sendMessage<{ success: boolean; error?: string; state?: any }>(
        MessageType.GET_OPERATION_STATE_BY_PAPER,
        { paperUrl }
      );

      if (response.success) {
        logger.debug('STATE_CLIENT', '✓ Operation state retrieved for paper');
        return { success: true, state: response.state };
      } else {
        logger.error('STATE_CLIENT', 'Failed to get operation state by paper:', response.error);
        return { success: false, error: response.error };
      }
    } catch (error) {
      logger.error('STATE_CLIENT', 'Error getting operation state by paper:', error);
      return { success: false, error: String(error) };
    }
  }
}
