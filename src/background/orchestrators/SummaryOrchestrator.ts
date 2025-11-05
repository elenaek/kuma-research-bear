import { BaseOperationOrchestrator } from './base/BaseOperationOrchestrator.ts';
import { StoredPaper } from '../../shared/types/index.ts';
import { aiService } from '../../shared/utils/aiService.ts';
import { updatePaper } from '../../shared/utils/dbService.ts';
import { setOperationStart, setOperationComplete } from '../utils/handlerUtils.ts';
import { logger } from '../../shared/utils/logger.ts';

/**
 * SummaryOrchestrator - Orchestrates paper summary generation workflow
 *
 * Responsibilities:
 * - Generate summary using hierarchical summary for large papers
 * - Store result in IndexedDB
 * - Update completion status
 *
 * Algorithm:
 * 1. Retrieve paper from database
 * 2. Determine if hierarchical summary should be used (>6000 chars)
 * 3. Generate summary using aiService
 * 4. Store summary
 * 5. Update completion tracking
 *
 * Features:
 * - Unified handler for both simple and manual summary generation
 * - Automatic hierarchical summary usage for large papers
 * - Request deduplication (for manual triggers)
 * - Automatic state management
 */
export class SummaryOrchestrator extends BaseOperationOrchestrator {
  protected getOperationName(): string {
    return 'Summary';
  }

  protected getProgressField(): string {
    return 'summaryProgress';
  }

  protected getIsOperatingField(): string {
    return 'isGeneratingSummary';
  }

  /**
   * Execute simple summary generation (no state management)
   *
   * @param title - Paper title
   * @param abstract - Paper abstract
   * @param contextId - Context ID for AI sessions
   * @returns Summary
   */
  async executeSimple(
    title: string,
    abstract: string,
    contextId: string
  ): Promise<string> {
    try {
      const summary = await aiService.generateSummary(title, abstract, contextId);
      return summary;
    } finally {
      await aiService.destroySessionForContext(contextId);
    }
  }

  /**
   * Execute manual summary generation workflow
   *
   * @param paperUrl - Paper URL
   * @param tabId - Tab ID for state management
   * @param contextId - Context ID for AI sessions
   * @returns Summary
   */
  async executeManual(
    paperUrl: string,
    tabId: number | undefined,
    contextId: string
  ): Promise<string> {
    // Use request deduplication wrapper
    return await this.withRequestDeduplication(
      paperUrl,
      tabId,
      'summary-manual',
      async () => {
        // Retrieve paper
        const storedPaper = await this.ensurePaperExists(paperUrl);

        // Set operation start
        await setOperationStart(
          tabId,
          'summary',
          storedPaper,
          '🐻 Kuma is generating a summary for the research paper...'
        );

        logger.debug(
          'SUMMARY_ORCHESTRATOR',
          `Generating summary for paper: ${storedPaper.title} with context: ${contextId}`
        );

        // Determine if we should use hierarchical summary
        const hierarchicalSummary = this.getHierarchicalSummaryIfNeeded(storedPaper);

        // Generate summary
        const summary = await aiService.generateSummary(
          storedPaper.title,
          storedPaper.abstract,
          contextId,
          hierarchicalSummary
        );

        return { summary, storedPaper };
      }
    )
      .then(async (result) => {
        if (!result.success || !result.result) {
          throw new Error(result.error || 'Summary generation failed');
        }

        const { summary, storedPaper } = result.result as {
          summary: string;
          storedPaper: StoredPaper;
        };

        // Get output language for metadata
        const outputLanguage = await this.getOutputLanguage();

        // Update paper with new summary (preserve existing explanation)
        await updatePaper(storedPaper.id, {
          summary,
          summaryLanguage: outputLanguage,
        });
        logger.debug('SUMMARY_ORCHESTRATOR', '✓ Summary stored in IndexedDB');

        // Update completion tracking
        await this.updateCompletionStatus(tabId, storedPaper.url);

        // Set operation complete
        await setOperationComplete(
          tabId,
          'summary',
          '🐻 Kuma has finished generating the summary!'
        );

        // Clear the progress message after a delay
        this.clearProgressMessageAfterDelay(tabId, this.getProgressField());

        logger.debug('SUMMARY_ORCHESTRATOR', '✓ Paper summary complete');
        return summary;
      })
      .catch(async (error) => {
        logger.error('SUMMARY_ORCHESTRATOR', 'Error generating summary:', error);

        // Handle error state
        await this.handleError(tabId, error, this.getProgressField());

        throw error;
      })
      .finally(async () => {
        // Always destroy the session when done
        await aiService.destroySessionForContext(contextId);
      });
  }
}
