import { OperationState } from '../../types/index.ts';

/**
 * Operation State Service
 * Manages per-tab operation state tracking
 */

// Persistent operation state tracking (per-tab)
const operationStates = new Map<number, OperationState>();

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
      currentPaper: null,
      isPaperStored: false,
      error: null,
      detectionProgress: '',
      explanationProgress: '',
      analysisProgress: '',
      glossaryProgress: '',
      lastUpdated: Date.now(),
      activeAIRequests: [],
      isUsingCachedRequest: false,
      hasExplanation: false,
      hasSummary: false,
      hasAnalysis: false,
      hasGlossary: false,
      completionPercentage: 0,
    });
  }
  return operationStates.get(tabId)!;
}

/**
 * Update operation state for a tab
 * @returns The updated state
 */
export function updateState(tabId: number, updates: Partial<OperationState>): OperationState {
  const state = getState(tabId);
  Object.assign(state, updates, { lastUpdated: Date.now() });
  return state;
}

/**
 * Delete operation state for a tab
 */
export function deleteState(tabId: number): void {
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
