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
 * Track in-flight extractions to avoid duplicate processing
 * Maps paper URL to extraction promise
 */
const inFlightExtractions = new Set<string>();

/**
 * Generate embeddings for a paper's chunks
 */
async function generateEmbeddingsForPaper(paperId: string, paperUrl?: string): Promise<number | null> {
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

      // Send progress update every 10 embeddings or at 25%, 50%, 75%, 100%
      const current = i + 1;
      const shouldUpdate = current % 10 === 0 ||
                          current === Math.floor(chunks.length * 0.25) ||
                          current === Math.floor(chunks.length * 0.50) ||
                          current === Math.floor(chunks.length * 0.75) ||
                          current === chunks.length;

      if (shouldUpdate) {
        chrome.runtime.sendMessage({
          type: 'EMBEDDING_PROGRESS',
          payload: {
            paperId,
            paperUrl,
            current,
            total: chunks.length,
          }
        }).catch(() => {
          // Background might not be listening, that's ok
        });
      }

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
        const embeddingCount = await generateEmbeddingsForPaper(paperId, paperUrl);
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
