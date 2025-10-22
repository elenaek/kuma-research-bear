/**
 * Offscreen Document for Embedding Generation
 *
 * This offscreen document handles embedding generation for papers.
 * It has DOM access (needed by Transformers.js) and persists independently
 * of content scripts, allowing embeddings to complete even if user navigates away.
 */

import { MessageType } from '../types/index.ts';
import { getPaperChunks } from '../utils/dbService.ts';
import { embeddingService } from '../utils/embeddingService.ts';

console.log('[Offscreen] Offscreen document initialized');

/**
 * Generate embeddings for a paper's chunks
 */
async function generateEmbeddingsForPaper(paperId: string): Promise<number | null> {
  try {
    // Check if embedding model is available
    const capabilities = await embeddingService.checkAvailability();
    if (!capabilities.available) {
      return null;
    }

    // Fetch chunks from IndexedDB (shared with background)
    const chunks = await getPaperChunks(paperId);

    if (chunks.length === 0) {
      console.warn('[Offscreen] No chunks found for paper:', paperId);
      return null;
    }

    // Generate embeddings one at a time to avoid WASM memory issues
    const embeddings: Float32Array[] = [];

    for (let i = 0; i < chunks.length; i++) {
      const embedding = await embeddingService.generateEmbedding(chunks[i].content, false);
      embeddings.push(embedding);

      // Small delay to allow WASM memory cleanup between chunks
      if (i < chunks.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    }

    // Store embeddings in IndexedDB
    const { updateChunkEmbeddings } = await import('../utils/dbService.ts');
    await updateChunkEmbeddings(paperId, embeddings);

    console.log('[Offscreen] ✓ Generated', embeddings.length, 'embeddings');
    return embeddings.length;
  } catch (error) {
    console.error('[Offscreen] Failed to generate embeddings:', error);
    return null;
  }
}

/**
 * Perform semantic search for a query
 * Returns ranked chunk IDs based on cosine similarity
 */
async function searchSemantic(paperId: string, query: string, limit: number = 5): Promise<string[]> {
  try {
    // Get all chunks for the paper
    const chunks = await getPaperChunks(paperId);

    if (chunks.length === 0) {
      return [];
    }

    // Check if chunks have embeddings
    const hasEmbeddings = chunks.some(chunk => chunk.embedding !== undefined);

    if (!hasEmbeddings) {
      return [];
    }

    // Generate query embedding
    const queryEmbedding = await embeddingService.generateEmbedding(query, true);

    // Filter chunks that have embeddings
    const chunksWithEmbeddings = chunks.filter(c => c.embedding !== undefined);

    if (chunksWithEmbeddings.length === 0) {
      return [];
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

    // Return ranked chunk IDs
    return similarities.map(sim => sim.chunkId);
  } catch (error) {
    console.error('[Offscreen] Error in semantic search:', error);
    return [];
  }
}

/**
 * Message handler for requests from background
 */
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === MessageType.GENERATE_EMBEDDINGS) {
    const { paperId } = message.payload;

    // Generate embeddings asynchronously
    (async () => {
      try {
        const embeddingCount = await generateEmbeddingsForPaper(paperId);
        sendResponse({ success: true, count: embeddingCount });
      } catch (error) {
        console.error('[Offscreen] Error generating embeddings:', error);
        sendResponse({ success: false, error: String(error) });
      }
    })();

    return true; // Keep message channel open for async response
  }

  if (message.type === MessageType.SEMANTIC_SEARCH) {
    const { paperId, query, limit } = message.payload;

    // Perform semantic search asynchronously
    (async () => {
      try {
        const chunkIds = await searchSemantic(paperId, query, limit || 5);
        sendResponse({ success: true, chunkIds });
      } catch (error) {
        console.error('[Offscreen] Error in semantic search:', error);
        sendResponse({ success: false, error: String(error), chunkIds: [] });
      }
    })();

    return true; // Keep message channel open for async response
  }
});
