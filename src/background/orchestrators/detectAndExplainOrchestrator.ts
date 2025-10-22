import { MessageType } from '../../types/index.ts';
import { aiService } from '../../utils/aiService.ts';
import { getPaperByUrl } from '../../utils/dbService.ts';
import * as operationStateService from '../services/operationStateService.ts';
import * as iconService from '../services/iconService.ts';

/**
 * Detect and Explain Orchestrator
 * Orchestrates the multi-phase workflow:
 * 1. Detection - Detect paper on page
 * 2. Explanation - Generate explanation and summary
 * (Analysis and Glossary must be manually triggered by user)
 */

/**
 * Broadcast operation state change
 */
function broadcastStateChange(state: any): void {
  chrome.runtime.sendMessage({
    type: MessageType.OPERATION_STATE_CHANGED,
    payload: { state },
  }).catch(() => {
    // No listeners, that's ok
  });
}

/**
 * Helper to update state and broadcast changes
 */
function updateOperationState(tabId: number, updates: any): void {
  const state = operationStateService.updateState(tabId, updates);
  iconService.updateIconForTab(tabId, state);
  broadcastStateChange(state);
}

/**
 * Execute the full detect and explain workflow
 */
export async function executeDetectAndExplainFlow(tabId: number): Promise<any> {
  try {
    console.log('[Orchestrator] Starting detect and explain flow for tab', tabId);

    // Phase 1: Detection
    updateOperationState(tabId, {
      isDetecting: true,
      detectionProgress: '🐻 Kuma is foraging for research papers... (Detecting paper)',
      error: null,
      hasDetected: false,  // Reset detection flag when starting new detection
      hasChunked: false,   // Reset chunking flag when starting new detection
    });

    const detectResponse = await chrome.tabs.sendMessage(tabId, {
      type: MessageType.DETECT_PAPER,
    });

    if (!detectResponse.paper) {
      updateOperationState(tabId, {
        isDetecting: false,
        detectionProgress: '',
        error: '🐻 Kuma didn\'t find any research papers. (No paper detected on this page)',
      });
      return { success: false, error: '🐻 Kuma didn\'t find any research papers. (No paper detected)' };
    }

    // Check if paper is already stored in DB
    let isPaperStored = false;
    if (detectResponse.paper && detectResponse.alreadyStored) {
      isPaperStored = true;
      console.log('[Orchestrator] Paper is already stored in DB');
    }

    // Update state with detected paper
    updateOperationState(tabId, {
      isDetecting: false,  // Detection phase is complete
      detectionProgress: '🐻 Kuma found a research paper! (Paper detected!)',
      currentPaper: detectResponse.paper,
      isPaperStored: isPaperStored,
      hasDetected: true,  // Mark detection as complete
    });

    // Note: Paper and chunks are guaranteed to be in IndexedDB when detect returns
    // dbService.storePaper() waits for transaction.oncomplete before returning
    // Embedding generation happens in background and doesn't block
    console.log('[Orchestrator] Paper storage complete, proceeding to explanation...');

    // Phase 2: Explanation
    updateOperationState(tabId, {
      isDetecting: false,
      isExplaining: true,
      explanationProgress: '🐻 Kuma is thinking of ways to explain the research paper... (Generating explanation)',
    });

    // Use tab ID for context
    const explainContextId = `tab-${tabId}-explain`;
    const explanation = await aiService.explainAbstract(detectResponse.paper.abstract, explainContextId);
    const summary = await aiService.generateSummary(detectResponse.paper.title, detectResponse.paper.abstract, explainContextId);

    // Store explanation using paperId from detection response
    // The content script guarantees the paper is stored before returning
    const paperId = detectResponse.paperId;
    if (!paperId) {
      console.error('[Orchestrator] No paperId in detection response:', detectResponse);
      throw new Error('Paper was not stored successfully. Cannot save explanation.');
    }

    console.log('[Orchestrator] Storing explanation for paper:', paperId);
    const { updatePaperExplanation } = await import('../../utils/dbService.ts');
    await updatePaperExplanation(paperId, explanation, summary);
    console.log('[Orchestrator] ✓ Explanation stored in IndexedDB');

    // Mark explanation phase complete
    updateOperationState(tabId, {
      isDetecting: false,
      isExplaining: false,
      explanationProgress: '🐻 Kuma has finished explaining the research paper! (Explanation complete!)',
      isPaperStored: true,
      // Update completion tracking (explanation + summary = 2 of 4 features)
      // Analysis and Glossary are manual operations
      hasExplanation: true,
      hasSummary: true,
      completionPercentage: 50,
    });

    return { success: true, paper: detectResponse.paper };
  } catch (flowError) {
    console.error('[Orchestrator] Error in detect and explain flow:', flowError);
    updateOperationState(tabId, {
      isDetecting: false,
      isExplaining: false,
      isAnalyzing: false,
      detectionProgress: '',
      explanationProgress: '',
      analysisProgress: '',
      error: String(flowError),
    });
    return { success: false, error: String(flowError) };
  }
}
