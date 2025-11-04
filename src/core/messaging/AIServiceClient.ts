import { ChromeMessageClient } from './base/ChromeMessageClient.ts';
import {
  MessageType,
  PaperAnalysisResult,
  GlossaryResult,
  QuestionAnswer,
  AICapabilities,
} from '../../shared/types/index.ts';
import { logger } from '../../shared/utils/logger.ts';

/**
 * Response interfaces for AI operations
 */
export interface AnalysisResponse {
  success: boolean;
  error?: string;
  analysis?: PaperAnalysisResult;
}

export interface GlossaryResponse {
  success: boolean;
  error?: string;
  glossary?: GlossaryResult;
}

export interface ExplanationResponse {
  success: boolean;
  error?: string;
  explanation?: any;
}

export interface SummaryResponse {
  success: boolean;
  error?: string;
  summary?: any;
}

export interface QuestionResponse {
  success: boolean;
  error?: string;
  answer?: QuestionAnswer;
}

export interface ExplainPaperResponse {
  success: boolean;
  error?: string;
}

export interface DetectAndExplainResponse {
  success: boolean;
  error?: string;
}

export interface AIStatusResponse {
  success: boolean;
  error?: string;
  capabilities?: AICapabilities;
  downloadProgress?: number;
  currentDownloadingModel?: 'gemini' | 'embedding' | null;
}

export interface AIInitResponse {
  success: boolean;
  message?: string;
  error?: string;
}

/**
 * AIServiceClient - Handles all AI-related operations
 *
 * Responsibilities:
 * - Paper explanation (explain, explainManual)
 * - Summary generation
 * - Paper analysis
 * - Glossary generation
 * - Question answering
 * - Detect and explain workflow
 * - AI status and lifecycle (check status, initialize, reset)
 */
export class AIServiceClient extends ChromeMessageClient {
  /**
   * Trigger paper analysis
   *
   * @param paperUrl - URL of the paper to analyze
   * @param tabId - Optional tab ID
   * @returns Promise resolving to AnalysisResponse
   */
  async analyzePaper(paperUrl: string, tabId?: number): Promise<AnalysisResponse> {
    logger.debug('AI_CLIENT', 'Starting paper analysis for:', paperUrl, 'tabId:', tabId);

    try {
      const response = await this.sendMessage<{ success: boolean; error?: string; analysis?: PaperAnalysisResult }>(
        MessageType.ANALYZE_PAPER,
        { url: paperUrl, tabId }
      );

      if (response.success) {
        logger.debug('AI_CLIENT', '✓ Paper analysis completed successfully');
        return { success: true, analysis: response.analysis };
      } else {
        logger.error('AI_CLIENT', 'Analysis failed:', response.error);
        return { success: false, error: response.error };
      }
    } catch (error) {
      logger.error('AI_CLIENT', 'Error triggering analysis:', error);
      return { success: false, error: String(error) };
    }
  }

  /**
   * Generate glossary for a paper
   *
   * @param paperUrl - URL of the paper
   * @param tabId - Optional tab ID
   * @returns Promise resolving to GlossaryResponse
   */
  async generateGlossary(paperUrl: string, tabId?: number): Promise<GlossaryResponse> {
    logger.debug('AI_CLIENT', 'Starting glossary generation for:', paperUrl, 'tabId:', tabId);

    try {
      const response = await this.sendMessage<{ success: boolean; error?: string; glossary?: GlossaryResult }>(
        MessageType.GENERATE_GLOSSARY,
        { url: paperUrl, tabId }
      );

      if (response.success) {
        logger.debug('AI_CLIENT', '✓ Glossary generated successfully');
        return { success: true, glossary: response.glossary };
      } else {
        logger.error('AI_CLIENT', 'Glossary generation failed:', response.error);
        return { success: false, error: response.error };
      }
    } catch (error) {
      logger.error('AI_CLIENT', 'Error generating glossary:', error);
      return { success: false, error: String(error) };
    }
  }

  /**
   * Generate explanation for a paper manually
   *
   * @param paperUrl - URL of the paper
   * @param tabId - Optional tab ID
   * @returns Promise resolving to ExplanationResponse
   */
  async explainPaperManual(paperUrl: string, tabId?: number): Promise<ExplanationResponse> {
    logger.debug('AI_CLIENT', 'Starting explanation generation for:', paperUrl, 'tabId:', tabId);

    try {
      const response = await this.sendMessage<{ success: boolean; error?: string; explanation?: any }>(
        MessageType.EXPLAIN_PAPER_MANUAL,
        { url: paperUrl, tabId }
      );

      if (response.success) {
        logger.debug('AI_CLIENT', '✓ Explanation generated successfully');
        return { success: true, explanation: response.explanation };
      } else {
        logger.error('AI_CLIENT', 'Explanation generation failed:', response.error);
        return { success: false, error: response.error };
      }
    } catch (error) {
      logger.error('AI_CLIENT', 'Error generating explanation:', error);
      return { success: false, error: String(error) };
    }
  }

  /**
   * Generate summary for a paper manually
   *
   * @param paperUrl - URL of the paper
   * @param tabId - Optional tab ID
   * @returns Promise resolving to SummaryResponse
   */
  async generateSummaryManual(paperUrl: string, tabId?: number): Promise<SummaryResponse> {
    logger.debug('AI_CLIENT', 'Starting summary generation for:', paperUrl, 'tabId:', tabId);

    try {
      const response = await this.sendMessage<{ success: boolean; error?: string; summary?: any }>(
        MessageType.GENERATE_SUMMARY_MANUAL,
        { url: paperUrl, tabId }
      );

      if (response.success) {
        logger.debug('AI_CLIENT', '✓ Summary generated successfully');
        return { success: true, summary: response.summary };
      } else {
        logger.error('AI_CLIENT', 'Summary generation failed:', response.error);
        return { success: false, error: response.error };
      }
    } catch (error) {
      logger.error('AI_CLIENT', 'Error generating summary:', error);
      return { success: false, error: String(error) };
    }
  }

  /**
   * Ask a question about a paper
   *
   * @param paperUrl - URL of the paper
   * @param question - The question to ask
   * @returns Promise resolving to QuestionResponse
   */
  async askQuestion(paperUrl: string, question: string): Promise<QuestionResponse> {
    logger.debug('AI_CLIENT', 'Asking question:', question);

    try {
      const response = await this.sendMessage<{ success: boolean; error?: string; answer?: QuestionAnswer }>(
        MessageType.ASK_QUESTION,
        {
          paperUrl,
          question: question.trim(),
        }
      );

      if (response.success) {
        logger.debug('AI_CLIENT', '✓ Question answered successfully');
        return { success: true, answer: response.answer };
      } else {
        logger.error('AI_CLIENT', 'Question answering failed:', response.error);
        return { success: false, error: response.error };
      }
    } catch (error) {
      logger.error('AI_CLIENT', 'Error asking question:', error);
      return { success: false, error: String(error) };
    }
  }

  /**
   * Request explanation for a paper
   *
   * @param paper - Paper object
   * @returns Promise resolving to ExplainPaperResponse
   */
  async explainPaper(paper: any): Promise<ExplainPaperResponse> {
    logger.debug('AI_CLIENT', 'Requesting paper explanation for:', paper.title);

    try {
      const response = await this.sendMessage<{ success: boolean; error?: string }>(
        MessageType.EXPLAIN_PAPER,
        { paper }
      );

      if (response.success) {
        logger.debug('AI_CLIENT', '✓ Paper explanation requested successfully');
        return { success: true };
      } else {
        logger.error('AI_CLIENT', 'Paper explanation request failed:', response.error);
        return { success: false, error: response.error };
      }
    } catch (error) {
      logger.error('AI_CLIENT', 'Error requesting paper explanation:', error);
      return { success: false, error: String(error) };
    }
  }

  /**
   * Start the detect and explain flow for a tab
   *
   * @param tabId - Tab ID to detect and explain
   * @returns Promise resolving to DetectAndExplainResponse
   */
  async startDetectAndExplain(tabId: number): Promise<DetectAndExplainResponse> {
    logger.debug('AI_CLIENT', 'Starting detect and explain for tab:', tabId);

    try {
      const response = await this.sendMessage<{ success: boolean; error?: string }>(
        MessageType.START_DETECT_AND_EXPLAIN,
        { tabId }
      );

      if (response.success) {
        logger.debug('AI_CLIENT', '✓ Detect and explain started successfully');
        return { success: true };
      } else {
        logger.error('AI_CLIENT', 'Detect and explain failed:', response.error);
        return { success: false, error: response.error };
      }
    } catch (error) {
      logger.error('AI_CLIENT', 'Error starting detect and explain:', error);
      return { success: false, error: String(error) };
    }
  }

  /**
   * Check AI status and capabilities
   *
   * @returns Promise resolving to AIStatusResponse
   */
  async checkAIStatus(): Promise<AIStatusResponse> {
    logger.debug('AI_CLIENT', 'Checking AI status');

    try {
      const response = await this.sendMessage<{
        capabilities?: AICapabilities;
        downloadProgress?: number;
        currentDownloadingModel?: 'gemini' | 'embedding' | null;
      }>(MessageType.AI_STATUS);

      if (response) {
        const capabilities = response.capabilities || { availability: 'no' };
        logger.debug('AI_CLIENT', 'AI status retrieved:', capabilities.availability);
        return {
          success: true,
          capabilities,
          downloadProgress: response.downloadProgress,
          currentDownloadingModel: response.currentDownloadingModel,
        };
      } else {
        logger.error('AI_CLIENT', 'Failed to check AI status');
        return { success: false, error: 'No response from background' };
      }
    } catch (error) {
      logger.error('AI_CLIENT', 'Error checking AI status:', error);
      return { success: false, error: String(error) };
    }
  }

  /**
   * Initialize AI
   *
   * @returns Promise resolving to AIInitResponse
   */
  async initializeAI(): Promise<AIInitResponse> {
    logger.debug('AI_CLIENT', 'Initializing AI');

    try {
      const response = await this.sendMessage<{ success: boolean; message?: string }>(MessageType.INITIALIZE_AI);

      if (response.success) {
        logger.debug('AI_CLIENT', '✓ AI initialized successfully');
        return { success: true, message: response.message };
      } else {
        logger.error('AI_CLIENT', 'AI initialization failed:', response.message);
        return { success: false, error: response.message };
      }
    } catch (error) {
      logger.error('AI_CLIENT', 'Error initializing AI:', error);
      return { success: false, error: String(error) };
    }
  }

  /**
   * Reset AI
   *
   * @returns Promise resolving to AIInitResponse
   */
  async resetAI(): Promise<AIInitResponse> {
    logger.debug('AI_CLIENT', 'Resetting AI');

    try {
      const response = await this.sendMessage<{ success: boolean; message?: string }>(MessageType.RESET_AI);

      if (response.success) {
        logger.debug('AI_CLIENT', '✓ AI reset successfully');
        return { success: true, message: response.message };
      } else {
        logger.error('AI_CLIENT', 'AI reset failed:', response.message);
        return { success: false, error: response.message };
      }
    } catch (error) {
      logger.error('AI_CLIENT', 'Error resetting AI:', error);
      return { success: false, error: String(error) };
    }
  }

  /**
   * Destroy an AI session by context ID
   *
   * @param contextId - The context ID of the AI session to destroy
   * @returns Promise resolving to response with success status
   */
  async destroyAISession(contextId: string): Promise<{ success: boolean; error?: string }> {
    logger.debug('AI_CLIENT', 'Destroying AI session:', contextId);

    try {
      const response = await this.sendMessage<{ success: boolean; error?: string }>(
        MessageType.DESTROY_AI_SESSION,
        { contextId }
      );

      if (response.success) {
        logger.debug('AI_CLIENT', '✓ AI session destroyed successfully');
        return response;
      } else {
        logger.error('AI_CLIENT', 'Failed to destroy AI session:', response.error);
        return response;
      }
    } catch (error) {
      logger.error('AI_CLIENT', 'Error destroying AI session:', error);
      return { success: false, error: String(error) };
    }
  }
}
