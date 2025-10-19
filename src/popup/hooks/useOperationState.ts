import { useState, useEffect } from 'preact/hooks';
import { MessageType } from '../../types/index.ts';

interface OperationState {
  isDetecting: boolean;
  isExplaining: boolean;
  isAnalyzing: boolean;
  isGeneratingGlossary: boolean;
  detectionProgress?: string;
  explanationProgress?: string;
  analysisProgress?: string;
  glossaryProgress?: string;
  error?: string;
  hasExplanation?: boolean;
  hasSummary?: boolean;
  hasAnalysis?: boolean;
  hasGlossary?: boolean;
  completionPercentage?: number;
}

interface UseOperationStateReturn {
  // State
  isDetecting: boolean;
  isExplaining: boolean;
  isAnalyzing: boolean;
  isGeneratingGlossary: boolean;
  detectionStatus: string | null;
  hasExplanation: boolean;
  hasSummary: boolean;
  hasAnalysis: boolean;
  hasGlossary: boolean;
  completionPercentage: number;

  // Actions
  checkOperationState: (tabId: number) => Promise<void>;
  setDetectionStatus: (status: string | null) => void;
  setIsDetecting: (value: boolean) => void;
  setCompletionStatus: (status: {
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
 */
export function useOperationState(): UseOperationStateReturn {
  const [isDetecting, setIsDetecting] = useState(false);
  const [isExplaining, setIsExplaining] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isGeneratingGlossary, setIsGeneratingGlossary] = useState(false);
  const [detectionStatus, setDetectionStatus] = useState<string | null>(null);
  const [hasExplanation, setHasExplanation] = useState(false);
  const [hasSummary, setHasSummary] = useState(false);
  const [hasAnalysis, setHasAnalysis] = useState(false);
  const [hasGlossary, setHasGlossary] = useState(false);
  const [completionPercentage, setCompletionPercentage] = useState(0);

  // Listen for operation state changes from background
  useEffect(() => {
    const listener = (message: any) => {
      if (message.type === MessageType.OPERATION_STATE_CHANGED) {
        const state: OperationState = message.payload?.state;
        if (!state) return;

        console.log('[useOperationState] Operation state changed:', state);

        // Update UI based on state changes
        setIsDetecting(state.isDetecting);
        setIsExplaining(state.isExplaining);
        setIsAnalyzing(state.isAnalyzing);
        setIsGeneratingGlossary(state.isGeneratingGlossary);

        // Update completion status if available
        if (state.hasExplanation !== undefined) setHasExplanation(state.hasExplanation);
        if (state.hasSummary !== undefined) setHasSummary(state.hasSummary);
        if (state.hasAnalysis !== undefined) setHasAnalysis(state.hasAnalysis);
        if (state.hasGlossary !== undefined) setHasGlossary(state.hasGlossary);
        if (state.completionPercentage !== undefined) setCompletionPercentage(state.completionPercentage);

        // Update status message based on current operation
        if (state.isDetecting) {
          setDetectionStatus(state.detectionProgress || '🐻 Kuma is foraging for research papers... (Detecting paper)');
        } else if (state.isExplaining) {
          setDetectionStatus(state.explanationProgress || '🐻 Kuma is thinking of ways to explain the research paper... (Generating explanation)');
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

  async function checkOperationState(tabId: number) {
    try {
      const response = await chrome.runtime.sendMessage({
        type: MessageType.GET_OPERATION_STATE,
        payload: { tabId },
      });

      if (response.success && response.state) {
        const state: OperationState = response.state;
        setIsDetecting(state.isDetecting);
        setIsExplaining(state.isExplaining);
        setIsAnalyzing(state.isAnalyzing);
        setIsGeneratingGlossary(state.isGeneratingGlossary);

        // Only load completion status if there's actually a current paper in the state
        // This prevents stale cached completion data from overwriting database truth
        if (state.currentPaper) {
          if (state.hasExplanation !== undefined) setHasExplanation(state.hasExplanation);
          if (state.hasSummary !== undefined) setHasSummary(state.hasSummary);
          if (state.hasAnalysis !== undefined) setHasAnalysis(state.hasAnalysis);
          if (state.hasGlossary !== undefined) setHasGlossary(state.hasGlossary);
          if (state.completionPercentage !== undefined) setCompletionPercentage(state.completionPercentage);
          console.log('[useOperationState] Loaded completion status from background:', {
            hasExplanation: state.hasExplanation,
            hasAnalysis: state.hasAnalysis,
            completionPercentage: state.completionPercentage,
          });
        } else {
          console.log('[useOperationState] Skipping completion status (no current paper in background state)');
        }

        console.log('[useOperationState] Loaded operation state:', state);

        // Update UI based on current state
        if (state.isDetecting) {
          setDetectionStatus(state.detectionProgress || '🐻 Kuma is foraging for research papers... (Detecting paper)');
        } else if (state.isExplaining) {
          setDetectionStatus(state.explanationProgress || '🐻 Kuma is thinking of ways to explain the research paper... (Generating explanation)');
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
      console.error('[useOperationState] Failed to check operation state:', error);
    }
  }

  function setCompletionStatus(status: {
    hasExplanation: boolean;
    hasSummary: boolean;
    hasAnalysis: boolean;
    hasGlossary: boolean;
    completionPercentage: number;
  }) {
    setHasExplanation(status.hasExplanation);
    setHasSummary(status.hasSummary);
    setHasAnalysis(status.hasAnalysis);
    setHasGlossary(status.hasGlossary);
    setCompletionPercentage(status.completionPercentage);
    console.log('[useOperationState] Completion status updated:', status);
  }

  /**
   * Clear all operation state (used when paper is deleted)
   */
  function clearState() {
    setIsDetecting(false);
    setIsExplaining(false);
    setIsAnalyzing(false);
    setIsGeneratingGlossary(false);
    setDetectionStatus(null);
    setHasExplanation(false);
    setHasSummary(false);
    setHasAnalysis(false);
    setHasGlossary(false);
    setCompletionPercentage(0);
    console.log('[useOperationState] State cleared');
  }

  return {
    isDetecting,
    isExplaining,
    isAnalyzing,
    isGeneratingGlossary,
    detectionStatus,
    hasExplanation,
    hasSummary,
    hasAnalysis,
    hasGlossary,
    completionPercentage,
    checkOperationState,
    setDetectionStatus,
    setIsDetecting,
    setCompletionStatus,
    clearState,
  };
}
