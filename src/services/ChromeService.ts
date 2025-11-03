import { MessageType, StoredPaper, QuestionAnswer, PaperAnalysisResult, GlossaryResult, ChatMessage, ImageExplanation } from '../types/index.ts';
import { normalizeUrl } from '../utils/urlUtils.ts';
import { logger } from '../utils/logger.ts';

/**
 * ChromeService - Centralized service for all Chrome runtime messaging operations
 *
 * This service provides a clean API for communicating with the background worker
 * and other extension components via chrome.runtime.sendMessage.
 */

export interface ChromeMessageResponse<T = any> {
  success: boolean;
  error?: string;
  data?: T;
}

/**
 * IndexedDB Operations
 */

/**
 * Get a paper from IndexedDB by its URL
 */
export async function getPaperByUrl(url: string): Promise<StoredPaper | null> {
  const normalizedUrl = normalizeUrl(url);
  logger.debug('SERVICE', '[ChromeService] Requesting paper from background worker:', url, '(normalized:', normalizedUrl, ')');

  try {
    const response = await chrome.runtime.sendMessage({
      type: MessageType.GET_PAPER_FROM_DB_BY_URL,
      payload: { url: normalizedUrl },
    });

    if (response.success) {
      logger.debug('SERVICE', '[ChromeService] Paper retrieval result:', response.paper ? 'Found' : 'Not found');
      return response.paper || null;
    } else {
      logger.error('SERVICE', '[ChromeService] Failed to get paper:', response.error);
      return null;
    }
  } catch (error) {
    logger.error('SERVICE', '[ChromeService] Error getting paper by URL:', error);
    return null;
  }
}

/**
 * Get all papers from IndexedDB
 */
export async function getAllPapers(): Promise<StoredPaper[]> {
  logger.debug('SERVICE', '[ChromeService] Requesting all papers from background worker');

  try {
    const response = await chrome.runtime.sendMessage({
      type: MessageType.GET_ALL_PAPERS_FROM_DB,
      payload: {},
    });

    if (response.success) {
      logger.debug('SERVICE', '[ChromeService] Retrieved', response.papers?.length || 0, 'papers');
      return response.papers || [];
    } else {
      logger.error('SERVICE', '[ChromeService] Failed to get all papers:', response.error);
      return [];
    }
  } catch (error) {
    logger.error('SERVICE', '[ChromeService] Error getting all papers:', error);
    return [];
  }
}

/**
 * Update Q&A history for a paper in IndexedDB
 */
export async function updatePaperQAHistory(paperId: string, qaHistory: QuestionAnswer[]): Promise<boolean> {
  logger.debug('SERVICE', '[ChromeService] Updating Q&A history for paper:', paperId);

  try {
    const response = await chrome.runtime.sendMessage({
      type: MessageType.UPDATE_PAPER_QA_HISTORY,
      payload: { paperId, qaHistory },
    });

    if (response.success) {
      logger.debug('SERVICE', '[ChromeService] Q&A history updated successfully');
      return true;
    } else {
      logger.error('SERVICE', '[ChromeService] Failed to update Q&A history:', response.error);
      return false;
    }
  } catch (error) {
    logger.error('SERVICE', '[ChromeService] Error updating Q&A history:', error);
    return false;
  }
}

/**
 * Delete a paper from IndexedDB
 */
export async function deletePaper(paperId: string): Promise<boolean> {
  logger.debug('SERVICE', '[ChromeService] Deleting paper:', paperId);

  try {
    const response = await chrome.runtime.sendMessage({
      type: MessageType.DELETE_PAPER_FROM_DB,
      payload: { paperId },
    });

    if (response.success) {
      logger.debug('SERVICE', '[ChromeService] Paper deleted successfully');
      return true;
    } else {
      logger.error('SERVICE', '[ChromeService] Failed to delete paper:', response.error);
      return false;
    }
  } catch (error) {
    logger.error('SERVICE', '[ChromeService] Error deleting paper:', error);
    return false;
  }
}

export interface StorePaperResponse {
  success: boolean;
  error?: string;
  paper?: StoredPaper;
}

/**
 * Store a paper in IndexedDB with full text or pre-chunked data
 */
export async function storePaperInDB(
  paper: any,
  fullText?: string,
  preChunkedData?: {
    chunks: import('../types/index.ts').ContentChunk[];
    metadata: { averageChunkSize?: number };
  }
): Promise<StorePaperResponse> {
  logger.debug('SERVICE', '[ChromeService] Storing paper in IndexedDB:', paper.title);

  try {
    const response = await chrome.runtime.sendMessage({
      type: MessageType.STORE_PAPER_IN_DB,
      payload: { paper, fullText, preChunkedData },
    });

    if (response.success) {
      logger.debug('SERVICE', '[ChromeService] ✓ Paper stored successfully');
      return { success: true, paper: response.paper };
    } else {
      logger.error('SERVICE', '[ChromeService] Failed to store paper:', response.error);
      return { success: false, error: response.error };
    }
  } catch (error) {
    logger.error('SERVICE', '[ChromeService] Error storing paper:', error);
    return { success: false, error: String(error) };
  }
}

/**
 * AI Operations
 */

export interface AnalysisResponse {
  success: boolean;
  error?: string;
  analysis?: PaperAnalysisResult;
}

/**
 * Trigger paper analysis
 */
export async function analyzePaper(paperUrl: string, tabId?: number): Promise<AnalysisResponse> {
  logger.debug('SERVICE', '[ChromeService] Starting paper analysis for:', paperUrl, 'tabId:', tabId);

  try {
    const response = await chrome.runtime.sendMessage({
      type: MessageType.ANALYZE_PAPER,
      payload: { url: paperUrl, tabId },
    });

    if (response.success) {
      logger.debug('SERVICE', '[ChromeService] ✓ Paper analysis completed successfully');
      return { success: true, analysis: response.analysis };
    } else {
      logger.error('SERVICE', '[ChromeService] Analysis failed:', response.error);
      return { success: false, error: response.error };
    }
  } catch (error) {
    logger.error('SERVICE', '[ChromeService] Error triggering analysis:', error);
    return { success: false, error: String(error) };
  }
}

export interface GlossaryResponse {
  success: boolean;
  error?: string;
  glossary?: GlossaryResult;
}

/**
 * Generate glossary for a paper
 */
export async function generateGlossary(paperUrl: string, tabId?: number): Promise<GlossaryResponse> {
  logger.debug('SERVICE', '[ChromeService] Starting glossary generation for:', paperUrl, 'tabId:', tabId);

  try {
    const response = await chrome.runtime.sendMessage({
      type: MessageType.GENERATE_GLOSSARY,
      payload: { url: paperUrl, tabId },
    });

    if (response.success) {
      logger.debug('SERVICE', '[ChromeService] ✓ Glossary generated successfully');
      return { success: true, glossary: response.glossary };
    } else {
      logger.error('SERVICE', '[ChromeService] Glossary generation failed:', response.error);
      return { success: false, error: response.error };
    }
  } catch (error) {
    logger.error('SERVICE', '[ChromeService] Error generating glossary:', error);
    return { success: false, error: String(error) };
  }
}

export interface ExplanationResponse {
  success: boolean;
  error?: string;
  explanation?: any;
}

/**
 * Generate explanation for a paper manually
 */
export async function explainPaperManual(paperUrl: string, tabId?: number): Promise<ExplanationResponse> {
  logger.debug('SERVICE', '[ChromeService] Starting explanation generation for:', paperUrl, 'tabId:', tabId);

  try {
    const response = await chrome.runtime.sendMessage({
      type: MessageType.EXPLAIN_PAPER_MANUAL,
      payload: { url: paperUrl, tabId },
    });

    if (response.success) {
      logger.debug('SERVICE', '[ChromeService] ✓ Explanation generated successfully');
      return { success: true, explanation: response.explanation };
    } else {
      logger.error('SERVICE', '[ChromeService] Explanation generation failed:', response.error);
      return { success: false, error: response.error };
    }
  } catch (error) {
    logger.error('SERVICE', '[ChromeService] Error generating explanation:', error);
    return { success: false, error: String(error) };
  }
}

export interface SummaryResponse {
  success: boolean;
  error?: string;
  summary?: any;
}

/**
 * Generate summary for a paper manually
 */
export async function generateSummaryManual(paperUrl: string, tabId?: number): Promise<SummaryResponse> {
  logger.debug('SERVICE', '[ChromeService] Starting summary generation for:', paperUrl, 'tabId:', tabId);

  try {
    const response = await chrome.runtime.sendMessage({
      type: MessageType.GENERATE_SUMMARY_MANUAL,
      payload: { url: paperUrl, tabId },
    });

    if (response.success) {
      logger.debug('SERVICE', '[ChromeService] ✓ Summary generated successfully');
      return { success: true, summary: response.summary };
    } else {
      logger.error('SERVICE', '[ChromeService] Summary generation failed:', response.error);
      return { success: false, error: response.error };
    }
  } catch (error) {
    logger.error('SERVICE', '[ChromeService] Error generating summary:', error);
    return { success: false, error: String(error) };
  }
}

export interface QuestionResponse {
  success: boolean;
  error?: string;
  answer?: QuestionAnswer;
}

/**
 * Ask a question about a paper
 */
export async function askQuestion(paperUrl: string, question: string): Promise<QuestionResponse> {
  logger.debug('SERVICE', '[ChromeService] Asking question:', question);

  try {
    const response = await chrome.runtime.sendMessage({
      type: MessageType.ASK_QUESTION,
      payload: {
        paperUrl,
        question: question.trim(),
      },
    });

    if (response.success) {
      logger.debug('SERVICE', '[ChromeService] ✓ Question answered successfully');
      return { success: true, answer: response.answer };
    } else {
      logger.error('SERVICE', '[ChromeService] Question answering failed:', response.error);
      return { success: false, error: response.error };
    }
  } catch (error) {
    logger.error('SERVICE', '[ChromeService] Error asking question:', error);
    return { success: false, error: String(error) };
  }
}

/**
 * Operation State Operations
 */

export interface OperationStateResponse {
  success: boolean;
  error?: string;
  state?: any;
}

/**
 * Get current operation state for a tab
 */
export async function getOperationState(tabId: number): Promise<OperationStateResponse> {
  logger.debug('SERVICE', '[ChromeService] Getting operation state for tab:', tabId);

  try {
    const response = await chrome.runtime.sendMessage({
      type: MessageType.GET_OPERATION_STATE,
      payload: { tabId },
    });

    if (response.success) {
      logger.debug('SERVICE', '[ChromeService] ✓ Operation state retrieved successfully');
      return { success: true, state: response.state };
    } else {
      logger.error('SERVICE', '[ChromeService] Failed to get operation state:', response.error);
      return { success: false, error: response.error };
    }
  } catch (error) {
    logger.error('SERVICE', '[ChromeService] Error getting operation state:', error);
    return { success: false, error: String(error) };
  }
}

/**
 * Get operation state for a specific paper by URL
 * Used by sidepanel which tracks papers independently of tabs
 */
export async function getOperationStateByPaper(paperUrl: string): Promise<OperationStateResponse> {
  logger.debug('SERVICE', '[ChromeService] Getting operation state for paper:', paperUrl);

  try {
    const response = await chrome.runtime.sendMessage({
      type: MessageType.GET_OPERATION_STATE_BY_PAPER,
      payload: { paperUrl },
    });

    if (response.success) {
      logger.debug('SERVICE', '[ChromeService] ✓ Operation state retrieved for paper');
      return { success: true, state: response.state };
    } else {
      logger.error('SERVICE', '[ChromeService] Failed to get operation state by paper:', response.error);
      return { success: false, error: response.error };
    }
  } catch (error) {
    logger.error('SERVICE', '[ChromeService] Error getting operation state by paper:', error);
    return { success: false, error: String(error) };
  }
}

/**
 * Paper Operations
 */

export interface ExplainPaperResponse {
  success: boolean;
  error?: string;
}

/**
 * Request explanation for a paper
 */
export async function explainPaper(paper: any): Promise<ExplainPaperResponse> {
  logger.debug('SERVICE', '[ChromeService] Requesting paper explanation for:', paper.title);

  try {
    const response = await chrome.runtime.sendMessage({
      type: MessageType.EXPLAIN_PAPER,
      payload: { paper },
    });

    if (response.success) {
      logger.debug('SERVICE', '[ChromeService] ✓ Paper explanation requested successfully');
      return { success: true };
    } else {
      logger.error('SERVICE', '[ChromeService] Paper explanation request failed:', response.error);
      return { success: false, error: response.error };
    }
  } catch (error) {
    logger.error('SERVICE', '[ChromeService] Error requesting paper explanation:', error);
    return { success: false, error: String(error) };
  }
}

export interface DetectAndExplainResponse {
  success: boolean;
  error?: string;
}

/**
 * Start the detect and explain flow for a tab
 */
export async function startDetectAndExplain(tabId: number): Promise<DetectAndExplainResponse> {
  logger.debug('SERVICE', '[ChromeService] Starting detect and explain for tab:', tabId);

  try {
    const response = await chrome.runtime.sendMessage({
      type: MessageType.START_DETECT_AND_EXPLAIN,
      payload: { tabId },
    });

    if (response.success) {
      logger.debug('SERVICE', '[ChromeService] ✓ Detect and explain started successfully');
      return { success: true };
    } else {
      logger.error('SERVICE', '[ChromeService] Detect and explain failed:', response.error);
      return { success: false, error: response.error };
    }
  } catch (error) {
    logger.error('SERVICE', '[ChromeService] Error starting detect and explain:', error);
    return { success: false, error: String(error) };
  }
}

/**
 * Check if a paper is stored in the database
 */
export async function isPaperStoredInDB(url: string): Promise<boolean> {
  const normalizedUrl = normalizeUrl(url);
  logger.debug('SERVICE', '[ChromeService] Checking if paper is stored:', url, '(normalized:', normalizedUrl, ')');

  try {
    const response = await chrome.runtime.sendMessage({
      type: MessageType.IS_PAPER_STORED_IN_DB,
      payload: { url: normalizedUrl },
    });

    if (response.success) {
      logger.debug('SERVICE', '[ChromeService] Paper stored check result:', response.isStored);
      return response.isStored || false;
    } else {
      logger.error('SERVICE', '[ChromeService] Failed to check paper storage:', response.error);
      return false;
    }
  } catch (error) {
    logger.error('SERVICE', '[ChromeService] Error checking paper storage:', error);
    return false;
  }
}

export interface PaperStatusInfo {
  isStored: boolean;
  hasExplanation: boolean;
  hasSummary: boolean;
  hasAnalysis: boolean;
  hasGlossary: boolean;
  hasDetected: boolean;
  hasChunked: boolean;
  completionPercentage: number;
}

/**
 * Get lightweight paper status (without full paper data)
 * Useful for quick checks on tab activation
 */
export async function getPaperStatus(url: string): Promise<PaperStatusInfo> {
  const normalizedUrl = normalizeUrl(url);
  logger.debug('SERVICE', '[ChromeService] Getting paper status for:', url, '(normalized:', normalizedUrl, ')');

  try {
    const paper = await getPaperByUrl(normalizedUrl);

    if (!paper) {
      return {
        isStored: false,
        hasExplanation: false,
        hasSummary: false,
        hasAnalysis: false,
        hasGlossary: false,
        hasDetected: false,
        hasChunked: false,
        completionPercentage: 0,
      };
    }

    const hasExplanation = !!paper.explanation;
    const hasSummary = !!paper.summary;
    const hasAnalysis = !!paper.analysis;
    const hasGlossary = !!paper.glossary;
    const hasDetected = true; // If paper exists in DB, it was detected
    const hasChunked = paper.chunkCount > 0; // If chunks exist, chunking completed

    const completedFeatures = [hasExplanation, hasSummary, hasAnalysis, hasGlossary].filter(Boolean).length;
    const completionPercentage = (completedFeatures / 4) * 100;

    return {
      isStored: true,
      hasExplanation,
      hasSummary,
      hasAnalysis,
      hasGlossary,
      hasDetected,
      hasChunked,
      completionPercentage,
    };
  } catch (error) {
    logger.error('SERVICE', '[ChromeService] Error getting paper status:', error);
    return {
      isStored: false,
      hasExplanation: false,
      hasSummary: false,
      hasAnalysis: false,
      hasGlossary: false,
      hasDetected: false,
      hasChunked: false,
      completionPercentage: 0,
    };
  }
}

/**
 * AI Management Operations
 */

export interface AICapabilities {
  availability: 'available' | 'downloadable' | 'downloading' | 'unavailable' | 'no';
}

export interface AIStatusResponse {
  success: boolean;
  error?: string;
  capabilities?: AICapabilities;
  downloadProgress?: number;
  currentDownloadingModel?: 'gemini' | 'embedding' | null;
}

/**
 * Check AI status and capabilities
 */
export async function checkAIStatus(): Promise<AIStatusResponse> {
  logger.debug('SERVICE', '[ChromeService] Checking AI status');

  try {
    const response = await chrome.runtime.sendMessage({
      type: MessageType.AI_STATUS,
    });

    if (response) {
      const capabilities = response.capabilities || { availability: 'no' };
      logger.debug('SERVICE', '[ChromeService] AI status retrieved:', capabilities.availability);
      return {
        success: true,
        capabilities,
        downloadProgress: response.downloadProgress,
        currentDownloadingModel: response.currentDownloadingModel
      };
    } else {
      logger.error('SERVICE', '[ChromeService] Failed to check AI status');
      return { success: false, error: 'No response from background' };
    }
  } catch (error) {
    logger.error('SERVICE', '[ChromeService] Error checking AI status:', error);
    return { success: false, error: String(error) };
  }
}

export interface AIInitResponse {
  success: boolean;
  message?: string;
  error?: string;
}

/**
 * Initialize AI
 */
export async function initializeAI(): Promise<AIInitResponse> {
  logger.debug('SERVICE', '[ChromeService] Initializing AI');

  try {
    const response = await chrome.runtime.sendMessage({
      type: MessageType.INITIALIZE_AI,
    });

    if (response.success) {
      logger.debug('SERVICE', '[ChromeService] ✓ AI initialized successfully');
      return { success: true, message: response.message };
    } else {
      logger.error('SERVICE', '[ChromeService] AI initialization failed:', response.message);
      return { success: false, error: response.message };
    }
  } catch (error) {
    logger.error('SERVICE', '[ChromeService] Error initializing AI:', error);
    return { success: false, error: String(error) };
  }
}

/**
 * Reset AI
 */
export async function resetAI(): Promise<AIInitResponse> {
  logger.debug('SERVICE', '[ChromeService] Resetting AI');

  try {
    const response = await chrome.runtime.sendMessage({
      type: MessageType.RESET_AI,
    });

    if (response.success) {
      logger.debug('SERVICE', '[ChromeService] ✓ AI reset successfully');
      return { success: true, message: response.message };
    } else {
      logger.error('SERVICE', '[ChromeService] AI reset failed:', response.message);
      return { success: false, error: response.message };
    }
  } catch (error) {
    logger.error('SERVICE', '[ChromeService] Error resetting AI:', error);
    return { success: false, error: String(error) };
  }
}

/**
 * UI Operations
 */

/**
 * Check if the sidepanel is currently open
 */
export async function isSidepanelOpen(): Promise<boolean> {
  logger.debug('SERVICE', '[ChromeService] Checking if sidepanel is open');

  try {
    const response = await chrome.runtime.sendMessage({
      type: MessageType.CHECK_SIDEPANEL_OPEN,
    });

    const isOpen = response?.isOpen || false;
    logger.debug('SERVICE', '[ChromeService] Sidepanel open status:', isOpen);
    return isOpen;
  } catch (error) {
    logger.error('SERVICE', '[ChromeService] Error checking sidepanel status:', error);
    return false;
  }
}

/**
 * Navigate the sidepanel to a specific paper by URL
 */
export async function navigateSidepanelToPaper(url: string): Promise<void> {
  logger.debug('SERVICE', '[ChromeService] Navigating sidepanel to paper:', url);

  try {
    await chrome.runtime.sendMessage({
      type: MessageType.NAVIGATE_TO_PAPER,
      payload: { url },
    });
    logger.debug('SERVICE', '[ChromeService] ✓ Navigation message sent');
  } catch (error) {
    logger.error('SERVICE', '[ChromeService] Error navigating sidepanel:', error);
  }
}

/**
 * Chat Operations
 */

export interface SendChatMessageResponse {
  success: boolean;
  error?: string;
}

/**
 * Send a chat message about a paper
 * Returns immediately - streaming responses are sent via CHAT_STREAM_CHUNK messages
 */
export async function sendChatMessage(paperUrl: string, message: string): Promise<SendChatMessageResponse> {
  logger.debug('SERVICE', '[ChromeService] Sending chat message:', message);

  try {
    const response = await chrome.runtime.sendMessage({
      type: MessageType.SEND_CHAT_MESSAGE,
      payload: {
        paperUrl,
        message: message.trim(),
      },
    });

    if (response.success) {
      logger.debug('SERVICE', '[ChromeService] ✓ Chat message sent successfully');
      return { success: true };
    } else {
      logger.error('SERVICE', '[ChromeService] Chat message failed:', response.error);
      return { success: false, error: response.error };
    }
  } catch (error) {
    logger.error('SERVICE', '[ChromeService] Error sending chat message:', error);
    return { success: false, error: String(error) };
  }
}

export interface UpdateChatHistoryResponse {
  success: boolean;
  error?: string;
}

/**
 * Update chat history for a paper in IndexedDB
 */
export async function updateChatHistory(paperUrl: string, chatHistory: ChatMessage[]): Promise<UpdateChatHistoryResponse> {
  logger.debug('SERVICE', '[ChromeService] Updating chat history for paper:', paperUrl);

  try {
    const response = await chrome.runtime.sendMessage({
      type: MessageType.UPDATE_CHAT_HISTORY,
      payload: { paperUrl, chatHistory },
    });

    if (response.success) {
      logger.debug('SERVICE', '[ChromeService] ✓ Chat history updated successfully');
      return { success: true };
    } else {
      logger.error('SERVICE', '[ChromeService] Failed to update chat history:', response.error);
      return { success: false, error: response.error };
    }
  } catch (error) {
    logger.error('SERVICE', '[ChromeService] Error updating chat history:', error);
    return { success: false, error: String(error) };
  }
}

export interface GetChatHistoryResponse {
  success: boolean;
  error?: string;
  chatHistory?: ChatMessage[];
}

/**
 * Get chat history for a paper from IndexedDB
 */
export async function getChatHistory(paperUrl: string): Promise<GetChatHistoryResponse> {
  logger.debug('SERVICE', '[ChromeService] Getting chat history for paper:', paperUrl);

  try {
    const response = await chrome.runtime.sendMessage({
      type: MessageType.GET_CHAT_HISTORY,
      payload: { paperUrl },
    });

    if (response.success) {
      logger.debug('SERVICE', '[ChromeService] ✓ Chat history retrieved successfully');
      return { success: true, chatHistory: response.chatHistory || [] };
    } else {
      logger.error('SERVICE', '[ChromeService] Failed to get chat history:', response.error);
      return { success: false, error: response.error };
    }
  } catch (error) {
    logger.error('SERVICE', '[ChromeService] Error getting chat history:', error);
    return { success: false, error: String(error) };
  }
}

/**
 * Clear chat history for a paper
 */
export async function clearChatHistory(paperUrl: string): Promise<UpdateChatHistoryResponse> {
  logger.debug('SERVICE', '[ChromeService] Clearing chat history for paper:', paperUrl);

  try {
    const response = await chrome.runtime.sendMessage({
      type: MessageType.CLEAR_CHAT_HISTORY,
      payload: { paperUrl },
    });

    if (response.success) {
      logger.debug('SERVICE', '[ChromeService] ✓ Chat history cleared successfully');
      return { success: true };
    } else {
      logger.error('SERVICE', '[ChromeService] Failed to clear chat history:', response.error);
      return { success: false, error: response.error };
    }
  } catch (error) {
    logger.error('SERVICE', '[ChromeService] Error clearing chat history:', error);
    return { success: false, error: String(error) };
  }
}

/**
 * Image Chat Operations (Multi-tabbed Chatbox)
 */

export interface SendImageChatMessageResponse {
  success: boolean;
  error?: string;
}

/**
 * Send an image chat message (multimodal chat about a specific image)
 * Returns immediately - streaming responses are sent via IMAGE_CHAT_STREAM_CHUNK messages
 */
export async function sendImageChatMessage(
  paperId: string,
  imageUrl: string,
  imageBlob: Blob,
  message: string
): Promise<SendImageChatMessageResponse> {
  logger.debug('SERVICE', '[ChromeService] Sending image chat message:', message);

  try {
    // Convert Blob to Base64 for Chrome messaging (Chrome uses JSON serialization, not structured cloning)
    const arrayBuffer = await imageBlob.arrayBuffer();
    const uint8Array = new Uint8Array(arrayBuffer);
    const imageMimeType = imageBlob.type;

    // Convert Uint8Array to Base64 string (chunk to avoid call stack overflow on large images)
    const chunkSize = 0x8000; // 32KB chunks
    let binaryString = '';
    for (let i = 0; i < uint8Array.length; i += chunkSize) {
      const chunk = uint8Array.subarray(i, Math.min(i + chunkSize, uint8Array.length));
      binaryString += String.fromCharCode.apply(null, Array.from(chunk));
    }
    const imageDataBase64 = btoa(binaryString);

    logger.debug('SERVICE', '[ChromeService] Converted blob to Base64:', imageDataBase64.length, 'chars, type:', imageMimeType);

    const response = await chrome.runtime.sendMessage({
      type: MessageType.IMAGE_CHAT_MESSAGE,
      payload: {
        paperId,
        imageUrl,
        imageDataBase64,
        imageMimeType,
        message: message.trim(),
      },
    });

    if (response.success) {
      logger.debug('SERVICE', '[ChromeService] ✓ Image chat message sent successfully');
      return { success: true };
    } else {
      logger.error('SERVICE', '[ChromeService] Image chat message failed:', response.error);
      return { success: false, error: response.error };
    }
  } catch (error) {
    logger.error('SERVICE', '[ChromeService] Error sending image chat message:', error);
    return { success: false, error: String(error) };
  }
}

export interface GetImageChatHistoryResponse {
  success: boolean;
  error?: string;
  chatHistory?: ChatMessage[];
}

/**
 * Get image chat history from IndexedDB
 */
export async function getImageChatHistory(
  paperId: string,
  imageUrl: string
): Promise<GetImageChatHistoryResponse> {
  logger.debug('SERVICE', '[ChromeService] Getting image chat history for image:', imageUrl);

  try {
    const response = await chrome.runtime.sendMessage({
      type: MessageType.GET_IMAGE_CHAT_HISTORY,
      payload: { paperId, imageUrl },
    });

    if (response.success) {
      logger.debug('SERVICE', '[ChromeService] ✓ Image chat history retrieved successfully');
      return { success: true, chatHistory: response.chatHistory || [] };
    } else {
      logger.error('SERVICE', '[ChromeService] Failed to get image chat history:', response.error);
      return { success: false, error: response.error };
    }
  } catch (error) {
    logger.error('SERVICE', '[ChromeService] Error getting image chat history:', error);
    return { success: false, error: String(error) };
  }
}

export interface UpdateImageChatHistoryResponse {
  success: boolean;
  error?: string;
}

/**
 * Update image chat history in IndexedDB
 */
export async function updateImageChatHistory(
  paperId: string,
  imageUrl: string,
  chatHistory: ChatMessage[]
): Promise<UpdateImageChatHistoryResponse> {
  logger.debug('SERVICE', '[ChromeService] Updating image chat history for image:', imageUrl);

  try {
    const response = await chrome.runtime.sendMessage({
      type: MessageType.UPDATE_IMAGE_CHAT_HISTORY,
      payload: { paperId, imageUrl, chatHistory },
    });

    if (response.success) {
      logger.debug('SERVICE', '[ChromeService] ✓ Image chat history updated successfully');
      return { success: true };
    } else {
      logger.error('SERVICE', '[ChromeService] Failed to update image chat history:', response.error);
      return { success: false, error: response.error };
    }
  } catch (error) {
    logger.error('SERVICE', '[ChromeService] Error updating image chat history:', error);
    return { success: false, error: String(error) };
  }
}

/**
 * Clear image chat history from IndexedDB
 */
export async function clearImageChatHistory(
  paperId: string,
  imageUrl: string
): Promise<UpdateImageChatHistoryResponse> {
  logger.debug('SERVICE', '[ChromeService] Clearing image chat history for image:', imageUrl);

  try {
    const response = await chrome.runtime.sendMessage({
      type: MessageType.CLEAR_IMAGE_CHAT_HISTORY,
      payload: { paperId, imageUrl },
    });

    if (response.success) {
      logger.debug('SERVICE', '[ChromeService] ✓ Image chat history cleared successfully');
      return { success: true };
    } else {
      logger.error('SERVICE', '[ChromeService] Failed to clear image chat history:', response.error);
      return { success: false, error: response.error };
    }
  } catch (error) {
    logger.error('SERVICE', '[ChromeService] Error clearing image chat history:', error);
    return { success: false, error: String(error) };
  }
}

/**
 * Toggle the chatbox visibility (content script)
 */
export async function toggleChatbox(tabId?: number): Promise<void> {
  logger.debug('SERVICE', '[ChromeService] Toggling chatbox');

  try {
    if (tabId) {
      await chrome.tabs.sendMessage(tabId, {
        type: MessageType.TOGGLE_CHATBOX,
      });
    } else {
      // Send to active tab
      const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tabs[0]?.id) {
        await chrome.tabs.sendMessage(tabs[0].id, {
          type: MessageType.TOGGLE_CHATBOX,
        });
      }
    }
    logger.debug('SERVICE', '[ChromeService] ✓ Chatbox toggle message sent');
  } catch (error) {
    logger.error('SERVICE', '[ChromeService] Error toggling chatbox:', error);
  }
}

/**
 * Get the current chatbox state (open/closed) from content script
 */
export async function getChatboxState(tabId?: number): Promise<boolean> {
  logger.debug('SERVICE', '[ChromeService] Getting chatbox state');

  try {
    let response;
    if (tabId) {
      response = await chrome.tabs.sendMessage(tabId, {
        type: MessageType.GET_CHATBOX_STATE,
      });
    } else {
      // Send to active tab
      const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tabs[0]?.id) {
        response = await chrome.tabs.sendMessage(tabs[0].id, {
          type: MessageType.GET_CHATBOX_STATE,
        });
      }
    }
    logger.debug('SERVICE', '[ChromeService] ✓ Chatbox state received:', response?.isOpen);
    return response?.isOpen || false;
  } catch (error) {
    logger.error('SERVICE', '[ChromeService] Error getting chatbox state:', error);
    return false;
  }
}

/**
 * Alias for getPaperByUrl for backwards compatibility
 */
export const getPaperFromDBByUrl = getPaperByUrl;

/**
 * Image Explanation Operations
 */

export interface StoreImageExplanationResponse {
  success: boolean;
  error?: string;
  explanation?: ImageExplanation;
}

export interface GetImageExplanationResponse {
  success: boolean;
  error?: string;
  explanation?: ImageExplanation | null;
}

export interface GetImageExplanationsByPaperResponse {
  success: boolean;
  error?: string;
  explanations?: ImageExplanation[];
}

/**
 * Store an image explanation in IndexedDB
 */
export async function storeImageExplanation(
  paperId: string,
  imageUrl: string,
  title: string,
  explanation: string,
  imageHash?: string
): Promise<StoreImageExplanationResponse> {
  logger.debug('SERVICE', '[ChromeService] Storing image explanation for:', imageUrl);

  try {
    const response = await chrome.runtime.sendMessage({
      type: MessageType.STORE_IMAGE_EXPLANATION,
      payload: { paperId, imageUrl, title, explanation, imageHash },
    });

    if (response.success) {
      logger.debug('SERVICE', '[ChromeService] ✓ Image explanation stored successfully');
      return response;
    } else {
      logger.error('SERVICE', '[ChromeService] Failed to store image explanation:', response.error);
      return response;
    }
  } catch (error) {
    logger.error('SERVICE', '[ChromeService] Error storing image explanation:', error);
    return { success: false, error: String(error) };
  }
}

/**
 * Get an image explanation from IndexedDB
 */
export async function getImageExplanation(
  paperId: string,
  imageUrl: string
): Promise<GetImageExplanationResponse> {
  logger.debug('SERVICE', '[ChromeService] Getting image explanation for:', imageUrl);

  try {
    const response = await chrome.runtime.sendMessage({
      type: MessageType.GET_IMAGE_EXPLANATION,
      payload: { paperId, imageUrl },
    });

    if (response.success) {
      logger.debug('SERVICE', '[ChromeService] ✓ Image explanation retrieved');
      return response;
    } else {
      logger.error('SERVICE', '[ChromeService] Failed to get image explanation:', response.error);
      return response;
    }
  } catch (error) {
    logger.error('SERVICE', '[ChromeService] Error getting image explanation:', error);
    return { success: false, error: String(error) };
  }
}

/**
 * Get all image explanations for a paper from IndexedDB
 */
export async function getImageExplanationsByPaper(
  paperId: string
): Promise<GetImageExplanationsByPaperResponse> {
  logger.debug('SERVICE', '[ChromeService] Getting all image explanations for paper:', paperId);

  try {
    const response = await chrome.runtime.sendMessage({
      type: MessageType.GET_IMAGE_EXPLANATIONS_BY_PAPER,
      payload: { paperId },
    });

    if (response.success) {
      logger.debug('SERVICE', '[ChromeService] ✓ Retrieved', response.explanations?.length || 0, 'image explanations');
      return response;
    } else {
      logger.error('SERVICE', '[ChromeService] Failed to get image explanations:', response.error);
      return response;
    }
  } catch (error) {
    logger.error('SERVICE', '[ChromeService] Error getting image explanations:', error);
    return { success: false, error: String(error), explanations: [] };
  }
}

/**
 * Screen Capture Operations
 */

export interface StoreScreenCaptureResponse {
  success: boolean;
  error?: string;
  entry?: import('../utils/dbService.ts').ScreenCaptureEntry;
}

export interface GetScreenCaptureResponse {
  success: boolean;
  error?: string;
  entry?: import('../utils/dbService.ts').ScreenCaptureEntry | null;
}

/**
 * Store a screen capture blob in IndexedDB
 */
export async function storeScreenCapture(
  paperId: string,
  imageUrl: string,
  blob: Blob,
  overlayPosition?: { pageX: number; pageY: number; width: number; height: number }
): Promise<StoreScreenCaptureResponse> {
  logger.debug('SERVICE', '[ChromeService] Storing screen capture:', imageUrl);

  try {
    // Convert Blob to Base64 for Chrome messaging (Chrome uses JSON serialization, not structured cloning)
    const arrayBuffer = await blob.arrayBuffer();
    const uint8Array = new Uint8Array(arrayBuffer);
    const mimeType = blob.type;

    // Convert Uint8Array to Base64 string (chunk to avoid call stack overflow on large images)
    const chunkSize = 0x8000; // 32KB chunks
    let binaryString = '';
    for (let i = 0; i < uint8Array.length; i += chunkSize) {
      const chunk = uint8Array.subarray(i, Math.min(i + chunkSize, uint8Array.length));
      binaryString += String.fromCharCode.apply(null, Array.from(chunk));
    }
    const blobDataBase64 = btoa(binaryString);

    logger.debug('SERVICE', '[ChromeService] Converted blob to Base64:', blobDataBase64.length, 'chars, type:', mimeType);

    const response = await chrome.runtime.sendMessage({
      type: MessageType.STORE_SCREEN_CAPTURE,
      payload: { paperId, imageUrl, blobDataBase64, mimeType, overlayPosition },
    });

    if (response.success) {
      logger.debug('SERVICE', '[ChromeService] ✓ Screen capture stored successfully');
      return response;
    } else {
      logger.error('SERVICE', '[ChromeService] Failed to store screen capture:', response.error);
      return response;
    }
  } catch (error) {
    logger.error('SERVICE', '[ChromeService] Error storing screen capture:', error);
    return { success: false, error: String(error) };
  }
}

/**
 * Get a screen capture blob from IndexedDB
 */
export async function getScreenCapture(
  paperId: string,
  imageUrl: string
): Promise<GetScreenCaptureResponse> {
  logger.debug('SERVICE', '[ChromeService] Getting screen capture:', imageUrl);

  try {
    const response = await chrome.runtime.sendMessage({
      type: MessageType.GET_SCREEN_CAPTURE,
      payload: { paperId, imageUrl },
    });

    if (response.success && response.entry) {
      // Reconstruct Blob from Base64 string (Chrome messaging uses JSON serialization)
      const binaryString = atob(response.entry.blobDataBase64);
      const bytes = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }
      const blob = new Blob([bytes], { type: response.entry.mimeType });
      logger.debug('SERVICE', '[ChromeService] ✓ Screen capture retrieved and reconstructed blob:', blob.size, 'bytes');

      return {
        success: true,
        entry: {
          paperId: response.entry.paperId,
          imageUrl: response.entry.imageUrl,
          timestamp: response.entry.timestamp,
          blob,
          overlayPosition: response.entry.overlayPosition,
        }
      };
    } else if (response.success) {
      logger.debug('SERVICE', '[ChromeService] Screen capture not found');
      return response;
    } else {
      logger.error('SERVICE', '[ChromeService] Failed to get screen capture:', response.error);
      return response;
    }
  } catch (error) {
    logger.error('SERVICE', '[ChromeService] Error getting screen capture:', error);
    return { success: false, error: String(error) };
  }
}

/**
 * Delete a screen capture blob from IndexedDB
 */
export async function deleteScreenCapture(
  paperId: string,
  imageUrl: string
): Promise<ChromeMessageResponse<boolean>> {
  logger.debug('SERVICE', '[ChromeService] Deleting screen capture:', imageUrl);

  try {
    const response = await chrome.runtime.sendMessage({
      type: MessageType.DELETE_SCREEN_CAPTURE,
      payload: { paperId, imageUrl },
    });

    if (response.success) {
      logger.debug('SERVICE', '[ChromeService] ✓ Screen capture deleted successfully');
      return response;
    } else {
      logger.error('SERVICE', '[ChromeService] Failed to delete screen capture:', response.error);
      return response;
    }
  } catch (error) {
    logger.error('SERVICE', '[ChromeService] Error deleting screen capture:', error);
    return { success: false, error: String(error) };
  }
}

/**
 * Delete an image explanation from IndexedDB
 */
export async function deleteImageExplanation(
  paperId: string,
  imageUrl: string
): Promise<ChromeMessageResponse<boolean>> {
  logger.debug('SERVICE', '[ChromeService] Deleting image explanation for:', imageUrl);

  try {
    const response = await chrome.runtime.sendMessage({
      type: MessageType.DELETE_IMAGE_EXPLANATION,
      payload: { paperId, imageUrl },
    });

    if (response.success) {
      logger.debug('SERVICE', '[ChromeService] ✓ Image explanation deleted successfully');
      return response;
    } else {
      logger.error('SERVICE', '[ChromeService] Failed to delete image explanation:', response.error);
      return response;
    }
  } catch (error) {
    logger.error('SERVICE', '[ChromeService] Error deleting image explanation:', error);
    return { success: false, error: String(error) };
  }
}

/**
 * Destroy an AI session by context ID
 */
export async function destroyAISession(
  contextId: string
): Promise<ChromeMessageResponse<boolean>> {
  logger.debug('SERVICE', '[ChromeService] Destroying AI session:', contextId);

  try {
    const response = await chrome.runtime.sendMessage({
      type: MessageType.DESTROY_AI_SESSION,
      payload: { contextId },
    });

    if (response.success) {
      logger.debug('SERVICE', '[ChromeService] ✓ AI session destroyed successfully');
      return response;
    } else {
      logger.error('SERVICE', '[ChromeService] Failed to destroy AI session:', response.error);
      return response;
    }
  } catch (error) {
    logger.error('SERVICE', '[ChromeService] Error destroying AI session:', error);
    return { success: false, error: String(error) };
  }
}
