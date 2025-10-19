import { MessageType, StoredPaper, QuestionAnswer, PaperAnalysisResult, GlossaryResult } from '../types/index.ts';

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
  console.log('[ChromeService] Requesting paper from background worker:', url);

  try {
    const response = await chrome.runtime.sendMessage({
      type: MessageType.GET_PAPER_FROM_DB_BY_URL,
      payload: { url },
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
 * Store a paper in IndexedDB with full text
 */
export async function storePaperInDB(paper: any, fullText?: string): Promise<StorePaperResponse> {
  console.log('[ChromeService] Storing paper in IndexedDB:', paper.title);

  try {
    const response = await chrome.runtime.sendMessage({
      type: MessageType.STORE_PAPER_IN_DB,
      payload: { paper, fullText },
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
export async function analyzePaper(paperUrl: string): Promise<AnalysisResponse> {
  console.log('[ChromeService] Starting paper analysis for:', paperUrl);

  try {
    const response = await chrome.runtime.sendMessage({
      type: MessageType.ANALYZE_PAPER,
      payload: { url: paperUrl },
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
export async function generateGlossary(paperUrl: string): Promise<GlossaryResponse> {
  console.log('[ChromeService] Starting glossary generation for:', paperUrl);

  try {
    const response = await chrome.runtime.sendMessage({
      type: MessageType.GENERATE_GLOSSARY,
      payload: { url: paperUrl },
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
  console.log('[ChromeService] Checking if paper is stored:', url);

  try {
    const response = await chrome.runtime.sendMessage({
      type: MessageType.IS_PAPER_STORED_IN_DB,
      payload: { url },
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
  completionPercentage: number;
}

/**
 * Get lightweight paper status (without full paper data)
 * Useful for quick checks on tab activation
 */
export async function getPaperStatus(url: string): Promise<PaperStatusInfo> {
  console.log('[ChromeService] Getting paper status for:', url);

  try {
    const paper = await getPaperByUrl(url);

    if (!paper) {
      return {
        isStored: false,
        hasExplanation: false,
        hasSummary: false,
        hasAnalysis: false,
        hasGlossary: false,
        completionPercentage: 0,
      };
    }

    const hasExplanation = !!paper.explanation;
    const hasSummary = !!paper.summary;
    const hasAnalysis = !!paper.analysis;
    const hasGlossary = !!paper.glossary;

    const completedFeatures = [hasExplanation, hasSummary, hasAnalysis, hasGlossary].filter(Boolean).length;
    const completionPercentage = (completedFeatures / 4) * 100;

    return {
      isStored: true,
      hasExplanation,
      hasSummary,
      hasAnalysis,
      hasGlossary,
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
      return { success: true, capabilities };
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
