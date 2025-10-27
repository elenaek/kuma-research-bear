import { MessageType, ResearchPaper } from '../../types/index.ts';
import { detectPaperWithAIOnly } from '../services/paperDetectionService.ts';
import { storePaper } from '../services/paperStorageService.ts';
import { aiService } from '../../utils/aiService.ts';
import { chatboxInjector } from '../services/chatboxInjector.ts';
import { imageExplanationHandler } from '../services/imageExplanationHandler.ts';

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

  // Detect language if paper found
  if (paper) {
    try {
      // Use title + abstract for best language detection accuracy
      const textForDetection = `${paper.title} ${paper.abstract}`.trim();
      const detectedLanguage = await aiService.detectLanguage(textForDetection);

      if (detectedLanguage) {
        // Initialize metadata if it doesn't exist
        if (!paper.metadata) {
          paper.metadata = {};
        }
        paper.metadata.originalLanguage = detectedLanguage;
        console.log('[MessageHandler] Detected paper language:', detectedLanguage);
      }
    } catch (error) {
      console.error('[MessageHandler] Error detecting language:', error);
      // Continue anyway - language detection is optional
    }
  }

  // Store in IndexedDB if detected
  let stored = false;
  let chunkCount = 0;
  let alreadyStored = false;
  let storageError: string | undefined;
  let paperId: string | undefined;

  if (paper) {
    const storageResult = await storePaper(paper);
    stored = storageResult.stored;
    chunkCount = storageResult.chunkCount;
    alreadyStored = storageResult.alreadyStored;
    storageError = storageResult.storageError;
    paperId = storageResult.paperId;
  }

  return {
    paper,
    stored,
    chunkCount,
    alreadyStored,
    storageError,
    paperId,
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

          case MessageType.TOGGLE_CHATBOX:
            await chatboxInjector.toggle();
            sendResponse({ success: true });
            break;

          case MessageType.GET_CHATBOX_STATE:
            sendResponse({
              success: true,
              isOpen: chatboxInjector.settings.visible
            });
            break;

          case MessageType.CONTEXT_MENU_IMAGE_DISCUSS:
            // Handle image context menu click
            if (message.payload?.imageUrl) {
              await imageExplanationHandler.handleContextMenuClick(message.payload.imageUrl);
              sendResponse({ success: true });
            } else {
              sendResponse({ success: false, error: 'No image URL provided' });
            }
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
