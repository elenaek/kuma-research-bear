import { getRelevantChunksSemantic } from '../../shared/utils/dbService.ts';
import { getAdaptiveChunkLimit } from '../../shared/utils/adaptiveRAGService.ts';
import type { SourceInfo } from '../../shared/types/index.ts';
import { logger } from '../../shared/utils/logger.ts';

/**
 * Context Chunk Structure
 * Enriched chunk data with position, hierarchy, and selector information
 */
export interface ContextChunk {
  content: string;
  section: string;
  index: number;
  parentSection?: string;
  paragraphIndex?: number;
  sentenceGroupIndex?: number;
  cssSelector?: string;
  elementId?: string;
  xPath?: string;
  startChar?: number;
  endChar?: number;
}

/**
 * RAG Context Result
 * Complete RAG context ready for AI consumption
 */
export interface RAGContextResult {
  contextChunks: ContextChunk[];
  contextString: string;
  sourceInfoMap: Map<string, SourceInfo>;
  sources: string[];
}

/**
 * Chat RAG Service
 *
 * Handles retrieval and formatting of relevant paper chunks for chat context.
 * Provides adaptive chunk retrieval, hierarchical formatting, and source mapping.
 *
 * Key Responsibilities:
 * - Retrieve relevant chunks using adaptive limits
 * - Format chunks with hierarchical citations
 * - Build source info map for scroll-to-source functionality
 * - Generate formatted context strings for AI consumption
 *
 * Usage Pattern:
 * ```typescript
 * const ragService = new ChatRAGService();
 * const result = await ragService.getRelevantChunksForChat(paperId, message, 'chat');
 * // Use result.contextString in AI prompt
 * // Use result.sourceInfoMap for citation mapping
 * ```
 */
export class ChatRAGService {
  /**
   * Get relevant chunks formatted for chat context
   *
   * Retrieves semantically relevant chunks from the paper using adaptive limits,
   * formats them with hierarchical citations, and builds source mapping for
   * scroll-to-source functionality.
   *
   * @param paperId - ID of the paper to retrieve chunks from
   * @param message - User's chat message (used for semantic search)
   * @param operationType - Type of operation ('chat' or 'qa') for adaptive limit calculation
   * @returns Complete RAG context with chunks, context string, and source mapping
   *
   * @throws Error if no relevant chunks are found
   *
   * @example
   * ```typescript
   * const result = await ragService.getRelevantChunksForChat(
   *   'paper-123',
   *   'What is the methodology?',
   *   'chat'
   * );
   *
   * // result.contextString: Formatted context with citations
   * // result.sourceInfoMap: Map for scroll-to-source
   * // result.contextChunks: Structured chunk data
   * ```
   */
  async getRelevantChunksForChat(
    paperId: string,
    message: string,
    operationType: 'chat' | 'qa'
  ): Promise<RAGContextResult> {
    // 1. Get adaptive chunk limit based on operation type
    const adaptiveLimit = await getAdaptiveChunkLimit(paperId, operationType);
    logger.debug('RAG', `[ChatRAGService] Using adaptive limit: ${adaptiveLimit} for ${operationType}`);

    // 2. Retrieve semantically relevant chunks
    const relevantChunks = await getRelevantChunksSemantic(paperId, message, adaptiveLimit);

    if (relevantChunks.length === 0) {
      throw new Error('No relevant content found to answer this question.');
    }

    logger.debug('RAG', `[ChatRAGService] Found ${relevantChunks.length} relevant chunks`);

    // 3. Format chunks with complete metadata
    const contextChunks = this.formatContextChunks(relevantChunks);

    // 4. Build source info map for scroll-to-source
    const sourceInfoMap = this.buildSourceInfoMap(contextChunks);

    // 5. Build formatted context string
    const contextString = this.buildContextString(contextChunks);

    // 6. Extract unique source sections
    const sources = Array.from(new Set(contextChunks.map(c => c.section)));

    return {
      contextChunks,
      contextString,
      sourceInfoMap,
      sources,
    };
  }

  /**
   * Format raw chunks into structured context chunks
   * Sorts by document order for better context flow
   *
   * @param relevantChunks - Raw chunks from semantic search
   * @returns Formatted and sorted context chunks
   * @private
   */
  private formatContextChunks(relevantChunks: any[]): ContextChunk[] {
    // Map chunks to structured format with all metadata
    const contextChunks: ContextChunk[] = relevantChunks.map(chunk => ({
      content: chunk.content,
      section: chunk.section || 'Unknown section',
      index: chunk.index,
      parentSection: chunk.parentSection,
      paragraphIndex: chunk.paragraphIndex,
      sentenceGroupIndex: chunk.sentenceGroupIndex,
      cssSelector: chunk.cssSelector,
      elementId: chunk.elementId,
      xPath: chunk.xPath,
      startChar: chunk.startChar,
      endChar: chunk.endChar,
    }));

    // Sort chunks by document order (index) for better context
    contextChunks.sort((a, b) => a.index - b.index);

    return contextChunks;
  }

  /**
   * Build source info map for scroll-to-source functionality
   * Maps hierarchical source citations to selector information
   *
   * @param contextChunks - Formatted context chunks
   * @returns Map of source text to source info (for citation linking)
   * @private
   */
  private buildSourceInfoMap(contextChunks: ContextChunk[]): Map<string, SourceInfo> {
    const sourceInfoMap = new Map<string, SourceInfo>();

    for (const chunk of contextChunks) {
      // Build hierarchical citation path (same as in context string)
      const hierarchy = chunk.parentSection
        ? `${chunk.parentSection} > ${chunk.section}`
        : chunk.section;

      // Build source text (section only, no paragraph numbers)
      const sourceText = `Section: ${hierarchy}`;

      // Map all sources that have section info (not just ones with CSS selectors)
      // Text search fallback can find any section heading
      if (chunk.section && !sourceInfoMap.has(sourceText)) {
        sourceInfoMap.set(sourceText, {
          text: sourceText,
          cssSelector: chunk.cssSelector,
          elementId: chunk.elementId,
          xPath: chunk.xPath,
          sectionHeading: chunk.section,
          startChar: chunk.startChar,
          endChar: chunk.endChar,
        });
      }
    }

    return sourceInfoMap;
  }

  /**
   * Build formatted context string with hierarchical citations
   * Format: [Section: Parent > Child > P 3]\nContent\n\n---\n\n
   *
   * @param contextChunks - Formatted context chunks
   * @returns Formatted context string ready for AI prompt
   * @private
   */
  private buildContextString(contextChunks: ContextChunk[]): string {
    return contextChunks
      .map((chunk) => {
        // Build hierarchical citation path
        const hierarchy = chunk.parentSection
          ? `${chunk.parentSection} > ${chunk.section}`
          : chunk.section;

        // Add paragraph/sentence info if available (natural boundaries)
        let citation = `[Section: ${hierarchy}`;
        if (chunk.paragraphIndex !== undefined) {
          citation += ` > P ${chunk.paragraphIndex + 1}`;
          if (chunk.sentenceGroupIndex !== undefined) {
            citation += ` > Sentences`;
          }
        }
        citation += `]`;

        return `${citation}\n${chunk.content}`;
      })
      .join('\n\n---\n\n');
  }
}
