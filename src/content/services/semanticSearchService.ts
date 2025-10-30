/**
 * Semantic Search Service (Content Script Only)
 * Wrapper for semantic RAG that only runs in content script context
 * This prevents Transformers.js from being bundled in background worker
 */

import { ContentChunk } from '../../types/index.ts';
import { getPaperChunks, getRelevantChunks, getRelevantChunksByTopic } from '../../utils/dbService.ts';
import { logger } from '../../utils/logger.ts';

/**
 * Get relevant chunks using semantic search (EmbeddingGemma)
 * Falls back to keyword search if embeddings are not available
 */
export async function getRelevantChunksSemantic(
  paperId: string,
  query: string,
  limit: number = 5
): Promise<ContentChunk[]> {
  logger.debug('RAG', '[Semantic Search] Searching for:', query);

  try {
    // Get all chunks for the paper
    const chunks = await getPaperChunks(paperId);

    if (chunks.length === 0) {
      logger.warn('RAG', '[Semantic Search] No chunks found for paper:', paperId);
      return [];
    }

    // Check if chunks have embeddings
    const hasEmbeddings = chunks.some(chunk => chunk.embedding !== undefined);

    if (!hasEmbeddings) {
      logger.debug('RAG', '[Semantic Search] No embeddings available, falling back to keyword search');
      return await getRelevantChunks(paperId, query, limit);
    }

    // Import embedding service (safe here - content script only)
    const { embeddingService } = await import('../../utils/embeddingService.ts');

    // Check if model is available
    const capabilities = await embeddingService.checkAvailability();
    if (!capabilities.available) {
      logger.debug('RAG', '[Semantic Search] Embedding model not available, falling back to keyword search');
      return await getRelevantChunks(paperId, query, limit);
    }

    logger.debug('RAG', '[Semantic Search] Using semantic search with', chunks.length, 'chunks');

    // Generate query embedding
    const queryEmbedding = await embeddingService.generateEmbedding(query, true);

    // Filter chunks that have embeddings
    const chunksWithEmbeddings = chunks.filter(c => c.embedding !== undefined);

    if (chunksWithEmbeddings.length === 0) {
      logger.warn('RAG', '[Semantic Search] No chunks with embeddings, falling back to keyword search');
      return await getRelevantChunks(paperId, query, limit);
    }

    // Calculate similarities
    const documentEmbeddings = chunksWithEmbeddings.map(c => c.embedding!);
    const chunkIds = chunksWithEmbeddings.map(c => c.id);

    const similarities = embeddingService.calculateSimilarities(
      queryEmbedding,
      documentEmbeddings,
      chunkIds,
      limit
    );

    logger.debug('RAG', '[Semantic Search] Top', limit, 'similarities:', similarities.slice(0, 3).map(s => s.score));

    // Map similarity scores back to chunks
    const relevantChunks = similarities.map(sim => {
      return chunksWithEmbeddings.find(c => c.id === sim.chunkId)!;
    });

    logger.debug('RAG', '[Semantic Search] ✓ Found', relevantChunks.length, 'relevant chunks');
    return relevantChunks;
  } catch (error) {
    logger.error('RAG', '[Semantic Search] Error, falling back to keyword search:', error);
    return await getRelevantChunks(paperId, query, limit);
  }
}

/**
 * Get relevant chunks using semantic search for multiple topic keywords
 */
export async function getRelevantChunksByTopicSemantic(
  paperId: string,
  topics: string[],
  limit: number = 3
): Promise<ContentChunk[]> {
  logger.debug('RAG', '[Semantic Search] Searching for topics:', topics);

  try {
    // Get all chunks for the paper
    const chunks = await getPaperChunks(paperId);

    if (chunks.length === 0) {
      logger.warn('RAG', '[Semantic Search] No chunks found for paper:', paperId);
      return [];
    }

    // Check if chunks have embeddings
    const hasEmbeddings = chunks.some(chunk => chunk.embedding !== undefined);

    if (!hasEmbeddings) {
      logger.debug('RAG', '[Semantic Search] No embeddings available, falling back to keyword search');
      return await getRelevantChunksByTopic(paperId, topics, limit);
    }

    // Import embedding service (safe here - content script only)
    const { embeddingService } = await import('../../utils/embeddingService.ts');

    // Check if model is available
    const capabilities = await embeddingService.checkAvailability();
    if (!capabilities.available) {
      logger.debug('RAG', '[Semantic Search] Embedding model not available, falling back to keyword search');
      return await getRelevantChunksByTopic(paperId, topics, limit);
    }

    logger.debug('RAG', '[Semantic Search] Using semantic search with', chunks.length, 'chunks');

    // Combine topics into a single query
    const query = topics.join(' ');

    // Generate query embedding
    const queryEmbedding = await embeddingService.generateEmbedding(query, true);

    // Filter chunks that have embeddings
    const chunksWithEmbeddings = chunks.filter(c => c.embedding !== undefined);

    if (chunksWithEmbeddings.length === 0) {
      logger.warn('RAG', '[Semantic Search] No chunks with embeddings, falling back to keyword search');
      return await getRelevantChunksByTopic(paperId, topics, limit);
    }

    // Calculate similarities
    const documentEmbeddings = chunksWithEmbeddings.map(c => c.embedding!);
    const chunkIds = chunksWithEmbeddings.map(c => c.id);

    const similarities = embeddingService.calculateSimilarities(
      queryEmbedding,
      documentEmbeddings,
      chunkIds,
      limit
    );

    logger.debug('RAG', '[Semantic Search] Top', limit, 'similarities:', similarities.slice(0, 3).map(s => s.score));

    // Map similarity scores back to chunks
    const relevantChunks = similarities.map(sim => {
      return chunksWithEmbeddings.find(c => c.id === sim.chunkId)!;
    });

    logger.debug('RAG', '[Semantic Search] ✓ Found', relevantChunks.length, 'relevant chunks');
    return relevantChunks;
  } catch (error) {
    logger.error('RAG', '[Semantic Search] Error, falling back to keyword search:', error);
    return await getRelevantChunksByTopic(paperId, topics, limit);
  }
}
