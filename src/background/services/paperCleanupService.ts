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
import { tabPaperTracker } from './tabPaperTracker.ts';
import { logger } from '../../utils/logger.ts';

/**
 * AI context IDs that might exist for a given tab
 * Note: Sub-contexts (analysis/glossary batches) are ephemeral and auto-cleaned
 */
const AI_CONTEXTS = [
  'explain',
  'explain-manual',
  'section',
  'term',
  'summary',
  'summary-manual',
  'analysis',
  'glossary',
  'glossary-manual',
  'qa',
  'extraction',
];

/**
 * Operations that might have active requests
 */
const OPERATIONS = [
  'analyze',
  'glossary',
  'glossary-manual',
  'explain-manual',
  'summary-manual',
];

/**
 * Clean up all resources for a single paper
 * @param paperUrl - URL of the paper being deleted
 * @param tabId - Optional specific tab ID to clean up
 * @param paperId - Optional paper ID for cleaning up chat sessions and ID mappings
 * @returns Summary of cleanup actions taken
 */
export async function cleanupPaper(
  paperUrl: string,
  tabId?: number,
  paperId?: string
): Promise<{
  aiSessionsDestroyed: number;
  requestsCancelled: number;
  statesCleared: number;
  tabMappingsCleared: number;
  chatSessionsDestroyed: number;
}> {
  logger.debug('BACKGROUND_SCRIPT', `[PaperCleanup] Starting cleanup for paper: ${paperUrl}`, tabId ? `(tab ${tabId})` : '(all tabs)');

  let aiSessionsDestroyed = 0;
  let requestsCancelled = 0;
  let statesCleared = 0;
  let tabMappingsCleared = 0;
  let chatSessionsDestroyed = 0;

  // If tabId is provided, clean up that specific tab
  if (tabId !== undefined) {
    // 1. Destroy AI sessions for this tab
    for (const context of AI_CONTEXTS) {
      const contextId = `tab-${tabId}-${context}`;
      try {
        aiService.destroySessionForContext(contextId);
        aiSessionsDestroyed++;
        logger.debug('BACKGROUND_SCRIPT', `[PaperCleanup] ✓ Destroyed AI session: ${contextId}`);
      } catch (error) {
        logger.warn('BACKGROUND_SCRIPT', `[PaperCleanup] Failed to destroy session ${contextId}:`, error);
      }
    }

    // 2. Cancel active requests for this paper on this tab
    for (const operation of OPERATIONS) {
      const requestKey = requestDeduplicationService.getRequestKey(tabId, operation, paperUrl);
      if (requestDeduplicationService.hasRequest(requestKey)) {
        requestDeduplicationService.deleteRequest(requestKey);
        requestsCancelled++;
        logger.debug('BACKGROUND_SCRIPT', `[PaperCleanup] ✓ Cancelled request: ${requestKey}`);
      }
    }

    // 3. Clear operation state for this tab if it matches this paper
    const state = operationStateService.getRawState(tabId);
    if (state?.currentPaper?.url === paperUrl) {
      operationStateService.deleteState(tabId);
      statesCleared++;
      logger.debug('BACKGROUND_SCRIPT', `[PaperCleanup] ✓ Cleared operation state for tab ${tabId}`);
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
            logger.debug('BACKGROUND_SCRIPT', `[PaperCleanup] ✓ Destroyed AI session: ${contextId}`);
          } catch (error) {
            logger.warn('BACKGROUND_SCRIPT', `[PaperCleanup] Failed to destroy session ${contextId}:`, error);
          }
        }

        // Cancel active requests for this tab
        for (const operation of OPERATIONS) {
          const requestKey = requestDeduplicationService.getRequestKey(currentTabId, operation, paperUrl);
          if (requestDeduplicationService.hasRequest(requestKey)) {
            requestDeduplicationService.deleteRequest(requestKey);
            requestsCancelled++;
            logger.debug('BACKGROUND_SCRIPT', `[PaperCleanup] ✓ Cancelled request: ${requestKey}`);
          }
        }

        // Clear operation state
        operationStateService.deleteState(currentTabId);
        statesCleared++;
        logger.debug('BACKGROUND_SCRIPT', `[PaperCleanup] ✓ Cleared operation state for tab ${currentTabId}`);
      }
    }

    // 2. Also check for requests by URL (using new URL-based methods)
    const urlRequests = requestDeduplicationService.getRequestsByUrl(paperUrl);
    for (const requestKey of urlRequests) {
      requestDeduplicationService.deleteRequest(requestKey);
      requestsCancelled++;
      logger.debug('BACKGROUND_SCRIPT', `[PaperCleanup] ✓ Cancelled request by URL: ${requestKey}`);
    }
  }

  // 3. Clean up tab-paper tracker mappings (only if not tab-specific cleanup)
  if (tabId === undefined) {
    const clearedTabCount = tabPaperTracker.clearPaperFromAllTabs(paperUrl);
    tabMappingsCleared = clearedTabCount;
    logger.debug('BACKGROUND_SCRIPT', `[PaperCleanup] ✓ Cleared ${clearedTabCount} tab-paper mappings`);

    // Also remove paper ID mapping if paperId provided
    if (paperId) {
      const removed = tabPaperTracker.removePaperIdMapping(paperId);
      if (removed) {
        logger.debug('BACKGROUND_SCRIPT', `[PaperCleanup] ✓ Removed paper ID mapping for ${paperId}`);
      }
    }
  }

  // 4. Clean up chat session (only if paperId provided and not tab-specific cleanup)
  if (paperId && tabId === undefined) {
    const chatContextId = `chat-${paperId}`;
    try {
      aiService.destroySessionForContext(chatContextId);
      chatSessionsDestroyed++;
      logger.debug('BACKGROUND_SCRIPT', `[PaperCleanup] ✓ Destroyed chat session: ${chatContextId}`);
    } catch (error) {
      logger.warn('BACKGROUND_SCRIPT', `[PaperCleanup] Failed to destroy chat session ${chatContextId}:`, error);
    }
  }

  const summary = {
    aiSessionsDestroyed,
    requestsCancelled,
    statesCleared,
    tabMappingsCleared,
    chatSessionsDestroyed,
  };

  logger.debug('BACKGROUND_SCRIPT', `[PaperCleanup] Cleanup complete for ${paperUrl}:`, summary);
  return summary;
}

/**
 * Clean up resources for multiple papers
 * @param papers - Array of objects with paperUrl and paperId
 * @returns Summary of total cleanup actions
 */
export async function cleanupMultiplePapers(
  papers: Array<{ paperUrl: string; paperId: string }>
): Promise<{
  aiSessionsDestroyed: number;
  requestsCancelled: number;
  statesCleared: number;
  tabMappingsCleared: number;
  chatSessionsDestroyed: number;
}> {
  logger.debug('BACKGROUND_SCRIPT', `[PaperCleanup] Starting cleanup for ${papers.length} papers`);

  let totalAISessionsDestroyed = 0;
  let totalRequestsCancelled = 0;
  let totalStatesCleared = 0;
  let totalTabMappingsCleared = 0;
  let totalChatSessionsDestroyed = 0;

  for (const { paperUrl, paperId } of papers) {
    const result = await cleanupPaper(paperUrl, undefined, paperId);
    totalAISessionsDestroyed += result.aiSessionsDestroyed;
    totalRequestsCancelled += result.requestsCancelled;
    totalStatesCleared += result.statesCleared;
    totalTabMappingsCleared += result.tabMappingsCleared;
    totalChatSessionsDestroyed += result.chatSessionsDestroyed;
  }

  const summary = {
    aiSessionsDestroyed: totalAISessionsDestroyed,
    requestsCancelled: totalRequestsCancelled,
    statesCleared: totalStatesCleared,
    tabMappingsCleared: totalTabMappingsCleared,
    chatSessionsDestroyed: totalChatSessionsDestroyed,
  };

  logger.debug('BACKGROUND_SCRIPT', `[PaperCleanup] Multi-paper cleanup complete:`, summary);
  return summary;
}
