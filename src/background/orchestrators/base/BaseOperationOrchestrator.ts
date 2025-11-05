import { StoredPaper } from '../../../shared/types/index.ts';
import { getPaperByUrl } from '../../../shared/utils/dbService.ts';
import * as operationStateService from '../../services/operationStateService.ts';
import * as requestDeduplicationService from '../../services/requestDeduplicationService.ts';
import * as paperStatusService from '../../services/paperStatusService.ts';
import { getOutputLanguage } from '../../../shared/utils/settingsService.ts';
import { logger } from '../../../shared/utils/logger.ts';

/**
 * BaseOperationOrchestrator - Abstract base class for operation orchestrators
 *
 * Responsibilities:
 * - Request deduplication wrapper
 * - State management integration (operation state updates, broadcasting)
 * - Error handling with state rollback
 * - Session lifecycle management
 * - Common utility methods for handlers
 *
 * Features:
 * - Unified pattern for all operation handlers
 * - Automatic request deduplication
 * - Consistent state management
 * - Automatic session cleanup
 * - Reusable helper methods
 *
 * Subclasses must implement:
 * - executeOperation(): Core operation logic
 * - getOperationName(): Name for logging/deduplication
 * - getProgressField(): Field name for progress messages
 * - getIsOperatingField(): Field name for operation flag
 */
export abstract class BaseOperationOrchestrator {
  /**
   * Execute operation with request deduplication wrapper
   *
   * @param paperUrl - Paper URL
   * @param tabId - Optional tab ID for state management
   * @param operationKey - Deduplication key suffix (e.g., 'explain-manual')
   * @param execute - Async function that performs the actual operation
   * @returns Operation result
   */
  protected async withRequestDeduplication<T>(
    paperUrl: string,
    tabId: number | undefined,
    operationKey: string,
    execute: () => Promise<T>
  ): Promise<{ success: boolean; result?: T; error?: string }> {
    const requestKey = requestDeduplicationService.getRequestKey(tabId, operationKey, paperUrl);

    try {
      // Check for existing active request
      if (requestDeduplicationService.hasRequest(requestKey)) {
        logger.debug(
          'OPERATION_ORCHESTRATOR',
          `[${this.getOperationName()}] Reusing existing request for ${requestKey}`
        );
        const existingResult = await requestDeduplicationService.getRequest(requestKey);
        return { success: true, result: existingResult };
      }

      // Create new operation promise
      const operationPromise = execute();

      // Store the promise for deduplication
      requestDeduplicationService.setRequest(requestKey, operationPromise);

      try {
        const result = await operationPromise;
        return { success: true, result };
      } catch (operationError) {
        logger.error(
          'OPERATION_ORCHESTRATOR',
          `[${this.getOperationName()}] Operation failed:`,
          operationError
        );
        return {
          success: false,
          error: `${this.getOperationName()} failed: ${String(operationError)}`,
        };
      } finally {
        // Clean up the active request
        requestDeduplicationService.deleteRequest(requestKey);
      }
    } catch (error) {
      logger.error(
        'OPERATION_ORCHESTRATOR',
        `[${this.getOperationName()}] Error in operation setup:`,
        error
      );
      requestDeduplicationService.deleteRequest(requestKey);
      return {
        success: false,
        error: `${this.getOperationName()} failed: ${String(error)}`,
      };
    }
  }

  /**
   * Ensure paper exists in database and return it
   *
   * @param paperUrl - Paper URL
   * @returns Stored paper
   * @throws Error if paper not found
   */
  protected async ensurePaperExists(paperUrl: string): Promise<StoredPaper> {
    const storedPaper = await getPaperByUrl(paperUrl);

    if (!storedPaper) {
      throw new Error('Paper not found in storage. Please store the paper first.');
    }

    return storedPaper;
  }

  /**
   * Determine if we should use hierarchical summary for large papers
   *
   * @param paper - Stored paper
   * @param threshold - Character threshold (default: 6000)
   * @returns Hierarchical summary if available and paper exceeds threshold, otherwise undefined
   */
  protected getHierarchicalSummaryIfNeeded(
    paper: StoredPaper,
    threshold: number = 6000
  ): string | undefined {
    const shouldUseHierarchicalSummary =
      paper.hierarchicalSummary && paper.fullText.length > threshold;

    if (shouldUseHierarchicalSummary) {
      logger.debug(
        'OPERATION_ORCHESTRATOR',
        `[${this.getOperationName()}] Paper is large (${paper.fullText.length} chars), using hierarchical summary`
      );
    } else {
      logger.debug(
        'OPERATION_ORCHESTRATOR',
        `[${this.getOperationName()}] Paper is small (${paper.fullText.length} chars), using abstract-only approach`
      );
    }

    return shouldUseHierarchicalSummary ? paper.hierarchicalSummary : undefined;
  }

  /**
   * Update completion status in operation state after successful operation
   *
   * @param tabId - Tab ID
   * @param paperUrl - Paper URL
   */
  protected async updateCompletionStatus(
    tabId: number | undefined,
    paperUrl: string
  ): Promise<void> {
    if (!tabId) return;

    const status = await paperStatusService.checkPaperStatus(paperUrl);
    await operationStateService.updateStateAndBroadcast(tabId, {
      hasExplanation: status.hasExplanation,
      hasSummary: status.hasSummary,
      hasAnalysis: status.hasAnalysis,
      hasGlossary: status.hasGlossary,
      completionPercentage: status.completionPercentage,
    });

    logger.debug(
      'OPERATION_ORCHESTRATOR',
      `[${this.getOperationName()}] ✓ Completion status updated: ${status.completionPercentage}%`
    );
  }

  /**
   * Clear progress message after a delay
   *
   * @param tabId - Tab ID
   * @param field - Progress field name
   * @param delay - Delay in milliseconds (default: 5000)
   */
  protected clearProgressMessageAfterDelay(
    tabId: number | undefined,
    field: string,
    delay: number = 5000
  ): void {
    if (!tabId) return;

    setTimeout(async () => {
      await operationStateService.updateStateAndBroadcast(tabId, {
        [field]: '',
      });
    }, delay);
  }

  /**
   * Update operation state and broadcast changes
   *
   * @param tabId - Tab ID
   * @param updates - State updates
   */
  protected async updateState(
    tabId: number | undefined,
    updates: Record<string, any>
  ): Promise<void> {
    if (!tabId) return;
    await operationStateService.updateStateAndBroadcast(tabId, updates);
  }

  /**
   * Handle operation error by updating state
   *
   * @param tabId - Tab ID
   * @param error - Error object or string
   * @param progressField - Progress field to clear
   */
  protected async handleError(
    tabId: number | undefined,
    error: any,
    progressField?: string
  ): Promise<void> {
    if (!tabId) return;

    const updates: Record<string, any> = {
      [this.getIsOperatingField()]: false,
      error: `🐻 Kuma had trouble with ${this.getOperationName()}: ${String(error)}`,
    };

    if (progressField) {
      updates[progressField] = '';
    }

    await operationStateService.updateStateAndBroadcast(tabId, updates);
  }

  /**
   * Get output language for metadata
   *
   * @returns Output language code
   */
  protected async getOutputLanguage(): Promise<string> {
    return await getOutputLanguage();
  }

  /**
   * Get operation name for logging/deduplication
   * Must be implemented by subclasses
   */
  protected abstract getOperationName(): string;

  /**
   * Get progress field name for state updates
   * Must be implemented by subclasses
   *
   * @returns Field name (e.g., 'explanationProgress', 'analysisProgress')
   */
  protected abstract getProgressField(): string;

  /**
   * Get is-operating field name for state updates
   * Must be implemented by subclasses
   *
   * @returns Field name (e.g., 'isExplaining', 'isAnalyzing')
   */
  protected abstract getIsOperatingField(): string;
}
