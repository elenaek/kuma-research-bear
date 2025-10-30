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
import { DEFAULT_HYBRID_CONFIG } from '../types/embedding.ts';
import BM25 from 'okapibm25';
import { logger } from '../utils/logger.ts';

logger.debug('EMBEDDINGS', '[Offscreen] Offscreen document initialized');

/**
 * Diagnostic: Check WebGPU availability on startup
 */
(async () => {
  logger.debug('PERFORMANCE', '[Offscreen] 🔍 Running WebGPU diagnostics...');

  // Check if WebGPU API exists
  if (typeof navigator === 'undefined' || !('gpu' in navigator)) {
    logger.warn('PERFORMANCE', '[Offscreen] ❌ WebGPU API not available in this context');
    return;
  }

  logger.debug('PERFORMANCE', '[Offscreen] ✓ WebGPU API exists');

  try {
    // Request adapter to test if WebGPU actually works
    const adapter = await navigator.gpu.requestAdapter();

    if (!adapter) {
      logger.warn('PERFORMANCE', '[Offscreen] ❌ WebGPU adapter request returned null (GPU not available)');
      return;
    }

    logger.debug('PERFORMANCE', '[Offscreen] ✓ WebGPU adapter obtained successfully');

    // Log adapter info (if available - newer API)
    try {
      if (typeof adapter.requestAdapterInfo === 'function') {
        const info = await adapter.requestAdapterInfo();
        logger.debug('PERFORMANCE', '[Offscreen] 📊 GPU Info:', {
          vendor: info.vendor,
          architecture: info.architecture,
          device: info.device,
          description: info.description,
        });
      } else {
        logger.debug('PERFORMANCE', '[Offscreen] 📊 GPU Info: (requestAdapterInfo not available in this browser)');
      }
    } catch (infoError) {
      logger.debug('PERFORMANCE', '[Offscreen] 📊 GPU Info: (unable to retrieve adapter info)');
    }

    // Log adapter features and limits
    logger.debug('PERFORMANCE', '[Offscreen] 🎯 GPU Features:', Array.from(adapter.features));
    logger.debug('PERFORMANCE', '[Offscreen] 📏 GPU Limits (selected):', {
      maxBufferSize: adapter.limits.maxBufferSize,
      maxComputeWorkgroupsPerDimension: adapter.limits.maxComputeWorkgroupsPerDimension,
    });

    logger.debug('PERFORMANCE', '[Offscreen] ✅ WebGPU is fully functional and ready for use!');
  } catch (error) {
    logger.error('PERFORMANCE', '[Offscreen] ❌ WebGPU test failed:', error);
  }
})();

/**
 * Track in-flight extractions to avoid duplicate processing
 * Maps paper URL to extraction promise
 */
const inFlightExtractions = new Set<string>();

/**
 * Generate embeddings for a paper's chunks
 * Returns object with count and device backend used
 */
async function generateEmbeddingsForPaper(
  paperId: string,
  paperUrl?: string
): Promise<{ count: number; device: 'webgpu' | 'wasm' } | null> {
  try {
    // Ensure model is loaded first (lazy loading happens here)
    // This is critical to get the correct device backend (WebGPU vs WASM)
    await embeddingService.loadModel();

    // Now check which device was actually used
    const capabilities = await embeddingService.checkAvailability();
    if (!capabilities.available) {
      return null;
    }

    // Get device backend (webgpu or wasm) - now this will be accurate!
    const device = capabilities.device || 'wasm';
    logger.debug('EMBEDDINGS', `[Offscreen] 🎯 Using ${device.toUpperCase()} backend for embeddings`);

    // Fetch chunks from IndexedDB (shared with background)
    const chunks = await getPaperChunks(paperId);

    if (chunks.length === 0) {
      logger.warn('EMBEDDINGS', '[Offscreen] No chunks found for paper:', paperId);
      return null;
    }

    // Generate embeddings in batches for better performance
    const embeddings: Float32Array[] = [];
    const startTime = performance.now();
    let lastProgressTime = startTime;
    const BATCH_SIZE = 10; // Process 10 chunks at a time
    const PROGRESS_THROTTLE_MS = 500; // Throttle progress updates to max 1 per 500ms
    const WASM_DELAY_MS = 200; // Reduced from 500ms

    for (let batchStart = 0; batchStart < chunks.length; batchStart += BATCH_SIZE) {
      const batchEnd = Math.min(batchStart + BATCH_SIZE, chunks.length);
      const batchChunks = chunks.slice(batchStart, batchEnd);

      // Generate embeddings for batch
      const batchTexts = batchChunks.map(chunk => chunk.content);
      const batchEmbeddings = await embeddingService.generateEmbeddingsBatch(batchTexts, false);
      embeddings.push(...batchEmbeddings);

      const current = embeddings.length;

      // Throttled progress updates (max 1 per 500ms) or at key milestones
      const now = performance.now();
      const timeSinceLastProgress = now - lastProgressTime;
      const isMilestone = current === Math.floor(chunks.length * 0.25) ||
                         current === Math.floor(chunks.length * 0.50) ||
                         current === Math.floor(chunks.length * 0.75) ||
                         current === chunks.length;
      const shouldUpdate = (timeSinceLastProgress >= PROGRESS_THROTTLE_MS) || isMilestone;

      if (shouldUpdate) {
        lastProgressTime = now;

        // Calculate performance metrics
        const elapsed = (now - startTime) / 1000; // seconds
        const embeddingsPerSecond = (current / elapsed).toFixed(2);
        const avgTimePerEmbedding = (elapsed / current * 1000).toFixed(0); // ms

        // Log performance every 10% progress
        if (current % Math.max(1, Math.floor(chunks.length * 0.1)) === 0 || isMilestone) {
          logger.debug('PERFORMANCE', `[Offscreen] ⚡ Performance: ${embeddingsPerSecond} emb/s (${avgTimePerEmbedding}ms per embedding) using ${device.toUpperCase()}`);
        }

        chrome.runtime.sendMessage({
          type: 'EMBEDDING_PROGRESS',
          payload: {
            paperId,
            paperUrl,
            current,
            total: chunks.length,
            device,  // Include backend device in progress updates
          }
        }).catch(() => {
          // Background might not be listening, that's ok
        });
      }

      // Yield to browser event loop after each batch to prevent UI freezing
      if (batchEnd < chunks.length) {
        // Small delay for WASM backend to allow memory cleanup
        // WebGPU can handle continuous processing with just a microtask yield
        if (device === 'wasm') {
          await new Promise(resolve => setTimeout(resolve, WASM_DELAY_MS));
        } else {
          // For WebGPU, just yield to event loop without artificial delay
          await new Promise(resolve => setTimeout(resolve, 0));
        }
      }
    }

    // Store embeddings in IndexedDB
    const { updateChunkEmbeddings } = await import('../utils/dbService.ts');
    await updateChunkEmbeddings(paperId, embeddings);

    // Calculate final performance metrics
    const endTime = performance.now();
    const totalTime = (endTime - startTime) / 1000; // seconds
    const embeddingsPerSecond = (embeddings.length / totalTime).toFixed(2);
    const avgTimePerEmbedding = (totalTime / embeddings.length * 1000).toFixed(0); // ms

    const backendUsed = device === 'webgpu' ? 'WebGPU (GPU-accelerated)' : 'WASM (CPU)';
    logger.debug('EMBEDDINGS', `[Offscreen] ✅ Generated ${embeddings.length} embeddings using ${backendUsed}`);
    logger.debug('PERFORMANCE', `[Offscreen] 📊 Performance Summary:`);
    logger.debug('PERFORMANCE', `   - Total time: ${totalTime.toFixed(1)}s`);
    logger.debug('PERFORMANCE', `   - Speed: ${embeddingsPerSecond} embeddings/second`);
    logger.debug('PERFORMANCE', `   - Average: ${avgTimePerEmbedding}ms per embedding`);
    logger.debug('PERFORMANCE', `   - Backend: ${device.toUpperCase()}`);

    return { count: embeddings.length, device };
  } catch (error) {
    logger.error('EMBEDDINGS', '[Offscreen] Failed to generate embeddings:', error);
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
    logger.error('RAG', '[Offscreen] Error in semantic search:', error);
    return [];
  }
}

/**
 * Calculate BM25 scores for all chunks using the OkapiBM25 algorithm
 * BM25 is a probabilistic ranking function that considers:
 * - Term frequency with saturation (repeated terms have diminishing returns)
 * - Inverse document frequency (rare terms weighted higher)
 * - Document length normalization (fair comparison across chunk sizes)
 *
 * @param chunks - Array of chunks to score
 * @param query - Search query
 * @param k1 - Term frequency saturation parameter (default 1.5)
 * @param b - Length normalization parameter (default 0.75)
 * @returns Array of BM25 scores corresponding to input chunks
 */
function calculateBM25Scores(
  chunks: { content: string }[],
  query: string,
  k1: number = 1.5,
  b: number = 0.75
): number[] {
  if (chunks.length === 0) {
    return [];
  }

  // Prepare documents and query for BM25
  const documents = chunks.map(chunk => chunk.content);
  const queryWords = query.toLowerCase().split(/\s+/).filter(word => word.length > 0);

  if (queryWords.length === 0) {
    return chunks.map(() => 0);
  }

  try {
    // BM25 returns array of scores matching document order
    const scores = BM25(documents, queryWords, { k1, b }) as number[];
    return scores;
  } catch (error) {
    logger.error('RAG', '[Offscreen] Error calculating BM25 scores:', error);
    return chunks.map(() => 0);
  }
}

/**
 * Perform hybrid search combining semantic embeddings and BM25 lexical search
 * Returns ranked chunk IDs based on weighted combination
 *
 * Uses:
 * - Semantic search: EmbeddingGemma cosine similarity (understanding)
 * - BM25: Statistical ranking with TF-IDF and length normalization (exact terms)
 *
 * @param paperId - Paper ID to search within
 * @param query - Search query
 * @param limit - Maximum number of results
 * @param alpha - Weight for semantic score (0-1), BM25 gets (1-alpha). Default from config.
 * @returns Ranked array of chunk IDs
 */
async function searchHybrid(
  paperId: string,
  query: string,
  limit: number = 5,
  alpha: number = DEFAULT_HYBRID_CONFIG.alpha
): Promise<string[]> {
  const { k1, b } = DEFAULT_HYBRID_CONFIG.bm25;
  try {
    // Get all chunks for the paper
    const chunks = await getPaperChunks(paperId);

    if (chunks.length === 0) {
      return [];
    }

    // Check if chunks have embeddings
    const hasEmbeddings = chunks.some(chunk => chunk.embedding !== undefined);

    if (!hasEmbeddings) {
      // Fall back to BM25-only search when embeddings unavailable
      logger.debug('RAG', '[Offscreen] No embeddings, falling back to BM25 search');
      const bm25Scores = calculateBM25Scores(chunks, query, k1, b);

      const scoredChunks = chunks.map((chunk, i) => ({
        chunkId: chunk.id,
        score: bm25Scores[i]
      }));

      return scoredChunks
        .filter(s => s.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, limit)
        .map(s => s.chunkId);
    }

    // Generate query embedding for semantic search
    const queryEmbedding = await embeddingService.generateEmbedding(query, true);

    // Filter chunks that have embeddings
    const chunksWithEmbeddings = chunks.filter(c => c.embedding !== undefined);

    if (chunksWithEmbeddings.length === 0) {
      return [];
    }

    // STEP 1: Calculate semantic similarities (already normalized 0-1)
    const documentEmbeddings = chunksWithEmbeddings.map(c => c.embedding!);
    const chunkIds = chunksWithEmbeddings.map(c => c.id);

    const semanticScores = embeddingService.calculateSimilarities(
      queryEmbedding,
      documentEmbeddings,
      chunkIds,
      chunks.length // Get all scores, we'll re-rank after combining
    );

    // Convert to map for easy lookup
    const semanticScoreMap = new Map(semanticScores.map(s => [s.chunkId, s.score]));

    // STEP 2: Calculate BM25 scores for chunks with embeddings
    const bm25Scores = calculateBM25Scores(chunksWithEmbeddings, query, k1, b);

    // STEP 3: Normalize BM25 scores to 0-1 range (min-max normalization)
    // BM25 scores can vary widely, so we normalize to match semantic scores (0-1)
    const maxBM25 = Math.max(...bm25Scores, 1); // Avoid division by zero
    const minBM25 = Math.min(...bm25Scores, 0);
    const bm25Range = maxBM25 - minBM25 || 1;

    const normalizedBM25Scores = bm25Scores.map((score, i) => ({
      chunkId: chunksWithEmbeddings[i].id,
      score: bm25Range > 0 ? (score - minBM25) / bm25Range : 0
    }));

    const bm25ScoreMap = new Map(normalizedBM25Scores.map(s => [s.chunkId, s.score]));

    // STEP 4: Combine scores with weighted formula
    // hybrid_score = alpha * semantic_score + (1 - alpha) * bm25_score
    const hybridScores = chunksWithEmbeddings.map(chunk => {
      const semanticScore = semanticScoreMap.get(chunk.id) || 0;
      const bm25Score = bm25ScoreMap.get(chunk.id) || 0;
      const hybridScore = alpha * semanticScore + (1 - alpha) * bm25Score;

      return {
        chunkId: chunk.id,
        score: hybridScore,
        semanticScore,
        bm25Score
      };
    });

    // STEP 5: Sort by hybrid score and return top results
    const rankedResults = hybridScores
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);

    // Log top result for debugging
    if (rankedResults.length > 0) {
      const top = rankedResults[0];
      logger.debug('RAG', `[Offscreen] Hybrid search (BM25) top result - Total: ${top.score.toFixed(3)}, Semantic: ${top.semanticScore.toFixed(3)}, BM25: ${top.bm25Score.toFixed(3)}`);
    }

    return rankedResults.map(r => r.chunkId);
  } catch (error) {
    logger.error('RAG', '[Offscreen] Error in hybrid search:', error);
    return [];
  }
}

/**
 * Extract paper from HTML and send to background for storage
 * Includes deduplication to avoid processing same paper multiple times
 *
 * Flow:
 * 1. Parse HTML to Document
 * 2. Extract sections
 * 3. Chunk sections by paragraphs (adaptive)
 * 4. Create metadata chunk
 * 5. Send all chunks + paper to background for storage
 */
async function extractPaperFromHTML(
  paperHtml: string,
  paperUrl: string,
  paper: import('../types/index.ts').ResearchPaper
): Promise<void> {
  // LEVEL 2 DEDUPLICATION: Skip if already extracting this URL
  if (inFlightExtractions.has(paperUrl)) {
    logger.debug('PDF_EXTRACTION', '[Offscreen] ⏭ Skipping duplicate extraction for:', paperUrl);
    return;
  }

  try {
    // Mark as in-flight
    inFlightExtractions.add(paperUrl);
    logger.debug('PDF_EXTRACTION', '[Offscreen] 📄 Starting extraction for:', paperUrl);

    // Parse HTML string into Document
    const parser = new DOMParser();
    const doc = parser.parseFromString(paperHtml, 'text/html');

    if (!doc) {
      logger.error('PDF_EXTRACTION', '[Offscreen] Failed to parse HTML');
      return;
    }

    // Extract sections using researchPaperSplitter
    const { extractHTMLSections } = await import('../utils/researchPaperSplitter.ts');
    const sections = await extractHTMLSections(doc);

    if (!sections || sections.length === 0) {
      logger.warn('PDF_EXTRACTION', '[Offscreen] No sections extracted from HTML');
      return;
    }

    logger.debug('PDF_EXTRACTION', `[Offscreen] ✓ Extracted ${sections.length} sections`);

    // Generate paper ID
    const { generatePaperId } = await import('../utils/dbService.ts');
    const paperId = generatePaperId(paperUrl);

    // Chunk sections adaptively by paragraphs
    const { chunkSections } = await import('../utils/adaptiveChunker.ts');
    const { chunks, stats } = await chunkSections(sections, paperId);

    logger.debug('CHUNKING', `[Offscreen] ✓ Created ${chunks.length} adaptive chunks`);

    // Create metadata chunk
    const { createMetadataChunk } = await import('../content/services/paperStorageService.ts');
    const metadataChunk = createMetadataChunk(paper, paperId);

    // Renumber all existing chunks (increment index by 1)
    const renumberedChunks = chunks.map(chunk => ({
      ...chunk,
      index: chunk.index + 1,
      id: `chunk_${paperId}_${chunk.index + 1}`,
    }));

    // Prepend metadata chunk
    const allChunks = [metadataChunk, ...renumberedChunks];

    // Recalculate average chunk size including metadata
    const totalChunkSize = allChunks.reduce((sum, c) => sum + c.content.length, 0);
    const avgChunkSize = Math.floor(totalChunkSize / allChunks.length);

    logger.debug('CHUNKING', `[Offscreen] ✓ Created metadata chunk, total chunks: ${allChunks.length}`);

    // Send to background for storage
    chrome.runtime.sendMessage({
      type: MessageType.STORE_PAPER_IN_DB,
      payload: {
        paper,
        fullText: undefined,
        preChunkedData: {
          chunks: allChunks,
          metadata: {
            averageChunkSize: avgChunkSize,
          },
        },
      }
    });

    logger.debug('PDF_EXTRACTION', '[Offscreen] ✓ Sent chunks to background for storage');
  } catch (error) {
    logger.error('PDF_EXTRACTION', '[Offscreen] Error extracting paper from HTML:', error);
  } finally {
    // Remove from in-flight set
    inFlightExtractions.delete(paperUrl);
  }
}

/**
 * Message handler for requests from background
 */
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === MessageType.GENERATE_EMBEDDINGS) {
    const { paperId, paperUrl } = message.payload;

    // Generate embeddings asynchronously
    (async () => {
      try {
        const result = await generateEmbeddingsForPaper(paperId, paperUrl);
        if (result) {
          sendResponse({ success: true, count: result.count, device: result.device });
        } else {
          sendResponse({ success: false, error: 'Failed to generate embeddings' });
        }
      } catch (error) {
        logger.error('EMBEDDINGS', '[Offscreen] Error generating embeddings:', error);
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
        logger.error('RAG', '[Offscreen] Error in semantic search:', error);
        sendResponse({ success: false, error: String(error), chunkIds: [] });
      }
    })();

    return true; // Keep message channel open for async response
  }

  if (message.type === MessageType.HYBRID_SEARCH) {
    const { paperId, query, limit, alpha } = message.payload;

    // Perform hybrid search asynchronously
    (async () => {
      try {
        const chunkIds = await searchHybrid(paperId, query, limit || 5, alpha);
        sendResponse({ success: true, chunkIds });
      } catch (error) {
        logger.error('RAG', '[Offscreen] Error in hybrid search:', error);
        sendResponse({ success: false, error: String(error), chunkIds: [] });
      }
    })();

    return true; // Keep message channel open for async response
  }

  if (message.type === MessageType.PRELOAD_EMBEDDINGS) {
    // Preload embedding model during initialization
    (async () => {
      try {
        logger.debug('EMBEDDINGS', '[Offscreen] Preloading embedding model...');
        await embeddingService.loadModel();
        logger.debug('EMBEDDINGS', '[Offscreen] Embedding model preloaded successfully');
        sendResponse({ success: true });
      } catch (error) {
        logger.error('EMBEDDINGS', '[Offscreen] Error preloading embeddings:', error);
        sendResponse({ success: false, error: String(error) });
      }
    })();

    return true; // Keep message channel open for async response
  }

  if (message.type === MessageType.EXTRACT_PAPER_HTML) {
    const { paperHtml, paperUrl, paper } = message.payload;

    // Fire-and-forget: Extract asynchronously without blocking sender
    (async () => {
      await extractPaperFromHTML(paperHtml, paperUrl, paper);
    })();

    // No need to keep channel open - fire and forget
    return false;
  }

  return false;
});
