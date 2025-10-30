import { logger } from '../../utils/logger.ts';

/**
 * UI Message Handlers
 * Handles UI-related operations (sidepanel, etc.)
 */

/**
 * Open the sidepanel for a tab
 */
export async function handleOpenSidepanel(tabId?: number): Promise<any> {
  if (tabId) {
    await chrome.sidePanel.open({ tabId });
    return { success: true };
  } else {
    return { success: false, error: 'No tab ID available' };
  }
}

/**
 * Check if the sidepanel is currently open
 */
export async function handleCheckSidepanelOpen(): Promise<{ isOpen: boolean }> {
  try {
    const sidePanelContexts = await chrome.runtime.getContexts({
      contextTypes: ['SIDE_PANEL' as chrome.runtime.ContextType],
    });
    return { isOpen: sidePanelContexts.length > 0 };
  } catch (error) {
    logger.error('BACKGROUND_SCRIPT', '[uiHandlers] Error checking sidepanel state:', error);
    return { isOpen: false };
  }
}
