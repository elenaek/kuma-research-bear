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
}

interface UseOperationStateReturn {
  // State
  isDetecting: boolean;
  isExplaining: boolean;
  isAnalyzing: boolean;
  isGeneratingGlossary: boolean;
  detectionStatus: string | null;

  // Actions
  checkOperationState: (tabId: number) => Promise<void>;
  setDetectionStatus: (status: string | null) => void;
  setIsDetecting: (value: boolean) => void;
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

  return {
    isDetecting,
    isExplaining,
    isAnalyzing,
    isGeneratingGlossary,
    detectionStatus,
    checkOperationState,
    setDetectionStatus,
    setIsDetecting,
  };
}
