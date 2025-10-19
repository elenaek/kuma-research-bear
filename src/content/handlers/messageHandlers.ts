import { MessageType, ResearchPaper } from '../../types/index.ts';
import { detectPaperWithAIOnly } from '../services/paperDetectionService.ts';
import { storePaper } from '../services/paperStorageService.ts';

/**
 * Message Handlers
 * Individual handler functions for each message type
 */

/**
 * Handle DETECT_PAPER message
 * Uses AI-first detection and provides detailed storage status
 */
export async function handleDetectPaper(currentPaper: ResearchPaper | null) {
  console.log('[MessageHandler] Handling DETECT_PAPER');

  // Manual detection uses AI-first approach
  const paper = await detectPaperWithAIOnly();

  // Store in IndexedDB if detected
  let stored = false;
  let chunkCount = 0;
  let alreadyStored = false;
  let storageError: string | undefined;

  if (paper) {
    const storageResult = await storePaper(paper);
    stored = storageResult.stored;
    chunkCount = storageResult.chunkCount;
    alreadyStored = storageResult.alreadyStored;
    storageError = storageResult.storageError;
  }

  return {
    paper,
    stored,
    chunkCount,
    alreadyStored,
    storageError,
  };
}

/**
 * Handle EXPLAIN_PAPER message
 * Forwards current paper to background for explanation
 */
export async function handleExplainPaper(currentPaper: ResearchPaper | null) {
  console.log('[MessageHandler] Handling EXPLAIN_PAPER');

  if (currentPaper) {
    // Send paper to background for explanation
    chrome.runtime.sendMessage({
      type: MessageType.EXPLAIN_PAPER,
      payload: { paper: currentPaper },
    });
    return { success: true };
  } else {
    return { success: false, error: 'No paper detected' };
  }
}

/**
 * Handle EXPLAIN_SECTION message
 * Forwards section to background for explanation
 */
export async function handleExplainSection(payload: any) {
  console.log('[MessageHandler] Handling EXPLAIN_SECTION');

  // Handle section explanation
  chrome.runtime.sendMessage({
    type: MessageType.EXPLAIN_SECTION,
    payload,
  });

  return { success: true };
}

/**
 * Create the message router
 * Routes incoming messages to appropriate handlers
 */
export function createMessageRouter(getCurrentPaper: () => ResearchPaper | null) {
  return (message: any, sender: any, sendResponse: (response: any) => void) => {
    // Handle async operations properly
    (async () => {
      try {
        const currentPaper = getCurrentPaper();

        switch (message.type) {
          case MessageType.DETECT_PAPER:
            const detectResult = await handleDetectPaper(currentPaper);
            sendResponse(detectResult);
            break;

          case MessageType.EXPLAIN_PAPER:
            const explainResult = await handleExplainPaper(currentPaper);
            sendResponse(explainResult);
            break;

          case MessageType.EXPLAIN_SECTION:
            const sectionResult = await handleExplainSection(message.payload);
            sendResponse(sectionResult);
            break;

          default:
            sendResponse({ success: false, error: 'Unknown message type' });
        }
      } catch (error) {
        console.error('[MessageHandler] Error handling message:', error);
        sendResponse({ success: false, error: String(error) });
      }
    })();

    return true; // Keep message channel open for async response
  };
}
