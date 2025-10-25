import { ResearchPaper } from '../types/index.ts';
import { detectAndStorePaper } from './services/paperDetectionService.ts';
import { createMessageRouter } from './handlers/messageHandlers.ts';
import { createMutationObserver, startObserving } from './handlers/mutationHandler.ts';
import { chatboxInjector } from './services/chatboxInjector.ts';
import { textSelectionHandler } from './services/textSelectionHandler.ts';
import { imageExplanationHandler } from './services/imageExplanationHandler.ts';

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
 * Initialize image explanation handler
 * Sets up AI-powered image explanations for figures in papers
 */
async function setupImageExplanations() {
  try {
    // Query IndexedDB directly using current URL
    const { getPaperFromDBByUrl } = await import('../services/ChromeService.ts');
    const storedPaper = await getPaperFromDBByUrl(window.location.href);

    if (storedPaper && storedPaper.id) {
      await imageExplanationHandler.initialize(storedPaper);
      console.log('[Content] ✓ Image explanation handler initialized for paper:', storedPaper.title);
    } else {
      console.log('[Content] Skipping image explanation handler (no stored paper for this URL)');
    }
  } catch (error) {
    console.error('[Content] Error initializing image explanation handler:', error);
  }
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

  // Initialize chatbox
  await setupChatbox();

  // Initialize text selection handler (depends on chatbox)
  await setupTextSelection();

  // Initialize image explanation handler (depends on paper detection)
  await setupImageExplanations();

  // Restore chatbox tabs AFTER image buttons are created
  await chatboxInjector.restoreTabs();
  console.log('[Content] ✓ Tabs restored');

  console.log('[Content] ✓ Content script initialized successfully');
})();
