import { MessageType } from '../../shared/types/index.ts';
import * as operationStateService from '../services/operationStateService.ts';
import { logger } from '../../shared/utils/logger.ts';

/**
 * Handler Utilities
 * Shared utility functions for message handlers
 */

/**
 * Broadcast operation state change to all listeners
 *
 * @param state - Operation state to broadcast
 */
export function broadcastStateChange(state: any): void {
  chrome.runtime.sendMessage({
    type: 'OPERATION_STATE_CHANGED',
    payload: { state },
  }).catch(() => {
    // No listeners, that's ok
  });
}

/**
 * Generate context ID based on tab ID and operation type
 *
 * @param tabId - Tab ID (optional)
 * @param operationType - Type of operation (e.g., 'explain', 'analysis', 'glossary')
 * @param suffix - Optional suffix (e.g., '-manual', '-section')
 * @returns Context ID string
 */
export function generateContextId(
  tabId: number | undefined,
  operationType: string,
  suffix?: string
): string {
  const base = tabId ? `tab-${tabId}-${operationType}` : `default-${operationType}`;
  return suffix ? `${base}${suffix}` : base;
}

/**
 * Send progress update message for analysis operation
 *
 * @param stage - Progress stage ('evaluating' | 'analyzing')
 * @param current - Current step number
 * @param total - Total steps
 * @param tabId - Optional tab ID for state updates
 */
export function sendAnalysisProgress(
  stage: 'evaluating' | 'analyzing',
  current: number,
  total: number,
  tabId?: number
): void {
  // Update operation state with progress
  if (tabId) {
    operationStateService.updateState(tabId, {
      analysisProgressStage: stage,
      currentAnalysisStep: current,
      totalAnalysisSteps: total,
    });
  }

  // Send progress update message
  chrome.runtime.sendMessage({
    type: MessageType.ANALYSIS_PROGRESS,
    payload: {
      stage,
      current,
      total,
    },
  }).catch(() => {
    // No listeners, that's ok
  });
}

/**
 * Send progress update message for glossary operation
 *
 * @param stage - Progress stage ('extracting' | 'filtering-terms' | 'generating-definitions' | 'extracting-terms-from-chunks')
 * @param current - Current item number
 * @param total - Total items
 * @param tabId - Optional tab ID for state updates
 */
export function sendGlossaryProgress(
  stage: string,
  current: number | undefined,
  total: number | undefined,
  tabId?: number
): void {
  // Update operation state with progress information
  if (tabId) {
    const state = operationStateService.updateState(tabId, {
      glossaryProgressStage: stage,
      currentGlossaryTerm: current || 0,
      totalGlossaryTerms: total || 0,
    });

    // Broadcast via state change
    broadcastStateChange(state);
  }

  // Also broadcast via runtime messages so sidepanel can receive it
  chrome.runtime.sendMessage({
    type: MessageType.GLOSSARY_PROGRESS,
    payload: {
      stage,
      current,
      total,
    },
  }).catch(() => {
    // No listeners, that's ok
  });
}

/**
 * Send analysis section completion message
 *
 * @param paperUrl - Paper URL
 * @param section - Section name ('methodology' | 'confounders' | 'implications' | 'limitations')
 * @param result - Section analysis result
 */
export function sendAnalysisSectionComplete(
  paperUrl: string,
  section: string,
  result: any
): void {
  logger.debug('HANDLER_UTILS', `[Analysis] Section complete: ${section}`);

  chrome.runtime.sendMessage({
    type: MessageType.ANALYSIS_SECTION_COMPLETE,
    payload: {
      paperUrl,
      section,
      result,
    },
  }).catch((error) => {
    logger.warn('HANDLER_UTILS', '[Analysis] Failed to broadcast section completion:', error);
  });
}

/**
 * Send glossary batch completion message
 *
 * @param paperUrl - Paper URL
 * @param terms - New glossary terms from this batch
 * @param totalProcessed - Total terms processed so far
 * @param totalTerms - Total terms to process
 */
export function sendGlossaryBatchComplete(
  paperUrl: string,
  terms: any[],
  totalProcessed: number,
  totalTerms: number
): void {
  chrome.runtime.sendMessage({
    type: MessageType.GLOSSARY_BATCH_COMPLETE,
    payload: {
      paperUrl,
      terms,
      totalProcessed,
      totalTerms,
    },
  }).catch(() => {
    // No listeners, that's ok
  });
}

/**
 * Update operation state to show operation is starting
 *
 * @param tabId - Tab ID
 * @param operationType - Type of operation
 * @param paper - Stored paper
 * @param progressMessage - Progress message to display
 */
export async function setOperationStart(
  tabId: number | undefined,
  operationType: 'explain' | 'summary' | 'analysis' | 'glossary',
  paper: any,
  progressMessage: string
): Promise<void> {
  if (!tabId) return;

  const fieldMap = {
    explain: 'isExplaining',
    summary: 'isGeneratingSummary',
    analysis: 'isAnalyzing',
    glossary: 'isGeneratingGlossary',
  };

  const progressFieldMap = {
    explain: 'explanationProgress',
    summary: 'summaryProgress',
    analysis: 'analysisProgress',
    glossary: 'glossaryProgress',
  };

  await operationStateService.updateStateAndBroadcast(tabId, {
    [fieldMap[operationType]]: true,
    currentPaper: paper,
    [progressFieldMap[operationType]]: progressMessage,
    error: null,
  });
}

/**
 * Update operation state to show operation completed successfully
 *
 * @param tabId - Tab ID
 * @param operationType - Type of operation
 * @param successMessage - Success message to display
 */
export async function setOperationComplete(
  tabId: number | undefined,
  operationType: 'explain' | 'summary' | 'analysis' | 'glossary',
  successMessage: string
): Promise<void> {
  if (!tabId) return;

  const fieldMap = {
    explain: 'isExplaining',
    summary: 'isGeneratingSummary',
    analysis: 'isAnalyzing',
    glossary: 'isGeneratingGlossary',
  };

  const progressFieldMap = {
    explain: 'explanationProgress',
    summary: 'summaryProgress',
    analysis: 'analysisProgress',
    glossary: 'glossaryProgress',
  };

  await operationStateService.updateStateAndBroadcast(tabId, {
    [fieldMap[operationType]]: false,
    [progressFieldMap[operationType]]: successMessage,
    error: null,
  });
}

/**
 * Clear analysis progress state fields
 *
 * @param tabId - Tab ID
 */
export async function clearAnalysisProgressState(tabId: number | undefined): Promise<void> {
  if (!tabId) return;

  await operationStateService.updateStateAndBroadcast(tabId, {
    analysisProgressStage: null,
    currentAnalysisStep: 0,
    totalAnalysisSteps: 0,
  });
}

/**
 * Clear glossary progress state fields
 *
 * @param tabId - Tab ID
 */
export async function clearGlossaryProgressState(tabId: number | undefined): Promise<void> {
  if (!tabId) return;

  await operationStateService.updateStateAndBroadcast(tabId, {
    glossaryProgressStage: null,
    currentGlossaryTerm: 0,
    totalGlossaryTerms: 0,
  });
}
