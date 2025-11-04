import { BaseOperationOrchestrator } from './base/BaseOperationOrchestrator.ts';
import { ResearchPaper, StoredPaper } from '../../shared/types/index.ts';
import { aiService } from '../../shared/utils/aiService.ts';
import { getPaperByUrl, updatePaperExplanation, updatePaper } from '../../shared/utils/dbService.ts';
import { setOperationStart, setOperationComplete } from '../utils/handlerUtils.ts';
import { logger } from '../../shared/utils/logger.ts';

/**
 * ExplainOrchestrator - Orchestrates paper explanation workflow
 *
 * Responsibilities:
 * - Generate explanation using hierarchical summary for large papers
 * - Generate summary alongside explanation
 * - Store results in IndexedDB
 * - Update completion status
 *
 * Algorithm:
 * 1. Retrieve paper from database
 * 2. Determine if hierarchical summary should be used (>6000 chars)
 * 3. Generate explanation using aiService
 * 4. Generate summary using aiService
 * 5. Store explanation and summary
 * 6. Update completion tracking
 *
 * Features:
 * - Unified handler for both auto and manual explanation
 * - Automatic hierarchical summary usage for large papers
 * - Request deduplication (for manual triggers)
 * - Automatic state management
 */
export class ExplainOrchestrator extends BaseOperationOrchestrator {
  protected getOperationName(): string {
    return 'Explanation';
  }

  protected getProgressField(): string {
    return 'explanationProgress';
  }

  protected getIsOperatingField(): string {
    return 'isExplaining';
  }

  /**
   * Execute explanation workflow (auto mode - triggered during paper storage)
   *
   * @param paper - Research paper to explain
   * @param tabId - Tab ID for state management
   * @param contextId - Context ID for AI sessions
   * @returns Explanation and summary
   */
  async executeAuto(
    paper: ResearchPaper,
    tabId: number | undefined,
    contextId: string
  ): Promise<{ explanation: string; summary: string }> {
    try {
      // Update operation state to show explaining is in progress
      await this.updateState(tabId, {
        isExplaining: true,
        explanationProgress: '🐻 Kuma is thinking of ways to explain the research paper...',
        currentPaper: paper,
        error: null,
      });

      // Get stored paper to check for hierarchical summary
      const storedPaper = await getPaperByUrl(paper.url);
      if (!storedPaper) {
        throw new Error('Paper not found in storage. Cannot generate explanation.');
      }

      // Determine if we should use hierarchical summary (for large papers)
      const hierarchicalSummary = this.getHierarchicalSummaryIfNeeded(storedPaper);

      // Generate explanation and summary
      const explanation = await aiService.explainAbstract(
        paper.abstract,
        contextId,
        hierarchicalSummary
      );
      const summary = await aiService.generateSummary(
        paper.title,
        paper.abstract,
        contextId,
        hierarchicalSummary
      );

      // Update operation state to show completion
      await this.updateState(tabId, {
        isExplaining: false,
        explanationProgress: '🐻 Kuma has finished explaining the research paper!',
        error: null,
      });

      // Get output language for metadata
      const outputLanguage = await this.getOutputLanguage();

      // Store explanation and summary
      await updatePaperExplanation(storedPaper.id, explanation, summary, outputLanguage);
      logger.debug('EXPLAIN_ORCHESTRATOR', '✓ Explanation stored in IndexedDB');

      // Update completion tracking
      await this.updateCompletionStatus(tabId, storedPaper.url);

      return { explanation, summary };
    } catch (explainError) {
      // Update operation state to show error
      await this.handleError(tabId, explainError, this.getProgressField());
      throw explainError;
    } finally {
      // Always destroy the session when done
      await aiService.destroySessionForContext(contextId);
    }
  }

  /**
   * Execute explanation workflow (manual mode - triggered from UI)
   *
   * @param paperUrl - Paper URL
   * @param tabId - Tab ID for state management
   * @param contextId - Context ID for AI sessions
   * @returns Explanation
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
      'explain-manual',
      async () => {
        // Retrieve paper
        const storedPaper = await this.ensurePaperExists(paperUrl);

        // Set operation start
        await setOperationStart(
          tabId,
          'explain',
          storedPaper,
          '🐻 Kuma is generating an explanation for the research paper...'
        );

        logger.debug(
          'EXPLAIN_ORCHESTRATOR',
          `Generating explanation for paper: ${storedPaper.title} with context: ${contextId}`
        );

        // Determine if we should use hierarchical summary
        const hierarchicalSummary = this.getHierarchicalSummaryIfNeeded(storedPaper);

        // Generate explanation
        const explanation = await aiService.explainAbstract(
          storedPaper.abstract,
          contextId,
          hierarchicalSummary
        );

        return { explanation, storedPaper };
      }
    )
      .then(async (result) => {
        if (!result.success || !result.result) {
          throw new Error(result.error || 'Explanation generation failed');
        }

        const { explanation, storedPaper } = result.result as {
          explanation: string;
          storedPaper: StoredPaper;
        };

        // Get output language for metadata
        const outputLanguage = await this.getOutputLanguage();

        // Update paper with new explanation (preserve existing summary)
        await updatePaper(storedPaper.id, {
          explanation,
          explanationLanguage: outputLanguage,
        });
        logger.debug('EXPLAIN_ORCHESTRATOR', '✓ Explanation stored in IndexedDB');

        // Update completion tracking
        await this.updateCompletionStatus(tabId, storedPaper.url);

        // Set operation complete
        await setOperationComplete(
          tabId,
          'explain',
          '🐻 Kuma has finished generating the explanation!'
        );

        // Clear the progress message after a delay
        this.clearProgressMessageAfterDelay(tabId, this.getProgressField());

        logger.debug('EXPLAIN_ORCHESTRATOR', '✓ Paper explanation complete');
        return explanation;
      })
      .catch(async (error) => {
        logger.error('EXPLAIN_ORCHESTRATOR', 'Error generating explanation:', error);

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
