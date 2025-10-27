import { MessageType } from '../../types/index.ts';
import { aiService } from '../../utils/aiService.ts';
import { getPaperByUrl } from '../../utils/dbService.ts';
import * as operationStateService from '../services/operationStateService.ts';
import * as iconService from '../services/iconService.ts';

/**
 * Detect and Explain Orchestrator
 * Orchestrates the paper detection workflow:
 * 1. Detection - Detect paper on page
 * 2. Chunking - Extract and chunk paper content (async in offscreen)
 * 3. Embedding generation - Generate embeddings for semantic search (async in offscreen)
 *
 * Note: Explanation, Summary, Analysis, and Glossary must be manually triggered by user
 */

/**
 * Helper to update state and broadcast changes
 * Now uses updateStateAndBroadcast which automatically updates icons
 */
async function updateOperationState(tabId: number, updates: any): Promise<void> {
  await operationStateService.updateStateAndBroadcast(tabId, updates);
}

/**
 * Execute the full detect and explain workflow
 */
export async function executeDetectAndExplainFlow(tabId: number): Promise<any> {
  try {
    console.log('[Orchestrator] Starting detect and explain flow for tab', tabId);

    // Phase 1: Detection
    await updateOperationState(tabId, {
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
      await updateOperationState(tabId, {
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
    await updateOperationState(tabId, {
      isDetecting: false,  // Detection phase is complete
      detectionProgress: '🐻 Kuma found a research paper! (Paper detected!)',
      currentPaper: detectResponse.paper,
      isPaperStored: isPaperStored,
      hasDetected: true,  // Mark detection as complete
    });

    // Note: Chunking and embedding generation happen asynchronously in offscreen document
    // The dbHandlers.ts will track chunking completion and set chatReady: true
    // Then embeddings will be generated and imageExplanationReady will be set when complete
    console.log('[Orchestrator] Paper detection complete. Chunking and embedding will happen in background.');

    return { success: true, paper: detectResponse.paper };
  } catch (flowError) {
    console.error('[Orchestrator] Error in detect flow:', flowError);
    await updateOperationState(tabId, {
      isDetecting: false,
      isExplaining: false,
      isAnalyzing: false,
      isGeneratingEmbeddings: false,
      detectionProgress: '',
      explanationProgress: '',
      analysisProgress: '',
      embeddingProgress: '',
      error: String(flowError),
    });
    return { success: false, error: String(flowError) };
  }
}
