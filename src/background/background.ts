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
import { executeDetectAndExplainFlow } from './orchestrators/detectAndExplainOrchestrator.ts';
import { inputQuotaService } from '../utils/inputQuotaService.ts';

// Context menu IDs for opening chatbox
const CONTEXT_MENU_ID = 'open-chat'; // Extension icon context menu
const CONTEXT_MENU_PAGE_ID = 'chat-with-kuma-page'; // Page context menu

// Track pending paper extractions (paperUrl → tabId)
// Used to reconnect tabId after offscreen processing completes
const pendingExtractions = new Map<string, number>();

// Handle extension installation
chrome.runtime.onInstalled.addListener(async () => {
  console.log('Research Bear extension installed');

  // Set default settings
  chrome.storage.local.set({
    settings: {
      enableAutoDetect: true,
      defaultExplanationLevel: 'simple',
      theme: 'auto',
    },
  });

  // Initialize inputQuota service for adaptive chunking
  try {
    console.log('[Background] Initializing inputQuota service...');
    await inputQuotaService.initialize();
    const quotaInfo = await inputQuotaService.getQuotaInfo();
    console.log('[Background] ✓ InputQuota initialized:', quotaInfo);
  } catch (error) {
    console.error('[Background] Failed to initialize inputQuota:', error);
  }

  // Create context menu for opening chatbox from extension icon
  chrome.contextMenus.create({
    id: CONTEXT_MENU_ID,
    title: 'Chat with Kuma',
    contexts: ['action'],
    enabled: false, // Initially disabled, will be enabled when a chunked paper is detected
  });

  // Create context menu for opening chatbox from page right-click
  chrome.contextMenus.create({
    id: CONTEXT_MENU_PAGE_ID,
    title: 'Chat with Kuma',
    contexts: ['page'],
    enabled: false, // Initially disabled, will be enabled when a chunked paper is detected
  });

  console.log('Context menus created');
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

      case MessageType.EXPLAIN_PAPER:
        try {
          const tabId = message.payload.tabId || sender.tab?.id;
          sendResponse(await aiHandlers.handleExplainPaper(message.payload, tabId));
        } catch (explainError) {
          throw explainError;
        }
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

        // Fallback: Look up tabId from pending extractions (for offscreen-processed papers)
        if (!tabId && message.payload.paper?.url) {
          const paperUrl = message.payload.paper.url;
          tabId = pendingExtractions.get(paperUrl);
          if (tabId) {
            console.log('[Background] Retrieved tabId', tabId, 'from pending extractions for:', paperUrl);
            pendingExtractions.delete(paperUrl); // Clean up mapping
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
          console.log('[Background] Stored tabId', extractTabId, 'for paper extraction:', message.payload.paperUrl);
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
                const state = operationStateService.updateState(tabId, {
                  embeddingProgress: progressMessage,
                });
                await operationStateService.broadcastStateChange(state);
              }
            }
          } else {
            const tabIds = tabPaperTracker.getTabsForPaperUrl(paperUrl);
            for (const tabId of tabIds) {
              const state = operationStateService.updateState(tabId, {
                embeddingProgress: progressMessage,
              });
              await operationStateService.broadcastStateChange(state);
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

      default:
        sendResponse({ success: false, error: 'Unknown message type' });
    }
  } catch (error) {
    console.error('Error handling message:', error);
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
    console.error('[ContextMenu] Error checking chat ready status:', error);
    return false;
  }
}

/**
 * Update context menu state for the active tab
 */
async function updateContextMenuState() {
  try {
    const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!activeTab || !activeTab.id) return;

    const chatReady = await isChatReady(activeTab.id);

    // Update both context menus
    await chrome.contextMenus.update(CONTEXT_MENU_ID, {
      enabled: chatReady,
    });
    await chrome.contextMenus.update(CONTEXT_MENU_PAGE_ID, {
      enabled: chatReady,
    });
  } catch (error) {
    // Context menu might not exist yet, that's ok
    console.debug('[ContextMenu] Could not update menu state:', error);
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
    console.debug('[ContextMenu] Could not update menu for paper:', error);
  }
}

// Handle context menu clicks
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if ((info.menuItemId === CONTEXT_MENU_ID || info.menuItemId === CONTEXT_MENU_PAGE_ID) && tab?.id) {
    try {
      // Send message to content script to toggle chatbox
      await chrome.tabs.sendMessage(tab.id, {
        type: MessageType.TOGGLE_CHATBOX,
      });
    } catch (error) {
      console.error('[ContextMenu] Error opening chatbox:', error);
    }
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

console.log('Research Bear background service worker loaded');
