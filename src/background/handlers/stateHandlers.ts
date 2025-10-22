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

/**
 * Get operation state for a paper by URL
 * Used by sidepanel which tracks papers independently of tabs
 */
export async function handleGetOperationStateByPaper(payload: any): Promise<any> {
  try {
    const paperUrl = payload?.paperUrl;
    if (!paperUrl) {
      return { success: false, error: 'No paper URL provided' };
    }

    const state = operationStateService.getStateByPaperUrl(paperUrl);

    if (state) {
      console.log('[StateHandlers] Returning operation state for paper', paperUrl, state);
      return { success: true, state };
    } else {
      console.log('[StateHandlers] No operation state found for paper', paperUrl);
      return { success: true, state: null };
    }
  } catch (error) {
    console.error('[StateHandlers] Error getting operation state by paper:', error);
    return { success: false, error: String(error) };
  }
}
