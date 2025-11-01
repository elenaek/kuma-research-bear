import { MessageType } from '../types/index.ts';
import { logger } from '../utils/logger.ts';

/**
 * StorageService - Service for runtime message operations
 *
 * This service provides utilities for managing operation state changes
 * via runtime message broadcasts.
 */

/**
 * Runtime message handler type
 */
export type RuntimeMessageHandler = (message: any, sender: chrome.runtime.MessageSender, sendResponse: (response?: any) => void) => void | boolean;

/**
 * Operation state from background worker
 */
export interface OperationState {
  isExplaining: boolean;
  isAnalyzing: boolean;
  isGeneratingGlossary: boolean;
  currentPaper?: {
    url: string;
    title?: string;
  };
}

/**
 * Create a runtime message listener for operation state changes
 *
 * @param onOperationStateChange - Callback when operation state changes
 * @returns Runtime message listener function
 */
export function createOperationStateListener(
  onOperationStateChange: (state: OperationState) => void
): RuntimeMessageHandler {
  return (message) => {
    if (message.type === MessageType.OPERATION_STATE_CHANGED) {
      const state = message.payload?.state;
      if (!state) return;

      logger.debug('CHROME_SERVICE', 'Operation state changed:', state);
      onOperationStateChange(state);
    }
  };
}
