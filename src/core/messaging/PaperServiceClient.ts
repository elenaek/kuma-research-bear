import { ChromeMessageClient } from './base/ChromeMessageClient.ts';
import {
  MessageType,
  StoredPaper,
  QuestionAnswer,
  ContentChunk,
} from '../../shared/types/index.ts';
import { normalizeUrl } from '../../shared/utils/urlUtils.ts';
import { logger } from '../../shared/utils/logger.ts';

/**
 * StorePaperResponse interface
 */
export interface StorePaperResponse {
  success: boolean;
  error?: string;
  paper?: StoredPaper;
}

/**
 * PaperStatusInfo interface
 */
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
 * PaperServiceClient - Handles all paper-related operations
 *
 * Responsibilities:
 * - Paper CRUD operations (get, getAll, update, delete, store)
 * - Paper status checks (isPaperStored, getPaperStatus)
 * - Communication with background worker for paper database operations
 */
export class PaperServiceClient extends ChromeMessageClient {
  /**
   * Get a paper from IndexedDB by its URL
   *
   * @param url - Paper URL (will be normalized)
   * @returns Promise resolving to StoredPaper or null if not found
   */
  async getPaperByUrl(url: string): Promise<StoredPaper | null> {
    const normalizedUrl = normalizeUrl(url);
    logger.debug(
      'PAPER_CLIENT',
      'Requesting paper from background worker:',
      url,
      '(normalized:',
      normalizedUrl,
      ')'
    );

    try {
      const response = await this.sendMessage<{ success: boolean; error?: string; paper?: StoredPaper }>(
        MessageType.GET_PAPER_FROM_DB_BY_URL,
        { url: normalizedUrl }
      );

      if (response.success) {
        logger.debug('PAPER_CLIENT', 'Paper retrieval result:', response.paper ? 'Found' : 'Not found');
        return response.paper || null;
      } else {
        logger.error('PAPER_CLIENT', 'Failed to get paper:', response.error);
        return null;
      }
    } catch (error) {
      logger.error('PAPER_CLIENT', 'Error getting paper by URL:', error);
      return null;
    }
  }

  /**
   * Get all papers from IndexedDB
   *
   * @returns Promise resolving to array of StoredPaper objects
   */
  async getAllPapers(): Promise<StoredPaper[]> {
    logger.debug('PAPER_CLIENT', 'Requesting all papers from background worker');

    try {
      const response = await this.sendMessage<{ success: boolean; error?: string; papers?: StoredPaper[] }>(
        MessageType.GET_ALL_PAPERS_FROM_DB,
        {}
      );

      if (response.success) {
        logger.debug('PAPER_CLIENT', 'Retrieved', response.papers?.length || 0, 'papers');
        return response.papers || [];
      } else {
        logger.error('PAPER_CLIENT', 'Failed to get all papers:', response.error);
        return [];
      }
    } catch (error) {
      logger.error('PAPER_CLIENT', 'Error getting all papers:', error);
      return [];
    }
  }

  /**
   * Update Q&A history for a paper in IndexedDB
   *
   * @param paperId - ID of the paper to update
   * @param qaHistory - Array of QuestionAnswer objects
   * @returns Promise resolving to true if successful, false otherwise
   */
  async updatePaperQAHistory(paperId: string, qaHistory: QuestionAnswer[]): Promise<boolean> {
    logger.debug('PAPER_CLIENT', 'Updating Q&A history for paper:', paperId);

    try {
      const response = await this.sendMessage<{ success: boolean; error?: string }>(
        MessageType.UPDATE_PAPER_QA_HISTORY,
        { paperId, qaHistory }
      );

      if (response.success) {
        logger.debug('PAPER_CLIENT', 'Q&A history updated successfully');
        return true;
      } else {
        logger.error('PAPER_CLIENT', 'Failed to update Q&A history:', response.error);
        return false;
      }
    } catch (error) {
      logger.error('PAPER_CLIENT', 'Error updating Q&A history:', error);
      return false;
    }
  }

  /**
   * Delete a paper from IndexedDB
   *
   * @param paperId - ID of the paper to delete
   * @returns Promise resolving to true if successful, false otherwise
   */
  async deletePaper(paperId: string): Promise<boolean> {
    logger.debug('PAPER_CLIENT', 'Deleting paper:', paperId);

    try {
      const response = await this.sendMessage<{ success: boolean; error?: string }>(
        MessageType.DELETE_PAPER_FROM_DB,
        { paperId }
      );

      if (response.success) {
        logger.debug('PAPER_CLIENT', 'Paper deleted successfully');
        return true;
      } else {
        logger.error('PAPER_CLIENT', 'Failed to delete paper:', response.error);
        return false;
      }
    } catch (error) {
      logger.error('PAPER_CLIENT', 'Error deleting paper:', error);
      return false;
    }
  }

  /**
   * Store a paper in IndexedDB with full text or pre-chunked data
   *
   * @param paper - Paper metadata object
   * @param fullText - Optional full text content
   * @param preChunkedData - Optional pre-chunked content with metadata
   * @returns Promise resolving to StorePaperResponse
   */
  async storePaperInDB(
    paper: any,
    fullText?: string,
    preChunkedData?: {
      chunks: ContentChunk[];
      metadata: { averageChunkSize?: number };
    }
  ): Promise<StorePaperResponse> {
    logger.debug('PAPER_CLIENT', 'Storing paper in IndexedDB:', paper.title);

    try {
      const response = await this.sendMessage<{ success: boolean; error?: string; paper?: StoredPaper }>(
        MessageType.STORE_PAPER_IN_DB,
        { paper, fullText, preChunkedData }
      );

      if (response.success) {
        logger.debug('PAPER_CLIENT', '✓ Paper stored successfully');
        return { success: true, paper: response.paper };
      } else {
        logger.error('PAPER_CLIENT', 'Failed to store paper:', response.error);
        return { success: false, error: response.error };
      }
    } catch (error) {
      logger.error('PAPER_CLIENT', 'Error storing paper:', error);
      return { success: false, error: String(error) };
    }
  }

  /**
   * Check if a paper is stored in IndexedDB
   *
   * @param url - Paper URL (will be normalized)
   * @returns Promise resolving to true if stored, false otherwise
   */
  async isPaperStoredInDB(url: string): Promise<boolean> {
    const normalizedUrl = normalizeUrl(url);
    logger.debug('PAPER_CLIENT', 'Checking if paper is stored:', url, '(normalized:', normalizedUrl, ')');

    try {
      const response = await this.sendMessage<{ success: boolean; error?: string; isStored?: boolean }>(
        MessageType.IS_PAPER_STORED_IN_DB,
        { url: normalizedUrl }
      );

      if (response.success) {
        logger.debug('PAPER_CLIENT', 'Paper stored check result:', response.isStored);
        return response.isStored || false;
      } else {
        logger.error('PAPER_CLIENT', 'Failed to check paper storage:', response.error);
        return false;
      }
    } catch (error) {
      logger.error('PAPER_CLIENT', 'Error checking paper storage:', error);
      return false;
    }
  }

  /**
   * Get lightweight paper status (without full paper data)
   * Useful for quick checks on tab activation
   *
   * @param url - Paper URL
   * @returns Promise resolving to PaperStatusInfo
   */
  async getPaperStatus(url: string): Promise<PaperStatusInfo> {
    const normalizedUrl = normalizeUrl(url);
    logger.debug('PAPER_CLIENT', 'Getting paper status for:', url, '(normalized:', normalizedUrl, ')');

    try {
      const paper = await this.getPaperByUrl(normalizedUrl);

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
      logger.error('PAPER_CLIENT', 'Error getting paper status:', error);
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
}
