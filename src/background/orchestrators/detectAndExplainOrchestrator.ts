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
 * 3. Analysis + Glossary - Deep analysis and term extraction (parallel)
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
      isDetecting: true,
      detectionProgress: '🐻 Kuma found a research paper! (Paper detected!)',
      currentPaper: detectResponse.paper,
      isPaperStored: isPaperStored,
    });

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

    // Store explanation in chrome.storage (for quick access/backwards compatibility)
    await chrome.storage.local.set({
      lastExplanation: {
        paper: detectResponse.paper,
        explanation,
        summary,
        timestamp: Date.now(),
      },
      currentPaper: detectResponse.paper,
    });

    // Also store in IndexedDB per-paper for persistence
    try {
      const storedPaperForExplanation = await getPaperByUrl(detectResponse.paper.url);
      if (storedPaperForExplanation) {
        const { updatePaperExplanation } = await import('../../utils/dbService.ts');
        await updatePaperExplanation(storedPaperForExplanation.id, explanation, summary);
        console.log('[Orchestrator] ✓ Explanation stored in IndexedDB');
      }
    } catch (dbError) {
      console.warn('[Orchestrator] Failed to store explanation in IndexedDB:', dbError);
      // Don't fail the whole operation if IndexedDB update fails
    }

    updateOperationState(tabId, {
      isDetecting: false,
      isExplaining: true,
      explanationProgress: '🐻 Kuma has finished explaining the research paper! (Explanation complete!)',
    });

    // Phase 3: Analysis + Glossary (auto-trigger in parallel)
    updateOperationState(tabId, {
      isDetecting: false,
      isExplaining: false,
      isAnalyzing: true,
      isGeneratingGlossary: true,
      analysisProgress: '🐻 Kuma is deeply analyzing the research paper... (Analyzing paper)',
      glossaryProgress: '🐻 Kuma is extracting technical terms and acronyms... (Generating glossary)',
    });

    const paperUrl = detectResponse.paper.url;
    const storedPaper = await getPaperByUrl(paperUrl);

    if (storedPaper) {
      // Update state to show paper is stored
      updateOperationState(tabId, {
        isPaperStored: true,
      });

      const paperContent = storedPaper.fullText || storedPaper.abstract;
      const analysisContextId = `tab-${tabId}-analysis`;
      const glossaryContextId = `tab-${tabId}-glossary`;

      // Run analysis and glossary generation in parallel
      const [analysis, glossary] = await Promise.all([
        aiService.analyzePaper(paperContent, analysisContextId),
        aiService.generateGlossary(paperContent, storedPaper.title, glossaryContextId)
      ]);

      // Store analysis in chrome.storage (for quick access/backwards compatibility)
      await chrome.storage.local.set({
        lastAnalysis: {
          paper: storedPaper,
          analysis,
          timestamp: Date.now(),
        },
      });

      // Store both analysis and glossary in IndexedDB
      try {
        const { updatePaperAnalysis, updatePaperGlossary } = await import('../../utils/dbService.ts');
        await Promise.all([
          updatePaperAnalysis(storedPaper.id, analysis),
          updatePaperGlossary(storedPaper.id, glossary)
        ]);
        console.log('[Orchestrator] ✓ Analysis and glossary stored in IndexedDB');
      } catch (dbError) {
        console.warn('[Orchestrator] Failed to store analysis/glossary in IndexedDB:', dbError);
        // Don't fail the whole operation if IndexedDB update fails
      }

      updateOperationState(tabId, {
        isDetecting: false,
        isExplaining: false,
        isAnalyzing: true,
        isGeneratingGlossary: true,
        analysisProgress: '🐻 Kuma has finished analyzing the research paper! (Analysis complete!)',
        glossaryProgress: '🐻 Kuma has finished extracting terms! (Glossary complete!)',
      });

      setTimeout(() =>{
        // Get current state to preserve isPaperStored
        const currentState = operationStateService.getState(tabId);
        updateOperationState(tabId, {
          isDetecting: false,
          isExplaining: false,
          isAnalyzing: false,
          isGeneratingGlossary: false,
          analysisProgress: '',
          glossaryProgress: '',
          error: null,
          // Preserve the isPaperStored state
          isPaperStored: currentState.isPaperStored,
        });
      }, 5000);
    } else {
      updateOperationState(tabId, {
        isDetecting: false,
        isAnalyzing: false,
        isExplaining: false,
        isGeneratingGlossary: false,
        analysisProgress: '',
        glossaryProgress: '',
        error: '🐻 Kuma could not find a research paper to analyze. (Paper not found for analysis)',
      });
    }

    return { success: true, paper: detectResponse.paper };
  } catch (flowError) {
    console.error('[Orchestrator] Error in detect and explain flow:', flowError);
    updateOperationState(tabId, {
      isDetecting: false,
      isExplaining: false,
      isAnalyzing: false,
      isGeneratingGlossary: false,
      detectionProgress: '',
      explanationProgress: '',
      analysisProgress: '',
      glossaryProgress: '',
      error: String(flowError),
    });
    return { success: false, error: String(flowError) };
  }
}
