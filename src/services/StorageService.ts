import { MessageType } from '../types/index.ts';

/**
 * StorageService - Centralized service for chrome.storage operations
 *
 * This service provides utilities for managing chrome.storage listeners
 * and state synchronization.
 */

/**
 * Storage change handler type
 */
export type StorageChangeHandler = (changes: Record<string, chrome.storage.StorageChange>, namespace: string) => void;

/**
 * Runtime message handler type
 */
export type RuntimeMessageHandler = (message: any, sender: chrome.runtime.MessageSender, sendResponse: (response?: any) => void) => void | boolean;

/**
 * Create a storage change listener for explanation state
 *
 * @param onExplanationChange - Callback when isExplaining flag changes
 * @param onDataChange - Callback when explanation/analysis/paper data changes (should be debounced)
 * @returns Storage change listener function
 */
export function createStorageListener(
  onExplanationChange: (isExplaining: boolean) => void,
  onDataChange: () => void
): StorageChangeHandler {
  return (changes, namespace) => {
    if (namespace === 'local') {
      // Handle explanation progress flag
      if (changes.isExplaining) {
        const isExplaining = changes.isExplaining.newValue || false;
        console.log('[StorageService] Explanation status changed:', isExplaining);
        onExplanationChange(isExplaining);
      }

      // Trigger reload on data changes
      if (changes.lastExplanation || changes.lastAnalysis || changes.currentPaper) {
        console.log('[StorageService] Storage changed, triggering data reload...', changes);
        onDataChange();
      }
    }
  };
}

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

      console.log('[StorageService] Operation state changed:', state);
      onOperationStateChange(state);
    }
  };
}

/**
 * Register chrome.storage and runtime message listeners
 *
 * @param storageListener - Storage change listener
 * @param messageListener - Runtime message listener
 * @returns Cleanup function to remove listeners
 */
export function registerListeners(
  storageListener: StorageChangeHandler,
  messageListener: RuntimeMessageHandler
): () => void {
  chrome.storage.onChanged.addListener(storageListener);
  chrome.runtime.onMessage.addListener(messageListener);

  // Return cleanup function
  return () => {
    chrome.storage.onChanged.removeListener(storageListener);
    chrome.runtime.onMessage.removeListener(messageListener);
  };
}

/**
 * Get the current explanation flag from storage
 */
export async function getIsExplaining(): Promise<boolean> {
  try {
    const result = await chrome.storage.local.get('isExplaining');
    return result.isExplaining || false;
  } catch (error) {
    console.error('[StorageService] Error getting isExplaining flag:', error);
    return false;
  }
}

/**
 * Get the last explanation data from storage
 */
export async function getLastExplanation(): Promise<any> {
  try {
    const result = await chrome.storage.local.get('lastExplanation');
    return result.lastExplanation || null;
  } catch (error) {
    console.error('[StorageService] Error getting lastExplanation:', error);
    return null;
  }
}

/**
 * Get the last analysis data from storage
 */
export async function getLastAnalysis(): Promise<any> {
  try {
    const result = await chrome.storage.local.get('lastAnalysis');
    return result.lastAnalysis || null;
  } catch (error) {
    console.error('[StorageService] Error getting lastAnalysis:', error);
    return null;
  }
}

/**
 * Get the current paper from storage
 */
export async function getCurrentPaper(): Promise<any> {
  try {
    const result = await chrome.storage.local.get('currentPaper');
    return result.currentPaper || null;
  } catch (error) {
    console.error('[StorageService] Error getting currentPaper:', error);
    return null;
  }
}

/**
 * Clear all storage data (for debug purposes)
 */
export async function clearAllStorage(): Promise<void> {
  try {
    await chrome.storage.local.clear();
    console.log('[StorageService] All storage cleared');
  } catch (error) {
    console.error('[StorageService] Error clearing storage:', error);
    throw error;
  }
}
