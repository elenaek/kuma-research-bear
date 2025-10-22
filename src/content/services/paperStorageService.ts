import { ResearchPaper } from '../../types/index.ts';
import * as ChromeService from '../../services/ChromeService.ts';
import { extractFullText } from './textExtractionService.ts';

/**
 * Paper Storage Service
 * Handles paper storage operations via background worker using ChromeService
 */

export interface StorageResult {
  stored: boolean;
  chunkCount: number;
  alreadyStored: boolean;
  storageError?: string;
  paperId?: string;
}

/**
 * Store paper with full text extraction and storage status tracking
 * Handles both new papers and already-stored papers
 */
export async function storePaper(paper: ResearchPaper): Promise<StorageResult> {
  console.log('[PaperStorage] Preparing to store paper:', {
    title: paper.title,
    url: paper.url,
    source: paper.source
  });

  try {
    // Check if already stored
    const alreadyStored = await ChromeService.isPaperStoredInDB(paper.url);
    console.log('[PaperStorage] isPaperStored check result:', alreadyStored);

    if (!alreadyStored) {
      console.log('[PaperStorage] Extracting text and sending to background for storage...');

      // Extract full text in content script (where document is available)
      const fullText = await extractFullText();

      // Send to background for storage (IndexedDB must be in background for cross-context access)
      const storageResponse = await ChromeService.storePaperInDB(paper, fullText);

      if (storageResponse.success && storageResponse.paper) {
        console.log('[PaperStorage] ✓ Paper stored successfully in background!', {
          id: storageResponse.paper.id,
          chunkCount: storageResponse.paper.chunkCount,
        });

        // Note: Embedding generation now handled by offscreen document in background
        // This ensures embeddings persist even if user navigates away from tab

        return {
          stored: true,
          chunkCount: storageResponse.paper.chunkCount,
          alreadyStored: false,
          paperId: storageResponse.paper.id,
        };
      } else {
        console.error('[PaperStorage] Failed to store paper:', storageResponse.error);
        return {
          stored: false,
          chunkCount: 0,
          alreadyStored: false,
          storageError: storageResponse.error || 'Failed to store paper',
        };
      }
    } else {
      console.log('[PaperStorage] Paper already stored, fetching existing data...');
      const existingPaper = await ChromeService.getPaperByUrl(paper.url);
      console.log('[PaperStorage] Existing paper retrieved:', {
        id: existingPaper?.id,
        chunkCount: existingPaper?.chunkCount
      });

      return {
        stored: true,
        chunkCount: existingPaper?.chunkCount || 0,
        alreadyStored: true,
        paperId: existingPaper?.id,
      };
    }
  } catch (error) {
    // Capture detailed error message for debugging
    console.error('[PaperStorage] ❌ Failed to store paper in IndexedDB:', {
      error,
      stack: error instanceof Error ? error.stack : undefined,
      paperUrl: paper.url
    });

    return {
      stored: false,
      chunkCount: 0,
      alreadyStored: false,
      storageError: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Simple storage without detailed tracking (for auto-detection on page load)
 */
export async function storePaperSimple(paper: ResearchPaper): Promise<boolean> {
  try {
    const alreadyStored = await ChromeService.isPaperStoredInDB(paper.url);
    if (!alreadyStored) {
      console.log('[PaperStorage] Extracting text and sending to background for storage...');
      const fullText = await extractFullText();

      // Send to background for storage
      const storageResponse = await ChromeService.storePaperInDB(paper, fullText);

      if (storageResponse.success && storageResponse.paper) {
        console.log('[PaperStorage] ✓ Paper stored in background for offline access');

        // Note: Embedding generation handled by offscreen document in background

        return true;
      } else {
        console.error('[PaperStorage] Failed to store paper:', storageResponse.error);
        return false;
      }
    } else {
      console.log('[PaperStorage] Paper already stored in IndexedDB');
      return true;
    }
  } catch (error) {
    console.warn('[PaperStorage] Failed to store paper in IndexedDB:', error);
    return false;
  }
}
