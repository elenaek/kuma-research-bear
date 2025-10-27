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
 * Check for stored papers (no automatic detection)
 */
async function init() {
  console.log('[Content] Initializing content script...');

  try {
    // Only check IndexedDB for existing stored papers
    // No automatic detection - users must press "Detect Paper" button
    console.log('[Content] Checking IndexedDB for stored paper...');
    const { getPaperByUrl } = await import('../services/ChromeService.ts');
    const storedPaper = await getPaperByUrl(window.location.href);

    if (storedPaper) {
      currentPaper = storedPaper;
      console.log('[Content] ✓ Found stored paper in IndexedDB:', storedPaper.title);
    } else {
      console.log('[Content] No stored paper found. Use "Detect Paper" button to add papers.');
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

      // If deleted paper URL matches current page, clean up everything
      const currentPageUrl = normalizeUrl(window.location.href);
      const deletedPaperUrl = normalizeUrl(message.payload.paperUrl);
      if (deletedPaperUrl === currentPageUrl) {
        console.log('[Content] Current page paper was deleted, cleaning up...');

        // Destroy image buttons
        imageExplanationHandler.destroy();

        // Close chatbox and reset state
        await chatboxInjector.handlePaperDeletion();

        console.log('[Content] ✓ Cleanup complete');
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

            // Update chatbox paper context directly
            // This ensures chatbox.currentPaper is set for newly detected papers
            await chatboxInjector.updatePaperContext(storedPaper);
            console.log('[Content] ✓ Chatbox paper context updated');
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
 * Wait for page to be fully loaded (including images)
 */
async function waitForPageReady(): Promise<void> {
  // If document already loaded, resolve immediately
  if (document.readyState === 'complete') {
    return;
  }

  // Otherwise wait for load event
  return new Promise((resolve) => {
    window.addEventListener('load', () => resolve(), { once: true });
  });
}

/**
 * Wait for images in main content to be fully loaded with natural dimensions
 * This ensures detectImages() won't filter them out due to 0 width/height
 */
async function waitForImagesToLoad(): Promise<void> {
  console.log('[Content] Waiting for images to load...');

  // Find main content area (same logic as imageDetectionService)
  const MAIN_CONTENT_SELECTORS = [
    'main', 'article', '[role="main"]', '.content', '.article-content',
    '.paper-content', '#content', '#main', '.main-content',
    '#abs', '.ltx_page_main', '.article-details', '.full-text',
    '.article', '.highwire-article',
  ];

  let mainContent: HTMLElement | null = null;
  for (const selector of MAIN_CONTENT_SELECTORS) {
    const element = document.querySelector(selector);
    if (element) {
      mainContent = element as HTMLElement;
      break;
    }
  }

  if (!mainContent) {
    mainContent = document.body;
  }

  // Get all images in main content
  const images = Array.from(mainContent.querySelectorAll('img'));
  console.log('[Content] Found', images.length, 'images to wait for');

  if (images.length === 0) {
    console.log('[Content] No images found, skipping wait');
    return;
  }

  // Wait for each image to be loaded (with timeout)
  const imagePromises = images.map((img) => {
    return new Promise<void>((resolve) => {
      // If image is already loaded with natural dimensions, resolve immediately
      if (img.complete && img.naturalWidth > 0) {
        resolve();
        return;
      }

      // Set up timeout (5 seconds per image)
      const timeout = setTimeout(() => {
        console.log('[Content] Image load timeout:', img.src);
        resolve(); // Resolve anyway to not block forever
      }, 5000);

      // Wait for load event
      img.addEventListener('load', () => {
        clearTimeout(timeout);
        resolve();
      }, { once: true });

      // Handle errors
      img.addEventListener('error', () => {
        clearTimeout(timeout);
        console.log('[Content] Image load error:', img.src);
        resolve(); // Resolve anyway to continue
      }, { once: true });
    });
  });

  // Wait for all images (or timeouts)
  await Promise.all(imagePromises);
  console.log('[Content] ✓ All images loaded or timed out');
}

/**
 * Initialize image explanation buttons for already-chunked papers
 * This handles the case where extension is reloaded on a page with an existing paper
 *
 * IMPORTANT: Must be called AFTER page is fully loaded so images are ready
 */
async function initializeImageButtonsForStoredPaper() {
  console.log('[Content] Checking if image buttons should be initialized for stored paper...');

  // Wait for page to be fully loaded
  await waitForPageReady();
  console.log('[Content] Page fully loaded');

  // CRITICAL: Wait for images to actually load their natural dimensions
  // Without this, detectImages() will filter them out as "too small"
  await waitForImagesToLoad();
  console.log('[Content] Images fully loaded, proceeding with image button check');

  // Check if we have a current paper
  if (!currentPaper) {
    console.log('[Content] No current paper, skipping image button initialization');
    return;
  }

  // Fetch the stored paper from database
  const { getPaperByUrl } = await import('../services/ChromeService.ts');
  const storedPaper = await getPaperByUrl(currentPaper.url);

  // If paper is stored and has chunks, initialize image buttons
  if (storedPaper && storedPaper.chunkCount && storedPaper.chunkCount > 0) {
    console.log('[Content] Paper already chunked, initializing image buttons');
    await imageExplanationHandler.initialize(storedPaper);
    console.log('[Content] ✓ Image buttons initialized for already-chunked paper');
  } else {
    console.log('[Content] Paper not yet chunked, image buttons will be initialized when chunking completes');
  }
}

/**
 * Note: Image explanation handler can be initialized in two ways:
 * 1. For newly detected papers: via OPERATION_STATE_CHANGED message when imageExplanationReady becomes true
 * 2. For already-chunked papers (e.g., after extension reload): via initializeImageButtonsForStoredPaper()
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

  // BUG FIX: Initialize image buttons for already-chunked papers (e.g., after extension reload)
  // This waits for page load internally to ensure images are ready
  // MUST run BEFORE restoreTabs() so image states exist for tab restoration
  await initializeImageButtonsForStoredPaper();
  console.log('[Content] ✓ Image buttons initialized');

  // Restore chatbox tabs (depends on image buttons being created first)
  await chatboxInjector.restoreTabs();
  console.log('[Content] ✓ Tabs restored');

  console.log('[Content] ✓ Content script initialized successfully');
})();
