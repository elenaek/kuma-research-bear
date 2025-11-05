import { ResearchPaper } from '../../shared/types/index.ts';
import { detectPaper, detectPaperWithAI } from '../../shared/utils/paperDetectors.ts';
import { storePaperSimple } from './paperStorageService.ts';
import { aiService } from '../../shared/utils/aiService.ts';
import { logger } from '../../shared/utils/logger.ts';

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
      logger.debug('CONTENT_SCRIPT', '[PaperDetection] Research paper detected:', paper.title);

      // Detect language
      try {
        const textForDetection = `${paper.title} ${paper.abstract}`.trim();
        const detectedLanguage = await aiService.detectLanguage(textForDetection);

        if (detectedLanguage) {
          if (!paper.metadata) {
            paper.metadata = {};
          }
          paper.metadata.originalLanguage = detectedLanguage;
          logger.debug('CONTENT_SCRIPT', '[PaperDetection] Detected paper language:', detectedLanguage);
        }
      } catch (error) {
        logger.error('CONTENT_SCRIPT', '[PaperDetection] Error detecting language:', error);
        // Continue anyway - language detection is optional
      }

      // Store in IndexedDB via background worker (single source of truth)
      await storePaperSimple(paper);

      return paper;
    } else {
      logger.debug('CONTENT_SCRIPT', '[PaperDetection] No research paper detected on this page');
      return null;
    }
  } catch (error) {
    logger.error('CONTENT_SCRIPT', '[PaperDetection] Error during paper detection:', error);
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
      logger.debug('CONTENT_SCRIPT', '[PaperDetection] AI-detected paper:', paper.title);
    }

    return paper;
  } catch (error) {
    logger.error('CONTENT_SCRIPT', '[PaperDetection] Error during AI paper detection:', error);
    return null;
  }
}
