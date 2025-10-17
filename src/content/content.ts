import { MessageType, ResearchPaper } from '../types/index.ts';
import { detectPaper, detectPaperWithAI } from '../utils/paperDetectors.ts';
import { extractPageText } from '../utils/contentExtractor.ts';

// Helper functions to communicate with background worker for IndexedDB operations
async function storePaperInDB(paper: ResearchPaper, fullText?: string): Promise<any> {
  const response = await chrome.runtime.sendMessage({
    type: MessageType.STORE_PAPER_IN_DB,
    payload: { paper, fullText },
  });
  return response;
}

async function isPaperStoredInDB(url: string): Promise<boolean> {
  const response = await chrome.runtime.sendMessage({
    type: MessageType.IS_PAPER_STORED_IN_DB,
    payload: { url },
  });
  return response.isStored;
}

async function getPaperByUrlFromDB(url: string): Promise<any> {
  const response = await chrome.runtime.sendMessage({
    type: MessageType.GET_PAPER_FROM_DB_BY_URL,
    payload: { url },
  });
  return response.paper;
}

let currentPaper: ResearchPaper | null = null;

// Auto-detect paper on page load
async function init() {
  try {
    currentPaper = await detectPaper();

    if (currentPaper) {
      console.log('Research paper detected:', currentPaper.title);
      // Store in chrome storage for access by other components
      await chrome.storage.local.set({ currentPaper });

      // Store in IndexedDB via background worker if not already stored
      try {
        const alreadyStored = await isPaperStoredInDB(currentPaper.url);
        if (!alreadyStored) {
          console.log('[Content] Storing paper in IndexedDB via background worker...');
          // Extract full text in content script (where document is available)
          const extractedContent = extractPageText();
          const storeResult = await storePaperInDB(currentPaper, extractedContent.text);
          if (storeResult.success) {
            console.log('[Content] ✓ Paper stored locally for offline access');
          } else {
            console.error('[Content] Failed to store paper:', storeResult.error);
          }
        } else {
          console.log('[Content] Paper already stored in IndexedDB');
        }
      } catch (dbError) {
        console.warn('[Content] Failed to store paper in IndexedDB:', dbError);
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
            console.log('[Content] Paper detected, preparing to store:', {
              title: currentPaper.title,
              url: currentPaper.url,
              source: currentPaper.source
            });

            try {
              alreadyStored = await isPaperStoredInDB(currentPaper.url);
              console.log('[Content] isPaperStored check result:', alreadyStored);

              if (!alreadyStored) {
                console.log('[Content] Storing paper in IndexedDB via background worker...');
                // Extract full text in content script (where document is available)
                const extractedContent = extractPageText();
                const storeResult = await storePaperInDB(currentPaper, extractedContent.text);

                if (storeResult.success) {
                  const storedPaper = storeResult.paper;
                  console.log('[Content] ✓ Paper stored successfully!', {
                    id: storedPaper.id,
                    chunkCount: storedPaper.chunkCount,
                    storedAt: new Date(storedPaper.storedAt).toLocaleString()
                  });
                  stored = true;
                  chunkCount = storedPaper.chunkCount;
                  alreadyStored = false;
                } else {
                  console.error('[Content] Failed to store paper:', storeResult.error);
                  stored = false;
                  storageError = storeResult.error;
                }
              } else {
                console.log('[Content] Paper already stored, fetching existing data...');
                const existingPaper = await getPaperByUrlFromDB(currentPaper.url);
                console.log('[Content] Existing paper retrieved:', {
                  id: existingPaper?.id,
                  chunkCount: existingPaper?.chunkCount
                });
                stored = true;
                chunkCount = existingPaper?.chunkCount || 0;
                alreadyStored = true;
              }
            } catch (dbError) {
              // Capture detailed error message for debugging
              console.error('[Content] ❌ Failed to store paper in IndexedDB:', {
                error: dbError,
                stack: dbError instanceof Error ? dbError.stack : undefined,
                paperUrl: currentPaper.url
              });
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

          // Store in IndexedDB via background worker
          try {
            const alreadyStored = await isPaperStoredInDB(currentPaper.url);
            if (!alreadyStored) {
              // Extract full text in content script (where document is available)
              const extractedContent = extractPageText();
              const storeResult = await storePaperInDB(currentPaper, extractedContent.text);
              if (storeResult.success) {
                console.log('[Content] ✓ Paper stored locally');
              } else {
                console.error('[Content] Failed to store paper:', storeResult.error);
              }
            }
          } catch (dbError) {
            console.warn('[Content] Failed to store paper in IndexedDB:', dbError);
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
