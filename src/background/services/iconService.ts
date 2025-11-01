import { OperationState } from '../../types/index.ts';
import { logger } from '../../utils/logger.ts';

/**
 * Icon Service
 * Manages extension icon and title updates based on operation states
 */

// Icon paths configuration - paths must be absolute from extension root
const ICON_PATHS = {
  default: {
    16: '/icons/icon16.png',
    32: '/icons/icon32.png',
    48: '/icons/icon48.png',
    128: '/icons/icon128.png',
  },
  detecting: {
    16: '/icons/icon-detecting-16.png',
    32: '/icons/icon-detecting-32.png',
    48: '/icons/icon-detecting-48.png',
    128: '/icons/icon-detecting-128.png',
  },
  explaining: {
    16: '/icons/icon-explaining-16.png',
    32: '/icons/icon-explaining-32.png',
    48: '/icons/icon-explaining-48.png',
    128: '/icons/icon-explaining-128.png',
  },
  analyzing: {
    16: '/icons/icon-analyzing-16.png',
    32: '/icons/icon-analyzing-32.png',
    48: '/icons/icon-analyzing-48.png',
    128: '/icons/icon-analyzing-128.png',
  },
  stored: {
    16: '/icons/icon-stored-16.png',
    32: '/icons/icon-stored-32.png',
    48: '/icons/icon-stored-48.png',
    128: '/icons/icon-stored-128.png',
  },
};

/**
 * Update extension icon based on operation state
 * Priority: detecting/chunking > processing (post-detect/chunk operations) > stored > default
 * Processing operations: explaining, summarizing, analyzing, glossary generation, embedding generation
 */
export async function updateIconForTab(tabId: number, state: OperationState): Promise<void> {
  try {
    let iconType = 'default';

    // Check if any post-detect/chunk operation is running
    const isProcessing =
      state.isExplaining ||
      state.isGeneratingSummary ||
      state.isAnalyzing ||
      state.isGeneratingGlossary ||
      state.isGeneratingEmbeddings;

    // Priority: detecting/chunking > processing (post-detect/chunk operations) > stored > default
    if (state.isDetecting || state.isChunking) {
      iconType = 'detecting';
    } else if (isProcessing) {
      iconType = 'analyzing';
    } else if (state.isPaperStored && state.currentPaper) {
      iconType = 'stored';
    }

    logger.debug('BACKGROUND_SCRIPT', `[IconService] Updating icon for tab ${tabId}: ${iconType}, state:`, {
      isDetecting: state.isDetecting,
      isChunking: state.isChunking,
      isExplaining: state.isExplaining,
      isGeneratingSummary: state.isGeneratingSummary,
      isAnalyzing: state.isAnalyzing,
      isGeneratingGlossary: state.isGeneratingGlossary,
      isGeneratingEmbeddings: state.isGeneratingEmbeddings,
      isPaperStored: state.isPaperStored,
      completionPercentage: state.completionPercentage
    });

    const iconPaths = ICON_PATHS[iconType as keyof typeof ICON_PATHS];

    // Update the extension icon for this specific tab
    await chrome.action.setIcon({
      path: iconPaths,
      tabId: tabId,
    });

    // Also update the tooltip to show the current operation
    let title = 'Kuma the Research Bear';
    if (state.isDetecting) {
      title += ' - Detecting paper...';
    } else if (state.isChunking) {
      title += ' - Processing paper...';
    } else if (state.isAnalyzing) {
      title += ' - Analyzing paper...';
    } else if (state.isGeneratingGlossary) {
      title += ' - Generating glossary...';
    } else if (state.isGeneratingSummary) {
      title += ' - Generating summary...';
    } else if (state.isExplaining) {
      title += ' - Explaining paper...';
    } else if (state.isGeneratingEmbeddings) {
      title += ' - Generating embeddings...';
    } else if (state.isPaperStored && state.currentPaper) {
      // Show completion status in title
      title += getCompletionTitle(state);
    }

    await chrome.action.setTitle({
      title: title,
      tabId: tabId,
    });

    logger.debug('BACKGROUND_SCRIPT', `[IconService] Icon updated successfully for tab ${tabId}: ${iconType}`);
  } catch (error) {
    logger.error('BACKGROUND_SCRIPT', `[IconService] Failed to update icon for tab ${tabId}:`, error);
    // Fallback to default icon on error
    try {
      await chrome.action.setIcon({
        path: ICON_PATHS.default,
        tabId: tabId,
      });
    } catch (fallbackError) {
      logger.error('BACKGROUND_SCRIPT', 'Failed to set default icon:', fallbackError);
    }
  }
}

/**
 * Get completion title based on what features are ready
 */
function getCompletionTitle(state: OperationState): string {
  const completed = [
    state.hasExplanation && 'Explanation',
    state.hasSummary && 'Summary',
    state.hasAnalysis && 'Analysis',
    state.hasGlossary && 'Glossary',
  ].filter(Boolean);

  if (completed.length === 0) {
    return ' - Paper saved';
  } else if (completed.length === 4) {
    return ' - All features ready';
  } else if (completed.length === 1) {
    return ` - ${completed[0]} ready`;
  } else {
    // Show percentage for partial completion
    const percentage = Math.round(state.completionPercentage);
    return ` - ${percentage}% complete (${completed.length}/4)`;
  }
}

/**
 * Set icon to default state for a tab
 */
export async function setDefaultIcon(tabId: number): Promise<void> {
  try {
    await chrome.action.setIcon({
      path: ICON_PATHS.default,
      tabId: tabId,
    });
    await chrome.action.setTitle({
      title: 'Kuma the Research Bear',
      tabId: tabId,
    });
  } catch (error) {
    logger.error('BACKGROUND_SCRIPT', `[IconService] Failed to set default icon for tab ${tabId}:`, error);
  }
}

/**
 * Get icon paths (for potential external use)
 */
export function getIconPaths() {
  return ICON_PATHS;
}
