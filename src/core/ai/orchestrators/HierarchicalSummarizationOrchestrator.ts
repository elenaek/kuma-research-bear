import { PromptExecutor } from '../core/PromptExecutor.ts';
import { AISessionManager } from '../core/AISessionManager.ts';
import { getSchemaForLanguage } from '../../../shared/schemas/analysisSchemas.multilang.ts';
import { getOutputLanguage } from '../../../shared/utils/settingsService.ts';
import { logger } from '../../../shared/utils/logger.ts';

/**
 * Result of hierarchical summarization
 */
export interface HierarchicalSummaryResult {
  /** Final hierarchical summary */
  summary: string;
  /** Terms extracted from each chunk */
  chunkTerms: string[][];
}

/**
 * Chunk summary result with terms
 */
interface ChunkSummaryResult {
  summary: string;
  terms: string[];
}

/**
 * HierarchicalSummarizationOrchestrator - Orchestrates hierarchical summarization
 *
 * Responsibilities:
 * - Break large documents into manageable chunks
 * - Summarize each chunk sequentially with retry logic
 * - Extract technical terms from each chunk
 * - Create meta-summary if needed
 * - Report progress to caller
 * - Clean up sessions after use
 *
 * Algorithm:
 * 1. Split document into chunks (5000 chars, 1000 char overlap)
 * 2. For each chunk:
 *    - Summarize with term extraction
 *    - Retry with exponential backoff on failure
 *    - Clean up session immediately after use
 * 3. If combined summaries > 8000 chars, create meta-summary
 * 4. Return final summary + terms per chunk
 *
 * Features:
 * - Preserves acronyms and technical terminology
 * - Supports LaTeX math expressions
 * - Progress reporting
 * - Automatic session cleanup
 * - Exponential backoff retry logic
 */
export class HierarchicalSummarizationOrchestrator {
  private promptExecutor: PromptExecutor;
  private sessionManager: AISessionManager;

  // Chunking parameters
  private readonly CHUNK_SIZE = 5000; // chars
  private readonly CHUNK_OVERLAP = 1000; // chars
  private readonly META_SUMMARY_THRESHOLD = 8000; // chars
  private readonly MAX_RETRIES = 3;
  private readonly CHUNK_TIMEOUT_MS = 60000; // 60 seconds per chunk
  private readonly DELAY_BETWEEN_CHUNKS_MS = 150;

  constructor(sessionManager: AISessionManager, promptExecutor: PromptExecutor) {
    this.sessionManager = sessionManager;
    this.promptExecutor = promptExecutor;
  }

  /**
   * Create hierarchical summary of a large document
   *
   * @param fullText - Full document text to summarize
   * @param contextId - Base context identifier for sessions
   * @param onProgress - Progress callback (current, total)
   * @returns Summary result with terms per chunk
   */
  async createSummary(
    fullText: string,
    contextId: string = 'hierarchical-summary',
    onProgress?: (current: number, total: number) => void
  ): Promise<HierarchicalSummaryResult> {
    logger.debug('HIERARCHICAL_SUMMARY', 'Starting hierarchical summarization...');
    logger.debug('HIERARCHICAL_SUMMARY', `Document length: ${fullText.length} chars`);

    // Import chunking utility
    const { chunkContent } = await import('../../../shared/utils/contentExtractor.ts');

    // Step 1: Split into chunks
    const chunks = chunkContent(fullText, this.CHUNK_SIZE, this.CHUNK_OVERLAP);
    logger.debug('HIERARCHICAL_SUMMARY', `Split into ${chunks.length} chunks`);

    // Get output language for schema
    const outputLanguage = await getOutputLanguage();

    // Handle single chunk case
    if (chunks.length === 1) {
      return await this.handleSingleChunk(fullText, contextId, outputLanguage);
    }

    // Handle multiple chunks
    return await this.handleMultipleChunks(
      chunks,
      contextId,
      outputLanguage,
      onProgress
    );
  }

  /**
   * Handle single chunk case (document is already small)
   */
  private async handleSingleChunk(
    fullText: string,
    contextId: string,
    outputLanguage: string
  ): Promise<HierarchicalSummaryResult> {
    logger.debug('HIERARCHICAL_SUMMARY', 'Document is small, creating single summary');

    const systemPrompt = this.buildChunkSummarySystemPrompt();
    const schema = getSchemaForLanguage('chunk-summary', outputLanguage as 'en' | 'es' | 'ja');

    // Create session
    await this.sessionManager.createSession(contextId, {
      systemPrompt,
      expectedInputs: [{ type: 'text', languages: ['en', 'es', 'ja'] }],
      expectedOutputs: [{ type: 'text', languages: [outputLanguage || 'en'] }],
      temperature: 0.0,
      topK: 1,
    });

    try {
      const input = `Summarize this research paper content concisely, capturing all important points. Also extract the 5-10 most important technical terms and acronyms:\n\n${fullText.slice(0, 6000)}`;

      const response = await this.promptExecutor.executeWithTimeout(
        contextId,
        input,
        {
          timeoutMs: this.CHUNK_TIMEOUT_MS,
          maxRetries: 2,
          retryDelayMs: 1000,
          recreateSessionOnTimeout: true,
        },
        { responseConstraint: schema }
      );

      const parsed = JSON.parse(response);
      logger.debug('HIERARCHICAL_SUMMARY', `Single summary created: ${parsed.summary.length} chars, ${parsed.terms.length} terms`);

      return {
        summary: parsed.summary,
        chunkTerms: [parsed.terms],
      };
    } finally {
      // Cleanup session
      await this.sessionManager.destroySession(contextId);
    }
  }

  /**
   * Handle multiple chunks case
   */
  private async handleMultipleChunks(
    chunks: Array<{ content: string; index: number }>,
    contextId: string,
    outputLanguage: string,
    onProgress?: (current: number, total: number) => void
  ): Promise<HierarchicalSummaryResult> {
    logger.debug('HIERARCHICAL_SUMMARY', 'Summarizing chunks sequentially with retry logic...');

    // Report initial progress
    if (onProgress) {
      onProgress(0, chunks.length);
    }

    const chunkResults: ChunkSummaryResult[] = [];

    // Process chunks sequentially
    for (let i = 0; i < chunks.length; i++) {
      const result = await this.summarizeChunkWithRetry(
        chunks[i],
        i,
        contextId,
        outputLanguage
      );
      chunkResults.push(result);

      // Report progress
      if (onProgress) {
        onProgress(i + 1, chunks.length);
      }

      // Add delay between chunks to prevent resource contention
      if (i < chunks.length - 1) {
        await this.sleep(this.DELAY_BETWEEN_CHUNKS_MS);
      }
    }

    logger.debug('HIERARCHICAL_SUMMARY', 'All chunks summarized and terms extracted');

    // Separate summaries and terms
    const chunkSummaries = chunkResults.map(result => result.summary);
    const chunkTerms = chunkResults.map(result => result.terms);
    logger.debug('HIERARCHICAL_SUMMARY', `Extracted ${chunkTerms.flat().length} total terms`);

    // Combine summaries
    const combinedSummaries = chunkSummaries.join('\n\n');
    logger.debug('HIERARCHICAL_SUMMARY', `Combined summaries length: ${combinedSummaries.length} chars`);

    // If combined summaries are compact enough, return as-is
    if (combinedSummaries.length <= this.META_SUMMARY_THRESHOLD) {
      logger.debug('HIERARCHICAL_SUMMARY', 'Combined summaries already compact');
      return {
        summary: combinedSummaries,
        chunkTerms,
      };
    }

    // Create meta-summary
    const metaSummary = await this.createMetaSummary(
      combinedSummaries,
      contextId,
      outputLanguage
    );

    return {
      summary: metaSummary,
      chunkTerms,
    };
  }

  /**
   * Summarize a single chunk with retry logic
   */
  private async summarizeChunkWithRetry(
    chunk: { content: string; index: number },
    index: number,
    baseContextId: string,
    outputLanguage: string
  ): Promise<ChunkSummaryResult> {
    const systemPrompt = this.buildChunkSummarySystemPrompt();
    const schema = getSchemaForLanguage('chunk-summary', outputLanguage as 'en' | 'es' | 'ja');
    const input = `Summarize this section of a research paper, capturing all important points. Also extract the 5-10 most important technical terms and acronyms:\n\n${chunk.content}`;

    for (let attempt = 1; attempt <= this.MAX_RETRIES; attempt++) {
      const chunkContextId = `${baseContextId}-chunk-${index}`;

      try {
        // Create session for this chunk
        await this.sessionManager.createSession(chunkContextId, {
          systemPrompt,
          expectedInputs: [{ type: 'text', languages: ['en', 'es', 'ja'] }],
          expectedOutputs: [{ type: 'text', languages: [outputLanguage || 'en'] }],
          temperature: 0.0,
          topK: 1,
        });

        const response = await this.promptExecutor.executeWithTimeout(
          chunkContextId,
          input,
          {
            timeoutMs: this.CHUNK_TIMEOUT_MS,
            maxRetries: 2,
            retryDelayMs: 1000,
            recreateSessionOnTimeout: true,
          },
          { responseConstraint: schema }
        );

        const parsed = JSON.parse(response);
        logger.debug('HIERARCHICAL_SUMMARY', `Chunk ${index + 1} summarized: ${parsed.summary.length} chars, ${parsed.terms.length} terms`);

        // Clean up session immediately
        await this.sessionManager.destroySession(chunkContextId);

        return {
          summary: parsed.summary,
          terms: parsed.terms,
        };
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        const isRetryableError =
          errorMessage.includes('UnknownError') ||
          errorMessage.includes('generic failures') ||
          errorMessage.includes('timeout') ||
          errorMessage.includes('resource');

        if (attempt < this.MAX_RETRIES && isRetryableError) {
          const delay = Math.pow(2, attempt - 1) * 1000; // 1s, 2s, 4s
          logger.warn('HIERARCHICAL_SUMMARY', `Chunk ${index + 1} failed (attempt ${attempt}/${this.MAX_RETRIES}), retrying in ${delay}ms:`, errorMessage);
          await this.sleep(delay);
        } else {
          logger.error('HIERARCHICAL_SUMMARY', `Chunk ${index + 1} failed after ${attempt} attempts:`, error);
          // Return truncated content as fallback
          return {
            summary: chunk.content.slice(0, 500),
            terms: [],
          };
        }
      } finally {
        // Ensure cleanup even on error
        try {
          await this.sessionManager.destroySession(chunkContextId);
        } catch (cleanupError) {
          logger.warn('HIERARCHICAL_SUMMARY', `Failed to cleanup chunk ${index} session:`, cleanupError);
        }
      }
    }

    // Fallback (shouldn't reach here)
    return {
      summary: chunk.content.slice(0, 500),
      terms: [],
    };
  }

  /**
   * Create meta-summary from combined summaries
   */
  private async createMetaSummary(
    combinedSummaries: string,
    baseContextId: string,
    outputLanguage: string
  ): Promise<string> {
    logger.debug('HIERARCHICAL_SUMMARY', 'Creating meta-summary...');

    const metaSystemPrompt = `You are a research paper summarizer.
Create a comprehensive but concise summary from multiple section summaries.
CRITICAL:
- Preserve ALL acronyms and technical terminology exactly
- Do NOT paraphrase specialized terms
- Maintain term consistency across sections
- Include methodology, findings, results, conclusions
For mathematical expressions: use $expression$ for inline math, $$expression$$ for display equations. Use proper LaTeX syntax (\\frac{a}{b}, \\sum, \\alpha, etc.).`;

    const metaInput = `Create a comprehensive summary of this research paper from these section summaries. Capture all key findings, methodology, results, and conclusions:\n\n${combinedSummaries.slice(0, 20000)}`;
    const metaContextId = `${baseContextId}-meta`;

    try {
      // Create meta session
      await this.sessionManager.createSession(metaContextId, {
        systemPrompt: metaSystemPrompt,
        expectedInputs: [{ type: 'text', languages: ['en', 'es', 'ja'] }],
        expectedOutputs: [{ type: 'text', languages: [outputLanguage || 'en'] }],
        temperature: 0.0,
        topK: 1,
      });

      const finalSummary = await this.promptExecutor.executeWithTimeout(
        metaContextId,
        metaInput,
        {
          timeoutMs: this.CHUNK_TIMEOUT_MS,
          maxRetries: 2,
          retryDelayMs: 1000,
          recreateSessionOnTimeout: true,
        }
      );

      logger.debug('HIERARCHICAL_SUMMARY', `✓ Meta-summary created: ${finalSummary.length} chars`);

      return finalSummary;
    } catch (error) {
      logger.error('HIERARCHICAL_SUMMARY', 'Meta-summary failed, returning truncated combined:', error);
      return combinedSummaries.slice(0, this.META_SUMMARY_THRESHOLD) + '...';
    } finally {
      // Cleanup meta session
      try {
        await this.sessionManager.destroySession(metaContextId);
      } catch (cleanupError) {
        logger.warn('HIERARCHICAL_SUMMARY', 'Failed to cleanup meta session:', cleanupError);
      }
    }
  }

  /**
   * Build system prompt for chunk summarization
   */
  private buildChunkSummarySystemPrompt(): string {
    return `You are a research paper summarizer. Create concise summaries that capture key information AND extract technical terms.
CRITICAL:
- Preserve ALL acronyms exactly (e.g., "SES", "RCT", "fMRI")
- Keep technical terminology intact - do NOT paraphrase
- Maintain domain-specific language
- Include acronym definitions if present
- Capture key findings, methods, data
- Extract 5-10 most important technical terms, acronyms, initialisms, and domain-specific jargon a user would need to know to understand this section
For mathematical expressions: use $expression$ for inline math, $$expression$$ for display equations. Use proper LaTeX syntax (\\frac{a}{b}, \\sum, \\alpha, etc.).`;
  }

  /**
   * Sleep utility
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
