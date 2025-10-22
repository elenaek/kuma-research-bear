import { ResearchPaper } from '../../types/index.ts';
import { detectPaper, detectPaperWithAI } from '../../utils/paperDetectors.ts';
import { storePaperSimple } from './paperStorageService.ts';
import { aiService } from '../../utils/aiService.ts';

/**
 * Paper Detection Service
 * Unified service for paper detection and automatic storage
 * Eliminates code duplication across init, message handlers, and mutation observer
 */

/**
 * Detect paper using basic detection (site-specific detectors)
 * Automatically stores detected paper in IndexedDB
 * Used for auto-detection on page load and mutation observer
 */
export async function detectAndStorePaper(): Promise<ResearchPaper | null> {
  try {
    const paper = await detectPaper();

    if (paper) {
      console.log('[PaperDetection] Research paper detected:', paper.title);

      // Detect language
      try {
        const textForDetection = `${paper.title} ${paper.abstract}`.trim();
        const detectedLanguage = await aiService.detectLanguage(textForDetection);

        if (detectedLanguage) {
          if (!paper.metadata) {
            paper.metadata = {};
          }
          paper.metadata.originalLanguage = detectedLanguage;
          console.log('[PaperDetection] Detected paper language:', detectedLanguage);
        }
      } catch (error) {
        console.error('[PaperDetection] Error detecting language:', error);
        // Continue anyway - language detection is optional
      }

      // Store in IndexedDB via background worker (single source of truth)
      await storePaperSimple(paper);

      return paper;
    } else {
      console.log('[PaperDetection] No research paper detected on this page');
      return null;
    }
  } catch (error) {
    console.error('[PaperDetection] Error during paper detection:', error);
    return null;
  }
}

/**
 * Detect paper using AI-first approach (more accurate but slower)
 * Returns paper without automatic storage (caller handles storage)
 * Used for manual detection via DETECT_PAPER message
 */
export async function detectPaperWithAIOnly(): Promise<ResearchPaper | null> {
  try {
    const paper = await detectPaperWithAI();

    if (paper) {
      console.log('[PaperDetection] AI-detected paper:', paper.title);
    }

    return paper;
  } catch (error) {
    console.error('[PaperDetection] Error during AI paper detection:', error);
    return null;
  }
}
