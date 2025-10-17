import { MessageType, ResearchPaper } from '../types/index.ts';
import { detectPaper, detectPaperWithAI } from '../utils/paperDetectors.ts';
import { storePaper, isPaperStored } from '../utils/dbService.ts';

let currentPaper: ResearchPaper | null = null;

// Auto-detect paper on page load
async function init() {
  try {
    currentPaper = await detectPaper();

    if (currentPaper) {
      console.log('Research paper detected:', currentPaper.title);
      // Store in chrome storage for access by other components
      await chrome.storage.local.set({ currentPaper });

      // Store in IndexedDB if not already stored
      try {
        const alreadyStored = await isPaperStored(currentPaper.url);
        if (!alreadyStored) {
          console.log('Storing paper in IndexedDB...');
          await storePaper(currentPaper);
          console.log('✓ Paper stored locally for offline access');
        } else {
          console.log('Paper already stored in IndexedDB');
        }
      } catch (dbError) {
        console.warn('Failed to store paper in IndexedDB:', dbError);
        // Don't fail the whole detection if storage fails
      }
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

          // Store in IndexedDB if detected
          let stored = false;
          let chunkCount = 0;
          let alreadyStored = false;
          let storageError: string | undefined;

          if (currentPaper) {
            try {
              alreadyStored = await isPaperStored(currentPaper.url);
              if (!alreadyStored) {
                console.log('Storing paper in IndexedDB...');
                const storedPaper = await storePaper(currentPaper);
                console.log('✓ Paper stored locally for offline access');
                stored = true;
                chunkCount = storedPaper.chunkCount;
              } else {
                console.log('Paper already stored in IndexedDB');
                // Get chunk count for already stored paper
                const existingPaper = await (await import('../utils/dbService.ts')).getPaperByUrl(currentPaper.url);
                stored = true;
                chunkCount = existingPaper?.chunkCount || 0;
              }
            } catch (dbError) {
              // Capture detailed error message for debugging
              console.error('Failed to store paper in IndexedDB:', dbError);
              stored = false;

              // Extract error message
              if (dbError instanceof Error) {
                storageError = dbError.message;
              } else {
                storageError = String(dbError);
              }
            }
          }

          sendResponse({
            paper: currentPaper,
            stored,
            chunkCount,
            alreadyStored,
            storageError
          });
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

          // Store in IndexedDB
          try {
            const alreadyStored = await isPaperStored(currentPaper.url);
            if (!alreadyStored) {
              await storePaper(currentPaper);
              console.log('✓ Paper stored locally');
            }
          } catch (dbError) {
            console.warn('Failed to store paper in IndexedDB:', dbError);
          }
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
