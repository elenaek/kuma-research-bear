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

  return {
    paper,
    isPaperStored,
    setPaper,
    checkPaperStorageStatus,
  };
}
