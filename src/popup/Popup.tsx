import { useEffect } from 'preact/hooks';
import * as ChromeService from '../services/ChromeService.ts';
import { useAIStatus } from './hooks/useAIStatus.ts';
import { useOperationState } from './hooks/useOperationState.ts';
import { usePaperStatus } from './hooks/usePaperStatus.ts';
import { Header } from './components/Header.tsx';
import { AIStatusCard } from './components/AIStatusCard.tsx';
import { PaperInfoCard } from './components/PaperInfoCard.tsx';
import { ActionButtons } from './components/ActionButtons.tsx';

export function Popup() {
  // Custom hooks
  const aiStatus = useAIStatus();
  const operationState = useOperationState();
  const paperStatus = usePaperStatus();

  // Check operation state on mount
  useEffect(() => {
    checkInitialState();
  }, []);

  // Listen for PAPER_DELETED messages
  useEffect(() => {
    const listener = (message: any) => {
      if (message.type === 'PAPER_DELETED') {
        const deletedPaperUrl = message.payload?.paperUrl;
        console.log('[Popup] Paper deleted:', deletedPaperUrl);

        // Clear state if the deleted paper matches the current paper
        if (deletedPaperUrl && paperStatus.paper?.url === deletedPaperUrl) {
          console.log('[Popup] Clearing state for deleted paper');
          operationState.clearState();
          paperStatus.clearPaper();
        }
      }
    };

    chrome.runtime.onMessage.addListener(listener);

    return () => {
      chrome.runtime.onMessage.removeListener(listener);
    };
  }, [paperStatus.paper?.url]);

  async function checkInitialState() {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

      // Step 1: Check database for stored paper (if URL exists)
      let paperUrl: string | undefined;
      if (tab.url) {
        paperUrl = tab.url;
        console.log('[Popup] Checking database for stored paper:', tab.url);
        const status = await paperStatus.checkStoredPaper(tab.url);

        if (status.isStored) {
          // Update operation state with completion info
          operationState.setCompletionStatus({
            hasExplanation: status.hasExplanation,
            hasSummary: status.hasSummary,
            hasAnalysis: status.hasAnalysis,
            hasGlossary: status.hasGlossary,
            completionPercentage: status.completionPercentage,
          });
          console.log('[Popup] ✓ Stored paper found with completion:', status.completionPercentage + '%');
        }
      }

      // Step 2: Check background for active operations (pass URL to prevent overwriting completion status)
      if (tab.id) {
        await operationState.checkOperationState(tab.id, paperUrl);
      }
    } catch (error) {
      console.error('[Popup] Failed to check initial state:', error);
    }
  }

  async function handleDetectPaper() {
    try {
      operationState.setIsDetecting(true);
      operationState.setDetectionStatus('🐻 Kuma is foraging for research papers... (Detecting paper)');

      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

      if (!tab.id) {
        operationState.setDetectionStatus('❌ No active tab found');
        setTimeout(() => operationState.setDetectionStatus(null), 3000);
        operationState.setIsDetecting(false);
        return;
      }

      // Call background service to orchestrate the full flow
      const response = await ChromeService.startDetectAndExplain(tab.id);

      if (!response.success) {
        operationState.setDetectionStatus(`❌ ${response.error || 'Detection failed'}`);
        setTimeout(() => operationState.setDetectionStatus(null), 5000);
        operationState.setIsDetecting(false);
      }
      // If successful, state updates will come via OPERATION_STATE_CHANGED listener
    } catch (error: any) {
      console.error('[Popup] Detection failed:', error);

      // Handle content script not ready
      if (error.message?.includes('Receiving end does not exist')) {
        operationState.setDetectionStatus('⚠️ Content script not ready. Please refresh the page and try again.');
      } else {
        operationState.setDetectionStatus(`❌ Detection failed: ${error.message || String(error)}`);
      }

      setTimeout(() => operationState.setDetectionStatus(null), 5000);
      operationState.setIsDetecting(false);
    }
  }

  async function handleOpenSidepanel() {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

      if (tab.id) {
        await chrome.sidePanel.open({ tabId: tab.id });
      }
    } catch (error) {
      console.error('[Popup] Failed to open sidepanel:', error);
    }
  }

  return (
    <div class="w-90 bg-gradient-to-br from-gray-50 to-gray-100">
      <div class="p-6">
        {/* Header */}
        <Header />

        {/* AI Status Card */}
        <AIStatusCard
          aiStatus={aiStatus.aiStatus}
          aiAvailability={aiStatus.aiAvailability}
          statusMessage={aiStatus.statusMessage}
          isInitializing={aiStatus.isInitializing}
          isResetting={aiStatus.isResetting}
          isDetecting={operationState.isDetecting}
          isExplaining={operationState.isExplaining}
          isAnalyzing={operationState.isAnalyzing}
          isGeneratingGlossary={operationState.isGeneratingGlossary}
          detectionStatus={operationState.detectionStatus}
          onInitialize={aiStatus.handleInitializeAI}
          onReset={aiStatus.handleResetAI}
        />

        {/* Paper Info Card */}
        {paperStatus.paper && (
          <PaperInfoCard
            paper={paperStatus.paper}
            isPaperStored={paperStatus.isPaperStored}
            hasExplanation={operationState.hasExplanation}
            hasSummary={operationState.hasSummary}
            hasAnalysis={operationState.hasAnalysis}
            hasGlossary={operationState.hasGlossary}
            completionPercentage={operationState.completionPercentage}
          />
        )}

        {/* Action Buttons */}
        <ActionButtons
          aiStatus={aiStatus.aiStatus}
          isDetecting={operationState.isDetecting}
          isExplaining={operationState.isExplaining}
          isAnalyzing={operationState.isAnalyzing}
          isGeneratingGlossary={operationState.isGeneratingGlossary}
          isPaperStored={paperStatus.isPaperStored}
          onDetectPaper={handleDetectPaper}
          onOpenSidepanel={handleOpenSidepanel}
        />
      </div>
    </div>
  );
}
