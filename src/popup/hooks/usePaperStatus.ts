import { useState, useEffect, useRef } from 'preact/hooks';
import * as ChromeService from '../../services/chromeService.ts';
import { MessageType, ResearchPaper } from '../../shared/types/index.ts';
import { normalizeUrl } from '../../shared/utils/urlUtils.ts';
import { logger } from '../../shared/utils/logger.ts';

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
 * @param currentTabUrl - Optional URL of the current tab to filter broadcasts
 */
export function usePaperStatus(currentTabUrl?: string): UsePaperStatusReturn {
  const [paper, setPaper] = useState<ResearchPaper | null>(null);
  const [isPaperStored, setIsPaperStored] = useState(false);
  const currentTabUrlRef = useRef<string | null>(null);

  // Update ref when currentTabUrl changes
  useEffect(() => {
    currentTabUrlRef.current = currentTabUrl || null;
  }, [currentTabUrl]);

  // Listen for paper updates from operation state changes
  useEffect(() => {
    const listener = (message: any) => {
      if (message.type === MessageType.OPERATION_STATE_CHANGED) {
        const state = message.payload?.state;

        // Filter: Only accept broadcasts for current tab
        const paperUrl = state?.currentPaper?.url;
        if (currentTabUrlRef.current && paperUrl) {
          const normalizedCurrentUrl = normalizeUrl(currentTabUrlRef.current);
          const normalizedPaperUrl = normalizeUrl(paperUrl);
          if (normalizedCurrentUrl !== normalizedPaperUrl) {
            return;
          }
        }

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
      const isStored = await ChromeService.isPaperStoredInDB(paperUrl);
      setIsPaperStored(isStored);
    } catch (error) {
      logger.error('CHROME_SERVICE', 'Error checking paper storage:', error);
      setIsPaperStored(false);
    }
  }

  async function checkStoredPaper(url: string): Promise<ChromeService.PaperStatusInfo> {
    try {
      const status = await ChromeService.getPaperStatus(url);

      if (status.isStored) {
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
      logger.error('CHROME_SERVICE', 'Error checking stored paper:', error);
      return {
        isStored: false,
        hasExplanation: false,
        hasSummary: false,
        hasAnalysis: false,
        hasGlossary: false,
        hasDetected: false,
        hasChunked: false,
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
