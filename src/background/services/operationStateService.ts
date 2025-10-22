import { OperationState } from '../../types/index.ts';

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
      isAnalyzing: false,
      isGeneratingGlossary: false,
      isChunking: false,
      currentPaper: null,
      isPaperStored: false,
      error: null,
      detectionProgress: '',
      explanationProgress: '',
      analysisProgress: '',
      glossaryProgress: '',
      glossaryProgressStage: null,
      currentGlossaryTerm: 0,
      totalGlossaryTerms: 0,
      chunkingProgress: '',
      currentChunk: 0,
      totalChunks: 0,
      lastUpdated: Date.now(),
      activeAIRequests: [],
      isUsingCachedRequest: false,
      hasExplanation: false,
      hasSummary: false,
      hasAnalysis: false,
      hasGlossary: false,
      hasDetected: false,
      hasChunked: false,
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
  if (updates.currentPaper && state.currentPaper && state.currentPaper.url !== updates.currentPaper.url) {
    paperToState.delete(state.currentPaper.url);
  }

  Object.assign(state, updates, { lastUpdated: Date.now() });

  // Update paper-to-state index if we have a current paper
  if (state.currentPaper?.url) {
    paperToState.set(state.currentPaper.url, state);
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
    paperToState.delete(state.currentPaper.url);
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
  return paperToState.get(paperUrl);
}
