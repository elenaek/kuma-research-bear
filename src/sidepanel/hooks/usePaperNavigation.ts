import { useState } from 'preact/hooks';
import { StoredPaper, QuestionAnswer } from '../../types/index.ts';
import * as ChromeService from '../../services/ChromeService.ts';

interface UsePaperNavigationProps {
  onPaperSwitch?: (paper: StoredPaper) => Promise<void>;
  onPaperDelete?: (deletedPaper: StoredPaper) => void;
  onAllPapersDeleted?: () => void;
}

interface UsePaperNavigationReturn {
  // State
  currentPaperIndex: number;
  allPapers: StoredPaper[];
  isDeleting: boolean;
  showDeleteConfirm: boolean;

  // Actions
  setAllPapers: (papers: StoredPaper[]) => void;
  setCurrentPaperIndex: (index: number) => void;
  handlePrevPaper: () => void;
  handleNextPaper: () => void;
  handleDeletePaper: (currentPaper: StoredPaper | null, currentQaHistory: QuestionAnswer[]) => Promise<void>;
  switchToPaper: (index: number, papersArray?: StoredPaper[]) => Promise<void>;
  setShowDeleteConfirm: (show: boolean) => void;
}

/**
 * Custom hook to handle paper navigation and deletion
 * Manages the carousel of papers and navigation between them
 */
export function usePaperNavigation(props: UsePaperNavigationProps = {}): UsePaperNavigationReturn {
  const { onPaperSwitch, onPaperDelete, onAllPapersDeleted } = props;

  const [allPapers, setAllPapers] = useState<StoredPaper[]>([]);
  const [currentPaperIndex, setCurrentPaperIndex] = useState<number>(0);
  const [isDeleting, setIsDeleting] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  /**
   * Switch to a specific paper by index
   */
  async function switchToPaper(index: number, papersArray?: StoredPaper[]) {
    // Use provided array or fall back to state (for backwards compatibility)
    const papers = papersArray || allPapers;

    if (index < 0 || index >= papers.length) return;

    console.log(`[usePaperNavigation] Switching to paper at index ${index}`);

    // Switch to new paper
    setCurrentPaperIndex(index);
    const newPaper = papers[index];

    // Fetch fresh paper data from IndexedDB to avoid stale state issues
    const freshPaper = await ChromeService.getPaperByUrl(newPaper.url);
    if (freshPaper) {
      // Update the allPapers array with fresh data to prevent future staleness
      const updatedPapers = [...papers];
      updatedPapers[index] = freshPaper;
      if (!papersArray) {
        // Only update state if using state array (not passed-in array)
        setAllPapers(updatedPapers);
      }

      // Call the callback with fresh paper data
      if (onPaperSwitch) {
        await onPaperSwitch(freshPaper);
      }
    } else {
      // Call the callback with array paper data if fresh data not available
      if (onPaperSwitch) {
        await onPaperSwitch(newPaper);
      }
    }
  }

  /**
   * Navigate to previous paper
   */
  function handlePrevPaper() {
    if (currentPaperIndex > 0) {
      switchToPaper(currentPaperIndex - 1);
    }
  }

  /**
   * Navigate to next paper
   */
  function handleNextPaper() {
    if (currentPaperIndex < allPapers.length - 1) {
      switchToPaper(currentPaperIndex + 1);
    }
  }

  /**
   * Delete the current paper
   * Requires confirmation via showDeleteConfirm state
   */
  async function handleDeletePaper(
    currentPaper: StoredPaper | null,
    currentQaHistory: QuestionAnswer[]
  ) {
    if (!currentPaper || !showDeleteConfirm) {
      setShowDeleteConfirm(true);
      return;
    }

    try {
      setIsDeleting(true);
      const success = await ChromeService.deletePaper(currentPaper.id);

      if (success) {
        console.log('[usePaperNavigation] Paper deleted successfully');

        // Notify callback with the deleted paper
        if (onPaperDelete) {
          onPaperDelete(currentPaper);
        }

        // Remove from allPapers array
        const newAllPapers = allPapers.filter((_, idx) => idx !== currentPaperIndex);
        setAllPapers(newAllPapers);

        // Handle switching to another paper
        if (newAllPapers.length === 0) {
          // No papers left
          if (onAllPapersDeleted) {
            onAllPapersDeleted();
          }
        } else {
          // Calculate new index: stay at same index to view "next" paper,
          // unless we deleted the last paper (then go to new last paper)
          const newIndex = currentPaperIndex >= newAllPapers.length
            ? newAllPapers.length - 1  // Deleted last paper, go to new last
            : currentPaperIndex;       // Stay at same index (next paper slides into position)

          // Pass newAllPapers directly to avoid race condition with state updates
          // Note: switchToPaper will set currentPaperIndex internally
          await switchToPaper(newIndex, newAllPapers);
        }
      } else {
        alert('Failed to delete paper. Please try again.');
      }
    } catch (error) {
      console.error('[usePaperNavigation] Error deleting paper:', error);
      alert('Failed to delete paper. Please try again.');
    } finally {
      setIsDeleting(false);
      setShowDeleteConfirm(false);
    }
  }

  return {
    currentPaperIndex,
    allPapers,
    isDeleting,
    showDeleteConfirm,
    setAllPapers,
    setCurrentPaperIndex,
    handlePrevPaper,
    handleNextPaper,
    handleDeletePaper,
    switchToPaper,
    setShowDeleteConfirm,
  };
}
