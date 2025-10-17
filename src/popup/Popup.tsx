import { useState, useEffect } from 'preact/hooks';
import { Search, Sparkles, PanelRight, Settings, Download, Loader, PawPrint } from 'lucide-preact';
import { MessageType, ResearchPaper, AIAvailability } from '../types/index.ts';

export function Popup() {
  const [aiStatus, setAiStatus] = useState<'checking' | 'ready' | 'needsInit' | 'downloading' | 'error'>('checking');
  const [aiAvailability, setAiAvailability] = useState<AIAvailability>('no');
  const [statusMessage, setStatusMessage] = useState('Checking AI availability...');
  const [paper, setPaper] = useState<ResearchPaper | null>(null);
  const [isExplaining, setIsExplaining] = useState(false);
  const [isInitializing, setIsInitializing] = useState(false);
  const [isDetecting, setIsDetecting] = useState(false);
  const [detectionStatus, setDetectionStatus] = useState<string | null>(null);

  // Check AI availability on mount
  useEffect(() => {
    checkAIStatus();
  }, []);

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
      console.error('Kuma status check failed:', error);
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


  async function handleDetectPaper() {
    try {
      setIsDetecting(true);
      setDetectionStatus('Checking for paper...');

      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

      if (!tab.id) {
        setDetectionStatus('❌ No active tab found');
        setTimeout(() => setDetectionStatus(null), 3000);
        setIsDetecting(false);
        return;
      }

      // Update status for AI extraction phase
      setDetectionStatus('🐻 Kuma is foraging for research papers...');

      let response;
      try {
        response = await chrome.tabs.sendMessage(tab.id, {
          type: MessageType.DETECT_PAPER,
        });
      } catch (msgError: any) {
        // Handle content script not ready
        if (msgError.message?.includes('Receiving end does not exist')) {
          setDetectionStatus('⚠️ Content script not ready. Please refresh the page and try again.');
        } else {
          setDetectionStatus(`❌ Detection failed: ${msgError.message || String(msgError)}`);
        }
        setTimeout(() => setDetectionStatus(null), 5000);
        return;
      }

      if (response.paper) {
        setPaper(response.paper);
        // Store current paper in storage
        await chrome.storage.local.set({ currentPaper: response.paper });

        // Show storage status based on response
        const source = response.paper.source.replace('-', ' ');

        if (response.stored) {
          if (response.alreadyStored) {
            // Paper was already stored
            setDetectionStatus(`✅ Paper found (already stored with ${response.chunkCount} chunks)`);
          } else {
            // Newly stored paper
            setDetectionStatus(`✅ Paper found and stored! (${response.chunkCount} chunks ready for Q&A)`);
          }
        } else {
          // Paper found but storage failed - show specific error
          console.log(response);
          const errorMsg = response.storageError || 'Unknown error';
          setDetectionStatus(`⚠️ Storage failed: ${errorMsg}`);
        }

        setTimeout(() => setDetectionStatus(null), 5000);
      } else {
        setDetectionStatus('❌ No paper detected on this page');
        setTimeout(() => setDetectionStatus(null), 4000);
      }
    } catch (error) {
      console.error('Kuma didn\'t find any papers. (Detection failed):', error);
      setDetectionStatus('❌ Kuma didn\'t find any papers. (Detection failed)');
      setTimeout(() => setDetectionStatus(null), 4000);
    } finally {
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
              <span>Please wait while AI model downloads...</span>
            </div>
          )}

          {/* Error/Crashed Status */}
          {aiStatus === 'error' && aiAvailability === 'unavailable' && (
            <div class="mt-3 p-3 bg-yellow-50 border border-yellow-200 rounded text-xs">
              <p class="font-semibold text-yellow-800 mb-2">AI Model Crashed</p>
              <p class="text-yellow-700 mb-2">Chrome's AI has crashed. To fix:</p>
              <ol class="list-decimal ml-4 text-yellow-700 space-y-1">
                <li>Open: <code class="bg-yellow-100 px-1">chrome://flags/#optimization-guide-on-device-model</code></li>
                <li>Set to "Enabled BypassPerfRequirement"</li>
                <li>Restart Chrome completely</li>
                <li>Reload this extension</li>
              </ol>
              <p class="mt-2 text-yellow-600">Note: Extension still works using basic detection (arXiv, PubMed, etc.)</p>
            </div>
          )}
        </div>

        {/* Paper Info */}
        {paper && (
          <div class="card mb-4 bg-blue-50 border-blue-200">
            <h3 class="text-sm font-semibold text-gray-700 mb-2">Current Paper</h3>
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
            title={aiStatus !== 'ready' ? 'Wake Kuma up' : isDetecting ? 'Detection in progress...' : ''}
          >
            {isDetecting ? (
              <>
                <Loader size={16} class="animate-spin" />
                Detecting...
              </>
            ) : (
              <>
                <Search size={16} />
                Detect Paper
              </>
            )}
          </button>

          <button
            onClick={handleExplainPaper}
            disabled={!paper || isExplaining || aiStatus !== 'ready'}
            class="btn btn-secondary w-full hover:cursor-pointer"
            title={aiStatus !== 'ready' ? 'Wake Kuma up' : ''}
          >
            <Sparkles size={16} />
            {isExplaining ? 'Explaining...' : 'Explain Paper'}
          </button>

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
