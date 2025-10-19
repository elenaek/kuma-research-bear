import { aiService } from '../../utils/aiService.ts';
import * as operationStateService from '../services/operationStateService.ts';
import * as requestDeduplicationService from '../services/requestDeduplicationService.ts';
import * as iconService from '../services/iconService.ts';
import * as paperStatusService from '../services/paperStatusService.ts';

/**
 * Tab Lifecycle Handlers
 * Manages Chrome tab events: onUpdated, onActivated, onRemoved
 */

/**
 * Handle tab updates - clear badges when tab loading completes
 * Also check for stored papers when navigation completes
 */
export async function handleTabUpdated(
  tabId: number,
  changeInfo: chrome.tabs.TabChangeInfo,
  tab: chrome.tabs.Tab
): Promise<void> {
  if (changeInfo.status === 'complete' && tab.url) {
    // Extension now works on ALL sites - no restrictions
    // The badge has been removed in favor of dynamic icon changes
    // Icons will change based on operation state (detecting/explaining/analyzing)

    // Clear any existing badge to avoid conflicts with icon changes
    chrome.action.setBadgeText({ text: '', tabId });

    // Check if this URL has a stored paper
    await checkAndUpdatePaperStatus(tabId, tab.url);
  }
}

/**
 * Handle tab activation - update icon based on current tab's state
 * Check database for stored papers if no operation state exists
 */
export async function handleTabActivated(activeInfo: chrome.tabs.TabActiveInfo): Promise<void> {
  const { tabId } = activeInfo;

  try {
    // Get the tab to access its URL
    const tab = await chrome.tabs.get(tabId);

    // Check if we have an operation state for this tab
    if (operationStateService.hasState(tabId)) {
      const state = operationStateService.getRawState(tabId)!;
      await iconService.updateIconForTab(tabId, state);
      console.log(`[TabLifecycle] Tab ${tabId} activated, icon updated based on current state`);
    } else if (tab.url) {
      // No operation state exists, check if this URL has a stored paper
      await checkAndUpdatePaperStatus(tabId, tab.url);
    } else {
      // No URL, set default icon
      await iconService.setDefaultIcon(tabId);
    }
  } catch (error) {
    console.error(`[TabLifecycle] Error handling tab activation for ${tabId}:`, error);
    await iconService.setDefaultIcon(tabId);
  }
}

/**
 * Check if a URL has a stored paper and update operation state + icon accordingly
 */
async function checkAndUpdatePaperStatus(tabId: number, url: string): Promise<void> {
  console.log(`[TabLifecycle] Checking paper status for tab ${tabId}, URL: ${url}`);

  // Quick database lookup
  const status = await paperStatusService.checkPaperStatus(url);

  if (status.isStored) {
    // Update operation state with completion info
    paperStatusService.updateOperationStateFromStoredPaper(tabId, status);

    // Update icon to reflect stored paper
    const state = operationStateService.getRawState(tabId)!;
    await iconService.updateIconForTab(tabId, state);

    console.log(`[TabLifecycle] ✓ Stored paper found for tab ${tabId}:`, {
      completionPercentage: status.completionPercentage,
      hasExplanation: status.hasExplanation,
      hasAnalysis: status.hasAnalysis,
      hasGlossary: status.hasGlossary,
    });
  } else {
    // No stored paper, set default icon
    await iconService.setDefaultIcon(tabId);
    console.log(`[TabLifecycle] No stored paper for tab ${tabId}`);
  }
}

/**
 * Handle tab removal - clean up AI sessions, active requests, and operation state
 */
export function handleTabRemoved(tabId: number, removeInfo: chrome.tabs.TabRemoveInfo): void {
  console.log(`[TabLifecycle] Tab ${tabId} closed, cleaning up AI sessions...`);

  // Clean up all session contexts for this tab
  const contextPrefixes = [
    `tab-${tabId}-explain`,
    `tab-${tabId}-section`,
    `tab-${tabId}-term`,
    `tab-${tabId}-summary`,
    `tab-${tabId}-analysis`,
    `tab-${tabId}-qa`,
    `tab-${tabId}-extraction`,
  ];

  for (const contextId of contextPrefixes) {
    aiService.destroySessionForContext(contextId);
  }

  // Clean up active requests for this tab
  const deletedRequests = requestDeduplicationService.deleteRequestsByTab(tabId);
  if (deletedRequests.length > 0) {
    console.log(`[TabLifecycle] Cleaned up ${deletedRequests.length} active requests:`, deletedRequests);
  }

  // Also clean up operation state for this tab
  if (operationStateService.hasState(tabId)) {
    operationStateService.deleteState(tabId);
    console.log(`[TabLifecycle] Cleaned up operation state for tab ${tabId}`);
  }

  // Reset icon to default (cleanup any custom icons)
  // Note: Icon is automatically cleaned up when tab is closed, but this is for consistency
}

/**
 * Register all tab lifecycle event listeners
 */
export function registerTabLifecycleHandlers(): void {
  chrome.tabs.onUpdated.addListener(handleTabUpdated);
  chrome.tabs.onActivated.addListener(handleTabActivated);
  chrome.tabs.onRemoved.addListener(handleTabRemoved);

  console.log('[TabLifecycle] Tab lifecycle handlers registered');
}
