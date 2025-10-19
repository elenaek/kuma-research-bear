import { getPaperByUrl } from '../../utils/dbService.ts';
import * as operationStateService from '../services/operationStateService.ts';

/**
 * Database Message Handlers
 * Handles IndexedDB operations centralized in the background worker
 */

/**
 * Store a paper in IndexedDB with full text
 */
export async function handleStorePaper(payload: any, tabId?: number): Promise<any> {
  try {
    console.log('[DBHandlers] Storing paper in IndexedDB:', payload.paper.title);
    const { storePaper } = await import('../../utils/dbService.ts');
    const storedPaper = await storePaper(payload.paper, payload.fullText);
    console.log('[DBHandlers] ✓ Paper stored successfully:', storedPaper.id);

    // Update operation state to show paper is stored
    if (tabId) {
      const state = operationStateService.updateState(tabId, {
        currentPaper: storedPaper,
        isPaperStored: true,
      });

      // Broadcast state change
      chrome.runtime.sendMessage({
        type: 'OPERATION_STATE_CHANGED',
        payload: { state },
      }).catch(() => {
        // No listeners, that's ok
      });
    }

    return { success: true, paper: storedPaper };
  } catch (dbError) {
    console.error('[DBHandlers] Failed to store paper:', dbError);
    return { success: false, error: String(dbError) };
  }
}

/**
 * Get a paper from IndexedDB by URL
 */
export async function handleGetPaperByUrl(payload: any): Promise<any> {
  try {
    console.log('[DBHandlers] Getting paper by URL:', payload.url);
    const paper = await getPaperByUrl(payload.url);
    console.log('[DBHandlers] Paper retrieval result:', paper ? 'Found' : 'Not found');
    return { success: true, paper };
  } catch (dbError) {
    console.error('[DBHandlers] Failed to get paper:', dbError);
    return { success: false, error: String(dbError), paper: null };
  }
}

/**
 * Check if a paper is stored in IndexedDB
 */
export async function handleIsPaperStored(payload: any): Promise<any> {
  try {
    console.log('[DBHandlers] Checking if paper is stored:', payload.url);
    const { isPaperStored } = await import('../../utils/dbService.ts');
    const isStored = await isPaperStored(payload.url);
    console.log('[DBHandlers] Paper stored check result:', isStored);
    return { success: true, isStored };
  } catch (dbError) {
    console.error('[DBHandlers] Failed to check if paper stored:', dbError);
    return { success: false, error: String(dbError), isStored: false };
  }
}

/**
 * Get all papers from IndexedDB
 */
export async function handleGetAllPapers(): Promise<any> {
  try {
    console.log('[DBHandlers] Getting all papers from IndexedDB');
    const { getAllPapers } = await import('../../utils/dbService.ts');
    const papers = await getAllPapers();
    console.log('[DBHandlers] Retrieved', papers.length, 'papers');
    return { success: true, papers };
  } catch (dbError) {
    console.error('[DBHandlers] Failed to get all papers:', dbError);
    return { success: false, error: String(dbError), papers: [] };
  }
}

/**
 * Delete a paper from IndexedDB
 */
export async function handleDeletePaper(payload: any): Promise<any> {
  try {
    console.log('[DBHandlers] Deleting paper:', payload.paperId);

    // Get paper URL before deletion to clean up OperationState
    const { getPaperById, deletePaper } = await import('../../utils/dbService.ts');
    const paperToDelete = await getPaperById(payload.paperId);
    const deletedPaperUrl = paperToDelete?.url;

    const deleted = await deletePaper(payload.paperId);
    console.log('[DBHandlers] Paper deletion result:', deleted);

    // Clear any OperationState entries referencing this paper
    if (deleted && deletedPaperUrl) {
      operationStateService.getAllStates().forEach((state, tabId) => {
        if (state.currentPaper?.url === deletedPaperUrl) {
          console.log(`[DBHandlers] Clearing currentPaper from tab ${tabId} OperationState`);
          const updatedState = operationStateService.updateState(tabId, {
            currentPaper: null,
            isPaperStored: false,
          });

          // Broadcast state change
          chrome.runtime.sendMessage({
            type: 'OPERATION_STATE_CHANGED',
            payload: { state: updatedState },
          }).catch(() => {
            // No listeners, that's ok
          });
        }
      });
    }

    return { success: deleted };
  } catch (dbError) {
    console.error('[DBHandlers] Failed to delete paper:', dbError);
    return { success: false, error: String(dbError) };
  }
}

/**
 * Update Q&A history for a paper
 */
export async function handleUpdateQAHistory(payload: any): Promise<any> {
  try {
    console.log('[DBHandlers] Updating Q&A history for paper:', payload.paperId);
    const { updatePaperQAHistory } = await import('../../utils/dbService.ts');
    const updated = await updatePaperQAHistory(payload.paperId, payload.qaHistory);
    console.log('[DBHandlers] Q&A history update result:', updated);
    return { success: updated };
  } catch (dbError) {
    console.error('[DBHandlers] Failed to update Q&A history:', dbError);
    return { success: false, error: String(dbError) };
  }
}
