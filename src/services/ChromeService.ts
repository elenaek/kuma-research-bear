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
