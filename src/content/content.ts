import { ResearchPaper } from '../types/index.ts';
import { detectAndStorePaper } from './services/paperDetectionService.ts';
import { createMessageRouter } from './handlers/messageHandlers.ts';
import { createMutationObserver, startObserving } from './handlers/mutationHandler.ts';
import { chatboxInjector } from './services/chatboxInjector.ts';
import { textSelectionHandler } from './services/textSelectionHandler.ts';
import { imageExplanationHandler } from './services/imageExplanationHandler.ts';
import { normalizeUrl } from '../utils/urlUtils.ts';

/**
 * Content Script
 * Orchestrates paper detection, storage, and message handling
 */

// State management
let currentPaper: ResearchPaper | null = null;

// Getter and setter for currentPaper (used by handlers)
function getCurrentPaper(): ResearchPaper | null {
  return currentPaper;
}

function setCurrentPaper(paper: ResearchPaper | null): void {
  currentPaper = paper;
}

/**
 * Initialize content script
 * Auto-detect paper on page load
 */
async function init() {
  console.log('[Content] Initializing content script...');

  try {
    currentPaper = await detectAndStorePaper();

    if (currentPaper) {
      console.log('[Content] ✓ Research paper detected on page load:', currentPaper.title);
    } else {
      console.log('[Content] No research paper detected on this page');
    }
  } catch (error) {
    console.error('[Content] Error during initialization:', error);
  }
}

/**
 * Set up message listener
 * Routes messages to appropriate handlers
 */
function setupMessageListener() {
  const messageRouter = createMessageRouter(getCurrentPaper);
  chrome.runtime.onMessage.addListener(messageRouter);

  // Listen for paper deletion and chunking completion
  chrome.runtime.onMessage.addListener(async (message, sender, sendResponse) => {
    // Handle paper deletion
    if (message.type === 'PAPER_DELETED') {
      console.log('[Content] Paper deleted:', message.payload);

      // If deleted paper URL matches current page, destroy image buttons
      const currentPageUrl = normalizeUrl(window.location.href);
      const deletedPaperUrl = normalizeUrl(message.payload.paperUrl);
      if (deletedPaperUrl === currentPageUrl) {
        console.log('[Content] Current page paper was deleted, removing image buttons');
        imageExplanationHandler.destroy();
      }
    }

    // Handle operation state changes
    if (message.type === 'OPERATION_STATE_CHANGED') {
      const state = message.payload.state;

      const currentPageUrl = normalizeUrl(window.location.href);
      const statePaperUrl = state.currentPaper?.url ? normalizeUrl(state.currentPaper.url) : null;

      // Only process state changes for the current page
      if (statePaperUrl === currentPageUrl) {
        // Initialize image explanation buttons when imageExplanationReady becomes true
        if (state.imageExplanationReady) {
          console.log('[Content] Image explanations ready, initializing image buttons');

          // Get fresh paper data from DB
          const { getPaperFromDBByUrl } = await import('../services/ChromeService.ts');
          const storedPaper = await getPaperFromDBByUrl(currentPageUrl);

          if (storedPaper && storedPaper.id) {
            // imageExplanationHandler.initialize() will check if already initialized and skip if so
            await imageExplanationHandler.initialize(storedPaper);
            console.log('[Content] ✓ Image buttons initialized after embeddings complete');
          }
        }
      }
    }
  });

  console.log('[Content] Message listener registered');
}

/**
 * Set up mutation observer
 * Re-detects papers when page content changes (useful for SPAs)
 */
function setupMutationObserver() {
  const observer = createMutationObserver(getCurrentPaper, setCurrentPaper);
  startObserving(observer);
}

/**
 * Initialize chatbox
 * Sets up the floating chatbox UI
 */
async function setupChatbox() {
  try {
    await chatboxInjector.initialize();
    console.log('[Content] ✓ Chatbox initialized');
  } catch (error) {
    console.error('[Content] Error initializing chatbox:', error);
  }
}

/**
 * Initialize text selection handler
 * Sets up the "Ask Kuma" button for text selection
 */
async function setupTextSelection() {
  try {
    await textSelectionHandler.initialize(chatboxInjector);
    console.log('[Content] ✓ Text selection handler initialized');
  } catch (error) {
    console.error('[Content] Error initializing text selection handler:', error);
  }
}

/**
 * Note: Image explanation handler is no longer initialized via a dedicated function
 * It will be initialized dynamically when imageExplanationReady becomes true
 * via the OPERATION_STATE_CHANGED message listener
 */

/**
 * Bootstrap the content script
 */
(async () => {
  // Initialize paper detection
  await init();

  // Set up message handling
  setupMessageListener();

  // Set up mutation observer for SPA detection
  setupMutationObserver();

  // Initialize chatbox
  await setupChatbox();

  // Initialize text selection handler (depends on chatbox)
  await setupTextSelection();

  // Note: Image explanation handler is no longer initialized on page load
  // It will be initialized when imageExplanationReady becomes true (after embeddings complete)
  // This happens via the OPERATION_STATE_CHANGED message listener

  // Restore chatbox tabs AFTER page load
  await chatboxInjector.restoreTabs();
  console.log('[Content] ✓ Tabs restored');

  console.log('[Content] ✓ Content script initialized successfully');
})();
