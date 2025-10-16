import { useState, useEffect } from 'preact/hooks';
import { Search, Sparkles, PanelRight, Settings } from 'lucide-preact';
import { MessageType, ResearchPaper } from '../types/index.ts';

export function Popup() {
  const [aiStatus, setAiStatus] = useState<'checking' | 'ready' | 'error'>('checking');
  const [statusMessage, setStatusMessage] = useState('Checking AI availability...');
  const [paper, setPaper] = useState<ResearchPaper | null>(null);
  const [isExplaining, setIsExplaining] = useState(false);

  // Check AI availability on mount
  useEffect(() => {
    checkAIStatus();
    checkCurrentPaper();
  }, []);

  async function checkAIStatus() {
    try {
      const response = await chrome.runtime.sendMessage({
        type: MessageType.AI_STATUS,
      });

      if (response.available) {
        setAiStatus('ready');
        setStatusMessage('AI Ready');
      } else {
        setAiStatus('error');
        setStatusMessage('AI not available. Enable Chrome AI flags.');
      }
    } catch (error) {
      setAiStatus('error');
      setStatusMessage('Error checking AI status');
      console.error('AI status check failed:', error);
    }
  }

  async function checkCurrentPaper() {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab.id) return;

      const response = await chrome.tabs.sendMessage(tab.id, {
        type: MessageType.DETECT_PAPER,
      });

      if (response?.paper) {
        setPaper(response.paper);
      }
    } catch (error) {
      // Content script might not be loaded yet
      console.log('Content script not ready:', error);
    }
  }

  async function handleDetectPaper() {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

      if (!tab.id) {
        alert('No active tab found');
        return;
      }

      const response = await chrome.tabs.sendMessage(tab.id, {
        type: MessageType.DETECT_PAPER,
      });

      if (response.paper) {
        setPaper(response.paper);
        // Store current paper in storage
        await chrome.storage.local.set({ currentPaper: response.paper });
      } else {
        alert('No research paper detected on this page');
      }
    } catch (error) {
      console.error('Paper detection failed:', error);
      alert('Failed to detect paper. Make sure you\'re on a research paper page.');
    }
  }

  async function handleExplainPaper() {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

      if (!tab.id) {
        alert('No active tab found');
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
      console.error('Explanation failed:', error);
      alert('Failed to explain paper');
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
        <header class="mb-6">
          <h1 class="text-2xl font-bold text-gray-800">Kuma the Research Bear</h1>
          <p class="text-sm text-gray-600">AI-Powered Paper Explainer</p>
        </header>

        {/* AI Status */}
        <div class="card mb-4">
          <div class="flex items-center gap-3">
            <span class={`status-dot ${aiStatus === 'ready' ? 'ready' : aiStatus === 'error' ? 'error' : ''}`} />
            <span class="text-sm text-gray-700">{statusMessage}</span>
          </div>
        </div>

        {/* Paper Info */}
        {paper && (
          <div class="card mb-4 bg-blue-50 border-blue-200">
            <h3 class="text-sm font-semibold text-gray-700 mb-2">Current Paper</h3>
            <p class="text-sm font-medium text-gray-900 mb-1 line-clamp-2">{paper.title}</p>
            <p class="text-xs text-gray-600 line-clamp-1">{paper.authors.join(', ')}</p>
          </div>
        )}

        {/* Actions */}
        <div class="space-y-2">
          <button
            onClick={handleDetectPaper}
            disabled={aiStatus !== 'ready'}
            class="btn btn-primary w-full"
          >
            <Search size={16} />
            Detect Paper
          </button>

          <button
            onClick={handleExplainPaper}
            disabled={!paper || isExplaining}
            class="btn btn-secondary w-full"
          >
            <Sparkles size={16} />
            {isExplaining ? 'Explaining...' : 'Explain Paper'}
          </button>

          <button
            onClick={handleOpenSidepanel}
            class="btn btn-secondary w-full"
          >
            <PanelRight size={16} />
            Open Sidepanel
          </button>
        </div>

        {/* Settings */}
        <div class="mt-4 flex justify-center">
          <button class="text-sm text-gray-500 hover:text-gray-700 flex items-center gap-1">
            <Settings size={14} />
            Settings
          </button>
        </div>
      </div>
    </div>
  );
}
