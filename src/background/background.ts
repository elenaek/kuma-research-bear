/**
 * Background Service Worker
 *
 * Main orchestrator for the Kuma Research Bear extension.
 * Handles message routing between content scripts, sidepanel, and popup.
 *
 * Architecture:
 * - Services: State management, icons, request deduplication
 * - Handlers: AI operations, database operations, state queries, UI actions
 * - Orchestrators: Complex multi-phase workflows
 * - Utils: Tab lifecycle management, message routing
 */

import { MessageType } from '../types/index.ts';
import { registerTabLifecycleHandlers } from './utils/tabLifecycleHandlers.ts';
import { tabPaperTracker } from './services/tabPaperTracker.ts';
import * as operationStateService from './services/operationStateService.ts';
import * as dbHandlers from './handlers/dbHandlers.ts';
import * as aiHandlers from './handlers/aiHandlers.ts';
import * as stateHandlers from './handlers/stateHandlers.ts';
import * as uiHandlers from './handlers/uiHandlers.ts';
import * as chatHandlers from './handlers/chatHandlers.ts';
import * as citationHandlers from './handlers/citationHandlers.ts';
import { executeDetectAndExplainFlow } from './orchestrators/detectAndExplainOrchestrator.ts';
import { inputQuotaService } from '../utils/inputQuotaService.ts';
import { getShowImageButtons, setShowImageButtons } from '../utils/settingsService.ts';
import { logger } from '../utils/logger.ts';

// Download progress state storage (for popup state reinitialization)
// Uses chrome.storage.local to persist across service worker restarts
const STORAGE_KEY_DOWNLOAD_PROGRESS = 'downloadProgress';
const STORAGE_KEY_DOWNLOADING_MODEL = 'downloadingModel';

// Getter for download progress state (exported for handlers)
export async function getDownloadProgressState() {
  try {
    const result = await chrome.storage.local.get([
      STORAGE_KEY_DOWNLOAD_PROGRESS,
      STORAGE_KEY_DOWNLOADING_MODEL
    ]);

    return {
      downloadProgress: result[STORAGE_KEY_DOWNLOAD_PROGRESS] || 0,
      currentDownloadingModel: result[STORAGE_KEY_DOWNLOADING_MODEL] || null
    };
  } catch (error) {
    logger.error('BACKGROUND_SCRIPT', '[Background] Failed to read download progress from storage:', error);
    return {
      downloadProgress: 0,
      currentDownloadingModel: null
    };
  }
}

// Setter for download progress state
async function setDownloadProgressState(progress: number, model: 'gemini' | 'embedding' | null) {
  try {
    await chrome.storage.local.set({
      [STORAGE_KEY_DOWNLOAD_PROGRESS]: progress,
      [STORAGE_KEY_DOWNLOADING_MODEL]: model
    });
    logger.debug('BACKGROUND_SCRIPT', `[Background] Stored progress: ${progress.toFixed(1)}% (${model})`);
  } catch (error) {
    logger.error('BACKGROUND_SCRIPT', '[Background] Failed to store download progress:', error);
  }
}

// Clear progress when download completes
async function clearDownloadProgressState() {
  try {
    await chrome.storage.local.remove([
      STORAGE_KEY_DOWNLOAD_PROGRESS,
      STORAGE_KEY_DOWNLOADING_MODEL
    ]);
    logger.debug('BACKGROUND_SCRIPT', '[Background] Cleared download progress state');
  } catch (error) {
    logger.error('BACKGROUND_SCRIPT', '[Background] Failed to clear download progress:', error);
  }
}

// Context menu IDs
const CONTEXT_MENU_ID = 'open-chat'; // Extension icon - chat menu
const CONTEXT_MENU_PAGE_ID = 'chat-with-kuma-page'; // Page - chat menu
const CONTEXT_MENU_DETECT_ID = 'detect-paper-page'; // Page - detect paper menu
const CONTEXT_MENU_IMAGE_ID = 'discuss-image-with-kuma'; // Image - discuss image menu
const CONTEXT_MENU_CAPTURE_SCREEN_ID = 'capture-screen-with-kuma'; // Page - screen capture menu
const CONTEXT_MENU_TOGGLE_IMAGE_BUTTONS_ID = 'toggle-image-buttons'; // Page - toggle image buttons
const CONTEXT_MENU_SIDEPANEL_ID = 'open-sidepanel-page'; // Page - open sidepanel menu

// Context menu section headers (disabled items for visual organization)
const CONTEXT_MENU_HEADER_SYSTEM_ID = 'header-system';
const CONTEXT_MENU_HEADER_ACTIONS_ID = 'header-actions';
const CONTEXT_MENU_HEADER_SETTINGS_ID = 'header-settings';

// Context menu separators
const CONTEXT_MENU_SEPARATOR_1_ID = 'separator-system-actions';
const CONTEXT_MENU_SEPARATOR_2_ID = 'separator-actions-settings';

// Track pending paper extractions (paperUrl → tabId)
// Used to reconnect tabId after offscreen processing completes
const pendingExtractions = new Map<string, number>();

// Handle extension installation
chrome.runtime.onInstalled.addListener(async () => {
  logger.debug('BACKGROUND_SCRIPT', 'Research Bear extension installed');

  // Set default settings (legacy settings in local storage)
  chrome.storage.local.set({
    settings: {
      enableAutoDetect: true,
      defaultExplanationLevel: 'simple',
      theme: 'auto',
    },
  });

  // Initialize image buttons setting in sync storage (new centralized approach)
  await setShowImageButtons(true);

  // Initialize inputQuota service for adaptive chunking
  try {
    logger.debug('BACKGROUND_SCRIPT', '[Background] Initializing inputQuota service...');
    await inputQuotaService.initialize();
    const quotaInfo = await inputQuotaService.getQuotaInfo();
    logger.debug('BACKGROUND_SCRIPT', '[Background] ✓ InputQuota initialized:', quotaInfo);
  } catch (error) {
    logger.error('BACKGROUND_SCRIPT', '[Background] Failed to initialize inputQuota:', error);
  }

  // ========================================
  // CONTEXT MENU: SYSTEM SECTION
  // ========================================

  // System section header
  chrome.contextMenus.create({
    id: CONTEXT_MENU_HEADER_SYSTEM_ID,
    title: '────────── System ──────────',
    contexts: ['page', 'frame'],
    enabled: false, // Disabled = non-clickable header
  });

  // Detect paper from page right-click
  chrome.contextMenus.create({
    id: CONTEXT_MENU_DETECT_ID,
    title: 'Detect Paper with Kuma',
    contexts: ['page', 'frame'],
    enabled: true, // Initially enabled, will be disabled when paper is already stored
  });

  // Open sidepanel
  chrome.contextMenus.create({
    id: CONTEXT_MENU_SIDEPANEL_ID,
    title: 'Open Sidepanel',
    contexts: ['page', 'frame'],
    enabled: true, // Always enabled
  });

  // Separator between System and Actions
  chrome.contextMenus.create({
    id: CONTEXT_MENU_SEPARATOR_1_ID,
    type: 'separator',
    contexts: ['page', 'frame'],
  });

  // ========================================
  // CONTEXT MENU: ACTIONS SECTION
  // ========================================

  // Actions section header
  chrome.contextMenus.create({
    id: CONTEXT_MENU_HEADER_ACTIONS_ID,
    title: '────────── Actions ──────────',
    contexts: ['page', 'frame'],
    enabled: false, // Disabled = non-clickable header
  });

  // Chat with Kuma from extension icon
  chrome.contextMenus.create({
    id: CONTEXT_MENU_ID,
    title: 'Chat with Kuma',
    contexts: ['action'],
    enabled: false, // Initially disabled, will be enabled when a chunked paper is detected
  });

  // Chat with Kuma from page right-click
  chrome.contextMenus.create({
    id: CONTEXT_MENU_PAGE_ID,
    title: 'Chat with Kuma',
    contexts: ['page', 'frame'],
    enabled: false, // Initially disabled, will be enabled when a chunked paper is detected
  });

  // Discuss images with Kuma
  chrome.contextMenus.create({
    id: CONTEXT_MENU_IMAGE_ID,
    title: 'Discuss this image with Kuma',
    contexts: ['image'],
    enabled: false, // Initially disabled, will be enabled when a chunked paper is detected
  });

  // Capture & explain screen area
  chrome.contextMenus.create({
    id: CONTEXT_MENU_CAPTURE_SCREEN_ID,
    title: 'Screenshot and Discuss with Kuma',
    contexts: ['page', 'frame'],
    enabled: false, // Initially disabled, will be enabled when a chunked paper is detected
  });

  // Separator between Actions and Settings
  chrome.contextMenus.create({
    id: CONTEXT_MENU_SEPARATOR_2_ID,
    type: 'separator',
    contexts: ['page', 'frame'],
  });

  // ========================================
  // CONTEXT MENU: SETTINGS SECTION
  // ========================================

  // Settings section header
  chrome.contextMenus.create({
    id: CONTEXT_MENU_HEADER_SETTINGS_ID,
    title: '────────── Settings ──────────',
    contexts: ['page', 'frame'],
    enabled: false, // Disabled = non-clickable header
  });

  // Toggle image explanation buttons
  chrome.contextMenus.create({
    id: CONTEXT_MENU_TOGGLE_IMAGE_BUTTONS_ID,
    title: 'Show Image Explanation Buttons',
    contexts: ['page', 'frame'],
    type: 'checkbox',
    checked: true, // Default to checked
  });

  logger.debug('BACKGROUND_SCRIPT', 'Context menus created');
});

/**
 * Message Router
 * Routes incoming messages to appropriate handlers based on message type
 */
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handleMessage(message, sender, sendResponse);
  return true; // Keep message channel open for async responses
});

/**
 * Main message handler - routes to specialized handlers
 */
async function handleMessage(message: any, sender: chrome.runtime.MessageSender, sendResponse: (response: any) => void) {
  try {
    switch (message.type) {
      // AI Operations
      case MessageType.AI_STATUS:
        sendResponse(await aiHandlers.handleAIStatus());
        break;

      case MessageType.INITIALIZE_AI:
        sendResponse(await aiHandlers.handleInitializeAI());
        break;

      case MessageType.RESET_AI:
        sendResponse(await aiHandlers.handleResetAI());
        break;

      case MessageType.MODEL_DOWNLOAD_PROGRESS:
        // Store download progress state for popup reinitialization
        if (message.payload) {
          const model = message.payload.model || null;
          const progress = message.payload.combinedProgress || 0;

          // Store in chrome.storage for persistence across service worker restarts
          await setDownloadProgressState(progress, model);

          // Clear progress when download completes
          if (progress >= 100) {
            logger.debug('BACKGROUND_SCRIPT', '[Background] Download complete, clearing progress state');
            await clearDownloadProgressState();
          }
        }
        // No response needed - this is a broadcast message
        break;

      case MessageType.PRELOAD_EMBEDDINGS:
        // This message is intended for the offscreen document
        // The offscreen document has a handler for this (offscreen.ts:556-571)
        // Background script acknowledges receipt so the message doesn't fail
        // The offscreen listener will handle the actual preload
        // No response needed from background - let offscreen handle it
        break;

      case MessageType.EXPLAIN_PAPER:
        try {
          const tabId = message.payload.tabId || sender.tab?.id;
          sendResponse(await aiHandlers.handleExplainPaper(message.payload, tabId));
        } catch (explainError) {
          throw explainError;
        }
        break;

      case MessageType.EXPLAIN_PAPER_MANUAL:
        const explainManualTabId = message.payload.tabId || sender.tab?.id;
        sendResponse(await aiHandlers.handleExplainPaperManual(message.payload, explainManualTabId));
        break;

      case MessageType.EXPLAIN_SECTION:
        sendResponse(await aiHandlers.handleExplainSection(message.payload, sender.tab?.id));
        break;

      case MessageType.EXPLAIN_TERM:
        sendResponse(await aiHandlers.handleExplainTerm(message.payload, sender.tab?.id));
        break;

      case MessageType.GENERATE_SUMMARY:
        sendResponse(await aiHandlers.handleGenerateSummary(message.payload, sender.tab?.id));
        break;

      case MessageType.GENERATE_SUMMARY_MANUAL:
        const summaryManualTabId = message.payload.tabId || sender.tab?.id;
        sendResponse(await aiHandlers.handleGenerateSummaryManual(message.payload, summaryManualTabId));
        break;

      case MessageType.ANALYZE_PAPER:
        const analyzeTabId = message.payload.tabId || sender.tab?.id;
        sendResponse(await aiHandlers.handleAnalyzePaper(message.payload, analyzeTabId));
        break;

      case MessageType.GENERATE_GLOSSARY:
        const glossaryTabId = message.payload.tabId || sender.tab?.id;
        // Use the new transformer-based manual glossary generation
        sendResponse(await aiHandlers.handleGenerateGlossaryManual(message.payload, glossaryTabId));
        break;

      case MessageType.ASK_QUESTION:
        const qaTabId = message.payload.tabId || sender.tab?.id;
        sendResponse(await aiHandlers.handleAskQuestion(message.payload, qaTabId));
        break;

      // Chat Operations
      case MessageType.SEND_CHAT_MESSAGE:
        sendResponse(await chatHandlers.handleSendChatMessage(message.payload, sender));
        break;

      case MessageType.UPDATE_CHAT_HISTORY:
        sendResponse(await chatHandlers.handleUpdateChatHistory(message.payload));
        break;

      case MessageType.GET_CHAT_HISTORY:
        sendResponse(await chatHandlers.handleGetChatHistory(message.payload));
        break;

      case MessageType.CLEAR_CHAT_HISTORY:
        sendResponse(await chatHandlers.handleClearChatHistory(message.payload));
        break;

      // Image Chat Operations (Multi-tabbed Chatbox)
      case MessageType.IMAGE_CHAT_MESSAGE:
        sendResponse(await chatHandlers.handleSendImageChatMessage(message.payload, sender));
        break;

      case MessageType.GET_IMAGE_CHAT_HISTORY:
        sendResponse(await chatHandlers.handleGetImageChatHistory(message.payload));
        break;

      case MessageType.UPDATE_IMAGE_CHAT_HISTORY:
        sendResponse(await chatHandlers.handleUpdateImageChatHistory(message.payload));
        break;

      case MessageType.CLEAR_IMAGE_CHAT_HISTORY:
        sendResponse(await chatHandlers.handleClearImageChatHistory(message.payload));
        break;

      // UI Operations
      case MessageType.OPEN_SIDEPANEL:
        sendResponse(await uiHandlers.handleOpenSidepanel(sender.tab?.id));
        break;

      case MessageType.CHECK_SIDEPANEL_OPEN:
        sendResponse(await uiHandlers.handleCheckSidepanelOpen());
        break;

      // Database Operations
      case MessageType.STORE_PAPER_IN_DB:
        let tabId = message.payload.tabId || sender.tab?.id;

        // Fallback 1: Look up tabId from pending extractions (for offscreen-processed papers)
        if (!tabId && message.payload.paper?.url) {
          const paperUrl = message.payload.paper.url;
          tabId = pendingExtractions.get(paperUrl);
          if (tabId) {
            logger.debug('BACKGROUND_SCRIPT', '[Background] Retrieved tabId', tabId, 'from pending extractions for:', paperUrl);
            pendingExtractions.delete(paperUrl); // Clean up mapping
          }
        }

        // Fallback 2: Look up from tabPaperTracker using URL (for PDF papers)
        if (!tabId && message.payload.paperUrl) {
          const tabs = tabPaperTracker.getTabsForPaperUrl(message.payload.paperUrl);
          if (tabs.length > 0) {
            tabId = tabs[0]; // Use first matching tab
            logger.debug('BACKGROUND_SCRIPT', '[Background] Retrieved tabId', tabId, 'from tabPaperTracker for:', message.payload.paperUrl);
          }
        }

        // Fallback 3: Query all tabs for matching URL (last resort for PDFs)
        if (!tabId && message.payload.paperUrl) {
          const allTabs = await chrome.tabs.query({});
          const matchingTab = allTabs.find(t => t.url === message.payload.paperUrl);
          if (matchingTab?.id) {
            tabId = matchingTab.id;
            logger.debug('BACKGROUND_SCRIPT', '[Background] Retrieved tabId', tabId, 'from chrome.tabs.query for:', message.payload.paperUrl);
          }
        }

        const result = await dbHandlers.handleStorePaper(message.payload, tabId);
        sendResponse(result);
        break;

      case MessageType.EXTRACT_PAPER_HTML:
        // Capture tabId before offscreen processing
        const extractTabId = sender.tab?.id;
        if (extractTabId && message.payload.paperUrl) {
          pendingExtractions.set(message.payload.paperUrl, extractTabId);
          logger.debug('BACKGROUND_SCRIPT', '[Background] Stored tabId', extractTabId, 'for paper extraction:', message.payload.paperUrl);
        }
        sendResponse(await dbHandlers.handleExtractPaperHTML(message.payload));
        break;

      case MessageType.GET_PAPER_FROM_DB_BY_URL:
        sendResponse(await dbHandlers.handleGetPaperByUrl(message.payload));
        break;

      case MessageType.IS_PAPER_STORED_IN_DB:
        sendResponse(await dbHandlers.handleIsPaperStored(message.payload));
        break;

      case MessageType.GET_ALL_PAPERS_FROM_DB:
        sendResponse(await dbHandlers.handleGetAllPapers());
        break;

      case MessageType.DELETE_PAPER_FROM_DB:
        sendResponse(await dbHandlers.handleDeletePaper(message.payload));
        break;

      case MessageType.UPDATE_PAPER_QA_HISTORY:
        sendResponse(await dbHandlers.handleUpdateQAHistory(message.payload));
        break;

      // Image Explanation Operations
      case MessageType.STORE_IMAGE_EXPLANATION:
        sendResponse(await dbHandlers.handleStoreImageExplanation(message.payload));
        break;

      case MessageType.GET_IMAGE_EXPLANATION:
        sendResponse(await dbHandlers.handleGetImageExplanation(message.payload));
        break;

      case MessageType.GET_IMAGE_EXPLANATIONS_BY_PAPER:
        sendResponse(await dbHandlers.handleGetImageExplanationsByPaper(message.payload));
        break;

      // Screen Capture Operations
      case MessageType.STORE_SCREEN_CAPTURE:
        sendResponse(await dbHandlers.handleStoreScreenCapture(message.payload));
        break;

      case MessageType.GET_SCREEN_CAPTURE:
        sendResponse(await dbHandlers.handleGetScreenCapture(message.payload));
        break;

      case MessageType.DELETE_SCREEN_CAPTURE:
        sendResponse(await dbHandlers.handleDeleteScreenCapture(message.payload));
        break;

      // Citation Operations
      case 'ADD_CITATION':
        sendResponse(await citationHandlers.handleAddCitation(message.payload));
        break;

      case 'GET_ALL_CITATIONS':
        sendResponse(await citationHandlers.handleGetAllCitations());
        break;

      case 'DELETE_CITATION':
        sendResponse(await citationHandlers.handleDeleteCitation(message.payload));
        break;

      // State Operations
      case MessageType.GET_OPERATION_STATE:
        const getStateTabId = message.payload?.tabId || sender.tab?.id;
        sendResponse(await stateHandlers.handleGetOperationState(message.payload, getStateTabId));
        break;

      case MessageType.GET_OPERATION_STATE_BY_PAPER:
        sendResponse(await stateHandlers.handleGetOperationStateByPaper(message.payload));
        break;

      case MessageType.EMBEDDING_PROGRESS:
        // Handle embedding progress updates from offscreen document
        (async () => {
          const { paperId, current, total, device } = message.payload;

          // Create progress message with backend indicator
          const backendNote = device === 'webgpu' ? ' -⚡ WebGPU-accelerated' : '';
          const progressMessage = `Kuma is reading the paper and learning the semantic meaning... (${current}/${total} embeddings${backendNote})`;

          // Find the tab(s) viewing this paper
          const paperUrl = message.payload.paperUrl;
          if (!paperUrl) {
            // Try to get paperUrl from pending extractions or stored papers
            const { getPaperById } = await import('../utils/dbService.ts');
            const paper = await getPaperById(paperId);
            if (paper) {
              const tabIds = tabPaperTracker.getTabsForPaperUrl(paper.url);
              for (const tabId of tabIds) {
                await operationStateService.updateStateAndBroadcast(tabId, {
                  embeddingProgress: progressMessage,
                });
              }
            }
          } else {
            const tabIds = tabPaperTracker.getTabsForPaperUrl(paperUrl);
            for (const tabId of tabIds) {
              await operationStateService.updateStateAndBroadcast(tabId, {
                embeddingProgress: progressMessage,
              });
            }
          }
        })();
        break;

      // Orchestrated Workflows
      case MessageType.START_DETECT_AND_EXPLAIN:
        (async () => {
          const tabId = message.payload?.tabId || sender.tab?.id;
          if (!tabId) {
            sendResponse({ success: false, error: 'No tab ID provided' });
            return;
          }
          const result = await executeDetectAndExplainFlow(tabId);
          sendResponse(result);
        })();
        return true; // Keep channel open for async response

      // PDF Screen Capture
      case MessageType.CAPTURE_PDF_SCREENSHOT:
        (async () => {
          try {
            const tabId = sender.tab?.id;
            const windowId = sender.tab?.windowId;

            if (!tabId || !windowId) {
              sendResponse({ success: false, error: 'No tab or window ID available' });
              return;
            }

            // Capture visible tab as dataURL
            const dataUrl = await chrome.tabs.captureVisibleTab(windowId, {
              format: 'png',
            });

            sendResponse({ success: true, dataUrl });
          } catch (error) {
            logger.error('BACKGROUND_SCRIPT', '[PDFCapture] Error capturing screenshot:', error);
            sendResponse({ success: false, error: String(error) });
          }
        })();
        return true; // Keep channel open for async response

      default:
        sendResponse({ success: false, error: 'Unknown message type' });
    }
  } catch (error) {
    logger.error('BACKGROUND_SCRIPT', 'Error handling message:', error);
    sendResponse({ success: false, error: String(error) });
  }
}

// Register tab lifecycle handlers
registerTabLifecycleHandlers();

/**
 * Context Menu Setup for Opening Chatbox
 */

/**
 * Check if chat is ready for a tab (paper is chunked and chat is enabled)
 */
async function isChatReady(tabId: number): Promise<boolean> {
  try {
    const tab = await chrome.tabs.get(tabId);
    if (!tab.url) return false;

    // Check operation state for chatReady flag
    const state = operationStateService.getStateByPaperUrl(tab.url);
    if (state && state.chatReady) {
      return true;
    }

    // Fallback: check if paper has chunks (for existing papers that were loaded before this change)
    const paper = await dbHandlers.handleGetPaperByUrl({ url: tab.url });
    return !!(paper.success && paper.paper && paper.paper.chunkCount > 0);
  } catch (error) {
    logger.error('BACKGROUND_SCRIPT', '[ContextMenu] Error checking chat ready status:', error);
    return false;
  }
}

/**
 * Check if paper is NOT stored for a tab (inverse of isChatReady)
 * Returns true when no paper is stored or paper is not yet chunked
 * Also returns false (disables detect) when detection/chunking is in progress
 */
async function isPaperNotStored(tabId: number): Promise<boolean> {
  try {
    const tab = await chrome.tabs.get(tabId);
    if (!tab.url) return false;

    // Check operation state by tab ID (works even before paper exists)
    const state = operationStateService.getRawState(tabId);
    if (state) {
      // Paper is stored and ready - disable detect
      if (state.chatReady) {
        return false;
      }

      // Detection/chunking/embedding in progress - disable detect to prevent duplicate operations
      if (state.isDetecting || state.isChunking || state.isGeneratingEmbeddings) {
        return false;
      }
    }

    // Check if paper exists in database
    const paper = await dbHandlers.handleGetPaperByUrl({ url: tab.url });
    const paperExists = !!(paper.success && paper.paper && paper.paper.chunkCount > 0);

    return !paperExists; // Return true if paper doesn't exist or isn't chunked
  } catch (error) {
    logger.error('BACKGROUND_SCRIPT', '[ContextMenu] Error checking paper storage status:', error);
    return false; // Default to not showing detect menu on error
  }
}

/**
 * Update context menu state for the active tab
 * Exported so operationStateService can call it when state changes
 */
export async function updateContextMenuState() {
  try {
    const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!activeTab || !activeTab.id) return;

    const chatReady = await isChatReady(activeTab.id);
    const paperNotStored = await isPaperNotStored(activeTab.id);

    // Update detect paper context menu (enabled when paper is NOT stored)
    await chrome.contextMenus.update(CONTEXT_MENU_DETECT_ID, {
      enabled: paperNotStored,
    });

    // Update chat context menus (enabled when paper is stored and chunked)
    await chrome.contextMenus.update(CONTEXT_MENU_ID, {
      enabled: chatReady,
    });
    await chrome.contextMenus.update(CONTEXT_MENU_PAGE_ID, {
      enabled: chatReady,
    });
    await chrome.contextMenus.update(CONTEXT_MENU_IMAGE_ID, {
      enabled: chatReady,
    });
    await chrome.contextMenus.update(CONTEXT_MENU_CAPTURE_SCREEN_ID, {
      enabled: chatReady,
    });


    // Update image buttons toggle checkbox to match current setting
    const showImageButtons = await getShowImageButtons();
    await chrome.contextMenus.update(CONTEXT_MENU_TOGGLE_IMAGE_BUTTONS_ID, {
      checked: showImageButtons,
    });

    // Update sidepanel menu with dynamic title
    await chrome.contextMenus.update(CONTEXT_MENU_SIDEPANEL_ID, {
      title: chatReady ? 'Open Paper in Sidepanel' : 'Open Sidepanel',
      enabled: true, // Always enabled
    });
  } catch (error) {
    // Context menu might not exist yet, that's ok
    logger.debug('BACKGROUND_SCRIPT', '[ContextMenu] Could not update menu state:', error);
  }
}

/**
 * Update context menu state for all tabs viewing a specific paper
 * Called when paper operations complete to ensure all relevant tabs are updated
 */
export async function updateContextMenuForPaper(paperUrl: string) {
  try {
    const tabIds = tabPaperTracker.getTabsForPaperUrl(paperUrl);
    if (tabIds.length === 0) return;

    // Check if any of these tabs is currently active
    const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (activeTab?.id && tabIds.includes(activeTab.id)) {
      await updateContextMenuState();
    }
  } catch (error) {
    logger.debug('BACKGROUND_SCRIPT', '[ContextMenu] Could not update menu for paper:', error);
  }
}

// Handle context menu clicks
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (!tab?.id) return;

  try {
    // Handle "Open Sidepanel" FIRST to preserve user gesture
    // Must be before any async operations (like tab.id = -1 fix)
    if (info.menuItemId === CONTEXT_MENU_SIDEPANEL_ID) {
      logger.debug('BACKGROUND_SCRIPT', '[ContextMenu] Open sidepanel triggered from context menu for tab', tab.id);

      // For PDFs (tab.id === -1), use CALLBACK-based API to preserve user gesture
      // Promises/async-await break the gesture chain (~1ms timeout)
      if (tab.id === -1) {
        // Use callback form (not await/Promise) to preserve user gesture
        chrome.tabs.query({currentWindow: true, active: true}, (tabs) => {
          if (!tabs[0]?.id) {
            logger.error('BACKGROUND_SCRIPT', '[ContextMenu] Could not find active tab for PDF sidepanel');
            return;
          }

          const actualTab = tabs[0];

          // Open sidepanel with callback (preserves gesture)
          chrome.sidePanel.open({ tabId: actualTab.id }, () => {
            // After sidepanel opens, do navigation logic (can use Promises now)
            isChatReady(actualTab.id).then((chatReady) => {
              if (chatReady && actualTab.url) {
                chrome.runtime.sendMessage({
                  type: MessageType.NAVIGATE_TO_PAPER,
                  payload: { url: actualTab.url },
                });
              }
            }).catch((error) => {
              logger.error('BACKGROUND_SCRIPT', '[ContextMenu] Error in navigation logic:', error);
            });
          });
        });
      } else {
        // Normal tabs: await works fine here
        await chrome.sidePanel.open({ tabId: tab.id });

        // Check if we should navigate to paper
        const chatReady = await isChatReady(tab.id);
        if (chatReady && tab.url) {
          await chrome.runtime.sendMessage({
            type: MessageType.NAVIGATE_TO_PAPER,
            payload: { url: tab.url },
          });
        }
      }
      return; // Early return to skip the rest
    }

    // PDF plugin returns tab.id = -1, need to get the actual active tab
    // (Only needed for non-sidepanel menu items now)
    if (tab.id === -1) {
      const tabs = await chrome.tabs.query({currentWindow: true, active: true});
      if (!tabs[0]?.id) return;
      tab = tabs[0];
    }

    // Handle "Chat with Kuma" menu items
    if (info.menuItemId === CONTEXT_MENU_ID || info.menuItemId === CONTEXT_MENU_PAGE_ID) {
      // Send message to content script to toggle chatbox
      await chrome.tabs.sendMessage(tab.id, {
        type: MessageType.TOGGLE_CHATBOX,
      });
    }
    // Handle "Detect Paper with Kuma" menu item
    else if (info.menuItemId === CONTEXT_MENU_DETECT_ID) {
      logger.debug('BACKGROUND_SCRIPT', '[ContextMenu] Detect Paper triggered from context menu for tab', tab.id);
      // Execute the detect and explain flow (same as popup button)
      await executeDetectAndExplainFlow(tab.id);
    }
    // Handle "Discuss this image with Kuma" menu item
    else if (info.menuItemId === CONTEXT_MENU_IMAGE_ID) {
      logger.debug('BACKGROUND_SCRIPT', '[ContextMenu] Discuss image triggered for:', info.srcUrl);
      // Send message to content script with image URL
      await chrome.tabs.sendMessage(tab.id, {
        type: MessageType.CONTEXT_MENU_IMAGE_DISCUSS,
        payload: { imageUrl: info.srcUrl },
      });
    }
    // Handle "Capture & Explain Image with Kuma" menu item
    else if (info.menuItemId === CONTEXT_MENU_CAPTURE_SCREEN_ID) {
      logger.debug('BACKGROUND_SCRIPT', '[ContextMenu] Screen capture triggered from context menu for tab', tab.id);
      // Send message to content script to start screen capture
      await chrome.tabs.sendMessage(tab.id, {
        type: MessageType.START_SCREEN_CAPTURE,
      });
    }
    // Handle "Show Image Explanation Buttons" toggle
    else if (info.menuItemId === CONTEXT_MENU_TOGGLE_IMAGE_BUTTONS_ID) {
      logger.debug('BACKGROUND_SCRIPT', '[ContextMenu] Toggle image buttons:', info.checked);
      // Update setting
      await setShowImageButtons(info.checked ?? true);

      // Broadcast change to all tabs
      const tabs = await chrome.tabs.query({});
      for (const tabItem of tabs) {
        if (tabItem.id) {
          chrome.tabs.sendMessage(tabItem.id, {
            type: MessageType.IMAGE_BUTTONS_VISIBILITY_CHANGED,
            payload: { showImageButtons: info.checked },
          }).catch(() => {}); // Ignore errors for tabs without content script
        }
      }
    }
  } catch (error) {
    logger.error('BACKGROUND_SCRIPT', '[ContextMenu] Error handling context menu click:', error);
  }
});

// Update menu state when switching tabs
chrome.tabs.onActivated.addListener(async () => {
  await updateContextMenuState();
});

// Update menu state when tab URL changes
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (changeInfo.url && tab.active) {
    await updateContextMenuState();
  }
});

logger.debug('BACKGROUND_SCRIPT', 'Research Bear background service worker loaded');
