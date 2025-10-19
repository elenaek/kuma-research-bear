import { ResearchPaper } from '../types/index.ts';
import { detectAndStorePaper } from './services/paperDetectionService.ts';
import { createMessageRouter } from './handlers/messageHandlers.ts';
import { createMutationObserver, startObserving } from './handlers/mutationHandler.ts';

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
 * Bootstrap the content script
 */
(async () => {
  // Initialize paper detection
  await init();

  // Set up message handling
  setupMessageListener();

  // Set up mutation observer for SPA detection
  setupMutationObserver();

  console.log('[Content] ✓ Content script initialized successfully');
})();
