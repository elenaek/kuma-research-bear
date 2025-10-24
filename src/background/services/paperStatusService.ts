import { StoredPaper, ResearchPaper } from '../../types/index.ts';
import * as dbService from '../../utils/dbService.ts';
import * as operationStateService from './operationStateService.ts';
import { tabPaperTracker } from './tabPaperTracker.ts';

/**
 * Paper Status Service
 * Quick status checking for stored papers and their completion state
 */

export interface PaperStatus {
  isStored: boolean;
  hasExplanation: boolean;
  hasSummary: boolean;
  hasAnalysis: boolean;
  hasGlossary: boolean;
  completionPercentage: number;
  paper: StoredPaper | null;
}

/**
 * Check if a paper is stored and what features are complete
 * Single efficient database lookup
 */
export async function checkPaperStatus(url: string): Promise<PaperStatus> {
  try {
    const paper = await dbService.getPaperByUrl(url);

    if (!paper) {
      return {
        isStored: false,
        hasExplanation: false,
        hasSummary: false,
        hasAnalysis: false,
        hasGlossary: false,
        completionPercentage: 0,
        paper: null,
      };
    }

    // Check which features are complete
    const hasExplanation = !!paper.explanation;
    const hasSummary = !!paper.summary;
    const hasAnalysis = !!paper.analysis;
    const hasGlossary = !!paper.glossary;

    // Calculate completion percentage (4 main features)
    const completedFeatures = [hasExplanation, hasSummary, hasAnalysis, hasGlossary].filter(Boolean).length;
    const completionPercentage = (completedFeatures / 4) * 100;

    console.log('[PaperStatus] Status check for URL:', url, {
      isStored: true,
      hasExplanation,
      hasSummary,
      hasAnalysis,
      hasGlossary,
      completionPercentage,
    });

    return {
      isStored: true,
      hasExplanation,
      hasSummary,
      hasAnalysis,
      hasGlossary,
      completionPercentage,
      paper,
    };
  } catch (error) {
    console.error('[PaperStatus] Error checking paper status:', error);
    return {
      isStored: false,
      hasExplanation: false,
      hasSummary: false,
      hasAnalysis: false,
      hasGlossary: false,
      completionPercentage: 0,
      paper: null,
    };
  }
}

/**
 * Update operation state from a stored paper's completion status
 * Syncs the operation state with what's actually in the database
 */
export function updateOperationStateFromStoredPaper(tabId: number, status: PaperStatus): void {
  if (!status.isStored || !status.paper) {
    console.log('[PaperStatus] No stored paper, keeping operation state as-is');
    return;
  }

  // Register paper with tab tracker
  tabPaperTracker.registerPaper(tabId, status.paper);

  // Update the operation state with completion info
  operationStateService.updateState(tabId, {
    isPaperStored: true,
    currentPaper: status.paper as ResearchPaper,
    hasExplanation: status.hasExplanation,
    hasSummary: status.hasSummary,
    hasAnalysis: status.hasAnalysis,
    hasGlossary: status.hasGlossary,
    completionPercentage: status.completionPercentage,
  });

  console.log('[PaperStatus] Updated operation state for tab', tabId, {
    isPaperStored: true,
    completionPercentage: status.completionPercentage,
  });
}

/**
 * Get a human-readable completion summary
 */
export function getCompletionSummary(status: PaperStatus): string {
  if (!status.isStored) {
    return 'No paper stored';
  }

  const completed = [
    status.hasExplanation && 'Explanation',
    status.hasSummary && 'Summary',
    status.hasAnalysis && 'Analysis',
    status.hasGlossary && 'Glossary',
  ].filter(Boolean);

  if (completed.length === 0) {
    return 'Paper saved';
  } else if (completed.length === 4) {
    return 'All features complete';
  } else {
    return `${completed.join(', ')} ready`;
  }
}
