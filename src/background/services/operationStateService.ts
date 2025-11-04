import { OperationState, MessageType } from '../../shared/types/index.ts';
import { tabPaperTracker } from './tabPaperTracker.ts';
import { updateContextMenuForPaper, updateContextMenuState } from '../background.ts';
import { normalizeUrl } from '../../shared/utils/urlUtils.ts';
import * as iconService from './iconService.ts';
import { logger } from '../../shared/utils/logger.ts';

/**
 * Operation State Service
 * Manages per-tab operation state tracking
 * Also provides paper-based lookups for sidepanel use cases
 */

// Persistent operation state tracking (per-tab)
const operationStates = new Map<number, OperationState>();

// Secondary index: paper URL to operation state
// Used when querying state from sidepanel (which doesn't know tab ID)
const paperToState = new Map<string, OperationState>();

/**
 * Get operation state for a tab, creating a new one if it doesn't exist
 */
export function getState(tabId: number): OperationState {
  if (!operationStates.has(tabId)) {
    operationStates.set(tabId, {
      tabId,
      isDetecting: false,
      isExplaining: false,
      isGeneratingSummary: false,
      isAnalyzing: false,
      isGeneratingGlossary: false,
      isChunking: false,
      isGeneratingEmbeddings: false,
      currentPaper: null,
      isPaperStored: false,
      error: null,
      detectionProgress: '',
      explanationProgress: '',
      summaryProgress: '',
      analysisProgress: '',
      glossaryProgress: '',
      glossaryProgressStage: null,
      currentGlossaryTerm: 0,
      totalGlossaryTerms: 0,
      analysisProgressStage: null,
      currentAnalysisStep: 0,
      totalAnalysisSteps: 0,
      chunkingProgress: '',
      currentChunk: 0,
      totalChunks: 0,
      embeddingProgress: '',
      lastUpdated: Date.now(),
      activeAIRequests: [],
      isUsingCachedRequest: false,
      hasExplanation: false,
      hasSummary: false,
      hasAnalysis: false,
      hasGlossary: false,
      hasDetected: false,
      hasChunked: false,
      hasEmbeddings: false,
      chatReady: false,
      imageExplanationReady: false,
      completionPercentage: 0,
    });
  }
  return operationStates.get(tabId)!;
}

/**
 * Update operation state for a tab
 * Also updates paper-based index if currentPaper changes
 * @returns The updated state
 */
export function updateState(tabId: number, updates: Partial<OperationState>): OperationState {
  const state = getState(tabId);

  // Remove old paper URL mapping if paper is changing
  if (updates.currentPaper && state.currentPaper) {
    const oldUrl = normalizeUrl(state.currentPaper.url);
    const newUrl = normalizeUrl(updates.currentPaper.url);
    if (oldUrl !== newUrl) {
      paperToState.delete(oldUrl);
    }
  }

  Object.assign(state, updates, { lastUpdated: Date.now() });

  // Update paper-to-state index if we have a current paper
  if (state.currentPaper?.url) {
    const normalizedUrl = normalizeUrl(state.currentPaper.url);
    paperToState.set(normalizedUrl, state);
  }

  return state;
}

/**
 * Delete operation state for a tab
 * Also removes paper-based index entry
 */
export function deleteState(tabId: number): void {
  const state = operationStates.get(tabId);
  if (state?.currentPaper?.url) {
    const normalizedUrl = normalizeUrl(state.currentPaper.url);
    paperToState.delete(normalizedUrl);
  }
  operationStates.delete(tabId);
}

/**
 * Check if operation state exists for a tab
 */
export function hasState(tabId: number): boolean {
  return operationStates.has(tabId);
}

/**
 * Get all operation states (for iteration)
 * @returns Map of all operation states
 */
export function getAllStates(): Map<number, OperationState> {
  return operationStates;
}

/**
 * Get raw state without creating a new one
 * @returns The state if it exists, undefined otherwise
 */
export function getRawState(tabId: number): OperationState | undefined {
  return operationStates.get(tabId);
}

/**
 * Get operation state for a paper by its URL
 * Used by sidepanel which doesn't know tab IDs
 * @returns The state if found, undefined otherwise
 */
export function getStateByPaperUrl(paperUrl: string): OperationState | undefined {
  const normalizedUrl = normalizeUrl(paperUrl);
  return paperToState.get(normalizedUrl);
}

/**
 * Broadcast operation state changes to all relevant listeners
 * - Sends to runtime (popup, sidepanel)
 * - Sends to all tabs viewing this paper
 * - Updates context menu for the paper
 */
export async function broadcastStateChange(state: OperationState): Promise<void> {
  try {
    // Broadcast to runtime listeners (popup, sidepanel, background)
    chrome.runtime.sendMessage({
      type: MessageType.OPERATION_STATE_CHANGED,
      payload: { state },
    }).catch(() => {
      // No listeners, that's okay
    });

    // If we have a paper URL, send to all tabs viewing this paper
    if (state.currentPaper?.url) {
      const tabIds = tabPaperTracker.getTabsForPaperUrl(state.currentPaper.url);

      // Send messages to all tabs in parallel for better performance
      await Promise.all(
        tabIds.map(async (tabId) => {
          try {
            await chrome.tabs.sendMessage(tabId, {
              type: MessageType.OPERATION_STATE_CHANGED,
              payload: { state },
            });
          } catch (error) {
            // Tab might have been closed or content script not ready
            logger.debug('BACKGROUND_SCRIPT', `[OperationState] Could not send to tab ${tabId}:`, error);
          }
        })
      );

      // Update context menu for this paper
      await updateContextMenuForPaper(state.currentPaper.url);
    }

    // IMPORTANT: Also update context menu if this state change is for the active tab
    // This handles cases where detection/chunking starts before a paper exists
    const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (activeTab?.id === state.tabId) {
      await updateContextMenuState();
    }
  } catch (error) {
    logger.error('BACKGROUND_SCRIPT', '[OperationState] Error broadcasting state change:', error);
  }
}

/**
 * Update operation state and broadcast changes
 * This is the preferred method to use when updating state
 * Also updates the extension icon to reflect the current operation state
 * @returns The updated state
 */
export async function updateStateAndBroadcast(tabId: number, updates: Partial<OperationState>): Promise<OperationState> {
  const state = updateState(tabId, updates);
  await iconService.updateIconForTab(tabId, state);
  await broadcastStateChange(state);
  return state;
}
