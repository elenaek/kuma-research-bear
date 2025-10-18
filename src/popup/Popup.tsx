import { useState, useEffect } from 'preact/hooks';
import { Search, Sparkles, PanelRight, Settings, Download, Loader, PawPrint, RefreshCw, Database } from 'lucide-preact';
import { MessageType, ResearchPaper, AIAvailability } from '../types/index.ts';

export function Popup() {
  const [aiStatus, setAiStatus] = useState<'checking' | 'ready' | 'needsInit' | 'downloading' | 'error'>('checking');
  const [aiAvailability, setAiAvailability] = useState<AIAvailability>('no');
  const [statusMessage, setStatusMessage] = useState('Checking AI availability...');
  const [paper, setPaper] = useState<ResearchPaper | null>(null);
  const [isExplaining, setIsExplaining] = useState(false);
  const [isInitializing, setIsInitializing] = useState(false);
  const [isResetting, setIsResetting] = useState(false);
  const [isDetecting, setIsDetecting] = useState(false);
  const [detectionStatus, setDetectionStatus] = useState<string | null>(null);
  const [isPaperStored, setIsPaperStored] = useState(false);

  // Check AI availability and operation state on mount
  useEffect(() => {
    checkAIStatus();
    checkOperationState();

    // Listen for operation state changes from background
    const listener = (message: any) => {
      if (message.type === MessageType.OPERATION_STATE_CHANGED) {
        const state = message.payload?.state;
        if (!state) return;

        console.log('[Popup] Operation state changed:', state);

        // Update UI based on state changes
        setIsDetecting(state.isDetecting);

        if (state.isDetecting) {
          setDetectionStatus(state.detectionProgress || '🐻 Kuma is foraging for research papers...');
        } else if (state.isExplaining) {
          setDetectionStatus(state.explanationProgress || '🐻 Kuma is thinking of ways to explain the research paper...');
        } else if (state.isAnalyzing) {
          setDetectionStatus(state.analysisProgress || '🐻 Kuma is deeply analyzing the research paper...');
        } else if (state.error) {
          setDetectionStatus(`❌ ${state.error}`);
        } else {
          // All done
          setDetectionStatus('✅ Complete!');
          setTimeout(() => setDetectionStatus(null), 3000);
        }

        if (state.currentPaper) {
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

  async function checkOperationState() {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab.id) return;

      const response = await chrome.runtime.sendMessage({
        type: MessageType.GET_OPERATION_STATE,
        payload: { tabId: tab.id },
      });

      if (response.success && response.state) {
        const state = response.state;
        console.log('[Popup] Loaded operation state:', state);

        // Update UI based on current state
        if (state.isDetecting) {
          setIsDetecting(true);
          setDetectionStatus(state.detectionProgress || 'Detecting paper...');
        }
        if (state.isExplaining) {
          setDetectionStatus('🐻 Kuma is explaining the paper...');
        }
        if (state.currentPaper) {
          setPaper(state.currentPaper);
          checkPaperStorageStatus(state.currentPaper.url);
        }
        if (state.error) {
          setDetectionStatus(`❌ ${state.error}`);
        }
      }
    } catch (error) {
      console.error('[Popup] Failed to check operation state:', error);
    }
  }

  async function checkAIStatus() {
    try {
      const response = await chrome.runtime.sendMessage({
        type: MessageType.AI_STATUS,
      });

      const availability = response.capabilities?.availability || 'no';
      setAiAvailability(availability);

      if (availability === 'available') {
        setAiStatus('ready');
        setStatusMessage('Kuma is ready to help you with your research!');
      } else if (availability === 'downloadable') {
        setAiStatus('needsInit');
        setStatusMessage('Kuma needs to be woken up');
      } else if (availability === 'downloading') {
        setAiStatus('downloading');
        setStatusMessage('Kuma loading in...');
      } else if (availability === 'unavailable') {
        setAiStatus('error');
        setStatusMessage('Kuma fell asleep again. (Crashed - needs reset)');
      } else {
        setAiStatus('error');
        setStatusMessage('Kuma is missing from his cave. (Not available on this device)');
      }
    } catch (error) {
      setAiStatus('error');
      setStatusMessage('Error checking Kuma\'s status');
      console.log('Kuma status check failed:', error);
      console.error('Kuma status check failed:', error);
    }
  }

  async function checkPaperStorageStatus(paperUrl: string) {
    try {
      console.log('[Popup] Checking if paper is stored:', paperUrl);
      const response = await chrome.runtime.sendMessage({
        type: MessageType.IS_PAPER_STORED_IN_DB,
        payload: { url: paperUrl },
      });

      if (response.success) {
        console.log('[Popup] Paper stored check result:', response.isStored);
        setIsPaperStored(response.isStored);
      } else {
        console.error('[Popup] Failed to check paper storage:', response.error);
        setIsPaperStored(false);
      }
    } catch (error) {
      console.error('[Popup] Error checking paper storage:', error);
      setIsPaperStored(false);
    }
  }

  async function handleInitializeAI() {
    try {
      setIsInitializing(true);
      setStatusMessage('Kuma is waking up...');

      const response = await chrome.runtime.sendMessage({
        type: MessageType.INITIALIZE_AI,
      });

      if (response.success) {
        setAiStatus('ready');
        setStatusMessage('Kuma is ready to help you with your research!');
        alert('Kuma is here! You can now use all features.');
      } else {
        alert(`Kuma didn\'t come. (Failed to initialize AI: ${response.message})`);
        setStatusMessage(response.message || 'Initialization failed');
      }
    } catch (error) {
      console.error('Kuma didn\'t come. (Initialization failed):', error);
      alert(`Kuma didn\'t come. (Failed to initialize AI. Please try again.)`);
      setStatusMessage('Kuma didn\'t come. (Initialization failed)');
    } finally {
      setIsInitializing(false);
    }
  }

  async function handleResetAI() {
    try {
      setIsResetting(true);
      setStatusMessage('Resetting AI...');

      const response = await chrome.runtime.sendMessage({
        type: MessageType.RESET_AI,
      });

      if (response.success) {
        // Re-check AI status after successful reset
        await checkAIStatus();
        alert(`✓ ${response.message}`);
      } else {
        alert(`⚠️ ${response.message}`);
        setStatusMessage(response.message || 'Reset failed');
      }
    } catch (error) {
      console.error('AI reset failed:', error);
      alert('❌ Failed to reset AI. Please try again or restart Chrome.');
      setStatusMessage('Reset failed');
    } finally {
      setIsResetting(false);
    }
  }

  async function handleDetectPaper() {
    try {
      setIsDetecting(true);
      setDetectionStatus('🐻 Kuma is foraging for research papers...');

      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

      if (!tab.id) {
        setDetectionStatus('❌ No active tab found');
        setTimeout(() => setDetectionStatus(null), 3000);
        setIsDetecting(false);
        return;
      }

      // Call background service to orchestrate the full flow
      // This will persist even if popup closes
      const response = await chrome.runtime.sendMessage({
        type: MessageType.START_DETECT_AND_EXPLAIN,
        payload: { tabId: tab.id },
      });

      // Response will come back after detection completes
      // But explanation/analysis will continue in background
      if (!response.success) {
        setDetectionStatus(`❌ ${response.error || 'Detection failed'}`);
        setTimeout(() => setDetectionStatus(null), 5000);
        setIsDetecting(false);
      }
      // If successful, state updates will come via OPERATION_STATE_CHANGED listener
    } catch (error: any) {
      console.error('Kuma didn\'t find any papers. (Detection failed):', error);

      // Handle content script not ready
      if (error.message?.includes('Receiving end does not exist')) {
        setDetectionStatus('⚠️ Content script not ready. Please refresh the page and try again.');
      } else {
        setDetectionStatus(`❌ Detection failed: ${error.message || String(error)}`);
      }

      setTimeout(() => setDetectionStatus(null), 5000);
      setIsDetecting(false);
    }
  }

  async function handleExplainPaper() {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

      if (!tab.id) {
        alert('Kuma couldn\'t find the active tab. (No active tab found)');
        return;
      }

      setIsExplaining(true);

      await chrome.tabs.sendMessage(tab.id, {
        type: MessageType.EXPLAIN_PAPER,
      });

      // Open sidepanel to show explanation
      await chrome.sidePanel.open({ tabId: tab.id });

      setIsExplaining(false);
    } catch (error) {
      console.error('Kuma had some trouble with the human tongue. (Explanation failed):', error);
      alert('Kuma had some trouble with the human tongue. (Failed to explain paper)');
      setIsExplaining(false);
    }
  }

  async function handleOpenSidepanel() {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

      if (tab.id) {
        await chrome.sidePanel.open({ tabId: tab.id });
      }
    } catch (error) {
      console.error('Failed to open sidepanel:', error);
    }
  }

  return (
    <div class="w-80 bg-gradient-to-br from-gray-50 to-gray-100">
      <div class="p-6">
        {/* Header */}
        <header class="mb-6 text-center">
          {/* Logo */}
          <div class="flex justify-center mb-4">
            <img
              src="/icons/icon128.png"
              alt="Kuma the Research Bear"
              class="w-16 h-16"
            />
          </div>

          <h1 class="text-2xl font-bold text-gray-800">Kuma the Research Bear</h1>
          <p class="text-sm text-gray-600 pt-2 font-light">AI-Powered Bear that helps you understand research papers</p>
        </header>

        {/* AI Status */}
        <div class="card mb-4">
          <div class="flex items-center gap-3">
            <span class={`status-dot ${aiStatus === 'ready' ? 'ready' : aiStatus === 'error' ? 'error' : ''}`} />
            <span class="text-sm text-gray-700">{statusMessage}</span>
          </div>

          {/* Initialize AI Button */}
          {aiStatus === 'needsInit' && (
            <button
              onClick={handleInitializeAI}
              disabled={isInitializing}
              class="btn btn-primary w-full mt-3 hover:cursor-pointer"
            >
              {isInitializing ? (
                <>
                  <Loader size={16} class="animate-spin" />
                  Kuma is waking up...
                </>
              ) : (
                <>
                  <PawPrint size={16} />
                  Wake Kuma up
                </>
              )}
            </button>
          )}

          {/* Downloading Status */}
          {aiStatus === 'downloading' && (
            <div class="mt-3 flex items-center gap-2 text-sm text-gray-600">
              <Loader size={16} class="animate-spin" />
              <span>Please wait while Kuma wakes up (AI model downloads)...</span>
            </div>
          )}

          {/* Error/Crashed Status */}
          {aiStatus === 'error' && aiAvailability === 'unavailable' && (
            <div class="mt-3 p-3 bg-yellow-50 border border-yellow-200 rounded text-xs">
              <p class="font-semibold text-yellow-800 mb-2">Kuma full asleep again. (AI Model Crashed)</p>

              {/* Try Reset First */}
              <button
                onClick={handleResetAI}
                disabled={isResetting}
                class="btn btn-primary w-full mb-3 text-xs hover:cursor-pointer"
              >
                {isResetting ? (
                  <>
                    <Loader size={14} class="animate-spin" />
                    Kuma is waking up...
                  </>
                ) : (
                  <>
                    <RefreshCw size={14} />
                    Try to wake Kuma up (Restart Extension)
                  </>
                )}
              </button>

              <p class="text-yellow-700 mb-2">If reset doesn't work, manually fix:</p>
              <ol class="list-decimal ml-4 text-yellow-700 space-y-1">
                <li>Open: <code class="bg-yellow-100 px-1">chrome://flags/#optimization-guide-on-device-model</code></li>
                <li>Set to "Enabled BypassPerfRequirement"</li>
                <li>Restart Chrome completely</li>
                <li>Reload this extension</li>
              </ol>
              <p class="mt-2 text-yellow-600">Note: Kuma still works using basic detection (arXiv, PubMed, etc.)</p>
            </div>
          )}
        </div>

        {/* Paper Info */}
        {paper && (
          <div class="card mb-4 bg-blue-50 border-blue-200">
            <div class="flex items-start justify-between gap-2 mb-2">
              <h3 class="text-sm font-semibold text-gray-700">Current Paper</h3>
              {isPaperStored && (
                <span class="px-2 py-1 text-xs font-medium rounded-full bg-green-100 text-green-700 flex items-center gap-1">
                  <Database size={10} />
                  Stored
                </span>
              )}
            </div>
            <p class="text-sm font-medium text-gray-900 mb-1 line-clamp-2">{paper.title}</p>
            <p class="text-xs text-gray-600 line-clamp-1">{paper.authors.join(', ')}</p>
          </div>
        )}

        {/* Detection Status */}
        {detectionStatus && (
          <div class="card mb-4 bg-blue-50 border-blue-200">
            <div class="flex items-center gap-2">
              {isDetecting && <Loader size={14} class="animate-spin bg-gradient-to-br text-blue-500" />}
              <p class="text-sm font-medium text-blue-900">{detectionStatus}</p>
            </div>
          </div>
        )}

        {/* Actions */}
        <div class="space-y-2">
          <button
            onClick={handleDetectPaper}
            disabled={aiStatus !== 'ready' || isDetecting}
            class="btn btn-primary w-full hover:cursor-pointer"
            title={aiStatus !== 'ready' ? 'Wake Kuma up' : isDetecting ? 'Detecting and explaining...' : 'Detect paper and automatically generate explanation'}
          >
            {isDetecting ? (
              <>
                <Loader size={16} class="animate-spin" />
                Detecting & Explaining...
              </>
            ) : (
              <>
                <Search size={16} />
                Detect & Explain Paper
              </>
            )}
          </button>

          {/* Explain Paper button removed - explanation now happens automatically after detection */}
          {/* <button
            onClick={handleExplainPaper}
            disabled={!paper || isExplaining || aiStatus !== 'ready'}
            class="btn btn-secondary w-full hover:cursor-pointer"
            title={aiStatus !== 'ready' ? 'Wake Kuma up' : ''}
          >
            <Sparkles size={16} />
            {isExplaining ? 'Explaining...' : 'Explain Paper'}
          </button> */}

          <button
            onClick={handleOpenSidepanel}
            class="btn btn-secondary w-full hover:cursor-pointer"
          >
            <PanelRight size={16} />
            Open Sidepanel
          </button>
        </div>

        {/* Settings */}
        {/* <div class="mt-4 flex justify-center">
          <button class="text-sm text-gray-500 hover:text-gray-700 flex items-center gap-1 hover:cursor-pointer">
            <Settings size={14} />
            Settings
          </button>
        </div> */}
      </div>
    </div>
  );
}
