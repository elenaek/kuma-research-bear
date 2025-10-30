import { ResearchPaper } from '../../types/index.ts';
import { logger } from '../../utils/logger.ts';

/**
 * Mutation Handler
 * Handles MutationObserver setup for SPA state management
 */

/**
 * Create and configure MutationObserver for dynamic page changes
 * Checks IndexedDB for stored papers when page content changes (useful for SPAs)
 * Does NOT automatically detect or store new papers
 */
export function createMutationObserver(
  getCurrentPaper: () => ResearchPaper | null,
  setCurrentPaper: (paper: ResearchPaper | null) => void
): MutationObserver {
  const observer = new MutationObserver((mutations) => {
    const significantChange = mutations.some(
      mutation => mutation.addedNodes.length > 0 || mutation.removedNodes.length > 0
    );

    // Only check IndexedDB if there's no current paper and the page changed significantly
    if (significantChange && !getCurrentPaper()) {
      logger.debug('CONTENT_SCRIPT', '[MutationHandler] Significant page change detected, checking IndexedDB...');

      // Check IndexedDB for stored paper (no automatic detection)
      (async () => {
        try {
          const { getPaperByUrl } = await import('../../services/ChromeService.ts');
          const storedPaper = await getPaperByUrl(window.location.href);

          if (storedPaper) {
            setCurrentPaper(storedPaper);
            logger.debug('CONTENT_SCRIPT', '[MutationHandler] Found stored paper after page mutation:', storedPaper.title);
          } else {
            logger.debug('CONTENT_SCRIPT', '[MutationHandler] No stored paper found for new page');
          }
        } catch (error) {
          logger.error('CONTENT_SCRIPT', '[MutationHandler] Error checking stored paper after mutation:', error);
        }
      })();
    }
  });

  return observer;
}

/**
 * Start observing the document for mutations
 */
export function startObserving(observer: MutationObserver): void {
  observer.observe(document.body, {
    childList: true,
    subtree: true,
  });
  logger.debug('CONTENT_SCRIPT', '[MutationHandler] MutationObserver started');
}
