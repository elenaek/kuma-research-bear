import { BaseOperationOrchestrator } from './base/BaseOperationOrchestrator.ts';
import { PaperAnalysisResult, StoredPaper, MessageType } from '../../shared/types/index.ts';
import { aiService } from '../../shared/utils/aiService.ts';
import {
  updatePaper,
  getPaperChunks,
  updateChunkTerms,
  updatePaperAnalysis,
  updatePartialPaperAnalysis,
} from '../../shared/utils/dbService.ts';
import {
  sendAnalysisProgress,
  sendAnalysisSectionComplete,
  setOperationStart,
  setOperationComplete,
  clearAnalysisProgressState,
} from '../utils/handlerUtils.ts';
import { logger } from '../../shared/utils/logger.ts';

/**
 * AnalysisWorkflowOrchestrator - Orchestrates paper analysis workflow
 *
 * Responsibilities:
 * - Ensure hierarchical summary exists (generate if missing)
 * - Run comprehensive analysis using hierarchical summary + RAG
 * - Send progress updates for each analysis step
 * - Broadcast partial results as sections complete
 * - Store analysis in IndexedDB
 *
 * Algorithm:
 * 1. Check if hierarchical summary exists
 * 2. If not, generate hierarchical summary with progress updates
 * 3. Store hierarchical summary and chunk terms
 * 4. Run comprehensive analysis with progress callbacks
 * 5. Store final analysis
 * 6. Update completion status
 *
 * Features:
 * - Progressive UI updates (step-by-step progress)
 * - Partial result broadcasting (section completion)
 * - Request deduplication (prevent duplicate requests)
 * - Automatic state management
 */
export class AnalysisWorkflowOrchestrator extends BaseOperationOrchestrator {
  protected getOperationName(): string {
    return 'Analysis';
  }

  protected getProgressField(): string {
    return 'analysisProgress';
  }

  protected getIsOperatingField(): string {
    return 'isAnalyzing';
  }

  /**
   * Execute analysis workflow
   *
   * @param paperUrl - Paper URL
   * @param tabId - Tab ID for state management
   * @param contextId - Context ID for AI sessions
   * @returns Analysis result
   */
  async execute(
    paperUrl: string,
    tabId: number | undefined,
    contextId: string
  ): Promise<PaperAnalysisResult> {
    // Use request deduplication wrapper
    return await this.withRequestDeduplication(
      paperUrl,
      tabId,
      'analyze',
      async () => {
        // Retrieve paper
        const storedPaper = await this.ensurePaperExists(paperUrl);

        // Set operation start
        await setOperationStart(
          tabId,
          'analysis',
          storedPaper,
          '🐻 Kuma is deeply analyzing the research paper...'
        );

        logger.debug(
          'ANALYSIS_WORKFLOW',
          `Analyzing paper: ${storedPaper.title} with context: ${contextId}`
        );

        // Ensure hierarchical summary exists
        const hierarchicalSummary = await this.ensureHierarchicalSummary(
          storedPaper,
          contextId,
          tabId
        );

        // Run comprehensive analysis
        const analysis = await this.runComprehensiveAnalysis(
          storedPaper,
          hierarchicalSummary,
          contextId,
          tabId
        );

        return analysis;
      }
    )
      .then(async (result) => {
        if (!result.success || !result.result) {
          throw new Error(result.error || 'Analysis failed');
        }

        const analysis = result.result;
        const storedPaper = await this.ensurePaperExists(paperUrl);

        // Store in IndexedDB
        const outputLanguage = await this.getOutputLanguage();
        await updatePaperAnalysis(storedPaper.id, analysis, outputLanguage);
        logger.debug('ANALYSIS_WORKFLOW', '✓ Analysis stored in IndexedDB');

        // Update completion tracking
        await this.updateCompletionStatus(tabId, storedPaper.url);

        // Set operation complete
        await setOperationComplete(
          tabId,
          'analysis',
          '🐻 Kuma has finished analyzing the research paper!'
        );
        await clearAnalysisProgressState(tabId);

        // Clear the progress message after a delay
        this.clearProgressMessageAfterDelay(tabId, this.getProgressField());

        logger.debug('ANALYSIS_WORKFLOW', '✓ Paper analysis complete');
        return analysis;
      })
      .catch(async (error) => {
        logger.error('ANALYSIS_WORKFLOW', 'Error analyzing paper:', error);

        // Handle error state
        await this.handleError(tabId, error, this.getProgressField());
        await clearAnalysisProgressState(tabId);

        throw error;
      })
      .finally(async () => {
        // Always clean up all analysis-related sessions
        await this.cleanup(contextId);
      });
  }

  /**
   * Ensure hierarchical summary exists, generate if missing
   */
  private async ensureHierarchicalSummary(
    storedPaper: StoredPaper,
    contextId: string,
    tabId: number | undefined
  ): Promise<string> {
    // Check if hierarchical summary exists
    let hierarchicalSummary = storedPaper.hierarchicalSummary;

    if (!hierarchicalSummary) {
      logger.debug('ANALYSIS_WORKFLOW', 'No hierarchical summary found, generating one...');

      try {
        const fullText = storedPaper.fullText || storedPaper.abstract;
        const result = await aiService.createHierarchicalSummary(
          fullText,
          `${contextId}-summary`,
          (current, total) => {
            // Send progress update for hierarchical summary generation
            sendAnalysisProgress('evaluating', current, total, tabId);
          }
        );

        // Extract summary string from result object
        hierarchicalSummary = result.summary;

        // Update stored paper with hierarchical summary
        await updatePaper(storedPaper.id, { hierarchicalSummary });
        logger.debug('ANALYSIS_WORKFLOW', '✓ Hierarchical summary generated and stored');

        // Store chunk terms if available
        if (result.chunkTerms && result.chunkTerms.length > 0) {
          try {
            const chunks = await getPaperChunks(storedPaper.id);

            // Map chunkTerms array indices to actual chunk IDs
            const chunkTermsWithIds = result.chunkTerms
              .map((terms, index) => ({
                chunkId: chunks[index]?.id,
                terms: terms || [],
              }))
              .filter((item) => item.chunkId); // Only include valid chunk IDs

            if (chunkTermsWithIds.length > 0) {
              await updateChunkTerms(storedPaper.id, chunkTermsWithIds);
              logger.debug(
                'ANALYSIS_WORKFLOW',
                `✓ Stored ${chunkTermsWithIds.length} chunk term arrays from hierarchical summarization`
              );
            }
          } catch (error) {
            logger.error(
              'ANALYSIS_WORKFLOW',
              'Failed to store chunk terms from hierarchical summarization:',
              error
            );
            // Non-critical error, continue with analysis
          }
        }
      } catch (error) {
        logger.error(
          'ANALYSIS_WORKFLOW',
          'Failed to generate hierarchical summary, using truncated content:',
          error
        );
        // Fallback to truncated content
        hierarchicalSummary = (storedPaper.fullText || storedPaper.abstract).slice(0, 2000);
      }
    }

    return hierarchicalSummary;
  }

  /**
   * Run comprehensive analysis with hierarchical summary + RAG
   */
  private async runComprehensiveAnalysis(
    storedPaper: StoredPaper,
    hierarchicalSummary: string,
    contextId: string,
    tabId: number | undefined
  ): Promise<PaperAnalysisResult> {
    const analysis: PaperAnalysisResult = await aiService.analyzePaper(
      storedPaper.id,
      hierarchicalSummary,
      contextId,
      (step, total) => {
        // Send progress update for each analysis step
        sendAnalysisProgress('analyzing', step, total, tabId);
      },
      async (section, result) => {
        // Section completion handler - broadcast partial results
        sendAnalysisSectionComplete(storedPaper.url, section, result);

        // Update partial analysis in IndexedDB
        try {
          const outputLanguage = await this.getOutputLanguage();
          await updatePartialPaperAnalysis(storedPaper.id, section, result, outputLanguage);
        } catch (error) {
          logger.warn(
            'ANALYSIS_WORKFLOW',
            `Failed to store partial ${section} analysis:`,
            error
          );
        }
      }
    );

    return analysis;
  }

  /**
   * Clean up all analysis-related sessions
   *
   * @param contextId - Base context ID
   */
  async cleanup(contextId: string): Promise<void> {
    // Main analysis session
    await aiService.destroySessionForContext(contextId);
    // Sub-sessions for individual analyses
    await aiService.destroySessionForContext(`${contextId}-methodology`);
    await aiService.destroySessionForContext(`${contextId}-confounders`);
    await aiService.destroySessionForContext(`${contextId}-implications`);
    await aiService.destroySessionForContext(`${contextId}-limitations`);
    // Hierarchical summary session if created
    await aiService.destroySessionForContext(`${contextId}-summary`);
  }
}
