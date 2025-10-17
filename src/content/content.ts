import { MessageType, ResearchPaper } from '../types/index.ts';
import { detectPaper, detectPaperWithAI } from '../utils/paperDetectors.ts';

let currentPaper: ResearchPaper | null = null;

// Auto-detect paper on page load
async function init() {
  try {
    currentPaper = await detectPaper();

    if (currentPaper) {
      console.log('Research paper detected:', currentPaper.title);
      // Store in chrome storage for access by other components
      await chrome.storage.local.set({ currentPaper });
    } else {
      console.log('No research paper detected on this page');
    }
  } catch (error) {
    console.error('Error during paper detection:', error);
  }
}

// Listen for messages from popup/background
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // Handle async operations properly
  (async () => {
    try {
      switch (message.type) {
        case MessageType.DETECT_PAPER:
          // Manual detection uses AI-first approach
          currentPaper = await detectPaperWithAI();
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
    } catch (error) {
      console.error('Error handling message:', error);
      sendResponse({ success: false, error: String(error) });
    }
  })();

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
    // Use async detection
    (async () => {
      try {
        currentPaper = await detectPaper();
        if (currentPaper) {
          await chrome.storage.local.set({ currentPaper });
          console.log('Paper detected after page mutation:', currentPaper.title);
        }
      } catch (error) {
        console.error('Error detecting paper after mutation:', error);
      }
    })();
  }
});

observer.observe(document.body, {
  childList: true,
  subtree: true,
});
