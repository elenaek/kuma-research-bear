import { getPaperByUrl } from '../../utils/dbService.ts';
import * as operationStateService from '../services/operationStateService.ts';
import * as paperCleanupService from '../services/paperCleanupService.ts';
import * as iconService from '../services/iconService.ts';
import { tabPaperTracker } from '../services/tabPaperTracker.ts';
import { MessageType } from '../../types/index.ts';
import { normalizeUrl } from '../../utils/urlUtils.ts';
import { logger } from '../../utils/logger.ts';

/**
 * Database Message Handlers
 * Handles IndexedDB operations centralized in the background worker
 */

/**
 * Store a paper in IndexedDB with full text
 */
export async function handleStorePaper(payload: any, tabId?: number): Promise<any> {
  try {
    logger.debug('BACKGROUND_SCRIPT', '[DBHandlers] Storing paper in IndexedDB:', payload.paper.title);

    // Update state to show chunking/summarization is starting
    if (tabId) {
      await operationStateService.updateStateAndBroadcast(tabId, {
        isChunking: true,
        chunkingProgress: '🐻 Kuma is reading through the research paper by sections... (Preparing chunks)',
        currentChunk: 0,
        totalChunks: 0,
        hasDetected: true,  // Mark detection as complete (since we're starting chunking)
        hasChunked: false,  // Reset chunking completion flag
      });
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

        await operationStateService.updateStateAndBroadcast(tabId, {
          chunkingProgress: progressMessage,
          currentChunk: current,
          totalChunks: total,
          hasChunked: current === total,  // Mark as chunked when current === total
        });
      }
    };

    const storedPaper = await storePaper(payload.paper, payload.fullText, undefined, onChunkProgress, payload.preChunkedData);

    // Update operation state to show paper is stored and chunking is complete
    if (tabId) {
      // Register paper with tab tracker
      tabPaperTracker.registerPaper(tabId, storedPaper);

      await operationStateService.updateStateAndBroadcast(tabId, {
        currentPaper: storedPaper,
        isPaperStored: true,
        isChunking: false,
        chunkingProgress: '',
        currentChunk: 0,
        totalChunks: 0,
        hasChunked: true,  // Mark chunking as complete
        chatReady: true,  // Chat is now available (may use keyword search until embeddings ready)
        imageExplanationReady: true,  // Image explanations now available (before embeddings complete)
        isGeneratingEmbeddings: true,
        embeddingProgress: 'Kuma is learning the semantic meaning of the paper... (Initializing)',
      });
    }

    // Generate embeddings in offscreen document (tracked operation)
    // Offscreen document persists independently and has DOM access for Transformers.js
    (async () => {
      try {
        const { generateEmbeddingsOffscreen } = await import('../services/offscreenService.ts');
        const result = await generateEmbeddingsOffscreen(storedPaper.id, storedPaper.url);

        if (result.success) {
          const backendUsed = result.device === 'webgpu' ? 'WebGPU (GPU-accelerated)' : 'WASM (CPU)';
          logger.debug('BACKGROUND_SCRIPT', `[DBHandlers] ✅ Generated ${result.count} embeddings using ${backendUsed}`);

          // Update state to mark embeddings as complete
          if (tabId) {
            await operationStateService.updateStateAndBroadcast(tabId, {
              isGeneratingEmbeddings: false,
              embeddingProgress: '',
              hasEmbeddings: true,
              imageExplanationReady: true,  // Image explanations now available
            });

            // Also send a dedicated EMBEDDINGS_COMPLETE message
            chrome.runtime.sendMessage({
              type: MessageType.EMBEDDINGS_COMPLETE,
              payload: { paperId: storedPaper.id, paperUrl: storedPaper.url },
            }).catch(() => {
              // No listeners, that's ok
            });
          }
        } else {
          logger.debug('BACKGROUND_SCRIPT', '[DBHandlers] Could not generate embeddings, will use keyword search:', result.error);

          // Even if embeddings fail, enable image explanations (they can still work with keyword search)
          if (tabId) {
            await operationStateService.updateStateAndBroadcast(tabId, {
              isGeneratingEmbeddings: false,
              embeddingProgress: '',
              hasEmbeddings: false,  // Embeddings failed
              imageExplanationReady: true,  // But image explanations can still work
            });
          }
        }
      } catch (error) {
        logger.debug('BACKGROUND_SCRIPT', '[DBHandlers] Error triggering embedding generation:', error);

        // On error, still enable image explanations
        if (tabId) {
          await operationStateService.updateStateAndBroadcast(tabId, {
            isGeneratingEmbeddings: false,
            embeddingProgress: '',
            hasEmbeddings: false,
            imageExplanationReady: true,
          });
        }
      }
    })();

    return { success: true, paper: storedPaper };
  } catch (dbError) {
    logger.error('BACKGROUND_SCRIPT', '[DBHandlers] Failed to store paper:', dbError);

    // Clear chunking state on error
    if (tabId) {
      await operationStateService.updateStateAndBroadcast(tabId, {
        isChunking: false,
        chunkingProgress: '',
        currentChunk: 0,
        totalChunks: 0,
      });
    }

    return { success: false, error: String(dbError) };
  }
}

/**
 * Get a paper from IndexedDB by URL
 */
export async function handleGetPaperByUrl(payload: any): Promise<any> {
  try {
    logger.debug('BACKGROUND_SCRIPT', '[DBHandlers] Getting paper by URL:', payload.url);
    const paper = await getPaperByUrl(payload.url);
    logger.debug('BACKGROUND_SCRIPT', '[DBHandlers] Paper retrieval result:', paper ? 'Found' : 'Not found');
    return { success: true, paper };
  } catch (dbError) {
    logger.error('BACKGROUND_SCRIPT', '[DBHandlers] Failed to get paper:', dbError);
    return { success: false, error: String(dbError), paper: null };
  }
}

/**
 * Check if a paper is stored in IndexedDB
 */
export async function handleIsPaperStored(payload: any): Promise<any> {
  try {
    logger.debug('BACKGROUND_SCRIPT', '[DBHandlers] Checking if paper is stored:', payload.url);
    const { isPaperStored } = await import('../../utils/dbService.ts');
    const isStored = await isPaperStored(payload.url);
    logger.debug('BACKGROUND_SCRIPT', '[DBHandlers] Paper stored check result:', isStored);
    return { success: true, isStored };
  } catch (dbError) {
    logger.error('BACKGROUND_SCRIPT', '[DBHandlers] Failed to check if paper stored:', dbError);
    return { success: false, error: String(dbError), isStored: false };
  }
}

/**
 * Get all papers from IndexedDB
 */
export async function handleGetAllPapers(): Promise<any> {
  try {
    logger.debug('BACKGROUND_SCRIPT', '[DBHandlers] Getting all papers from IndexedDB');
    const { getAllPapers } = await import('../../utils/dbService.ts');
    const papers = await getAllPapers();
    logger.debug('BACKGROUND_SCRIPT', '[DBHandlers] Retrieved', papers.length, 'papers');
    return { success: true, papers };
  } catch (dbError) {
    logger.error('BACKGROUND_SCRIPT', '[DBHandlers] Failed to get all papers:', dbError);
    return { success: false, error: String(dbError), papers: [] };
  }
}

/**
 * Delete a paper from IndexedDB
 */
export async function handleDeletePaper(payload: any): Promise<any> {
  try {
    logger.debug('BACKGROUND_SCRIPT', '[DBHandlers] Deleting paper:', payload.paperId);

    // Get paper URL before deletion for cleanup
    const { getPaperById, deletePaper } = await import('../../utils/dbService.ts');
    const paperToDelete = await getPaperById(payload.paperId);
    const deletedPaperUrl = paperToDelete?.url;

    if (!deletedPaperUrl) {
      logger.warn('BACKGROUND_SCRIPT', '[DBHandlers] Paper not found or has no URL');
      return { success: false, error: 'Paper not found' };
    }

    // 1. Clean up all resources (AI sessions, requests, states, tab mappings, chat sessions) before deletion
    logger.debug('BACKGROUND_SCRIPT', '[DBHandlers] Cleaning up resources for paper:', deletedPaperUrl);
    const cleanupSummary = await paperCleanupService.cleanupPaper(deletedPaperUrl, undefined, payload.paperId);
    logger.debug('BACKGROUND_SCRIPT', '[DBHandlers] Cleanup summary:', cleanupSummary);

    // 2. Delete the paper from database
    const deleted = await deletePaper(payload.paperId);
    logger.debug('BACKGROUND_SCRIPT', '[DBHandlers] Paper deletion result:', deleted);

    // 3. Update icons for tabs showing this paper's URL
    if (deleted) {
      try {
        const tabs = await chrome.tabs.query({});
        const normalizedDeletedUrl = normalizeUrl(deletedPaperUrl);
        const matchingTabs = tabs.filter(tab => tab.url && normalizeUrl(tab.url) === normalizedDeletedUrl);

        for (const tab of matchingTabs) {
          if (tab.id !== undefined) {
            await iconService.setDefaultIcon(tab.id);
            logger.debug('BACKGROUND_SCRIPT', `[DBHandlers] ✓ Icon reset for tab ${tab.id}`);
          }
        }

        if (matchingTabs.length > 0) {
          logger.debug('BACKGROUND_SCRIPT', `[DBHandlers] ✓ Icons updated for ${matchingTabs.length} tab(s)`);
        }

        // Update context menus if active tab was viewing this paper
        const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (activeTab && activeTab.url && normalizeUrl(activeTab.url) === normalizedDeletedUrl) {
          // Paper deleted from active tab - update context menus
          try {
            await chrome.contextMenus.update('open-chat', { enabled: false });
            await chrome.contextMenus.update('chat-with-kuma-page', { enabled: false });
            await chrome.contextMenus.update('detect-paper-page', { enabled: true });
            logger.debug('BACKGROUND_SCRIPT', '[DBHandlers] ✓ Context menus updated after paper deletion');
          } catch (menuError) {
            logger.warn('BACKGROUND_SCRIPT', '[DBHandlers] Failed to update context menus:', menuError);
          }
        }
      } catch (iconError) {
        logger.warn('BACKGROUND_SCRIPT', '[DBHandlers] Failed to update icons:', iconError);
        // Don't fail the deletion if icon update fails
      }
    }

    // 4. Broadcast PAPER_DELETED message to notify all components
    if (deleted) {
      // Send to extension components (popup, sidepanel, etc.)
      chrome.runtime.sendMessage({
        type: MessageType.PAPER_DELETED,
        payload: { paperUrl: deletedPaperUrl, paperId: payload.paperId },
      }).catch(() => {
        // No listeners, that's ok
      });
      logger.debug('BACKGROUND_SCRIPT', '[DBHandlers] ✓ PAPER_DELETED broadcast sent to extension');

      // BUG FIX: Also send to content scripts in all tabs with matching URL
      try {
        const tabs = await chrome.tabs.query({});
        const normalizedDeletedUrl = normalizeUrl(deletedPaperUrl);
        const matchingTabs = tabs.filter(tab => tab.url && normalizeUrl(tab.url) === normalizedDeletedUrl);

        for (const tab of matchingTabs) {
          if (tab.id !== undefined) {
            chrome.tabs.sendMessage(tab.id, {
              type: MessageType.PAPER_DELETED,
              payload: { paperUrl: deletedPaperUrl, paperId: payload.paperId },
            }).catch(() => {
              // Content script might not be loaded, that's ok
            });
            logger.debug('BACKGROUND_SCRIPT', `[DBHandlers] ✓ PAPER_DELETED sent to content script in tab ${tab.id}`);
          }
        }

        if (matchingTabs.length > 0) {
          logger.debug('BACKGROUND_SCRIPT', `[DBHandlers] ✓ PAPER_DELETED sent to ${matchingTabs.length} matching tab(s)`);
        }
      } catch (tabError) {
        logger.warn('BACKGROUND_SCRIPT', '[DBHandlers] Failed to send PAPER_DELETED to tabs:', tabError);
        // Don't fail the deletion if tab messaging fails
      }
    }

    return { success: deleted, cleanupSummary };
  } catch (dbError) {
    logger.error('BACKGROUND_SCRIPT', '[DBHandlers] Failed to delete paper:', dbError);
    return { success: false, error: String(dbError) };
  }
}

/**
 * Update Q&A history for a paper
 */
export async function handleUpdateQAHistory(payload: any): Promise<any> {
  try {
    logger.debug('BACKGROUND_SCRIPT', '[DBHandlers] Updating Q&A history for paper:', payload.paperId);
    const { updatePaperQAHistory } = await import('../../utils/dbService.ts');
    const updated = await updatePaperQAHistory(payload.paperId, payload.qaHistory);
    logger.debug('BACKGROUND_SCRIPT', '[DBHandlers] Q&A history update result:', updated);
    return { success: updated };
  } catch (dbError) {
    logger.error('BACKGROUND_SCRIPT', '[DBHandlers] Failed to update Q&A history:', dbError);
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
    logger.debug('BACKGROUND_SCRIPT', '[DBHandlers] Storing image explanation for:', payload.imageUrl);
    const { storeImageExplanation } = await import('../../utils/dbService.ts');
    const explanation = await storeImageExplanation(
      payload.paperId,
      payload.imageUrl,
      payload.title,
      payload.explanation,
      payload.imageHash
    );
    logger.debug('BACKGROUND_SCRIPT', '[DBHandlers] ✓ Image explanation stored');
    return { success: true, explanation };
  } catch (dbError) {
    logger.error('BACKGROUND_SCRIPT', '[DBHandlers] Failed to store image explanation:', dbError);
    return { success: false, error: String(dbError) };
  }
}

/**
 * Get an image explanation from IndexedDB
 */
export async function handleGetImageExplanation(payload: any): Promise<any> {
  try {
    logger.debug('BACKGROUND_SCRIPT', '[DBHandlers] Getting image explanation for:', payload.imageUrl);
    const { getImageExplanation } = await import('../../utils/dbService.ts');
    const explanation = await getImageExplanation(payload.paperId, payload.imageUrl);
    logger.debug('BACKGROUND_SCRIPT', '[DBHandlers] Image explanation result:', explanation ? 'Found' : 'Not found');
    return { success: true, explanation };
  } catch (dbError) {
    logger.error('BACKGROUND_SCRIPT', '[DBHandlers] Failed to get image explanation:', dbError);
    return { success: false, error: String(dbError) };
  }
}

/**
 * Get all image explanations for a paper from IndexedDB
 */
export async function handleGetImageExplanationsByPaper(payload: any): Promise<any> {
  try {
    logger.debug('BACKGROUND_SCRIPT', '[DBHandlers] Getting all image explanations for paper:', payload.paperId);
    const { getImageExplanationsByPaper } = await import('../../utils/dbService.ts');
    const explanations = await getImageExplanationsByPaper(payload.paperId);
    logger.debug('BACKGROUND_SCRIPT', '[DBHandlers] ✓ Retrieved', explanations.length, 'image explanations');
    return { success: true, explanations };
  } catch (dbError) {
    logger.error('BACKGROUND_SCRIPT', '[DBHandlers] Failed to get image explanations:', dbError);
    return { success: false, error: String(dbError), explanations: [] };
  }
}

/**
 * Store a screen capture blob in IndexedDB
 */
export async function handleStoreScreenCapture(payload: any): Promise<any> {
  try {
    logger.debug('BACKGROUND_SCRIPT', '[DBHandlers] Storing screen capture for:', payload.imageUrl);

    // Reconstruct Blob from Base64 string (Chrome messaging uses JSON serialization)
    const binaryString = atob(payload.blobDataBase64);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    const blob = new Blob([bytes], { type: payload.mimeType });
    logger.debug('BACKGROUND_SCRIPT', '[DBHandlers] Reconstructed blob from Base64:', blob.size, 'bytes, type:', blob.type);

    const { storeScreenCapture } = await import('../../utils/dbService.ts');
    const entry = await storeScreenCapture(
      payload.paperId,
      payload.imageUrl,
      blob,
      payload.overlayPosition
    );
    logger.debug('BACKGROUND_SCRIPT', '[DBHandlers] ✓ Screen capture stored');
    return { success: true, entry };
  } catch (dbError) {
    logger.error('BACKGROUND_SCRIPT', '[DBHandlers] Failed to store screen capture:', dbError);
    return { success: false, error: String(dbError) };
  }
}

/**
 * Get a screen capture blob from IndexedDB
 */
export async function handleGetScreenCapture(payload: any): Promise<any> {
  try {
    logger.debug('BACKGROUND_SCRIPT', '[DBHandlers] Getting screen capture for:', payload.imageUrl);
    const { getScreenCapture } = await import('../../utils/dbService.ts');
    const entry = await getScreenCapture(payload.paperId, payload.imageUrl);
    logger.debug('BACKGROUND_SCRIPT', '[DBHandlers] Screen capture result:', entry ? 'Found' : 'Not found');

    if (!entry) {
      return { success: true, entry: null };
    }

    // Convert blob to base64 before sending back to content script (Chrome messaging uses JSON serialization)
    const arrayBuffer = await entry.blob.arrayBuffer();
    const uint8Array = new Uint8Array(arrayBuffer);
    const mimeType = entry.blob.type;

    // Convert Uint8Array to Base64 string (chunk to avoid call stack overflow)
    const chunkSize = 0x8000; // 32KB chunks
    let binaryString = '';
    for (let i = 0; i < uint8Array.length; i += chunkSize) {
      const chunk = uint8Array.subarray(i, Math.min(i + chunkSize, uint8Array.length));
      binaryString += String.fromCharCode.apply(null, Array.from(chunk));
    }
    const blobDataBase64 = btoa(binaryString);
    logger.debug('BACKGROUND_SCRIPT', '[DBHandlers] Converted blob to Base64:', blobDataBase64.length, 'chars');

    return {
      success: true,
      entry: {
        paperId: entry.paperId,
        imageUrl: entry.imageUrl,
        timestamp: entry.timestamp,
        blobDataBase64,
        mimeType,
        overlayPosition: entry.overlayPosition,
      }
    };
  } catch (dbError) {
    logger.error('BACKGROUND_SCRIPT', '[DBHandlers] Failed to get screen capture:', dbError);
    return { success: false, error: String(dbError) };
  }
}

/**
 * Delete a screen capture blob from IndexedDB
 */
export async function handleDeleteScreenCapture(payload: any): Promise<any> {
  try {
    logger.debug('BACKGROUND_SCRIPT', '[DBHandlers] Deleting screen capture for:', payload.imageUrl);
    const { deleteScreenCapture } = await import('../../utils/dbService.ts');
    const success = await deleteScreenCapture(payload.paperId, payload.imageUrl);
    logger.debug('BACKGROUND_SCRIPT', '[DBHandlers] ✓ Screen capture deleted');
    return { success };
  } catch (dbError) {
    logger.error('BACKGROUND_SCRIPT', '[DBHandlers] Failed to delete screen capture:', dbError);
    return { success: false, error: String(dbError) };
  }
}

/**
 * Extract paper from HTML in offscreen document
 * Receives HTML from content script and triggers offscreen extraction
 */
export async function handleExtractPaperHTML(payload: any): Promise<any> {
  try {
    logger.debug('BACKGROUND_SCRIPT', '[DBHandlers] Triggering offscreen extraction for:', payload.paperUrl);

    const { extractPaperFromHTMLOffscreen } = await import('../services/offscreenService.ts');
    const result = await extractPaperFromHTMLOffscreen(
      payload.paperHtml,
      payload.paperUrl,
      payload.paper
    );

    if (result.success) {
      logger.debug('BACKGROUND_SCRIPT', '[DBHandlers] ✓ Offscreen extraction triggered');
      return { success: true };
    } else {
      logger.error('BACKGROUND_SCRIPT', '[DBHandlers] Failed to trigger offscreen extraction:', result.error);
      return { success: false, error: result.error };
    }
  } catch (error) {
    logger.error('BACKGROUND_SCRIPT', '[DBHandlers] Error triggering offscreen extraction:', error);
    return { success: false, error: String(error) };
  }
}
