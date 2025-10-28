import { MessageType, StoredPaper, QuestionAnswer, PaperAnalysisResult, GlossaryResult, ChatMessage, ImageExplanation } from '../types/index.ts';
import { normalizeUrl } from '../utils/urlUtils.ts';

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
  console.log('[ChromeService] Requesting paper from background worker:', url, '(normalized:', normalizedUrl, ')');

  try {
    const response = await chrome.runtime.sendMessage({
      type: MessageType.GET_PAPER_FROM_DB_BY_URL,
      payload: { url: normalizedUrl },
    });

    if (response.success) {
      console.log('[ChromeService] Paper retrieval result:', response.paper ? 'Found' : 'Not found');
      return response.paper || null;
    } else {
      console.error('[ChromeService] Failed to get paper:', response.error);
      return null;
    }
  } catch (error) {
    console.error('[ChromeService] Error getting paper by URL:', error);
    return null;
  }
}

/**
 * Get all papers from IndexedDB
 */
export async function getAllPapers(): Promise<StoredPaper[]> {
  console.log('[ChromeService] Requesting all papers from background worker');

  try {
    const response = await chrome.runtime.sendMessage({
      type: MessageType.GET_ALL_PAPERS_FROM_DB,
      payload: {},
    });

    if (response.success) {
      console.log('[ChromeService] Retrieved', response.papers?.length || 0, 'papers');
      return response.papers || [];
    } else {
      console.error('[ChromeService] Failed to get all papers:', response.error);
      return [];
    }
  } catch (error) {
    console.error('[ChromeService] Error getting all papers:', error);
    return [];
  }
}

/**
 * Update Q&A history for a paper in IndexedDB
 */
export async function updatePaperQAHistory(paperId: string, qaHistory: QuestionAnswer[]): Promise<boolean> {
  console.log('[ChromeService] Updating Q&A history for paper:', paperId);

  try {
    const response = await chrome.runtime.sendMessage({
      type: MessageType.UPDATE_PAPER_QA_HISTORY,
      payload: { paperId, qaHistory },
    });

    if (response.success) {
      console.log('[ChromeService] Q&A history updated successfully');
      return true;
    } else {
      console.error('[ChromeService] Failed to update Q&A history:', response.error);
      return false;
    }
  } catch (error) {
    console.error('[ChromeService] Error updating Q&A history:', error);
    return false;
  }
}

/**
 * Delete a paper from IndexedDB
 */
export async function deletePaper(paperId: string): Promise<boolean> {
  console.log('[ChromeService] Deleting paper:', paperId);

  try {
    const response = await chrome.runtime.sendMessage({
      type: MessageType.DELETE_PAPER_FROM_DB,
      payload: { paperId },
    });

    if (response.success) {
      console.log('[ChromeService] Paper deleted successfully');
      return true;
    } else {
      console.error('[ChromeService] Failed to delete paper:', response.error);
      return false;
    }
  } catch (error) {
    console.error('[ChromeService] Error deleting paper:', error);
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
  console.log('[ChromeService] Storing paper in IndexedDB:', paper.title);

  try {
    const response = await chrome.runtime.sendMessage({
      type: MessageType.STORE_PAPER_IN_DB,
      payload: { paper, fullText, preChunkedData },
    });

    if (response.success) {
      console.log('[ChromeService] ✓ Paper stored successfully');
      return { success: true, paper: response.paper };
    } else {
      console.error('[ChromeService] Failed to store paper:', response.error);
      return { success: false, error: response.error };
    }
  } catch (error) {
    console.error('[ChromeService] Error storing paper:', error);
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
  console.log('[ChromeService] Starting paper analysis for:', paperUrl, 'tabId:', tabId);

  try {
    const response = await chrome.runtime.sendMessage({
      type: MessageType.ANALYZE_PAPER,
      payload: { url: paperUrl, tabId },
    });

    if (response.success) {
      console.log('[ChromeService] ✓ Paper analysis completed successfully');
      return { success: true, analysis: response.analysis };
    } else {
      console.error('[ChromeService] Analysis failed:', response.error);
      return { success: false, error: response.error };
    }
  } catch (error) {
    console.error('[ChromeService] Error triggering analysis:', error);
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
  console.log('[ChromeService] Starting glossary generation for:', paperUrl, 'tabId:', tabId);

  try {
    const response = await chrome.runtime.sendMessage({
      type: MessageType.GENERATE_GLOSSARY,
      payload: { url: paperUrl, tabId },
    });

    if (response.success) {
      console.log('[ChromeService] ✓ Glossary generated successfully');
      return { success: true, glossary: response.glossary };
    } else {
      console.error('[ChromeService] Glossary generation failed:', response.error);
      return { success: false, error: response.error };
    }
  } catch (error) {
    console.error('[ChromeService] Error generating glossary:', error);
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
  console.log('[ChromeService] Starting explanation generation for:', paperUrl, 'tabId:', tabId);

  try {
    const response = await chrome.runtime.sendMessage({
      type: MessageType.EXPLAIN_PAPER_MANUAL,
      payload: { url: paperUrl, tabId },
    });

    if (response.success) {
      console.log('[ChromeService] ✓ Explanation generated successfully');
      return { success: true, explanation: response.explanation };
    } else {
      console.error('[ChromeService] Explanation generation failed:', response.error);
      return { success: false, error: response.error };
    }
  } catch (error) {
    console.error('[ChromeService] Error generating explanation:', error);
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
  console.log('[ChromeService] Starting summary generation for:', paperUrl, 'tabId:', tabId);

  try {
    const response = await chrome.runtime.sendMessage({
      type: MessageType.GENERATE_SUMMARY_MANUAL,
      payload: { url: paperUrl, tabId },
    });

    if (response.success) {
      console.log('[ChromeService] ✓ Summary generated successfully');
      return { success: true, summary: response.summary };
    } else {
      console.error('[ChromeService] Summary generation failed:', response.error);
      return { success: false, error: response.error };
    }
  } catch (error) {
    console.error('[ChromeService] Error generating summary:', error);
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
  console.log('[ChromeService] Asking question:', question);

  try {
    const response = await chrome.runtime.sendMessage({
      type: MessageType.ASK_QUESTION,
      payload: {
        paperUrl,
        question: question.trim(),
      },
    });

    if (response.success) {
      console.log('[ChromeService] ✓ Question answered successfully');
      return { success: true, answer: response.answer };
    } else {
      console.error('[ChromeService] Question answering failed:', response.error);
      return { success: false, error: response.error };
    }
  } catch (error) {
    console.error('[ChromeService] Error asking question:', error);
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
  console.log('[ChromeService] Getting operation state for tab:', tabId);

  try {
    const response = await chrome.runtime.sendMessage({
      type: MessageType.GET_OPERATION_STATE,
      payload: { tabId },
    });

    if (response.success) {
      console.log('[ChromeService] ✓ Operation state retrieved successfully');
      return { success: true, state: response.state };
    } else {
      console.error('[ChromeService] Failed to get operation state:', response.error);
      return { success: false, error: response.error };
    }
  } catch (error) {
    console.error('[ChromeService] Error getting operation state:', error);
    return { success: false, error: String(error) };
  }
}

/**
 * Get operation state for a specific paper by URL
 * Used by sidepanel which tracks papers independently of tabs
 */
export async function getOperationStateByPaper(paperUrl: string): Promise<OperationStateResponse> {
  console.log('[ChromeService] Getting operation state for paper:', paperUrl);

  try {
    const response = await chrome.runtime.sendMessage({
      type: MessageType.GET_OPERATION_STATE_BY_PAPER,
      payload: { paperUrl },
    });

    if (response.success) {
      console.log('[ChromeService] ✓ Operation state retrieved for paper');
      return { success: true, state: response.state };
    } else {
      console.error('[ChromeService] Failed to get operation state by paper:', response.error);
      return { success: false, error: response.error };
    }
  } catch (error) {
    console.error('[ChromeService] Error getting operation state by paper:', error);
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
  console.log('[ChromeService] Requesting paper explanation for:', paper.title);

  try {
    const response = await chrome.runtime.sendMessage({
      type: MessageType.EXPLAIN_PAPER,
      payload: { paper },
    });

    if (response.success) {
      console.log('[ChromeService] ✓ Paper explanation requested successfully');
      return { success: true };
    } else {
      console.error('[ChromeService] Paper explanation request failed:', response.error);
      return { success: false, error: response.error };
    }
  } catch (error) {
    console.error('[ChromeService] Error requesting paper explanation:', error);
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
  console.log('[ChromeService] Starting detect and explain for tab:', tabId);

  try {
    const response = await chrome.runtime.sendMessage({
      type: MessageType.START_DETECT_AND_EXPLAIN,
      payload: { tabId },
    });

    if (response.success) {
      console.log('[ChromeService] ✓ Detect and explain started successfully');
      return { success: true };
    } else {
      console.error('[ChromeService] Detect and explain failed:', response.error);
      return { success: false, error: response.error };
    }
  } catch (error) {
    console.error('[ChromeService] Error starting detect and explain:', error);
    return { success: false, error: String(error) };
  }
}

/**
 * Check if a paper is stored in the database
 */
export async function isPaperStoredInDB(url: string): Promise<boolean> {
  const normalizedUrl = normalizeUrl(url);
  console.log('[ChromeService] Checking if paper is stored:', url, '(normalized:', normalizedUrl, ')');

  try {
    const response = await chrome.runtime.sendMessage({
      type: MessageType.IS_PAPER_STORED_IN_DB,
      payload: { url: normalizedUrl },
    });

    if (response.success) {
      console.log('[ChromeService] Paper stored check result:', response.isStored);
      return response.isStored || false;
    } else {
      console.error('[ChromeService] Failed to check paper storage:', response.error);
      return false;
    }
  } catch (error) {
    console.error('[ChromeService] Error checking paper storage:', error);
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
  console.log('[ChromeService] Getting paper status for:', url, '(normalized:', normalizedUrl, ')');

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
    console.error('[ChromeService] Error getting paper status:', error);
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
  console.log('[ChromeService] Checking AI status');

  try {
    const response = await chrome.runtime.sendMessage({
      type: MessageType.AI_STATUS,
    });

    if (response) {
      const capabilities = response.capabilities || { availability: 'no' };
      console.log('[ChromeService] AI status retrieved:', capabilities.availability);
      return {
        success: true,
        capabilities,
        downloadProgress: response.downloadProgress,
        currentDownloadingModel: response.currentDownloadingModel
      };
    } else {
      console.error('[ChromeService] Failed to check AI status');
      return { success: false, error: 'No response from background' };
    }
  } catch (error) {
    console.error('[ChromeService] Error checking AI status:', error);
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
  console.log('[ChromeService] Initializing AI');

  try {
    const response = await chrome.runtime.sendMessage({
      type: MessageType.INITIALIZE_AI,
    });

    if (response.success) {
      console.log('[ChromeService] ✓ AI initialized successfully');
      return { success: true, message: response.message };
    } else {
      console.error('[ChromeService] AI initialization failed:', response.message);
      return { success: false, error: response.message };
    }
  } catch (error) {
    console.error('[ChromeService] Error initializing AI:', error);
    return { success: false, error: String(error) };
  }
}

/**
 * Reset AI
 */
export async function resetAI(): Promise<AIInitResponse> {
  console.log('[ChromeService] Resetting AI');

  try {
    const response = await chrome.runtime.sendMessage({
      type: MessageType.RESET_AI,
    });

    if (response.success) {
      console.log('[ChromeService] ✓ AI reset successfully');
      return { success: true, message: response.message };
    } else {
      console.error('[ChromeService] AI reset failed:', response.message);
      return { success: false, error: response.message };
    }
  } catch (error) {
    console.error('[ChromeService] Error resetting AI:', error);
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
  console.log('[ChromeService] Checking if sidepanel is open');

  try {
    const response = await chrome.runtime.sendMessage({
      type: MessageType.CHECK_SIDEPANEL_OPEN,
    });

    const isOpen = response?.isOpen || false;
    console.log('[ChromeService] Sidepanel open status:', isOpen);
    return isOpen;
  } catch (error) {
    console.error('[ChromeService] Error checking sidepanel status:', error);
    return false;
  }
}

/**
 * Navigate the sidepanel to a specific paper by URL
 */
export async function navigateSidepanelToPaper(url: string): Promise<void> {
  console.log('[ChromeService] Navigating sidepanel to paper:', url);

  try {
    await chrome.runtime.sendMessage({
      type: MessageType.NAVIGATE_TO_PAPER,
      payload: { url },
    });
    console.log('[ChromeService] ✓ Navigation message sent');
  } catch (error) {
    console.error('[ChromeService] Error navigating sidepanel:', error);
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
  console.log('[ChromeService] Sending chat message:', message);

  try {
    const response = await chrome.runtime.sendMessage({
      type: MessageType.SEND_CHAT_MESSAGE,
      payload: {
        paperUrl,
        message: message.trim(),
      },
    });

    if (response.success) {
      console.log('[ChromeService] ✓ Chat message sent successfully');
      return { success: true };
    } else {
      console.error('[ChromeService] Chat message failed:', response.error);
      return { success: false, error: response.error };
    }
  } catch (error) {
    console.error('[ChromeService] Error sending chat message:', error);
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
  console.log('[ChromeService] Updating chat history for paper:', paperUrl);

  try {
    const response = await chrome.runtime.sendMessage({
      type: MessageType.UPDATE_CHAT_HISTORY,
      payload: { paperUrl, chatHistory },
    });

    if (response.success) {
      console.log('[ChromeService] ✓ Chat history updated successfully');
      return { success: true };
    } else {
      console.error('[ChromeService] Failed to update chat history:', response.error);
      return { success: false, error: response.error };
    }
  } catch (error) {
    console.error('[ChromeService] Error updating chat history:', error);
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
  console.log('[ChromeService] Getting chat history for paper:', paperUrl);

  try {
    const response = await chrome.runtime.sendMessage({
      type: MessageType.GET_CHAT_HISTORY,
      payload: { paperUrl },
    });

    if (response.success) {
      console.log('[ChromeService] ✓ Chat history retrieved successfully');
      return { success: true, chatHistory: response.chatHistory || [] };
    } else {
      console.error('[ChromeService] Failed to get chat history:', response.error);
      return { success: false, error: response.error };
    }
  } catch (error) {
    console.error('[ChromeService] Error getting chat history:', error);
    return { success: false, error: String(error) };
  }
}

/**
 * Clear chat history for a paper
 */
export async function clearChatHistory(paperUrl: string): Promise<UpdateChatHistoryResponse> {
  console.log('[ChromeService] Clearing chat history for paper:', paperUrl);

  try {
    const response = await chrome.runtime.sendMessage({
      type: MessageType.CLEAR_CHAT_HISTORY,
      payload: { paperUrl },
    });

    if (response.success) {
      console.log('[ChromeService] ✓ Chat history cleared successfully');
      return { success: true };
    } else {
      console.error('[ChromeService] Failed to clear chat history:', response.error);
      return { success: false, error: response.error };
    }
  } catch (error) {
    console.error('[ChromeService] Error clearing chat history:', error);
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
  console.log('[ChromeService] Sending image chat message:', message);

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

    console.log('[ChromeService] Converted blob to Base64:', imageDataBase64.length, 'chars, type:', imageMimeType);

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
      console.log('[ChromeService] ✓ Image chat message sent successfully');
      return { success: true };
    } else {
      console.error('[ChromeService] Image chat message failed:', response.error);
      return { success: false, error: response.error };
    }
  } catch (error) {
    console.error('[ChromeService] Error sending image chat message:', error);
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
  console.log('[ChromeService] Getting image chat history for image:', imageUrl);

  try {
    const response = await chrome.runtime.sendMessage({
      type: MessageType.GET_IMAGE_CHAT_HISTORY,
      payload: { paperId, imageUrl },
    });

    if (response.success) {
      console.log('[ChromeService] ✓ Image chat history retrieved successfully');
      return { success: true, chatHistory: response.chatHistory || [] };
    } else {
      console.error('[ChromeService] Failed to get image chat history:', response.error);
      return { success: false, error: response.error };
    }
  } catch (error) {
    console.error('[ChromeService] Error getting image chat history:', error);
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
  console.log('[ChromeService] Updating image chat history for image:', imageUrl);

  try {
    const response = await chrome.runtime.sendMessage({
      type: MessageType.UPDATE_IMAGE_CHAT_HISTORY,
      payload: { paperId, imageUrl, chatHistory },
    });

    if (response.success) {
      console.log('[ChromeService] ✓ Image chat history updated successfully');
      return { success: true };
    } else {
      console.error('[ChromeService] Failed to update image chat history:', response.error);
      return { success: false, error: response.error };
    }
  } catch (error) {
    console.error('[ChromeService] Error updating image chat history:', error);
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
  console.log('[ChromeService] Clearing image chat history for image:', imageUrl);

  try {
    const response = await chrome.runtime.sendMessage({
      type: MessageType.CLEAR_IMAGE_CHAT_HISTORY,
      payload: { paperId, imageUrl },
    });

    if (response.success) {
      console.log('[ChromeService] ✓ Image chat history cleared successfully');
      return { success: true };
    } else {
      console.error('[ChromeService] Failed to clear image chat history:', response.error);
      return { success: false, error: response.error };
    }
  } catch (error) {
    console.error('[ChromeService] Error clearing image chat history:', error);
    return { success: false, error: String(error) };
  }
}

/**
 * Toggle the chatbox visibility (content script)
 */
export async function toggleChatbox(tabId?: number): Promise<void> {
  console.log('[ChromeService] Toggling chatbox');

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
    console.log('[ChromeService] ✓ Chatbox toggle message sent');
  } catch (error) {
    console.error('[ChromeService] Error toggling chatbox:', error);
  }
}

/**
 * Get the current chatbox state (open/closed) from content script
 */
export async function getChatboxState(tabId?: number): Promise<boolean> {
  console.log('[ChromeService] Getting chatbox state');

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
    console.log('[ChromeService] ✓ Chatbox state received:', response?.isOpen);
    return response?.isOpen || false;
  } catch (error) {
    console.error('[ChromeService] Error getting chatbox state:', error);
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
  console.log('[ChromeService] Storing image explanation for:', imageUrl);

  try {
    const response = await chrome.runtime.sendMessage({
      type: MessageType.STORE_IMAGE_EXPLANATION,
      payload: { paperId, imageUrl, title, explanation, imageHash },
    });

    if (response.success) {
      console.log('[ChromeService] ✓ Image explanation stored successfully');
      return response;
    } else {
      console.error('[ChromeService] Failed to store image explanation:', response.error);
      return response;
    }
  } catch (error) {
    console.error('[ChromeService] Error storing image explanation:', error);
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
  console.log('[ChromeService] Getting image explanation for:', imageUrl);

  try {
    const response = await chrome.runtime.sendMessage({
      type: MessageType.GET_IMAGE_EXPLANATION,
      payload: { paperId, imageUrl },
    });

    if (response.success) {
      console.log('[ChromeService] ✓ Image explanation retrieved');
      return response;
    } else {
      console.error('[ChromeService] Failed to get image explanation:', response.error);
      return response;
    }
  } catch (error) {
    console.error('[ChromeService] Error getting image explanation:', error);
    return { success: false, error: String(error) };
  }
}

/**
 * Get all image explanations for a paper from IndexedDB
 */
export async function getImageExplanationsByPaper(
  paperId: string
): Promise<GetImageExplanationsByPaperResponse> {
  console.log('[ChromeService] Getting all image explanations for paper:', paperId);

  try {
    const response = await chrome.runtime.sendMessage({
      type: MessageType.GET_IMAGE_EXPLANATIONS_BY_PAPER,
      payload: { paperId },
    });

    if (response.success) {
      console.log('[ChromeService] ✓ Retrieved', response.explanations?.length || 0, 'image explanations');
      return response;
    } else {
      console.error('[ChromeService] Failed to get image explanations:', response.error);
      return response;
    }
  } catch (error) {
    console.error('[ChromeService] Error getting image explanations:', error);
    return { success: false, error: String(error), explanations: [] };
  }
}
