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
      console.log('[PaperStorage] Storing paper in IndexedDB via background worker...');

      // Extract full text in content script (where document is available)
      const fullText = await extractFullText();
      const storeResult = await ChromeService.storePaperInDB(paper, fullText);

      if (storeResult.success && storeResult.paper) {
        const storedPaper = storeResult.paper;
        console.log('[PaperStorage] ✓ Paper stored successfully!', {
          id: storedPaper.id,
          chunkCount: storedPaper.chunkCount,
          storedAt: new Date(storedPaper.storedAt).toLocaleString()
        });

        return {
          stored: true,
          chunkCount: storedPaper.chunkCount,
          alreadyStored: false,
          paperId: storedPaper.id,
        };
      } else {
        console.error('[PaperStorage] Failed to store paper:', storeResult.error);
        return {
          stored: false,
          chunkCount: 0,
          alreadyStored: false,
          storageError: storeResult.error,
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
      console.log('[PaperStorage] Storing paper in IndexedDB via background worker...');
      const fullText = await extractFullText();
      const storeResult = await ChromeService.storePaperInDB(paper, fullText);

      if (storeResult.success) {
        console.log('[PaperStorage] ✓ Paper stored locally for offline access');
        return true;
      } else {
        console.error('[PaperStorage] Failed to store paper:', storeResult.error);
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
