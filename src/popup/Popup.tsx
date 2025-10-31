import { useEffect, useState, useRef } from 'preact/hooks';
import * as ChromeService from '../services/ChromeService.ts';
import { useAIStatus } from './hooks/useAIStatus.ts';
import { useOperationState } from './hooks/useOperationState.ts';
import { usePaperStatus } from './hooks/usePaperStatus.ts';
import { InitHeader } from './components/InitHeader.tsx';
import { Header } from './components/Header.tsx';
import { AIStatusCard } from './components/AIStatusCard.tsx';
import { PaperInfoCard } from './components/PaperInfoCard.tsx';
import { OperationBadges } from './components/OperationBadges.tsx';
import { ActionButtons } from './components/ActionButtons.tsx';
import { LoopPurpose, LottiePlayer, LottiePlayerHandle } from '../shared/components/LottiePlayer.tsx';
import { LanguageDropdown } from './components/LanguageDropdown.tsx';
import { PersonaSelector } from './components/PersonaSelector.tsx';
import { PurposeSelector } from './components/PurposeSelector.tsx';
import { ImageButtonsToggle } from './components/ImageButtonsToggle.tsx';
import { normalizeUrl } from '../utils/urlUtils.ts';
import { MessageType } from '../types/index.ts';
import { getShowImageButtons, setShowImageButtons as saveShowImageButtons } from '../utils/settingsService.ts';
import { logger } from '../utils/logger.ts';
import { Settings, ChevronDown, ChevronUp } from 'lucide-preact';

export function Popup() {
  // Ref for Lottie animation control
  const lottieRef = useRef<LottiePlayerHandle>(null);
  // Track current tab info for filtering operation state broadcasts
  const [currentTabUrl, setCurrentTabUrl] = useState<string | undefined>();
  const [currentTabId, setCurrentTabId] = useState<number | undefined>();

  // Track sidepanel state for dynamic button behavior
  const [isSidepanelOpen, setIsSidepanelOpen] = useState(false);
  const [currentUrlHasPaper, setCurrentUrlHasPaper] = useState(false);

  // Track chatbox state for dynamic button behavior
  const [isChatOpen, setIsChatOpen] = useState(false);

  // Delete paper state
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  // Image buttons toggle state
  const [showImageButtons, setShowImageButtons] = useState(true);

  // Settings collapsible state
  const [settingsExpanded, setSettingsExpanded] = useState(false);

  // Custom hooks
  const aiStatus = useAIStatus();
  const operationState = useOperationState(currentTabUrl, currentTabId);
  const paperStatus = usePaperStatus(currentTabUrl);

  // Initialize current tab info IMMEDIATELY on mount (before broadcasts arrive)
  useEffect(() => {
    async function initializeTabInfo() {
      try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (tab.url) {
          setCurrentTabUrl(tab.url);
        }
        if (tab.id !== undefined) {
          setCurrentTabId(tab.id);
        }
      } catch (error) {
        logger.error('UI', '[Popup] Failed to get tab info:', error);
      }
    }

    initializeTabInfo();
  }, []); // Empty deps - runs once on mount

  // Check operation state on mount
  useEffect(() => {
    checkInitialState();
  }, []);

  // Load image buttons setting on mount
  useEffect(() => {
    async function loadSettings() {
      try {
        const showButtons = await getShowImageButtons();
        setShowImageButtons(showButtons);
      } catch (error) {
        logger.error('UI', '[Popup] Failed to load settings:', error);
      }
    }
    loadSettings();
  }, []);

  // Listen for PAPER_DELETED messages
  useEffect(() => {
    const listener = (message: any) => {
      if (message.type === 'PAPER_DELETED') {
        const deletedPaperUrl = message.payload?.paperUrl;

        // Clear state if the deleted paper matches the current paper
        if (deletedPaperUrl && paperStatus.paper?.url) {
          const normalizedDeletedUrl = normalizeUrl(deletedPaperUrl);
          const normalizedCurrentUrl = normalizeUrl(paperStatus.paper.url);
          if (normalizedDeletedUrl === normalizedCurrentUrl) {
            operationState.clearState();
            paperStatus.clearPaper();
          }
        }
      }
    };

    chrome.runtime.onMessage.addListener(listener);

    return () => {
      chrome.runtime.onMessage.removeListener(listener);
    };
  }, [paperStatus.paper?.url]);

  // Listen for OPERATION_STATE_CHANGED to update sidepanel button reactively
  useEffect(() => {
    const listener = async (message: any) => {
      if (message.type === 'OPERATION_STATE_CHANGED') {
        // When operation state changes, re-check button state
        // This enables the button when a paper is stored/explained
        await updateSidepanelButtonState();
      }
    };

    chrome.runtime.onMessage.addListener(listener);

    return () => {
      chrome.runtime.onMessage.removeListener(listener);
    };
  }, []);

  // Helper function to update sidepanel button state
  async function updateSidepanelButtonState() {
    try {
      // Check sidepanel open state
      const isOpen = await ChromeService.isSidepanelOpen();
      setIsSidepanelOpen(isOpen);

      // Check if current URL has paper
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab.url) {
        const hasPaper = await ChromeService.isPaperStoredInDB(tab.url);
        setCurrentUrlHasPaper(hasPaper);
      }
    } catch (error) {
      logger.error('UI', '[Popup] Error updating sidepanel button state:', error);
    }
  }

  // Helper function to update chatbox button state
  async function updateChatboxState() {
    try {
      const isOpen = await ChromeService.getChatboxState(currentTabId);
      setIsChatOpen(isOpen);
    } catch (error) {
      logger.error('UI', '[Popup] Error updating chatbox state:', error);
    }
  }

  async function checkInitialState() {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

      // Step 1: Check database for stored paper (if URL exists)
      let paperUrl: string | undefined;
      if (tab.url) {
        paperUrl = tab.url;
        // currentTabUrl already set in initialization effect on mount
        const status = await paperStatus.checkStoredPaper(tab.url);

        if (status.isStored) {
          // Update operation state with completion info
          operationState.setCompletionStatus({
            hasExplanation: status.hasExplanation,
            hasSummary: status.hasSummary,
            hasAnalysis: status.hasAnalysis,
            hasGlossary: status.hasGlossary,
            hasDetected: status.hasDetected,
            hasChunked: status.hasChunked,
            completionPercentage: status.completionPercentage,
          });
        }
      }

      // Step 2: Check background for active operations (pass URL to prevent overwriting completion status)
      if (tab.id) {
        await operationState.checkOperationState(tab.id, paperUrl);
      }

      // Step 3: Update sidepanel button state
      await updateSidepanelButtonState();

      // Step 4: Update chatbox state
      await updateChatboxState();
    } catch (error) {
      logger.error('UI', '[Popup] Failed to check initial state:', error);
    }
  }

  async function handleDetectPaper() {
    try {
      // Trigger Lottie animation
      lottieRef.current?.playOnce();

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
        // Check if failure was due to paper detection
        const isDetectionFailure = response.error?.includes('research paper') ||
                                    response.error?.includes('Not a research paper') ||
                                    response.error?.includes('detection failed');

        if (isDetectionFailure) {
          operationState.setDetectionFailed(true);
          operationState.setDetectionStatus(`⚠ ${response.error || 'Not a research paper'}`);
        } else {
          operationState.setDetectionStatus(`❌ ${response.error || 'Detection failed'}`);
        }

        setTimeout(() => operationState.setDetectionStatus(null), 5000);
        operationState.setIsDetecting(false);
      }
      // If successful, state updates will come via OPERATION_STATE_CHANGED listener
    } catch (error: any) {
      logger.error('UI', '[Popup] Detection failed:', error);
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

      if (isSidepanelOpen && currentUrlHasPaper && tab.url) {
        // Navigate existing sidepanel to this paper
        await ChromeService.navigateSidepanelToPaper(tab.url);
      } else if (tab.id) {
        // Open sidepanel
        await chrome.sidePanel.open({ tabId: tab.id });

        // Navigate to current paper if there is one
        if (currentUrlHasPaper && tab.url) {
          await ChromeService.navigateSidepanelToPaper(tab.url);
        }
      }
    } catch (error) {
      logger.error('UI', '[Popup] Failed to open sidepanel:', error);
    }
  }

  async function handleGenerateExplanation() {
    // Guard against missing paper or already generating explanation
    if (!paperStatus.paper || operationState.isExplaining) {
      return;
    }

    try {
      await ChromeService.explainPaperManual(paperStatus.paper.url, currentTabId);
    } catch (error) {
      logger.error('UI', '[Popup] Failed to generate explanation:', error);
    }
  }

  async function handleGenerateSummary() {
    // Guard against missing paper or already generating summary
    if (!paperStatus.paper || operationState.isGeneratingSummary) {
      return;
    }

    try {
      await ChromeService.generateSummaryManual(paperStatus.paper.url, currentTabId);
    } catch (error) {
      logger.error('UI', '[Popup] Failed to generate summary:', error);
    }
  }

  async function handleGenerateAnalysis() {
    // Guard against missing paper or already analyzing
    if (!paperStatus.paper || operationState.isAnalyzing) {
      return;
    }

    try {
      await ChromeService.analyzePaper(paperStatus.paper.url, currentTabId);
    } catch (error) {
      logger.error('UI', '[Popup] Failed to generate analysis:', error);
    }
  }

  async function handleGenerateGlossary() {
    // Guard against missing paper or already generating glossary
    if (!paperStatus.paper || operationState.isGeneratingGlossary) {
      return;
    }

    try {
      await ChromeService.generateGlossary(paperStatus.paper.url, currentTabId);
    } catch (error) {
      logger.error('UI', '[Popup] Failed to generate glossary:', error);
    }
  }

  async function handleOpenChat() {
    try {
      await ChromeService.toggleChatbox(currentTabId);
      // Update chatbox state after toggling
      await updateChatboxState();
    } catch (error) {
      logger.error('UI', '[Popup] Failed to toggle chatbox:', error);
    }
  }

  async function handleDeletePaper() {
    if (!paperStatus.paper) return;

    // Show confirmation on first click
    if (!showDeleteConfirm) {
      setShowDeleteConfirm(true);
      return;
    }

    // Get paper ID (stored papers have an id field)
    const paperId = (paperStatus.paper as any).id;
    if (!paperId) {
      logger.error('UI', '[Popup] Cannot delete: paper has no ID');
      return;
    }

    setIsDeleting(true);
    try {
      const success = await ChromeService.deletePaper(paperId);
      if (success) {
        logger.debug('UI', '[Popup] Paper deleted successfully');
        // State will be cleared by PAPER_DELETED listener
        setShowDeleteConfirm(false);
      } else {
        logger.error('UI', '[Popup] Failed to delete paper');
      }
    } catch (error) {
      logger.error('UI', '[Popup] Error deleting paper:', error);
    } finally {
      setIsDeleting(false);
    }
  }

  function handleCancelDelete() {
    setShowDeleteConfirm(false);
  }

  async function handleToggleImageButtons() {
    const newValue = !showImageButtons;
    setShowImageButtons(newValue);

    try {
      // Update setting in storage
      await saveShowImageButtons(newValue);

      // Broadcast change to all tabs
      const tabs = await chrome.tabs.query({});
      for (const tab of tabs) {
        if (tab.id) {
          chrome.tabs.sendMessage(tab.id, {
            type: MessageType.IMAGE_BUTTONS_VISIBILITY_CHANGED,
            payload: { showImageButtons: newValue },
          }).catch(() => {}); // Ignore errors for tabs without content script
        }
      }
    } catch (error) {
      logger.error('UI', '[Popup] Failed to toggle image buttons:', error);
    }
  }

  // Determine if Lottie animation should auto-start looping
  const isOperationActive =
    operationState.isDetecting ||
    operationState.isExplaining ||
    operationState.isGeneratingSummary ||
    operationState.isAnalyzing ||
    operationState.isGeneratingGlossary;

  const isComplete = operationState.hasChunked;
  const shouldAutoLoop = isOperationActive || isComplete;

  // Determine which lottie to show based on AI status and download progress
  let lottiePath = '/lotties/kuma-research-bear.lottie'; // Default

  if (aiStatus.aiStatus === 'needsInit') {
    // Show sleeping bear when model needs initialization
    lottiePath = '/lotties/kuma-sleeping.lottie';
  } 
  else if (aiStatus.aiStatus === 'downloading') {
    // Show different animations based on which model is downloading
    if (aiStatus.currentDownloadingModel === 'gemini') {
      // GeminiNano downloading (0-80%)
      lottiePath = '/lotties/kuma-sleeping-shaking-zzz.lottie';
    } else if (aiStatus.currentDownloadingModel === 'embedding') {
      // Embedding downloading (80-100%)
      lottiePath = '/lotties/kuma-sleeping-shaking-nozzz.lottie';
    } else {
      // Fallback during download (shouldn't happen but just in case)
      lottiePath = '/lotties/kuma-sleeping-shaking-zzz.lottie';
    }
  }
  // Otherwise use default kuma-research-bear.lottie

  return (
    <div class="w-90 max-h-96 bg-gradient-to-br from-gray-50 to-gray-100">
      <div class="p-6">
        {/* Settings Controls - Top Left Corner */}
        <div class="absolute p-2 top-0 left-0 flex flex-col gap-2 hover:cursor-pointer">
          <LanguageDropdown />
        </div>

        {/* Header */}
        {aiStatus.aiStatus !== 'ready' ? (
          <InitHeader ref={lottieRef} autoStartLoop={false} lottiePath={lottiePath} />
        ) : (
          <Header ref={lottieRef} autoStartLoop={shouldAutoLoop} />
        )}

        {/* AI Status Card */}
        <AIStatusCard
          aiStatus={aiStatus.aiStatus}
          aiAvailability={aiStatus.aiAvailability}
          statusMessage={aiStatus.statusMessage}
          isInitializing={aiStatus.isInitializing}
          isResetting={aiStatus.isResetting}
          isDetecting={operationState.isDetecting}
          isExplaining={operationState.isExplaining}
          isGeneratingSummary={operationState.isGeneratingSummary}
          isAnalyzing={operationState.isAnalyzing}
          isGeneratingGlossary={operationState.isGeneratingGlossary}
          isChunking={operationState.isChunking}
          detectionStatus={operationState.detectionStatus}
          downloadProgress={aiStatus.downloadProgress}
          currentDownloadingModel={aiStatus.currentDownloadingModel}
          onInitialize={aiStatus.handleInitializeAI}
          onReset={aiStatus.handleResetAI}
          paperReady={operationState.hasExplanation && operationState.hasSummary}
        />


        {/* Show operation badges early when operations are active but no paper yet */}
        {!paperStatus.paper && (operationState.isDetecting || operationState.isChunking || operationState.hasDetected || operationState.hasChunked || operationState.detectionFailed) && (
          <div class="card mb-4 bg-blue-50 border-blue-200">
            <h3 class="text-sm font-semibold text-gray-700 mb-1">Operation Progress</h3>
            <OperationBadges
              isDetecting={operationState.isDetecting}
              isChunking={operationState.isChunking}
              hasDetected={operationState.hasDetected}
              hasChunked={operationState.hasChunked}
              currentChunk={operationState.currentChunk}
              totalChunks={operationState.totalChunks}
              detectionFailed={operationState.detectionFailed}
            />
            {/* Show detection failure message */}
            {operationState.detectionFailed && (
              <div class="mt-2 text-xs text-amber-700">
                ⚠ No research paper detected on this page. This extension only works with research papers.
              </div>
            )}
          </div>
        )}
        
        {/* Delete Confirmation Banner */}
        {showDeleteConfirm && paperStatus.paper && (
          <div class="card mb-4 bg-red-50 border-red-200">
            <p class="text-sm font-semibold text-red-900 mb-2">
              Delete "{paperStatus.paper.title}"?
            </p>
            <p class="text-xs text-red-800 mb-3">
              This will remove all data including Q&A history.
            </p>
            <div class="flex gap-2">
              <button
                onClick={handleDeletePaper}
                disabled={isDeleting}
                class="flex-1 px-3 py-2 text-sm font-medium text-white bg-red-600 hover:bg-red-700 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed hover:cursor-pointer"
              >
                {isDeleting ? 'Deleting...' : 'Confirm Delete'}
              </button>
              <button
                onClick={handleCancelDelete}
                disabled={isDeleting}
                class="flex-1 px-3 py-2 text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 border border-gray-300 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed hover:cursor-pointer"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* Paper Info Card - Show when paper exists */}
        {paperStatus.paper && (
          <PaperInfoCard
            paper={paperStatus.paper}
            isPaperStored={paperStatus.isPaperStored}
            isDetecting={operationState.isDetecting}
            isChunking={operationState.isChunking}
            isExplaining={operationState.isExplaining}
            isGeneratingSummary={operationState.isGeneratingSummary}
            isAnalyzing={operationState.isAnalyzing}
            isGeneratingGlossary={operationState.isGeneratingGlossary}
            hasDetected={operationState.hasDetected}
            hasChunked={operationState.hasChunked}
            currentChunk={operationState.currentChunk}
            totalChunks={operationState.totalChunks}
            hasExplanation={operationState.hasExplanation}
            hasSummary={operationState.hasSummary}
            hasAnalysis={operationState.hasAnalysis}
            hasGlossary={operationState.hasGlossary}
            completionPercentage={operationState.completionPercentage}
            onGenerateExplanation={handleGenerateExplanation}
            onGenerateSummary={handleGenerateSummary}
            onGenerateAnalysis={handleGenerateAnalysis}
            onGenerateGlossary={handleGenerateGlossary}
            onDeletePaper={handleDeletePaper}
            paperId={(paperStatus.paper as any).id}
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
          isSidepanelOpen={isSidepanelOpen}
          currentUrlHasPaper={currentUrlHasPaper}
          isChatOpen={isChatOpen}
          hasChunked={operationState.hasChunked}
          onDetectPaper={handleDetectPaper}
          onOpenSidepanel={handleOpenSidepanel}
          onOpenChat={handleOpenChat}
        />

        {/* Collapsible Settings Section */}
        <div class="mt-6 border-t border-gray-200 pt-4">
          {/* Settings Toggle Button */}
          <button
            onClick={() => setSettingsExpanded(!settingsExpanded)}
            class="w-full flex items-center justify-between px-4 py-2 bg-gray-50 hover:bg-gray-100 rounded-lg transition-colors hover:cursor-pointer"
            aria-expanded={settingsExpanded}
            aria-label="Toggle settings"
          >
            <div class="flex items-center gap-2 mx-auto">
              <Settings size={16} class="text-gray-600" />
              <span class="text-sm font-medium text-gray-700">Settings</span>
            </div>
            {settingsExpanded ? (
              <ChevronUp size={16} class="text-gray-600" />
            ) : (
              <ChevronDown size={16} class="text-gray-600" />
            )}
          </button>

          {/* Collapsible Settings Content */}
          {settingsExpanded && (
            <div class="flex flex-col gap-4 mt-4 px-2">
              {/* Persona and Purpose Selectors */}
              <div class="flex flex-col gap-2 text-center">
                <label class="text-sm font-light text-gray-700">You are a...</label>
                <PersonaSelector />
                <label class="text-sm font-light text-gray-700">and you want to...</label>
                <PurposeSelector />
              </div>

              {/* Image Buttons Toggle */}
              <ImageButtonsToggle
                showImageButtons={showImageButtons}
                onToggle={handleToggleImageButtons}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
