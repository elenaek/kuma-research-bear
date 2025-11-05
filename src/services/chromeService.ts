/**
 * ChromeService - Facade for Chrome runtime messaging operations
 *
 * This service provides a clean API for communicating with the background worker
 * and other extension components. All actual messaging logic is delegated to
 * specialized client classes following the Facade pattern.
 *
 * Architecture:
 * - PaperServiceClient: Paper CRUD operations
 * - AIServiceClient: AI operations (explain, analyze, summarize, glossary, Q&A)
 * - ChatServiceClient: Text and image chat operations
 * - NavigationServiceClient: Sidepanel navigation and chatbox control
 * - StateServiceClient: Operation state queries
 */

import { PaperServiceClient, StorePaperResponse, PaperStatusInfo } from '../core/messaging/PaperServiceClient.ts';
import {
  AIServiceClient,
  AnalysisResponse,
  GlossaryResponse,
  ExplanationResponse,
  SummaryResponse,
  QuestionResponse,
  ExplainPaperResponse,
  DetectAndExplainResponse,
  AIStatusResponse,
  AIInitResponse,
} from '../core/messaging/AIServiceClient.ts';
import {
  ChatServiceClient,
  SendChatMessageResponse,
  UpdateChatHistoryResponse,
  GetChatHistoryResponse,
  SendImageChatMessageResponse,
  GetImageChatHistoryResponse,
  UpdateImageChatHistoryResponse,
  StoreImageExplanationResponse,
  GetImageExplanationResponse,
  GetImageExplanationsByPaperResponse,
  StoreScreenCaptureResponse,
  GetScreenCaptureResponse,
} from '../core/messaging/ChatServiceClient.ts';
import { NavigationServiceClient } from '../core/messaging/NavigationServiceClient.ts';
import { StateServiceClient, OperationStateResponse } from '../core/messaging/StateServiceClient.ts';

import type { StoredPaper, QuestionAnswer, ChatMessage, ContentChunk } from '../shared/types/index.ts';

// ============================================================================
// Singleton Client Instances
// ============================================================================

const paperClient = new PaperServiceClient();
const aiClient = new AIServiceClient();
const chatClient = new ChatServiceClient();
const navigationClient = new NavigationServiceClient();
const stateClient = new StateServiceClient();

// ============================================================================
// Re-export Response Interfaces for Backward Compatibility
// ============================================================================

export type {
  // Paper responses
  StorePaperResponse,
  PaperStatusInfo,
  // AI responses
  AnalysisResponse,
  GlossaryResponse,
  ExplanationResponse,
  SummaryResponse,
  QuestionResponse,
  ExplainPaperResponse,
  DetectAndExplainResponse,
  AIStatusResponse,
  AIInitResponse,
  // Chat responses
  SendChatMessageResponse,
  UpdateChatHistoryResponse,
  GetChatHistoryResponse,
  SendImageChatMessageResponse,
  GetImageChatHistoryResponse,
  UpdateImageChatHistoryResponse,
  StoreImageExplanationResponse,
  GetImageExplanationResponse,
  GetImageExplanationsByPaperResponse,
  StoreScreenCaptureResponse,
  GetScreenCaptureResponse,
  // State responses
  OperationStateResponse,
};

// Legacy interface for backward compatibility
export interface ChromeMessageResponse<T = any> {
  success: boolean;
  error?: string;
  data?: T;
}

// ============================================================================
// Paper Operations (delegates to PaperServiceClient)
// ============================================================================

/**
 * Get a paper from IndexedDB by its URL
 */
export async function getPaperByUrl(url: string): Promise<StoredPaper | null> {
  return paperClient.getPaperByUrl(url);
}

/**
 * Get all papers from IndexedDB
 */
export async function getAllPapers(): Promise<StoredPaper[]> {
  return paperClient.getAllPapers();
}

/**
 * Update Q&A history for a paper in IndexedDB
 */
export async function updatePaperQAHistory(paperId: string, qaHistory: QuestionAnswer[]): Promise<boolean> {
  return paperClient.updatePaperQAHistory(paperId, qaHistory);
}

/**
 * Delete a paper from IndexedDB
 */
export async function deletePaper(paperId: string): Promise<boolean> {
  return paperClient.deletePaper(paperId);
}

/**
 * Store a paper in IndexedDB with full text or pre-chunked data
 */
export async function storePaperInDB(
  paper: any,
  fullText?: string,
  preChunkedData?: {
    chunks: ContentChunk[];
    metadata: { averageChunkSize?: number };
  }
): Promise<StorePaperResponse> {
  return paperClient.storePaperInDB(paper, fullText, preChunkedData);
}

/**
 * Check if a paper is stored in the database
 */
export async function isPaperStoredInDB(url: string): Promise<boolean> {
  return paperClient.isPaperStoredInDB(url);
}

/**
 * Get lightweight paper status (without full paper data)
 * Useful for quick checks on tab activation
 */
export async function getPaperStatus(url: string): Promise<PaperStatusInfo> {
  return paperClient.getPaperStatus(url);
}

/**
 * Alias for getPaperByUrl (backward compatibility)
 */
export const getPaperFromDBByUrl = getPaperByUrl;

// ============================================================================
// AI Operations (delegates to AIServiceClient)
// ============================================================================

/**
 * Trigger paper analysis
 */
export async function analyzePaper(paperUrl: string, tabId?: number): Promise<AnalysisResponse> {
  return aiClient.analyzePaper(paperUrl, tabId);
}

/**
 * Generate glossary for a paper
 */
export async function generateGlossary(paperUrl: string, tabId?: number): Promise<GlossaryResponse> {
  return aiClient.generateGlossary(paperUrl, tabId);
}

/**
 * Generate explanation for a paper manually
 */
export async function explainPaperManual(paperUrl: string, tabId?: number): Promise<ExplanationResponse> {
  return aiClient.explainPaperManual(paperUrl, tabId);
}

/**
 * Generate summary for a paper manually
 */
export async function generateSummaryManual(paperUrl: string, tabId?: number): Promise<SummaryResponse> {
  return aiClient.generateSummaryManual(paperUrl, tabId);
}

/**
 * Ask a question about a paper
 */
export async function askQuestion(paperUrl: string, question: string): Promise<QuestionResponse> {
  return aiClient.askQuestion(paperUrl, question);
}

/**
 * Request explanation for a paper
 */
export async function explainPaper(paper: any): Promise<ExplainPaperResponse> {
  return aiClient.explainPaper(paper);
}

/**
 * Start the detect and explain flow for a tab
 */
export async function startDetectAndExplain(tabId: number): Promise<DetectAndExplainResponse> {
  return aiClient.startDetectAndExplain(tabId);
}

/**
 * Check AI status and capabilities
 */
export async function checkAIStatus(): Promise<AIStatusResponse> {
  return aiClient.checkAIStatus();
}

/**
 * Initialize AI
 */
export async function initializeAI(): Promise<AIInitResponse> {
  return aiClient.initializeAI();
}

/**
 * Reset AI
 */
export async function resetAI(): Promise<AIInitResponse> {
  return aiClient.resetAI();
}

/**
 * Destroy an AI session by context ID
 */
export async function destroyAISession(contextId: string): Promise<{ success: boolean; error?: string }> {
  return aiClient.destroyAISession(contextId);
}

// ============================================================================
// Chat Operations (delegates to ChatServiceClient)
// ============================================================================

/**
 * Send a chat message about a paper
 * Returns immediately - streaming responses are sent via CHAT_STREAM_CHUNK messages
 */
export async function sendChatMessage(paperUrl: string, message: string): Promise<SendChatMessageResponse> {
  return chatClient.sendChatMessage(paperUrl, message);
}

/**
 * Update chat history for a paper in IndexedDB
 */
export async function updateChatHistory(
  paperUrl: string,
  chatHistory: ChatMessage[]
): Promise<UpdateChatHistoryResponse> {
  return chatClient.updateChatHistory(paperUrl, chatHistory);
}

/**
 * Get chat history for a paper from IndexedDB
 */
export async function getChatHistory(paperUrl: string): Promise<GetChatHistoryResponse> {
  return chatClient.getChatHistory(paperUrl);
}

/**
 * Clear chat history for a paper
 */
export async function clearChatHistory(paperUrl: string): Promise<UpdateChatHistoryResponse> {
  return chatClient.clearChatHistory(paperUrl);
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
  return chatClient.sendImageChatMessage(paperId, imageUrl, imageBlob, message);
}

/**
 * Get image chat history from IndexedDB
 */
export async function getImageChatHistory(
  paperId: string,
  imageUrl: string
): Promise<GetImageChatHistoryResponse> {
  return chatClient.getImageChatHistory(paperId, imageUrl);
}

/**
 * Update image chat history in IndexedDB
 */
export async function updateImageChatHistory(
  paperId: string,
  imageUrl: string,
  chatHistory: ChatMessage[]
): Promise<UpdateImageChatHistoryResponse> {
  return chatClient.updateImageChatHistory(paperId, imageUrl, chatHistory);
}

/**
 * Clear image chat history from IndexedDB
 */
export async function clearImageChatHistory(
  paperId: string,
  imageUrl: string
): Promise<UpdateImageChatHistoryResponse> {
  return chatClient.clearImageChatHistory(paperId, imageUrl);
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
  return chatClient.storeImageExplanation(paperId, imageUrl, title, explanation, imageHash);
}

/**
 * Get an image explanation from IndexedDB
 */
export async function getImageExplanation(
  paperId: string,
  imageUrl: string
): Promise<GetImageExplanationResponse> {
  return chatClient.getImageExplanation(paperId, imageUrl);
}

/**
 * Get all image explanations for a paper from IndexedDB
 */
export async function getImageExplanationsByPaper(paperId: string): Promise<GetImageExplanationsByPaperResponse> {
  return chatClient.getImageExplanationsByPaper(paperId);
}

/**
 * Delete an image explanation from IndexedDB
 */
export async function deleteImageExplanation(
  paperId: string,
  imageUrl: string
): Promise<{ success: boolean; error?: string }> {
  return chatClient.deleteImageExplanation(paperId, imageUrl);
}

/**
 * Store a screen capture in IndexedDB
 */
export async function storeScreenCapture(
  paperId: string,
  imageUrl: string,
  blob: Blob,
  overlayPosition?: { pageX: number; pageY: number; width: number; height: number }
): Promise<StoreScreenCaptureResponse> {
  return chatClient.storeScreenCapture(paperId, imageUrl, blob, overlayPosition);
}

/**
 * Get a screen capture from IndexedDB
 */
export async function getScreenCapture(paperId: string, imageUrl: string): Promise<GetScreenCaptureResponse> {
  return chatClient.getScreenCapture(paperId, imageUrl);
}

/**
 * Delete a screen capture from IndexedDB
 */
export async function deleteScreenCapture(
  paperId: string,
  imageUrl: string
): Promise<{ success: boolean; error?: string }> {
  return chatClient.deleteScreenCapture(paperId, imageUrl);
}

// ============================================================================
// Navigation Operations (delegates to NavigationServiceClient)
// ============================================================================

/**
 * Check if sidepanel is currently open
 */
export async function isSidepanelOpen(): Promise<boolean> {
  return navigationClient.isSidepanelOpen();
}

/**
 * Navigate the sidepanel to a specific paper by URL
 */
export async function navigateSidepanelToPaper(url: string): Promise<void> {
  return navigationClient.navigateSidepanelToPaper(url);
}

/**
 * Toggle the chatbox visibility (content script)
 */
export async function toggleChatbox(tabId?: number): Promise<void> {
  return navigationClient.toggleChatbox(tabId);
}

/**
 * Get the current chatbox state (open/closed) from content script
 */
export async function getChatboxState(tabId?: number): Promise<boolean> {
  return navigationClient.getChatboxState(tabId);
}

// ============================================================================
// State Operations (delegates to StateServiceClient)
// ============================================================================

/**
 * Get current operation state for a tab
 */
export async function getOperationState(tabId: number): Promise<OperationStateResponse> {
  return stateClient.getOperationState(tabId);
}

/**
 * Get operation state for a specific paper by URL
 * Used by sidepanel which tracks papers independently of tabs
 */
export async function getOperationStateByPaper(paperUrl: string): Promise<OperationStateResponse> {
  return stateClient.getOperationStateByPaper(paperUrl);
}
