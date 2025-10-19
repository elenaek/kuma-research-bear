import { aiService } from '../../utils/aiService.ts';
import * as operationStateService from '../services/operationStateService.ts';
import * as requestDeduplicationService from '../services/requestDeduplicationService.ts';
import * as iconService from '../services/iconService.ts';

/**
 * Tab Lifecycle Handlers
 * Manages Chrome tab events: onUpdated, onActivated, onRemoved
 */

/**
 * Handle tab updates - clear badges when tab loading completes
 */
export function handleTabUpdated(
  tabId: number,
  changeInfo: chrome.tabs.TabChangeInfo,
  tab: chrome.tabs.Tab
): void {
  if (changeInfo.status === 'complete' && tab.url) {
    // Extension now works on ALL sites - no restrictions
    // The badge has been removed in favor of dynamic icon changes
    // Icons will change based on operation state (detecting/explaining/analyzing)

    // Clear any existing badge to avoid conflicts with icon changes
    chrome.action.setBadgeText({ text: '', tabId });
  }
}

/**
 * Handle tab activation - update icon based on current tab's state
 */
export async function handleTabActivated(activeInfo: chrome.tabs.TabActiveInfo): Promise<void> {
  const { tabId } = activeInfo;

  // Check if we have an operation state for this tab
  if (operationStateService.hasState(tabId)) {
    const state = operationStateService.getRawState(tabId)!;
    await iconService.updateIconForTab(tabId, state);
    console.log(`[TabLifecycle] Tab ${tabId} activated, icon updated based on current state`);
  } else {
    // Reset to default icon if no state exists
    await iconService.setDefaultIcon(tabId);
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
