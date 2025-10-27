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

console.log('[Offscreen] Offscreen document initialized');

/**
 * Diagnostic: Check WebGPU availability on startup
 */
(async () => {
  console.log('[Offscreen] 🔍 Running WebGPU diagnostics...');

  // Check if WebGPU API exists
  if (typeof navigator === 'undefined' || !('gpu' in navigator)) {
    console.warn('[Offscreen] ❌ WebGPU API not available in this context');
    return;
  }

  console.log('[Offscreen] ✓ WebGPU API exists');

  try {
    // Request adapter to test if WebGPU actually works
    const adapter = await navigator.gpu.requestAdapter();

    if (!adapter) {
      console.warn('[Offscreen] ❌ WebGPU adapter request returned null (GPU not available)');
      return;
    }

    console.log('[Offscreen] ✓ WebGPU adapter obtained successfully');

    // Log adapter info (if available - newer API)
    try {
      if (typeof adapter.requestAdapterInfo === 'function') {
        const info = await adapter.requestAdapterInfo();
        console.log('[Offscreen] 📊 GPU Info:', {
          vendor: info.vendor,
          architecture: info.architecture,
          device: info.device,
          description: info.description,
        });
      } else {
        console.log('[Offscreen] 📊 GPU Info: (requestAdapterInfo not available in this browser)');
      }
    } catch (infoError) {
      console.log('[Offscreen] 📊 GPU Info: (unable to retrieve adapter info)');
    }

    // Log adapter features and limits
    console.log('[Offscreen] 🎯 GPU Features:', Array.from(adapter.features));
    console.log('[Offscreen] 📏 GPU Limits (selected):', {
      maxBufferSize: adapter.limits.maxBufferSize,
      maxComputeWorkgroupsPerDimension: adapter.limits.maxComputeWorkgroupsPerDimension,
    });

    console.log('[Offscreen] ✅ WebGPU is fully functional and ready for use!');
  } catch (error) {
    console.error('[Offscreen] ❌ WebGPU test failed:', error);
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
    console.log(`[Offscreen] 🎯 Using ${device.toUpperCase()} backend for embeddings`);

    // Fetch chunks from IndexedDB (shared with background)
    const chunks = await getPaperChunks(paperId);

    if (chunks.length === 0) {
      console.warn('[Offscreen] No chunks found for paper:', paperId);
      return null;
    }

    // Generate embeddings one at a time to avoid memory issues
    const embeddings: Float32Array[] = [];
    const startTime = performance.now();
    let lastLogTime = startTime;

    for (let i = 0; i < chunks.length; i++) {
      const embedding = await embeddingService.generateEmbedding(chunks[i].content, false);
      embeddings.push(embedding);

      // Send progress update every 10 embeddings or at 25%, 50%, 75%, 100%
      const current = i + 1;
      const shouldUpdate = current % 10 === 0 ||
                          current === Math.floor(chunks.length * 0.25) ||
                          current === Math.floor(chunks.length * 0.50) ||
                          current === Math.floor(chunks.length * 0.75) ||
                          current === chunks.length;

      if (shouldUpdate) {
        // Calculate performance metrics
        const now = performance.now();
        const elapsed = (now - startTime) / 1000; // seconds
        const embeddingsPerSecond = (current / elapsed).toFixed(2);
        const avgTimePerEmbedding = (elapsed / current * 1000).toFixed(0); // ms

        // Log performance every 10% progress
        if (current % Math.max(1, Math.floor(chunks.length * 0.1)) === 0) {
          console.log(`[Offscreen] ⚡ Performance: ${embeddingsPerSecond} emb/s (${avgTimePerEmbedding}ms per embedding) using ${device.toUpperCase()}`);
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

      // Small delay only for WASM backend to allow memory cleanup
      // WebGPU can handle continuous processing without delay
      if (i < chunks.length - 1 && device === 'wasm') {
        await new Promise(resolve => setTimeout(resolve, 500));
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
    console.log(`[Offscreen] ✅ Generated ${embeddings.length} embeddings using ${backendUsed}`);
    console.log(`[Offscreen] 📊 Performance Summary:`);
    console.log(`   - Total time: ${totalTime.toFixed(1)}s`);
    console.log(`   - Speed: ${embeddingsPerSecond} embeddings/second`);
    console.log(`   - Average: ${avgTimePerEmbedding}ms per embedding`);
    console.log(`   - Backend: ${device.toUpperCase()}`);

    return { count: embeddings.length, device };
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
 * Helper function to escape regex special characters
 */
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Calculate keyword relevance score for a chunk
 * Returns number of keyword occurrences
 */
function calculateKeywordScore(content: string, query: string): number {
  const lowerContent = content.toLowerCase();
  const lowerQuery = query.toLowerCase();
  const queryWords = lowerQuery.split(/\s+/);

  let score = 0;
  for (const word of queryWords) {
    const escapedWord = escapeRegex(word);
    const matches = (lowerContent.match(new RegExp(escapedWord, 'g')) || []).length;
    score += matches;
  }

  return score;
}

/**
 * Perform hybrid search combining semantic and keyword approaches
 * Returns ranked chunk IDs based on weighted combination
 *
 * @param paperId - Paper ID to search within
 * @param query - Search query
 * @param limit - Maximum number of results
 * @param alpha - Weight for semantic score (0-1), keyword gets (1-alpha). Default from config.
 * @returns Ranked array of chunk IDs
 */
async function searchHybrid(
  paperId: string,
  query: string,
  limit: number = 5,
  alpha: number = DEFAULT_HYBRID_CONFIG.alpha
): Promise<string[]> {
  try {
    // Get all chunks for the paper
    const chunks = await getPaperChunks(paperId);

    if (chunks.length === 0) {
      return [];
    }

    // Check if chunks have embeddings
    const hasEmbeddings = chunks.some(chunk => chunk.embedding !== undefined);

    if (!hasEmbeddings) {
      // Fall back to keyword-only search
      console.log('[Offscreen] No embeddings, falling back to keyword search');
      const keywordScores = chunks.map(chunk => ({
        chunkId: chunk.id,
        score: calculateKeywordScore(chunk.content, query)
      }));

      return keywordScores
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

    // STEP 2: Calculate keyword scores for chunks with embeddings
    const keywordScores = chunksWithEmbeddings.map(chunk => ({
      chunkId: chunk.id,
      score: calculateKeywordScore(chunk.content, query)
    }));

    // STEP 3: Normalize keyword scores to 0-1 range (min-max normalization)
    const keywordScoreValues = keywordScores.map(s => s.score);
    const maxKeywordScore = Math.max(...keywordScoreValues, 1); // Avoid division by zero
    const minKeywordScore = Math.min(...keywordScoreValues, 0);
    const keywordRange = maxKeywordScore - minKeywordScore || 1; // Avoid division by zero

    const normalizedKeywordScores = keywordScores.map(s => ({
      chunkId: s.chunkId,
      score: keywordRange > 0 ? (s.score - minKeywordScore) / keywordRange : 0
    }));

    const keywordScoreMap = new Map(normalizedKeywordScores.map(s => [s.chunkId, s.score]));

    // STEP 4: Combine scores with weighted formula
    // hybrid_score = alpha * semantic_score + (1 - alpha) * keyword_score
    const hybridScores = chunksWithEmbeddings.map(chunk => {
      const semanticScore = semanticScoreMap.get(chunk.id) || 0;
      const keywordScore = keywordScoreMap.get(chunk.id) || 0;
      const hybridScore = alpha * semanticScore + (1 - alpha) * keywordScore;

      return {
        chunkId: chunk.id,
        score: hybridScore,
        semanticScore,
        keywordScore
      };
    });

    // STEP 5: Sort by hybrid score and return top results
    const rankedResults = hybridScores
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);

    // Log top result for debugging
    if (rankedResults.length > 0) {
      const top = rankedResults[0];
      console.log(`[Offscreen] Hybrid search top result - Total: ${top.score.toFixed(3)}, Semantic: ${top.semanticScore.toFixed(3)}, Keyword: ${top.keywordScore.toFixed(3)}`);
    }

    return rankedResults.map(r => r.chunkId);
  } catch (error) {
    console.error('[Offscreen] Error in hybrid search:', error);
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
    console.log('[Offscreen] ⏭ Skipping duplicate extraction for:', paperUrl);
    return;
  }

  try {
    // Mark as in-flight
    inFlightExtractions.add(paperUrl);
    console.log('[Offscreen] 📄 Starting extraction for:', paperUrl);

    // Parse HTML string into Document
    const parser = new DOMParser();
    const doc = parser.parseFromString(paperHtml, 'text/html');

    if (!doc) {
      console.error('[Offscreen] Failed to parse HTML');
      return;
    }

    // Extract sections using researchPaperSplitter
    const { extractHTMLSections } = await import('../utils/researchPaperSplitter.ts');
    const sections = await extractHTMLSections(doc);

    if (!sections || sections.length === 0) {
      console.warn('[Offscreen] No sections extracted from HTML');
      return;
    }

    console.log(`[Offscreen] ✓ Extracted ${sections.length} sections`);

    // Generate paper ID
    const { generatePaperId } = await import('../utils/dbService.ts');
    const paperId = generatePaperId(paperUrl);

    // Chunk sections adaptively by paragraphs
    const { chunkSections } = await import('../utils/adaptiveChunker.ts');
    const { chunks, stats } = await chunkSections(sections, paperId);

    console.log(`[Offscreen] ✓ Created ${chunks.length} adaptive chunks`);

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

    console.log(`[Offscreen] ✓ Created metadata chunk, total chunks: ${allChunks.length}`);

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

    console.log('[Offscreen] ✓ Sent chunks to background for storage');
  } catch (error) {
    console.error('[Offscreen] Error extracting paper from HTML:', error);
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

  if (message.type === MessageType.HYBRID_SEARCH) {
    const { paperId, query, limit, alpha } = message.payload;

    // Perform hybrid search asynchronously
    (async () => {
      try {
        const chunkIds = await searchHybrid(paperId, query, limit || 5, alpha);
        sendResponse({ success: true, chunkIds });
      } catch (error) {
        console.error('[Offscreen] Error in hybrid search:', error);
        sendResponse({ success: false, error: String(error), chunkIds: [] });
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
