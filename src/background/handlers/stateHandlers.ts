import * as operationStateService from '../services/operationStateService.ts';

/**
 * State Message Handlers
 * Handles operation state queries
 */

/**
 * Get operation state for a tab
 */
export async function handleGetOperationState(payload: any, tabId?: number): Promise<any> {
  try {
    if (!tabId) {
      return { success: false, error: 'No tab ID provided' };
    }
    const state = operationStateService.getState(tabId);
    console.log('[StateHandlers] Returning operation state for tab', tabId, state);
    return { success: true, state };
  } catch (error) {
    console.error('[StateHandlers] Error getting operation state:', error);
    return { success: false, error: String(error) };
  }
}
