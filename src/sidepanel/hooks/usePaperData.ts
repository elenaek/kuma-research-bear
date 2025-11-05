import * as ChromeService from '../../services/chromeService.ts';
import { StoredPaper } from '../../shared/types/index.ts';
import { logger } from '../../shared/utils/logger.ts';

interface UsePaperDataReturn {
  checkForStoredPaper: (paperUrl: string, maxRetries?: number) => Promise<StoredPaper | null>;
}

/**
 * Custom hook to handle paper data operations
 * Provides utilities for loading and checking paper storage status
 */
export function usePaperData(): UsePaperDataReturn {
  /**
   * Check for stored paper with retry logic and exponential backoff
   * Retries up to maxRetries times with increasing delays: 100ms, 200ms, 400ms, 800ms, 1600ms
   *
   * @param paperUrl - The URL of the paper to check
   * @param maxRetries - Maximum number of retry attempts (default: 5)
   * @returns The stored paper if found, null otherwise
   */
  async function checkForStoredPaper(paperUrl: string, maxRetries = 5): Promise<StoredPaper | null> {
    for (let i = 0; i < maxRetries; i++) {
      logger.debug('UI', `[usePaperData] Checking if paper is stored (attempt ${i + 1}/${maxRetries})...`);

      try {
        const stored = await ChromeService.getPaperByUrl(paperUrl);

        if (stored) {
          logger.debug('UI', '[usePaperData] ✓ Paper found in storage!', {
            id: stored.id,
            title: stored.title,
            chunkCount: stored.chunkCount,
            storedAt: new Date(stored.storedAt).toLocaleString()
          });
          return stored;
        }

        logger.debug('UI', `[usePaperData] Paper not found yet (attempt ${i + 1}/${maxRetries})`);
      } catch (error) {
        logger.error('UI', `[usePaperData] Error checking storage (attempt ${i + 1}/${maxRetries}):`, error);
      }

      // Wait before next retry with exponential backoff
      if (i < maxRetries - 1) {
        const delay = 100 * Math.pow(2, i);
        logger.debug('UI', `[usePaperData] Waiting ${delay}ms before next attempt...`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }

    logger.warn('UI', `[usePaperData] Paper not found after ${maxRetries} attempts`);
    return null;
  }

  return {
    checkForStoredPaper,
  };
}
