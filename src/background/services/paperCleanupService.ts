/**
 * Paper Cleanup Service
 * Orchestrates cleanup of all resources when papers are deleted
 * - Destroys AI sessions
 * - Cancels active requests
 * - Clears operation states
 */

import { aiService } from '../../utils/aiService.ts';
import * as operationStateService from './operationStateService.ts';
import * as requestDeduplicationService from './requestDeduplicationService.ts';

/**
 * AI context IDs that might exist for a given tab
 */
const AI_CONTEXTS = ['explain', 'section', 'term', 'summary', 'analysis', 'glossary', 'qa'];

/**
 * Operations that might have active requests
 */
const OPERATIONS = ['analyze', 'glossary'];

/**
 * Clean up all resources for a single paper
 * @param paperUrl - URL of the paper being deleted
 * @param tabId - Optional specific tab ID to clean up
 * @returns Summary of cleanup actions taken
 */
export async function cleanupPaper(paperUrl: string, tabId?: number): Promise<{
  aiSessionsDestroyed: number;
  requestsCancelled: number;
  statesCleared: number;
}> {
  console.log(`[PaperCleanup] Starting cleanup for paper: ${paperUrl}`, tabId ? `(tab ${tabId})` : '(all tabs)');

  let aiSessionsDestroyed = 0;
  let requestsCancelled = 0;
  let statesCleared = 0;

  // If tabId is provided, clean up that specific tab
  if (tabId !== undefined) {
    // 1. Destroy AI sessions for this tab
    for (const context of AI_CONTEXTS) {
      const contextId = `tab-${tabId}-${context}`;
      try {
        aiService.destroySessionForContext(contextId);
        aiSessionsDestroyed++;
        console.log(`[PaperCleanup] ✓ Destroyed AI session: ${contextId}`);
      } catch (error) {
        console.warn(`[PaperCleanup] Failed to destroy session ${contextId}:`, error);
      }
    }

    // 2. Cancel active requests for this paper on this tab
    for (const operation of OPERATIONS) {
      const requestKey = requestDeduplicationService.getRequestKey(tabId, operation, paperUrl);
      if (requestDeduplicationService.hasRequest(requestKey)) {
        requestDeduplicationService.deleteRequest(requestKey);
        requestsCancelled++;
        console.log(`[PaperCleanup] ✓ Cancelled request: ${requestKey}`);
      }
    }

    // 3. Clear operation state for this tab if it matches this paper
    const state = operationStateService.getRawState(tabId);
    if (state?.currentPaper?.url === paperUrl) {
      operationStateService.deleteState(tabId);
      statesCleared++;
      console.log(`[PaperCleanup] ✓ Cleared operation state for tab ${tabId}`);
    }
  } else {
    // Clean up across all tabs
    // 1. Clean up AI sessions across all tabs
    // Get all operation states to find relevant tabs
    const allStates = operationStateService.getAllStates();

    for (const [currentTabId, state] of allStates.entries()) {
      if (state.currentPaper?.url === paperUrl) {
        // Destroy AI sessions for this tab
        for (const context of AI_CONTEXTS) {
          const contextId = `tab-${currentTabId}-${context}`;
          try {
            aiService.destroySessionForContext(contextId);
            aiSessionsDestroyed++;
            console.log(`[PaperCleanup] ✓ Destroyed AI session: ${contextId}`);
          } catch (error) {
            console.warn(`[PaperCleanup] Failed to destroy session ${contextId}:`, error);
          }
        }

        // Cancel active requests for this tab
        for (const operation of OPERATIONS) {
          const requestKey = requestDeduplicationService.getRequestKey(currentTabId, operation, paperUrl);
          if (requestDeduplicationService.hasRequest(requestKey)) {
            requestDeduplicationService.deleteRequest(requestKey);
            requestsCancelled++;
            console.log(`[PaperCleanup] ✓ Cancelled request: ${requestKey}`);
          }
        }

        // Clear operation state
        operationStateService.deleteState(currentTabId);
        statesCleared++;
        console.log(`[PaperCleanup] ✓ Cleared operation state for tab ${currentTabId}`);
      }
    }

    // 2. Also check for requests by URL (using new URL-based methods)
    const urlRequests = requestDeduplicationService.getRequestsByUrl(paperUrl);
    for (const requestKey of urlRequests) {
      requestDeduplicationService.deleteRequest(requestKey);
      requestsCancelled++;
      console.log(`[PaperCleanup] ✓ Cancelled request by URL: ${requestKey}`);
    }
  }

  const summary = {
    aiSessionsDestroyed,
    requestsCancelled,
    statesCleared,
  };

  console.log(`[PaperCleanup] Cleanup complete for ${paperUrl}:`, summary);
  return summary;
}

/**
 * Clean up resources for multiple papers
 * @param paperUrls - Array of paper URLs being deleted
 * @returns Summary of total cleanup actions
 */
export async function cleanupMultiplePapers(paperUrls: string[]): Promise<{
  aiSessionsDestroyed: number;
  requestsCancelled: number;
  statesCleared: number;
}> {
  console.log(`[PaperCleanup] Starting cleanup for ${paperUrls.length} papers`);

  let totalAISessionsDestroyed = 0;
  let totalRequestsCancelled = 0;
  let totalStatesCleared = 0;

  for (const paperUrl of paperUrls) {
    const result = await cleanupPaper(paperUrl);
    totalAISessionsDestroyed += result.aiSessionsDestroyed;
    totalRequestsCancelled += result.requestsCancelled;
    totalStatesCleared += result.statesCleared;
  }

  const summary = {
    aiSessionsDestroyed: totalAISessionsDestroyed,
    requestsCancelled: totalRequestsCancelled,
    statesCleared: totalStatesCleared,
  };

  console.log(`[PaperCleanup] Multi-paper cleanup complete:`, summary);
  return summary;
}
