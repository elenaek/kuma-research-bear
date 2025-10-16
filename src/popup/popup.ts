import { MessageType, AICapabilities } from '../types/index.ts';

// DOM elements
const statusDot = document.getElementById('status-dot') as HTMLElement;
const statusText = document.getElementById('status-text') as HTMLElement;
const paperInfo = document.getElementById('paper-info') as HTMLElement;
const paperTitle = document.getElementById('paper-title') as HTMLElement;
const paperAuthors = document.getElementById('paper-authors') as HTMLElement;
const detectBtn = document.getElementById('detect-btn') as HTMLButtonElement;
const explainBtn = document.getElementById('explain-btn') as HTMLButtonElement;
const sidepanelBtn = document.getElementById('sidepanel-btn') as HTMLButtonElement;

// Check AI availability on load
async function checkAIStatus() {
  try {
    const response = await chrome.runtime.sendMessage({
      type: MessageType.AI_STATUS,
    });

    if (response.available) {
      statusDot.classList.add('ready');
      statusText.textContent = 'AI Ready';
      detectBtn.disabled = false;
    } else {
      statusDot.classList.add('error');
      statusText.textContent = 'AI not available. Enable Chrome AI flags.';
    }
  } catch (error) {
    statusDot.classList.add('error');
    statusText.textContent = 'Error checking AI status';
    console.error('AI status check failed:', error);
  }
}

// Detect paper on current page
detectBtn.addEventListener('click', async () => {
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
      paperInfo.classList.remove('hidden');
      paperTitle.textContent = response.paper.title;
      paperAuthors.textContent = response.paper.authors.join(', ');
      explainBtn.disabled = false;

      // Store current paper in storage
      await chrome.storage.local.set({ currentPaper: response.paper });
    } else {
      alert('No research paper detected on this page');
    }
  } catch (error) {
    console.error('Paper detection failed:', error);
    alert('Failed to detect paper. Make sure you\'re on a research paper page.');
  }
});

// Explain paper
explainBtn.addEventListener('click', async () => {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

    if (!tab.id) {
      alert('No active tab found');
      return;
    }

    explainBtn.textContent = 'Explaining...';
    explainBtn.disabled = true;

    await chrome.tabs.sendMessage(tab.id, {
      type: MessageType.EXPLAIN_PAPER,
    });

    // Open sidepanel to show explanation
    await chrome.sidePanel.open({ tabId: tab.id });

    explainBtn.textContent = 'Explain Paper';
    explainBtn.disabled = false;
  } catch (error) {
    console.error('Explanation failed:', error);
    alert('Failed to explain paper');
    explainBtn.textContent = 'Explain Paper';
    explainBtn.disabled = false;
  }
});

// Open sidepanel
sidepanelBtn.addEventListener('click', async () => {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

    if (tab.id) {
      await chrome.sidePanel.open({ tabId: tab.id });
    }
  } catch (error) {
    console.error('Failed to open sidepanel:', error);
  }
});

// Initialize
checkAIStatus();

// Check if current page has a paper
chrome.tabs.query({ active: true, currentWindow: true }, async (tabs) => {
  const tab = tabs[0];
  if (tab.id) {
    try {
      const response = await chrome.tabs.sendMessage(tab.id, {
        type: MessageType.DETECT_PAPER,
      });

      if (response && response.paper) {
        paperInfo.classList.remove('hidden');
        paperTitle.textContent = response.paper.title;
        paperAuthors.textContent = response.paper.authors.join(', ');
        explainBtn.disabled = false;
      }
    } catch (error) {
      // Content script might not be loaded yet
      console.log('Content script not ready:', error);
    }
  }
});
