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
import * as dbHandlers from './handlers/dbHandlers.ts';
import * as aiHandlers from './handlers/aiHandlers.ts';
import * as stateHandlers from './handlers/stateHandlers.ts';
import * as uiHandlers from './handlers/uiHandlers.ts';
import * as chatHandlers from './handlers/chatHandlers.ts';
import { executeDetectAndExplainFlow } from './orchestrators/detectAndExplainOrchestrator.ts';

// Handle extension installation
chrome.runtime.onInstalled.addListener(() => {
  console.log('Research Bear extension installed');

  // Set default settings
  chrome.storage.local.set({
    settings: {
      enableAutoDetect: true,
      defaultExplanationLevel: 'simple',
      theme: 'auto',
    },
  });
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

      // UI Operations
      case MessageType.OPEN_SIDEPANEL:
        sendResponse(await uiHandlers.handleOpenSidepanel(sender.tab?.id));
        break;

      case MessageType.CHECK_SIDEPANEL_OPEN:
        sendResponse(await uiHandlers.handleCheckSidepanelOpen());
        break;

      // Database Operations
      case MessageType.STORE_PAPER_IN_DB:
        const tabId = message.payload.tabId || sender.tab?.id;
        const result = await dbHandlers.handleStorePaper(message.payload, tabId);
        sendResponse(result);
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

      // State Operations
      case MessageType.GET_OPERATION_STATE:
        const getStateTabId = message.payload?.tabId || sender.tab?.id;
        sendResponse(await stateHandlers.handleGetOperationState(message.payload, getStateTabId));
        break;

      case MessageType.GET_OPERATION_STATE_BY_PAPER:
        sendResponse(await stateHandlers.handleGetOperationStateByPaper(message.payload));
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

console.log('Research Bear background service worker loaded');
