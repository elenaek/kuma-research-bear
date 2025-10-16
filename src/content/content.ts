import { MessageType, ResearchPaper } from '../types/index.ts';
import { detectPaper } from '../utils/paperDetectors.ts';

let currentPaper: ResearchPaper | null = null;

// Auto-detect paper on page load
function init() {
  currentPaper = detectPaper();

  if (currentPaper) {
    console.log('Research paper detected:', currentPaper.title);
    // Store in chrome storage for access by other components
    chrome.storage.local.set({ currentPaper });
  }
}

// Listen for messages from popup/background
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  switch (message.type) {
    case MessageType.DETECT_PAPER:
      currentPaper = detectPaper();
      sendResponse({ paper: currentPaper });
      break;

    case MessageType.EXPLAIN_PAPER:
      if (currentPaper) {
        // Send paper to background for explanation
        chrome.runtime.sendMessage({
          type: MessageType.EXPLAIN_PAPER,
          payload: { paper: currentPaper },
        });
        sendResponse({ success: true });
      } else {
        sendResponse({ success: false, error: 'No paper detected' });
      }
      break;

    case MessageType.EXPLAIN_SECTION:
      // Handle section explanation
      chrome.runtime.sendMessage({
        type: MessageType.EXPLAIN_SECTION,
        payload: message.payload,
      });
      sendResponse({ success: true });
      break;

    default:
      sendResponse({ success: false, error: 'Unknown message type' });
  }

  return true; // Keep message channel open for async response
});

// Initialize on page load
init();

// Re-detect on dynamic page changes (for SPAs)
const observer = new MutationObserver((mutations) => {
  const significantChange = mutations.some(
    mutation => mutation.addedNodes.length > 0 || mutation.removedNodes.length > 0
  );

  if (significantChange && !currentPaper) {
    currentPaper = detectPaper();
    if (currentPaper) {
      chrome.storage.local.set({ currentPaper });
    }
  }
});

observer.observe(document.body, {
  childList: true,
  subtree: true,
});
