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
