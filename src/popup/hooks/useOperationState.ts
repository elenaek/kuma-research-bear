import { useState, useEffect, useRef } from 'preact/hooks';
import { MessageType } from '../../shared/types/index.ts';
import { logger } from '../../shared/utils/logger.ts';

interface OperationState {
  tabId?: number;
  isDetecting: boolean;
  isExplaining: boolean;
  isGeneratingSummary: boolean;
  isAnalyzing: boolean;
  isGeneratingGlossary: boolean;
  isChunking: boolean;
  currentPaper?: {
    url: string;
    title?: string;
  };
  detectionProgress?: string;
  explanationProgress?: string;
  summaryProgress?: string;
  analysisProgress?: string;
  glossaryProgress?: string;
  chunkingProgress?: string;
  currentChunk?: number;
  totalChunks?: number;
  error?: string;
  hasExplanation?: boolean;
  hasSummary?: boolean;
  hasAnalysis?: boolean;
  hasGlossary?: boolean;
  hasDetected?: boolean;
  hasChunked?: boolean;
  detectionFailed?: boolean;  // NEW: Indicates if paper detection failed
  completionPercentage?: number;
}

interface UseOperationStateReturn {
  // State
  isDetecting: boolean;
  isExplaining: boolean;
  isGeneratingSummary: boolean;
  isAnalyzing: boolean;
  isGeneratingGlossary: boolean;
  isChunking: boolean;
  detectionStatus: string | null;
  hasExplanation: boolean;
  hasSummary: boolean;
  hasAnalysis: boolean;
  hasGlossary: boolean;
  hasDetected: boolean;
  hasChunked: boolean;
  detectionFailed: boolean;  // NEW: Indicates if paper detection failed
  completionPercentage: number;
  currentChunk: number;
  totalChunks: number;

  // Actions
  checkOperationState: (tabId: number, expectedUrl?: string) => Promise<void>;
  setDetectionStatus: (status: string | null) => void;
  setIsDetecting: (value: boolean) => void;
  setDetectionFailed: (value: boolean) => void;  // NEW: Setter for detectionFailed
  setCompletionStatus: (status: {
    hasDetected: boolean;
    hasChunked: boolean;
    hasExplanation: boolean;
    hasSummary: boolean;
    hasAnalysis: boolean;
    hasGlossary: boolean;
    completionPercentage: number;
  }) => void;
  clearState: () => void;
}

/**
 * Custom hook to track operation state (detecting, explaining, analyzing, glossary generation)
 * Listens to OPERATION_STATE_CHANGED messages from background
 * @param currentTabUrl - Optional URL of the current tab to filter broadcasts
 * @param currentTabId - Optional ID of the current tab to filter broadcasts
 */
export function useOperationState(currentTabUrl?: string, currentTabId?: number): UseOperationStateReturn {
  // Refs to track current tab info (for filtering broadcasts)
  const currentTabUrlRef = useRef<string | null>(null);
  const currentTabIdRef = useRef<number | null>(null);

  const [isDetecting, setIsDetecting] = useState(false);
  const [isExplaining, setIsExplaining] = useState(false);
  const [isGeneratingSummary, setIsGeneratingSummary] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isGeneratingGlossary, setIsGeneratingGlossary] = useState(false);
  const [isChunking, setIsChunking] = useState(false);
  const [detectionStatus, setDetectionStatus] = useState<string | null>(null);
  const [hasExplanation, setHasExplanation] = useState(false);
  const [hasSummary, setHasSummary] = useState(false);
  const [hasAnalysis, setHasAnalysis] = useState(false);
  const [hasGlossary, setHasGlossary] = useState(false);
  const [hasDetected, setHasDetected] = useState(false);
  const [hasChunked, setHasChunked] = useState(false);
  const [detectionFailed, setDetectionFailed] = useState(false);  // NEW: Track detection failure
  const [completionPercentage, setCompletionPercentage] = useState(0);
  const [currentChunk, setCurrentChunk] = useState(0);
  const [totalChunks, setTotalChunks] = useState(0);

  // Update refs when currentTabUrl or currentTabId changes
  useEffect(() => {
    currentTabUrlRef.current = currentTabUrl || null;
    currentTabIdRef.current = currentTabId !== undefined ? currentTabId : null;
  }, [currentTabUrl, currentTabId]);

  // Listen for operation state changes from background
  useEffect(() => {
    const listener = (message: any) => {
      if (message.type === MessageType.OPERATION_STATE_CHANGED) {
        const state: OperationState = message.payload?.state;
        if (!state) return;

        // Filter: Only process broadcasts for current tab
        const broadcastTabId = state.tabId;
        const broadcastUrl = state.currentPaper?.url;

        // Reject broadcasts from different tabs (using tabId for reliability)
        if (currentTabIdRef.current !== null && broadcastTabId !== undefined && currentTabIdRef.current !== broadcastTabId) {
          return;
        }

        // Update UI based on state changes
        setIsDetecting(state.isDetecting);
        setIsExplaining(state.isExplaining);
        setIsGeneratingSummary(state.isGeneratingSummary);
        setIsAnalyzing(state.isAnalyzing);
        setIsGeneratingGlossary(state.isGeneratingGlossary);
        setIsChunking(state.isChunking);

        // Update chunking progress if available
        if (state.currentChunk !== undefined) {
          setCurrentChunk(state.currentChunk);
        }
        if (state.totalChunks !== undefined) setTotalChunks(state.totalChunks);

        // Update completion status if available
        if (state.hasExplanation !== undefined) setHasExplanation(state.hasExplanation);
        if (state.hasSummary !== undefined) setHasSummary(state.hasSummary);
        if (state.hasAnalysis !== undefined) setHasAnalysis(state.hasAnalysis);
        if (state.hasGlossary !== undefined) setHasGlossary(state.hasGlossary);
        if (state.hasDetected !== undefined) setHasDetected(state.hasDetected);
        if (state.hasChunked !== undefined) setHasChunked(state.hasChunked);
        if (state.completionPercentage !== undefined) setCompletionPercentage(state.completionPercentage);

        // Update status message based on current operation
        if (state.isChunking) {
          setDetectionStatus(state.chunkingProgress || '🐻 Kuma is organizing the research paper... (Processing chunks)');
        } else if (state.isDetecting) {
          setDetectionStatus(state.detectionProgress || '🐻 Kuma is foraging for research papers... (Detecting paper)');
        } else if (state.isExplaining) {
          setDetectionStatus(state.explanationProgress || '🐻 Kuma is thinking of ways to explain the research paper... (Generating explanation)');
        } else if (state.isGeneratingSummary) {
          setDetectionStatus(state.summaryProgress || '🐻 Kuma is generating a summary for the research paper... (Generating summary)');
        } else if (state.isAnalyzing && state.isGeneratingGlossary) {
          // Both analysis and glossary are running in parallel
          setDetectionStatus('🐻 Kuma is analyzing the paper and extracting key terms... (Analyzing + Glossary)');
        } else if (state.isAnalyzing) {
          setDetectionStatus(state.analysisProgress || '🐻 Kuma is deeply analyzing the research paper... (Analyzing paper)');
        } else if (state.isGeneratingGlossary) {
          setDetectionStatus(state.glossaryProgress || '🐻 Kuma is extracting technical terms and acronyms... (Generating glossary)');
        } else if (state.error) {
          setDetectionStatus(`❌ ${state.error}`);
        } else {
          // All done
          setDetectionStatus('✅ Kuma is done! You can now open the sidepanel to see the results. (Complete!)');
          setTimeout(() => setDetectionStatus(null), 5000);
        }
      }
    };

    chrome.runtime.onMessage.addListener(listener);

    return () => {
      chrome.runtime.onMessage.removeListener(listener);
    };
  }, []);

  async function checkOperationState(tabId: number, expectedUrl?: string) {
    try {
      const response = await chrome.runtime.sendMessage({
        type: MessageType.GET_OPERATION_STATE,
        payload: { tabId },
      });

      if (response.success && response.state) {
        const state: OperationState = response.state;

        setIsDetecting(state.isDetecting);
        setIsExplaining(state.isExplaining);
        setIsGeneratingSummary(state.isGeneratingSummary);
        setIsAnalyzing(state.isAnalyzing);
        setIsGeneratingGlossary(state.isGeneratingGlossary);
        setIsChunking(state.isChunking);

        // Update chunking progress
        if (state.currentChunk !== undefined) setCurrentChunk(state.currentChunk);
        if (state.totalChunks !== undefined) setTotalChunks(state.totalChunks);

        // Only load completion status if there's a current paper AND it matches the expected URL
        // This prevents wrong paper's completion status from overwriting database truth
        const shouldLoadCompletion = state.currentPaper &&
          (!expectedUrl || state.currentPaper.url === expectedUrl);

        if (shouldLoadCompletion) {
          if (state.hasExplanation !== undefined) setHasExplanation(state.hasExplanation);
          if (state.hasSummary !== undefined) setHasSummary(state.hasSummary);
          if (state.hasAnalysis !== undefined) setHasAnalysis(state.hasAnalysis);
          if (state.hasGlossary !== undefined) setHasGlossary(state.hasGlossary);

          // Only update hasDetected/hasChunked if they're true (don't let empty operation states overwrite database truth)
          if (state.hasDetected) setHasDetected(true);
          if (state.hasChunked) setHasChunked(true);

          if (state.completionPercentage !== undefined) setCompletionPercentage(state.completionPercentage);
        }

        // Update UI based on current state
        if (state.isChunking) {
          setDetectionStatus(state.chunkingProgress || '🐻 Kuma is organizing the research paper... (Processing chunks)');
        } else if (state.isDetecting) {
          setDetectionStatus(state.detectionProgress || '🐻 Kuma is foraging for research papers... (Detecting paper)');
        } else if (state.isExplaining) {
          setDetectionStatus(state.explanationProgress || '🐻 Kuma is thinking of ways to explain the research paper... (Generating explanation)');
        } else if (state.isGeneratingSummary) {
          setDetectionStatus(state.summaryProgress || '🐻 Kuma is generating a summary for the research paper... (Generating summary)');
        } else if (state.isAnalyzing && state.isGeneratingGlossary) {
          setDetectionStatus('🐻 Kuma is analyzing the paper and extracting key terms... (Analyzing + Glossary)');
        } else if (state.isAnalyzing) {
          setDetectionStatus(state.analysisProgress || '🐻 Kuma is deeply analyzing the research paper... (Analyzing paper)');
        } else if (state.isGeneratingGlossary) {
          setDetectionStatus(state.glossaryProgress || '🐻 Kuma is extracting technical terms and acronyms... (Generating glossary)');
        }

        if (state.error) {
          setDetectionStatus(`❌ ${state.error}`);
        }
      }
    } catch (error) {
      logger.error('CHROME_SERVICE', 'Failed to check operation state:', error);
    }
  }

  function setCompletionStatus(status: {
    hasExplanation: boolean;
    hasSummary: boolean;
    hasAnalysis: boolean;
    hasGlossary: boolean;
    hasDetected: boolean;
    hasChunked: boolean;
    completionPercentage: number;
  }) {
    setHasExplanation(status.hasExplanation);
    setHasSummary(status.hasSummary);
    setHasAnalysis(status.hasAnalysis);
    setHasGlossary(status.hasGlossary);
    setHasDetected(status.hasDetected);
    setHasChunked(status.hasChunked);
    setCompletionPercentage(status.completionPercentage);
  }

  /**
   * Clear all operation state (used when paper is deleted)
   */
  function clearState() {
    setIsDetecting(false);
    setIsExplaining(false);
    setIsGeneratingSummary(false);
    setIsAnalyzing(false);
    setIsGeneratingGlossary(false);
    setIsChunking(false);
    setDetectionStatus(null);
    setHasExplanation(false);
    setHasSummary(false);
    setHasAnalysis(false);
    setHasGlossary(false);
    setHasDetected(false);
    setHasChunked(false);
    setDetectionFailed(false);  // NEW: Reset detection failure
    setCompletionPercentage(0);
    setCurrentChunk(0);
    setTotalChunks(0);
  }

  return {
    isDetecting,
    isExplaining,
    isGeneratingSummary,
    isAnalyzing,
    isGeneratingGlossary,
    isChunking,
    detectionStatus,
    hasExplanation,
    hasSummary,
    hasAnalysis,
    hasGlossary,
    hasDetected,
    hasChunked,
    detectionFailed,  // NEW: Detection failure flag
    completionPercentage,
    currentChunk,
    totalChunks,
    checkOperationState,
    setDetectionStatus,
    setIsDetecting,
    setDetectionFailed,  // NEW: Setter for detection failure
    setCompletionStatus,
    clearState,
  };
}
