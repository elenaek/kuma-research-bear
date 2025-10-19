import { ResearchPaper } from '../../types/index.ts';
import { detectAndStorePaper } from '../services/paperDetectionService.ts';

/**
 * Mutation Handler
 * Handles MutationObserver setup for SPA paper detection
 */

/**
 * Create and configure MutationObserver for dynamic page changes
 * Re-detects papers when page content changes (useful for SPAs)
 */
export function createMutationObserver(
  getCurrentPaper: () => ResearchPaper | null,
  setCurrentPaper: (paper: ResearchPaper | null) => void
): MutationObserver {
  const observer = new MutationObserver((mutations) => {
    const significantChange = mutations.some(
      mutation => mutation.addedNodes.length > 0 || mutation.removedNodes.length > 0
    );

    // Only re-detect if there's no current paper and the page changed significantly
    if (significantChange && !getCurrentPaper()) {
      console.log('[MutationHandler] Significant page change detected, re-running paper detection...');

      // Use async detection
      (async () => {
        try {
          const paper = await detectAndStorePaper();
          if (paper) {
            setCurrentPaper(paper);
            console.log('[MutationHandler] Paper detected after page mutation:', paper.title);
          }
        } catch (error) {
          console.error('[MutationHandler] Error detecting paper after mutation:', error);
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
  console.log('[MutationHandler] MutationObserver started');
}
