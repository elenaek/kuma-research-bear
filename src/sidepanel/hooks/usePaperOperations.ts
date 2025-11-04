import { useState } from 'preact/hooks';
import * as ChromeService from '../../services/chromeService.ts';
import { normalizeUrl } from '../../shared/utils/urlUtils.ts';
import { logger } from '../../shared/utils/logger.ts';

/**
 * Custom hook for managing paper operations (analysis, explanation, summary, glossary)
 * Handles triggering operations and finding the correct tab for a paper
 */
export function usePaperOperations(
  operationState: any,
  setOperationQueueMessage: (msg: string) => void,
  setHasQueuedOperations: (has: boolean) => void
) {
  /**
   * Find the tab ID for a paper by its URL
   * Searches all tabs and returns the first one viewing this paper
   * @returns Tab ID if found, undefined otherwise
   */
  async function findTabIdForPaper(paperUrl: string): Promise<number | undefined> {
    try {
      const normalizedPaperUrl = normalizeUrl(paperUrl);
      const tabs = await chrome.tabs.query({});

      for (const tab of tabs) {
        if (tab.url && normalizeUrl(tab.url) === normalizedPaperUrl) {
          return tab.id;
        }
      }

      logger.debug('UI', '[usePaperOperations] No tab found viewing paper:', paperUrl);
      return undefined;
    } catch (error) {
      logger.error('UI', '[usePaperOperations] Error finding tab for paper:', error);
      return undefined;
    }
  }

  async function triggerAnalysis(paperUrl: string) {
    // Guard: Don't retrigger if already analyzing THIS paper
    if (operationState.isAnalyzing(paperUrl)) {
      logger.debug('UI', '[usePaperOperations] Analysis already in progress for this paper, skipping');
      setOperationQueueMessage('Analysis already in progress for this paper');
      setHasQueuedOperations(true);
      setTimeout(() => {
        setHasQueuedOperations(false);
        setOperationQueueMessage('');
      }, 3000);
      return;
    }

    try {
      // Add to analyzing papers Set
      operationState.addAnalyzingPaper(paperUrl);
      logger.debug('UI', 'Starting paper analysis for:', paperUrl);

      // Find the tab viewing this specific paper (not just the active tab)
      const tabId = await findTabIdForPaper(paperUrl);

      const response = await ChromeService.analyzePaper(paperUrl, tabId);

      if (response.success) {
        logger.debug('UI', '✓ Paper analysis completed successfully');
        // Analysis will be loaded automatically via storage change listener
      } else {
        logger.error('UI', 'Analysis failed:', response.error);
        // Show error to user
        setOperationQueueMessage(`Analysis failed: ${response.error}`);
        setHasQueuedOperations(true);
        setTimeout(() => {
          setHasQueuedOperations(false);
          setOperationQueueMessage('');
        }, 5000);
      }
    } catch (error) {
      logger.error('UI', 'Error triggering analysis:', error);
      setOperationQueueMessage('Failed to start analysis');
      setHasQueuedOperations(true);
      setTimeout(() => {
        setHasQueuedOperations(false);
        setOperationQueueMessage('');
      }, 3000);
    } finally {
      // Remove from analyzing papers Set
      operationState.removeAnalyzingPaper(paperUrl);
    }
  }

  async function triggerGlossaryGeneration(paperUrl: string) {
    // Guard: Don't retrigger if already generating for THIS paper
    if (operationState.isGeneratingGlossary(paperUrl)) {
      logger.debug('UI', '[usePaperOperations] Glossary generation already in progress for this paper, skipping');
      setOperationQueueMessage('Glossary generation already in progress for this paper');
      setHasQueuedOperations(true);
      setTimeout(() => {
        setHasQueuedOperations(false);
        setOperationQueueMessage('');
      }, 3000);
      return;
    }

    try {
      // Add to glossary generating papers Set (progress updates come from message listener)
      operationState.addGlossaryGeneratingPaper(paperUrl);
      logger.debug('UI', 'Starting glossary generation for:', paperUrl);

      // Find the tab viewing this specific paper (not just the active tab)
      const tabId = await findTabIdForPaper(paperUrl);

      const response = await ChromeService.generateGlossary(paperUrl, tabId);

      if (response.success && response.glossary) {
        logger.debug('UI', '✓ Glossary generated successfully');
        // Glossary will be loaded automatically via storage change listener
      } else {
        logger.error('UI', 'Glossary generation failed:', response.error);
        // Show error to user
        setOperationQueueMessage(`Glossary generation failed: ${response.error || 'Unknown error'}`);
        setHasQueuedOperations(true);
        setTimeout(() => {
          setHasQueuedOperations(false);
          setOperationQueueMessage('');
        }, 5000);
      }
    } catch (error) {
      logger.error('UI', 'Error triggering glossary generation:', error);
      setOperationQueueMessage('Failed to start glossary generation');
      setHasQueuedOperations(true);
      setTimeout(() => {
        setHasQueuedOperations(false);
        setOperationQueueMessage('');
      }, 3000);
    } finally {
      // Remove from glossary generating papers Set
      operationState.removeGlossaryGeneratingPaper(paperUrl);
    }
  }

  async function triggerExplanation(paperUrl: string) {
    // Guard: Don't retrigger if already explaining for THIS paper
    if (operationState.isExplaining(paperUrl)) {
      logger.debug('UI', '[usePaperOperations] Explanation generation already in progress for this paper, skipping');
      setOperationQueueMessage('Explanation generation already in progress for this paper');
      setHasQueuedOperations(true);
      setTimeout(() => {
        setHasQueuedOperations(false);
        setOperationQueueMessage('');
      }, 3000);
      return;
    }

    try {
      // Add to explaining papers Set
      operationState.addExplainingPaper(paperUrl);
      logger.debug('UI', 'Starting explanation generation for:', paperUrl);

      // Find the tab viewing this specific paper (not just the active tab)
      const tabId = await findTabIdForPaper(paperUrl);

      const response = await ChromeService.explainPaperManual(paperUrl, tabId);

      if (response.success) {
        logger.debug('UI', '✓ Explanation generated successfully');
        // Explanation will be loaded automatically via storage change listener
      } else {
        logger.error('UI', 'Explanation generation failed:', response.error);
        // Show error to user
        setOperationQueueMessage(`Explanation generation failed: ${response.error}`);
        setHasQueuedOperations(true);
        setTimeout(() => {
          setHasQueuedOperations(false);
          setOperationQueueMessage('');
        }, 5000);
      }
    } catch (error) {
      logger.error('UI', 'Error triggering explanation generation:', error);
      setOperationQueueMessage('Failed to generate explanation');
      setHasQueuedOperations(true);
      setTimeout(() => {
        setHasQueuedOperations(false);
        setOperationQueueMessage('');
      }, 3000);
    } finally {
      // Remove from explaining papers Set
      operationState.removeExplainingPaper(paperUrl);
    }
  }

  async function triggerSummary(paperUrl: string) {
    // Guard: Don't retrigger if already generating summary for THIS paper
    if (operationState.isGeneratingSummary(paperUrl)) {
      logger.debug('UI', '[usePaperOperations] Summary generation already in progress for this paper, skipping');
      setOperationQueueMessage('Summary generation already in progress for this paper');
      setHasQueuedOperations(true);
      setTimeout(() => {
        setHasQueuedOperations(false);
        setOperationQueueMessage('');
      }, 3000);
      return;
    }

    try {
      // Add to summary generating papers Set
      operationState.addSummaryGeneratingPaper(paperUrl);
      logger.debug('UI', 'Starting summary generation for:', paperUrl);

      // Find the tab viewing this specific paper (not just the active tab)
      const tabId = await findTabIdForPaper(paperUrl);

      const response = await ChromeService.generateSummaryManual(paperUrl, tabId);

      if (response.success) {
        logger.debug('UI', '✓ Summary generated successfully');
        // Summary will be loaded automatically via storage change listener
      } else {
        logger.error('UI', 'Summary generation failed:', response.error);
        // Show error to user
        setOperationQueueMessage(`Summary generation failed: ${response.error}`);
        setHasQueuedOperations(true);
        setTimeout(() => {
          setHasQueuedOperations(false);
          setOperationQueueMessage('');
        }, 5000);
      }
    } catch (error) {
      logger.error('UI', 'Error triggering summary generation:', error);
      setOperationQueueMessage('Failed to start summary generation');
      setHasQueuedOperations(true);
      setTimeout(() => {
        setHasQueuedOperations(false);
        setOperationQueueMessage('');
      }, 3000);
    } finally {
      // Remove from summary generating papers Set
      operationState.removeSummaryGeneratingPaper(paperUrl);
    }
  }

  return {
    findTabIdForPaper,
    triggerAnalysis,
    triggerGlossaryGeneration,
    triggerExplanation,
    triggerSummary,
  };
}
