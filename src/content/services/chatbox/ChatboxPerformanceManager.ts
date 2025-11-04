/**
 * ChatboxPerformanceManager - Performance optimization utilities for chatbox initialization
 *
 * Responsibilities:
 * - Wait for page to be fully loaded before injecting chatbox
 * - Wait for URL to stabilize (important for SPAs that change URL dynamically)
 * - Ensure chatbox doesn't interfere with page load performance
 */

import { logger } from '../../../shared/utils/logger.ts';

export class ChatboxPerformanceManager {
  /**
   * Wait for page to be fully loaded
   * Resolves immediately if already loaded, otherwise waits for 'load' event
   */
  async waitForPageReady(): Promise<void> {
    // If document already loaded, resolve immediately
    if (document.readyState === 'complete') {
      logger.debug('CONTENT_SCRIPT', '[Performance] Page already loaded');
      return;
    }

    logger.debug('CONTENT_SCRIPT', '[Performance] Waiting for page load...');

    // Otherwise wait for load event
    return new Promise((resolve) => {
      window.addEventListener('load', () => {
        logger.debug('CONTENT_SCRIPT', '[Performance] ✓ Page loaded');
        resolve();
      }, { once: true });
    });
  }

  /**
   * Wait for URL to stabilize (important for SPAs that change URL dynamically)
   * Returns the stable URL once it hasn't changed for 3 consecutive checks
   *
   * @returns The stable URL after it stops changing
   */
  async waitForStableUrl(): Promise<string> {
    let currentUrl = window.location.href;
    let stableCount = 0;
    const STABILITY_THRESHOLD = 3; // Need 3 consecutive matches
    const CHECK_INTERVAL_MS = 100; // Check every 100ms

    logger.debug('CONTENT_SCRIPT', '[Performance] Waiting for stable URL...');

    // Check URL every 100ms, need 3 consecutive matches to consider it stable
    while (stableCount < STABILITY_THRESHOLD) {
      await new Promise(resolve => setTimeout(resolve, CHECK_INTERVAL_MS));

      if (window.location.href === currentUrl) {
        stableCount++;
      } else {
        currentUrl = window.location.href;
        stableCount = 0;
        logger.debug('CONTENT_SCRIPT', '[Performance] URL changed, resetting stability counter:', currentUrl);
      }
    }

    logger.debug('CONTENT_SCRIPT', '[Performance] ✓ URL stabilized:', currentUrl);
    return currentUrl;
  }
}
