import { QuestionAnswer } from '../../shared/types/index.ts';
import { aiService } from '../../shared/utils/aiService.ts';
import { getPaperByUrl, getRelevantChunksSemantic } from '../../shared/utils/dbService.ts';
import { logger } from '../../shared/utils/logger.ts';

/**
 * QAOrchestrator - Orchestrates question answering workflow
 *
 * Responsibilities:
 * - Retrieve relevant chunks using adaptive RAG
 * - Trim chunks to fit within token budget
 * - Format chunks with hierarchical context
 * - Generate answer using AI with RAG context
 *
 * Algorithm:
 * 1. Validate inputs (paperUrl, question)
 * 2. Retrieve paper from database
 * 3. Get relevant chunks using semantic search
 * 4. Trim chunks by token budget
 * 5. Format chunks with section/hierarchy info
 * 6. Answer question using AI
 * 7. Return Q&A result
 *
 * Features:
 * - Adaptive RAG chunk retrieval
 * - Token budget management
 * - Hierarchical chunk context
 * - Automatic session cleanup
 */
export class QAOrchestrator {
  /**
   * Execute question answering workflow
   *
   * @param paperUrl - Paper URL
   * @param question - User question
   * @param contextId - Context ID for AI session
   * @returns Question/answer result
   */
  async execute(
    paperUrl: string,
    question: string,
    contextId: string
  ): Promise<QuestionAnswer> {
    try {
      // Validate inputs
      if (!paperUrl || !question) {
        throw new Error('Paper URL and question are required');
      }

      logger.debug(
        'QA_ORCHESTRATOR',
        `Answering question about paper: ${paperUrl} with context: ${contextId}`
      );

      // Retrieve paper from IndexedDB
      const storedPaper = await getPaperByUrl(paperUrl);

      if (!storedPaper) {
        throw new Error('Paper not found in storage. Please store the paper first to ask questions.');
      }

      // Get relevant chunks with adaptive limit and token budget trimming
      const { getAdaptiveChunkLimit, trimChunksByTokenBudget } = await import(
        '../../shared/utils/adaptiveRAGService.ts'
      );

      const adaptiveLimit = await getAdaptiveChunkLimit(storedPaper.id, 'qa');
      const relevantChunks = await getRelevantChunksSemantic(
        storedPaper.id,
        question,
        adaptiveLimit
      );

      // Trim chunks to fit within token budget
      const { chunks: trimmedChunks, budgetStatus } = await trimChunksByTokenBudget(
        relevantChunks,
        'qa'
      );

      // Log warning if minimum chunks don't fit
      if (!budgetStatus.minChunksFit) {
        logger.warn(
          'QA_ORCHESTRATOR',
          `Insufficient space for minimum RAG chunks - budget: ${budgetStatus.usedTokens}/${budgetStatus.availableTokens} tokens`
        );
        logger.warn(
          'QA_ORCHESTRATOR',
          'Consider using a model with larger context window for better results'
        );
      }

      if (trimmedChunks.length === 0) {
        throw new Error('No relevant content found to answer this question.');
      }

      logger.debug(
        'QA_ORCHESTRATOR',
        `Found ${trimmedChunks.length} relevant chunks for question (retrieved ${relevantChunks.length}, trimmed by token budget)`
      );

      // Format chunks for AI with position and hierarchy
      const contextChunks = trimmedChunks.map((chunk) => ({
        content: chunk.content,
        section: chunk.section,
        index: chunk.index,
        parentSection: chunk.parentSection,
        paragraphIndex: chunk.paragraphIndex,
        sentenceGroupIndex: chunk.sentenceGroupIndex,
      }));

      // Sort chunks by document order (index) for better context
      contextChunks.sort((a, b) => a.index - b.index);

      // Use AI to answer the question with context ID
      const qaResult: QuestionAnswer = await aiService.answerQuestion(
        question,
        contextChunks,
        contextId
      );

      logger.debug('QA_ORCHESTRATOR', '✓ Question answered successfully');
      return qaResult;
    } catch (error) {
      logger.error('QA_ORCHESTRATOR', 'Error answering question:', error);
      throw error;
    } finally {
      // Always clean up the session
      await aiService.destroySessionForContext(contextId);
    }
  }
}
