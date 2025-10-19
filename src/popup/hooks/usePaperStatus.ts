import { useState, useEffect } from 'preact/hooks';
import * as ChromeService from '../../services/ChromeService.ts';
import { MessageType, ResearchPaper } from '../../types/index.ts';

interface UsePaperStatusReturn {
  // State
  paper: ResearchPaper | null;
  isPaperStored: boolean;

  // Actions
  setPaper: (paper: ResearchPaper | null) => void;
  checkPaperStorageStatus: (paperUrl: string) => Promise<void>;
  checkStoredPaper: (url: string) => Promise<ChromeService.PaperStatusInfo>;
  clearPaper: () => void;
}

/**
 * Custom hook to manage current paper and its storage status
 * Listens for paper updates from OPERATION_STATE_CHANGED messages
 */
export function usePaperStatus(): UsePaperStatusReturn {
  const [paper, setPaper] = useState<ResearchPaper | null>(null);
  const [isPaperStored, setIsPaperStored] = useState(false);

  // Listen for paper updates from operation state changes
  useEffect(() => {
    const listener = (message: any) => {
      if (message.type === MessageType.OPERATION_STATE_CHANGED) {
        const state = message.payload?.state;
        if (state?.currentPaper) {
          setPaper(state.currentPaper);
          checkPaperStorageStatus(state.currentPaper.url);
        }
      }
    };

    chrome.runtime.onMessage.addListener(listener);

    return () => {
      chrome.runtime.onMessage.removeListener(listener);
    };
  }, []);

  async function checkPaperStorageStatus(paperUrl: string) {
    try {
      console.log('[usePaperStatus] Checking if paper is stored:', paperUrl);
      const isStored = await ChromeService.isPaperStoredInDB(paperUrl);
      console.log('[usePaperStatus] Paper stored check result:', isStored);
      setIsPaperStored(isStored);
    } catch (error) {
      console.error('[usePaperStatus] Error checking paper storage:', error);
      setIsPaperStored(false);
    }
  }

  async function checkStoredPaper(url: string): Promise<ChromeService.PaperStatusInfo> {
    try {
      console.log('[usePaperStatus] Checking stored paper for URL:', url);
      const status = await ChromeService.getPaperStatus(url);

      if (status.isStored) {
        console.log('[usePaperStatus] ✓ Stored paper found:', {
          completionPercentage: status.completionPercentage,
          hasExplanation: status.hasExplanation,
          hasAnalysis: status.hasAnalysis,
        });
        setIsPaperStored(true);

        // Load the full paper to get title, authors, etc.
        const fullPaper = await ChromeService.getPaperByUrl(url);
        if (fullPaper) {
          setPaper(fullPaper as ResearchPaper);
        }
      } else {
        setIsPaperStored(false);
      }

      return status;
    } catch (error) {
      console.error('[usePaperStatus] Error checking stored paper:', error);
      return {
        isStored: false,
        hasExplanation: false,
        hasSummary: false,
        hasAnalysis: false,
        hasGlossary: false,
        completionPercentage: 0,
      };
    }
  }

  /**
   * Clear paper state (used when paper is deleted)
   */
  function clearPaper() {
    setPaper(null);
    setIsPaperStored(false);
    console.log('[usePaperStatus] Paper state cleared');
  }

  return {
    paper,
    isPaperStored,
    setPaper,
    checkPaperStorageStatus,
    checkStoredPaper,
    clearPaper,
  };
}
