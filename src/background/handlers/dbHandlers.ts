import { getPaperByUrl } from '../../utils/dbService.ts';
import * as operationStateService from '../services/operationStateService.ts';
import * as paperCleanupService from '../services/paperCleanupService.ts';
import * as iconService from '../services/iconService.ts';
import { tabPaperTracker } from '../services/tabPaperTracker.ts';
import { MessageType } from '../../types/index.ts';
import { normalizeUrl } from '../../utils/urlUtils.ts';

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

    // Update state to show chunking/summarization is starting
    if (tabId) {
      const initialState = operationStateService.updateState(tabId, {
        isChunking: true,
        chunkingProgress: '🐻 Kuma is reading through the research paper by sections... (Preparing chunks)',
        currentChunk: 0,
        totalChunks: 0,
        hasDetected: true,  // Mark detection as complete (since we're starting chunking)
        hasChunked: false,  // Reset chunking completion flag
      });

      // Broadcast initial chunking state to all relevant tabs
      await operationStateService.broadcastStateChange(initialState);
    }

    const { storePaper } = await import('../../utils/dbService.ts');

    // Create progress callback to update state during chunk summarization
    const onChunkProgress = async (current: number, total: number) => {
      if (tabId) {
        let progressMessage = "";
        if(current === total) {
          progressMessage = "🐻 Kuma is contemplating about what was read...";
        }
        else {
          progressMessage = total > 0
            ? `🐻 Kuma is reading through the research paper by chunks... (${current}/${total} chunks read)`
            : '🐻 Kuma is organizing the research paper... (Preparing chunks)';
        }

        const state = operationStateService.updateState(tabId, {
          chunkingProgress: progressMessage,
          currentChunk: current,
          totalChunks: total,
          hasChunked: current === total,  // Mark as chunked when current === total
        });

        // Broadcast chunking progress to all relevant tabs
        await operationStateService.broadcastStateChange(state);
      }
    };

    const storedPaper = await storePaper(payload.paper, payload.fullText, undefined, onChunkProgress);

    // Update operation state to show paper is stored and chunking is complete
    if (tabId) {
      // Register paper with tab tracker
      tabPaperTracker.registerPaper(tabId, storedPaper);

      const state = operationStateService.updateState(tabId, {
        currentPaper: storedPaper,
        isPaperStored: true,
        isChunking: false,
        isExplaining: true,
        chunkingProgress: '',
        currentChunk: 0,
        totalChunks: 0,
        hasChunked: true,  // Mark chunking as complete
      });

      // Broadcast state change to all relevant tabs
      await operationStateService.broadcastStateChange(state);
    }

    // Generate embeddings in offscreen document (non-blocking)
    // Offscreen document persists independently and has DOM access for Transformers.js
    (async () => {
      try {
        const { generateEmbeddingsOffscreen } = await import('../services/offscreenService.ts');
        const result = await generateEmbeddingsOffscreen(storedPaper.id);

        if (result.success) {
          console.log('[DBHandlers] ✓ Generated', result.count, 'embeddings in offscreen document');
        } else {
          console.log('[DBHandlers] Could not generate embeddings, will use keyword search:', result.error);
        }
      } catch (error) {
        console.log('[DBHandlers] Error triggering embedding generation:', error);
      }
    })();

    return { success: true, paper: storedPaper };
  } catch (dbError) {
    console.error('[DBHandlers] Failed to store paper:', dbError);

    // Clear chunking state on error
    if (tabId) {
      const state = operationStateService.updateState(tabId, {
        isChunking: false,
        chunkingProgress: '',
        currentChunk: 0,
        totalChunks: 0,
      });

      await operationStateService.broadcastStateChange(state);
    }

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

    // Get paper URL before deletion for cleanup
    const { getPaperById, deletePaper } = await import('../../utils/dbService.ts');
    const paperToDelete = await getPaperById(payload.paperId);
    const deletedPaperUrl = paperToDelete?.url;

    if (!deletedPaperUrl) {
      console.warn('[DBHandlers] Paper not found or has no URL');
      return { success: false, error: 'Paper not found' };
    }

    // 1. Clean up all resources (AI sessions, requests, states) before deletion
    console.log('[DBHandlers] Cleaning up resources for paper:', deletedPaperUrl);
    const cleanupSummary = await paperCleanupService.cleanupPaper(deletedPaperUrl);
    console.log('[DBHandlers] Cleanup summary:', cleanupSummary);

    // 2. Delete the paper from database
    const deleted = await deletePaper(payload.paperId);
    console.log('[DBHandlers] Paper deletion result:', deleted);

    // 3. Update icons for tabs showing this paper's URL
    if (deleted) {
      try {
        const tabs = await chrome.tabs.query({});
        const normalizedDeletedUrl = normalizeUrl(deletedPaperUrl);
        const matchingTabs = tabs.filter(tab => tab.url && normalizeUrl(tab.url) === normalizedDeletedUrl);

        for (const tab of matchingTabs) {
          if (tab.id !== undefined) {
            await iconService.setDefaultIcon(tab.id);
            console.log(`[DBHandlers] ✓ Icon reset for tab ${tab.id}`);
          }
        }

        if (matchingTabs.length > 0) {
          console.log(`[DBHandlers] ✓ Icons updated for ${matchingTabs.length} tab(s)`);
        }
      } catch (iconError) {
        console.warn('[DBHandlers] Failed to update icons:', iconError);
        // Don't fail the deletion if icon update fails
      }
    }

    // 4. Broadcast PAPER_DELETED message to notify all components
    if (deleted) {
      chrome.runtime.sendMessage({
        type: MessageType.PAPER_DELETED,
        payload: { paperUrl: deletedPaperUrl, paperId: payload.paperId },
      }).catch(() => {
        // No listeners, that's ok
      });
      console.log('[DBHandlers] ✓ PAPER_DELETED broadcast sent');
    }

    return { success: deleted, cleanupSummary };
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

/**
 * Image Explanation Handlers
 */

/**
 * Store an image explanation in IndexedDB
 */
export async function handleStoreImageExplanation(payload: any): Promise<any> {
  try {
    console.log('[DBHandlers] Storing image explanation for:', payload.imageUrl);
    const { storeImageExplanation } = await import('../../utils/dbService.ts');
    const explanation = await storeImageExplanation(
      payload.paperId,
      payload.imageUrl,
      payload.title,
      payload.explanation,
      payload.imageHash
    );
    console.log('[DBHandlers] ✓ Image explanation stored');
    return { success: true, explanation };
  } catch (dbError) {
    console.error('[DBHandlers] Failed to store image explanation:', dbError);
    return { success: false, error: String(dbError) };
  }
}

/**
 * Get an image explanation from IndexedDB
 */
export async function handleGetImageExplanation(payload: any): Promise<any> {
  try {
    console.log('[DBHandlers] Getting image explanation for:', payload.imageUrl);
    const { getImageExplanation } = await import('../../utils/dbService.ts');
    const explanation = await getImageExplanation(payload.paperId, payload.imageUrl);
    console.log('[DBHandlers] Image explanation result:', explanation ? 'Found' : 'Not found');
    return { success: true, explanation };
  } catch (dbError) {
    console.error('[DBHandlers] Failed to get image explanation:', dbError);
    return { success: false, error: String(dbError) };
  }
}

/**
 * Get all image explanations for a paper from IndexedDB
 */
export async function handleGetImageExplanationsByPaper(payload: any): Promise<any> {
  try {
    console.log('[DBHandlers] Getting all image explanations for paper:', payload.paperId);
    const { getImageExplanationsByPaper } = await import('../../utils/dbService.ts');
    const explanations = await getImageExplanationsByPaper(payload.paperId);
    console.log('[DBHandlers] ✓ Retrieved', explanations.length, 'image explanations');
    return { success: true, explanations };
  } catch (dbError) {
    console.error('[DBHandlers] Failed to get image explanations:', dbError);
    return { success: false, error: String(dbError), explanations: [] };
  }
}
