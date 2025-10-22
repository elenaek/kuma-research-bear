import { ResearchPaper, StoredPaper, ContentChunk } from '../types/index.ts';

/**
 * IndexedDB Service for storing research papers locally
 * Enables offline access and RAG-based Q&A functionality
 */

const DB_NAME = 'KumaResearchBearDB';
const DB_VERSION = 1;
const PAPERS_STORE = 'papers';
const CHUNKS_STORE = 'chunks';

/**
 * Initialize IndexedDB
 */
function initDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = () => {
      reject(new Error('Failed to open IndexedDB'));
    };

    request.onsuccess = () => {
      resolve(request.result);
    };

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;

      // Create papers store
      if (!db.objectStoreNames.contains(PAPERS_STORE)) {
        const papersStore = db.createObjectStore(PAPERS_STORE, { keyPath: 'id' });
        papersStore.createIndex('url', 'url', { unique: true });
        papersStore.createIndex('source', 'source', { unique: false });
        papersStore.createIndex('storedAt', 'storedAt', { unique: false });
        papersStore.createIndex('title', 'title', { unique: false });
      }

      // Create chunks store
      if (!db.objectStoreNames.contains(CHUNKS_STORE)) {
        const chunksStore = db.createObjectStore(CHUNKS_STORE, { keyPath: 'id' });
        chunksStore.createIndex('paperId', 'paperId', { unique: false });
        chunksStore.createIndex('index', 'index', { unique: false });
      }

      console.log('✓ IndexedDB initialized with stores:', PAPERS_STORE, CHUNKS_STORE);
    };
  });
}

/**
 * Generate unique ID for a paper (using URL hash)
 */
function generatePaperId(url: string): string {
  // Simple hash function for URL
  let hash = 0;
  for (let i = 0; i < url.length; i++) {
    const char = url.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32-bit integer
  }
  return `paper_${Math.abs(hash)}`;
}

/**
 * Store a research paper with its full content
 */
export async function storePaper(
  paper: ResearchPaper,
  fullText?: string,
  qaHistory?: any[],
  onChunkProgress?: (current: number, total: number) => void
): Promise<StoredPaper> {
  console.log('[IndexedDB] storePaper called:', {
    title: paper.title,
    url: paper.url,
    source: paper.source
  });

  const db = await initDB();

  try {
    const paperId = generatePaperId(paper.url);
    console.log('[IndexedDB] Generated paper ID:', paperId, 'for URL:', paper.url);

    // Extract full text if not provided (only works in content script context)
    let extractedText: string;
    if (fullText) {
      extractedText = fullText;
    } else if (typeof document !== 'undefined') {
      // We're in a content script context, can extract text
      const { extractPageText } = await import('./contentExtractor.ts');
      extractedText = extractPageText().text;
    } else {
      // We're in a background script context without fullText provided
      throw new Error('fullText must be provided when storing paper from background script context');
    }

    // Create chunks with metadata using contentExtractor (5000 chars with 1000 overlap for speed and context)
    const { chunkContent } = await import('./contentExtractor.ts');
    const extractorChunks = chunkContent(extractedText, 5000, 1000);

    // Transform to storage format with richer metadata
    const contentChunks: ContentChunk[] = extractorChunks.map((chunk, index) => ({
      id: `chunk_${paperId}_${index}`,
      paperId,
      content: chunk.content,
      index,
      section: chunk.heading,
      startChar: chunk.startIndex,
      endChar: chunk.endIndex,
      tokenCount: Math.ceil(chunk.content.length / 4),
    }));

    // Create stored paper object (hierarchical summary will be added after chunk storage)
    const storedPaper: StoredPaper = {
      ...paper,
      id: paperId,
      fullText: extractedText,
      chunkCount: contentChunks.length,
      storedAt: Date.now(),
      lastAccessedAt: Date.now(),
      hierarchicalSummary: undefined,  // Will be generated after chunks are stored
      qaHistory: qaHistory || [],
    };

    // Store paper
    const paperTransaction = db.transaction([PAPERS_STORE], 'readwrite');
    const paperStore = paperTransaction.objectStore(PAPERS_STORE);
    await new Promise<void>((resolve, reject) => {
      const request = paperStore.put(storedPaper);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(new Error('Failed to store paper'));
    });

    // Store chunks (instant - no progress tracking needed)
    const chunkTransaction = db.transaction([CHUNKS_STORE], 'readwrite');
    const chunkStore = chunkTransaction.objectStore(CHUNKS_STORE);

    for (let i = 0; i < contentChunks.length; i++) {
      const chunk = contentChunks[i];
      chunkStore.put(chunk);  // Queue all puts
    }

    // Wait for transaction to complete
    await new Promise<void>((resolve, reject) => {
      chunkTransaction.oncomplete = () => resolve();
      chunkTransaction.onerror = () => reject(new Error('Failed to store chunks'));
    });

    console.log(`✓ Stored paper: ${paper.title} (${contentChunks.length} chunks)`);

    // Generate hierarchical summary AND extract terms AFTER chunks are stored
    // Progress tracking happens during summarization (the time-consuming part)
    console.log('[IndexedDB] Generating hierarchical summary and extracting terms...');
    try {
      const { aiService } = await import('./aiService.ts');
      const result = await aiService.createHierarchicalSummary(
        extractedText,
        `paper-${paperId}`,
        onChunkProgress  // Pass progress callback to track chunk summarization
      );
      console.log('[IndexedDB] ✓ Hierarchical summary generated:', result.summary.length, 'chars');
      console.log('[IndexedDB] ✓ Extracted terms from', result.chunkTerms.length, 'chunks');

      // Update the stored paper with hierarchical summary
      storedPaper.hierarchicalSummary = result.summary;
      const paperUpdateTransaction = db.transaction([PAPERS_STORE], 'readwrite');
      const paperUpdateStore = paperUpdateTransaction.objectStore(PAPERS_STORE);
      await new Promise<void>((resolve, reject) => {
        const request = paperUpdateStore.put(storedPaper);
        request.onsuccess = () => resolve();
        request.onerror = () => reject(new Error('Failed to update paper with hierarchical summary'));
      });
      console.log('[IndexedDB] ✓ Paper updated with hierarchical summary');

      // Update chunks with extracted terms
      if (result.chunkTerms.length > 0) {
        console.log('[IndexedDB] Updating chunks with extracted terms...');
        const chunkUpdateTransaction = db.transaction([CHUNKS_STORE], 'readwrite');
        const chunkUpdateStore = chunkUpdateTransaction.objectStore(CHUNKS_STORE);

        // Update each chunk with its terms
        for (let i = 0; i < Math.min(contentChunks.length, result.chunkTerms.length); i++) {
          contentChunks[i].terms = result.chunkTerms[i];
          chunkUpdateStore.put(contentChunks[i]);
        }

        await new Promise<void>((resolve, reject) => {
          chunkUpdateTransaction.oncomplete = () => resolve();
          chunkUpdateTransaction.onerror = () => reject(new Error('Failed to update chunks with terms'));
        });

        console.log('[IndexedDB] ✓ Chunks updated with terms');
      }
    } catch (error) {
      console.error('[IndexedDB] Failed to generate hierarchical summary or extract terms:', error);
      // Continue without hierarchical summary and terms - analysis will still work but with reduced accuracy
    }

    // Note: Embedding generation moved to content/services/paperStorageService.ts
    // This prevents bundling Transformers.js in background worker

    db.close();
    return storedPaper;
  } catch (error) {
    db.close();
    throw error;
  }
}

/**
 * Get a paper by URL
 */
export async function getPaperByUrl(url: string): Promise<StoredPaper | null> {
  console.log('[IndexedDB] getPaperByUrl called with URL:', url);

  const db = await initDB();

  try {
    const transaction = db.transaction([PAPERS_STORE], 'readonly');
    const store = transaction.objectStore(PAPERS_STORE);
    const index = store.index('url');

    const paper = await new Promise<StoredPaper | null>((resolve) => {
      const request = index.get(url);
      request.onsuccess = () => {
        const result = request.result || null;
        console.log('[IndexedDB] Query result:', result ? {
          found: true,
          id: result.id,
          title: result.title,
          url: result.url,
          chunkCount: result.chunkCount
        } : { found: false, queriedUrl: url });
        resolve(result);
      };
      request.onerror = () => {
        console.error('[IndexedDB] Query error:', request.error);
        resolve(null);
      };
    });

    // Update last accessed timestamp
    if (paper) {
      paper.lastAccessedAt = Date.now();
      const updateTransaction = db.transaction([PAPERS_STORE], 'readwrite');
      const updateStore = updateTransaction.objectStore(PAPERS_STORE);
      updateStore.put(paper);
      console.log('[IndexedDB] Updated lastAccessedAt for paper:', paper.id);
    }

    db.close();
    return paper;
  } catch (error) {
    db.close();
    console.error('[IndexedDB] Error getting paper by URL:', {
      error,
      url,
      stack: error instanceof Error ? error.stack : undefined
    });
    return null;
  }
}

/**
 * Get a paper by ID
 */
export async function getPaperById(id: string): Promise<StoredPaper | null> {
  const db = await initDB();

  try {
    const transaction = db.transaction([PAPERS_STORE], 'readonly');
    const store = transaction.objectStore(PAPERS_STORE);

    const paper = await new Promise<StoredPaper | null>((resolve) => {
      const request = store.get(id);
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => resolve(null);
    });

    // Update last accessed timestamp
    if (paper) {
      paper.lastAccessedAt = Date.now();
      const updateTransaction = db.transaction([PAPERS_STORE], 'readwrite');
      const updateStore = updateTransaction.objectStore(PAPERS_STORE);
      updateStore.put(paper);
    }

    db.close();
    return paper;
  } catch (error) {
    db.close();
    console.error('Error getting paper by ID:', error);
    return null;
  }
}

/**
 * Get all chunks for a paper
 */
export async function getPaperChunks(paperId: string): Promise<ContentChunk[]> {
  const db = await initDB();

  try {
    const transaction = db.transaction([CHUNKS_STORE], 'readonly');
    const store = transaction.objectStore(CHUNKS_STORE);
    const index = store.index('paperId');

    const chunks = await new Promise<ContentChunk[]>((resolve, reject) => {
      const request = index.getAll(paperId);
      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => reject(new Error('Failed to get chunks'));
    });

    db.close();

    // Sort by index
    return chunks.sort((a, b) => a.index - b.index);
  } catch (error) {
    db.close();
    console.error('Error getting paper chunks:', error);
    return [];
  }
}

/**
 * Get all stored papers
 */
export async function getAllPapers(): Promise<StoredPaper[]> {
  const db = await initDB();

  try {
    const transaction = db.transaction([PAPERS_STORE], 'readonly');
    const store = transaction.objectStore(PAPERS_STORE);

    const papers = await new Promise<StoredPaper[]>((resolve, reject) => {
      const request = store.getAll();
      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => reject(new Error('Failed to get papers'));
    });

    db.close();

    // Sort by most recently stored
    return papers.sort((a, b) => b.storedAt - a.storedAt);
  } catch (error) {
    db.close();
    console.error('Error getting all papers:', error);
    return [];
  }
}

/**
 * Delete a paper and its chunks
 */
export async function deletePaper(paperId: string): Promise<boolean> {
  const db = await initDB();

  try {
    // Delete paper
    const paperTransaction = db.transaction([PAPERS_STORE], 'readwrite');
    const paperStore = paperTransaction.objectStore(PAPERS_STORE);
    await new Promise<void>((resolve, reject) => {
      const request = paperStore.delete(paperId);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(new Error('Failed to delete paper'));
    });

    // Delete all chunks for this paper
    const chunkTransaction = db.transaction([CHUNKS_STORE], 'readwrite');
    const chunkStore = chunkTransaction.objectStore(CHUNKS_STORE);
    const index = chunkStore.index('paperId');

    const chunks = await new Promise<ContentChunk[]>((resolve, reject) => {
      const request = index.getAll(paperId);
      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => reject(new Error('Failed to get chunks for deletion'));
    });

    for (const chunk of chunks) {
      await new Promise<void>((resolve, reject) => {
        const request = chunkStore.delete(chunk.id);
        request.onsuccess = () => resolve();
        request.onerror = () => reject(new Error('Failed to delete chunk'));
      });
    }

    console.log(`✓ Deleted paper and ${chunks.length} chunks`);

    db.close();
    return true;
  } catch (error) {
    db.close();
    console.error('Error deleting paper:', error);
    return false;
  }
}

/**
 * Update specific fields of a paper
 * Generic update function for any paper fields
 */
export async function updatePaper(paperId: string, updates: Partial<StoredPaper>): Promise<boolean> {
  const db = await initDB();

  try {
    const transaction = db.transaction([PAPERS_STORE], 'readwrite');
    const store = transaction.objectStore(PAPERS_STORE);

    const paper = await new Promise<StoredPaper | null>((resolve) => {
      const request = store.get(paperId);
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => resolve(null);
    });

    if (!paper) {
      console.error('Paper not found for update:', paperId);
      db.close();
      throw new Error(`Paper not found for update: ${paperId}`);
    }

    // Apply updates
    const updatedPaper = { ...paper, ...updates, lastAccessedAt: Date.now() };

    await new Promise<void>((resolve, reject) => {
      const request = store.put(updatedPaper);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(new Error('Failed to update paper'));
    });

    console.log(`✓ Updated paper: ${paper.title}`);
    db.close();
    return true;
  } catch (error) {
    db.close();
    console.error('Error updating paper:', error);
    throw error;
  }
}

/**
 * Update Q&A history for a paper
 */
export async function updatePaperQAHistory(paperId: string, qaHistory: any[]): Promise<boolean> {
  const db = await initDB();

  try {
    // Get the paper first
    const transaction = db.transaction([PAPERS_STORE], 'readonly');
    const store = transaction.objectStore(PAPERS_STORE);

    const paper = await new Promise<StoredPaper | null>((resolve) => {
      const request = store.get(paperId);
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => resolve(null);
    });

    if (!paper) {
      console.error('Paper not found for Q&A history update:', paperId);
      db.close();
      throw new Error(`Paper not found for Q&A history update: ${paperId}`);
    }

    // Update the paper with new Q&A history
    paper.qaHistory = qaHistory;
    paper.lastAccessedAt = Date.now();

    const updateTransaction = db.transaction([PAPERS_STORE], 'readwrite');
    const updateStore = updateTransaction.objectStore(PAPERS_STORE);
    await new Promise<void>((resolve, reject) => {
      const request = updateStore.put(paper);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(new Error('Failed to update Q&A history'));
    });

    console.log(`✓ Updated Q&A history for paper: ${paper.title}`);
    db.close();
    return true;
  } catch (error) {
    db.close();
    console.error('Error updating Q&A history:', error);
    throw error;
  }
}

/**
 * Update explanation and summary for a paper
 */
export async function updatePaperExplanation(
  paperId: string,
  explanation: any,
  summary: any,
  outputLanguage?: string
): Promise<boolean> {
  const db = await initDB();

  try {
    // Get the paper first
    const transaction = db.transaction([PAPERS_STORE], 'readonly');
    const store = transaction.objectStore(PAPERS_STORE);

    const paper = await new Promise<StoredPaper | null>((resolve) => {
      const request = store.get(paperId);
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => resolve(null);
    });

    if (!paper) {
      console.error('Paper not found for explanation update:', paperId);
      db.close();
      throw new Error(`Paper not found for explanation update: ${paperId}`);
    }

    // Update the paper with explanation and summary
    paper.explanation = explanation;
    paper.summary = summary;
    paper.lastAccessedAt = Date.now();

    // Store output language in metadata if provided
    if (outputLanguage) {
      if (!paper.metadata) {
        paper.metadata = {};
      }
      paper.metadata.outputLanguage = outputLanguage;
    }

    const updateTransaction = db.transaction([PAPERS_STORE], 'readwrite');
    const updateStore = updateTransaction.objectStore(PAPERS_STORE);
    await new Promise<void>((resolve, reject) => {
      const request = updateStore.put(paper);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(new Error('Failed to update explanation'));
    });

    console.log(`✓ Updated explanation for paper: ${paper.title}`);
    db.close();
    return true;
  } catch (error) {
    db.close();
    console.error('Error updating explanation:', error);
    throw error;
  }
}

/**
 * Update chunk embeddings for a paper
 * Used by offscreen document after generating embeddings
 */
export async function updateChunkEmbeddings(paperId: string, embeddings: Float32Array[]): Promise<void> {
  const db = await initDB();

  try {
    // Get chunks for the paper
    const chunks = await getPaperChunks(paperId);

    if (chunks.length !== embeddings.length) {
      throw new Error(`Chunk count mismatch: ${chunks.length} chunks vs ${embeddings.length} embeddings`);
    }

    // Update chunks with embeddings
    const transaction = db.transaction([CHUNKS_STORE], 'readwrite');
    const store = transaction.objectStore(CHUNKS_STORE);

    for (let i = 0; i < chunks.length; i++) {
      chunks[i].embedding = embeddings[i];
      store.put(chunks[i]);
    }

    // Wait for transaction to complete
    await new Promise<void>((resolve, reject) => {
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(new Error('Failed to update chunks with embeddings'));
    });

    console.log(`✓ Updated ${embeddings.length} chunks with embeddings for paper: ${paperId}`);
    db.close();
  } catch (error) {
    db.close();
    console.error('Error updating chunk embeddings:', error);
    throw error;
  }
}

/**
 * Update analysis for a paper
 */
export async function updatePaperAnalysis(paperId: string, analysis: any, outputLanguage?: string): Promise<boolean> {
  const db = await initDB();

  try {
    // Use single readwrite transaction for atomic read-modify-write
    const transaction = db.transaction([PAPERS_STORE], 'readwrite');
    const store = transaction.objectStore(PAPERS_STORE);

    const paper = await new Promise<StoredPaper | null>((resolve) => {
      const request = store.get(paperId);
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => resolve(null);
    });

    if (!paper) {
      console.error('Paper not found for analysis update:', paperId);
      db.close();
      throw new Error(`Paper not found for analysis update: ${paperId}`);
    }

    // Update the paper with analysis
    paper.analysis = analysis;
    paper.lastAccessedAt = Date.now();

    // Store output language in metadata if provided
    if (outputLanguage) {
      if (!paper.metadata) {
        paper.metadata = {};
      }
      paper.metadata.outputLanguage = outputLanguage;
    }

    // Write in the same transaction (prevents race conditions)
    await new Promise<void>((resolve, reject) => {
      const request = store.put(paper);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(new Error('Failed to update analysis'));
    });

    console.log(`✓ Updated analysis for paper: ${paper.title}`);
    db.close();
    return true;
  } catch (error) {
    db.close();
    console.error('Error updating analysis:', error);
    throw error;
  }
}

/**
 * Update glossary for a paper
 */
export async function updatePaperGlossary(paperId: string, glossary: any, outputLanguage?: string): Promise<boolean> {
  const db = await initDB();

  try {
    // Use single readwrite transaction for atomic read-modify-write
    const transaction = db.transaction([PAPERS_STORE], 'readwrite');
    const store = transaction.objectStore(PAPERS_STORE);

    const paper = await new Promise<StoredPaper | null>((resolve) => {
      const request = store.get(paperId);
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => resolve(null);
    });

    if (!paper) {
      console.error('Paper not found for glossary update:', paperId);
      db.close();
      throw new Error(`Paper not found for glossary update: ${paperId}`);
    }

    // Update the paper with glossary
    paper.glossary = glossary;
    paper.lastAccessedAt = Date.now();

    // Store output language in metadata if provided
    if (outputLanguage) {
      if (!paper.metadata) {
        paper.metadata = {};
      }
      paper.metadata.outputLanguage = outputLanguage;
    }

    // Write in the same transaction (prevents race conditions)
    await new Promise<void>((resolve, reject) => {
      const request = store.put(paper);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(new Error('Failed to update glossary'));
    });

    console.log(`✓ Updated glossary for paper: ${paper.title}`);
    db.close();
    return true;
  } catch (error) {
    db.close();
    console.error('Error updating glossary:', error);
    throw error;
  }
}

/**
 * Search papers by title or content (simple full-text search)
 */
export async function searchPapers(query: string): Promise<StoredPaper[]> {
  const papers = await getAllPapers();
  const lowerQuery = query.toLowerCase();

  return papers.filter(paper => {
    return (
      paper.title.toLowerCase().includes(lowerQuery) ||
      paper.abstract.toLowerCase().includes(lowerQuery) ||
      paper.authors.some(author => author.toLowerCase().includes(lowerQuery)) ||
      paper.fullText.toLowerCase().includes(lowerQuery)
    );
  });
}

/**
 * Escape special regex characters in a string
 * Prevents regex injection when creating RegExp from user input
 */
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Get relevant chunks for a query (for RAG)
 * Currently uses simple keyword matching
 * Future: Use embeddings for semantic search
 */
export async function getRelevantChunks(
  paperId: string,
  query: string,
  limit: number = 5
): Promise<ContentChunk[]> {
  const chunks = await getPaperChunks(paperId);
  const lowerQuery = query.toLowerCase();

  // Score chunks by keyword relevance
  const scoredChunks = chunks.map(chunk => {
    const content = chunk.content.toLowerCase();
    const queryWords = lowerQuery.split(/\s+/);

    let score = 0;
    for (const word of queryWords) {
      const escapedWord = escapeRegex(word);
      const matches = (content.match(new RegExp(escapedWord, 'g')) || []).length;
      score += matches;
    }

    return { chunk, score };
  });

  // Sort by score and return top chunks
  return scoredChunks
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(({ chunk }) => chunk);
}

/**
 * Get relevant chunks by searching for multiple topic keywords
 * Used for targeted analysis operations (methodology, limitations, etc.)
 * Enhanced version of getRelevantChunks that searches for specific topics
 */
export async function getRelevantChunksByTopic(
  paperId: string,
  topics: string[],
  limit: number = 3
): Promise<ContentChunk[]> {
  const chunks = await getPaperChunks(paperId);

  console.log(`[RAG] Searching ${chunks.length} chunks for topics:`, topics);

  // Score chunks by topic keyword relevance
  const scoredChunks = chunks.map(chunk => {
    const content = chunk.content.toLowerCase();
    const section = chunk.section?.toLowerCase() || '';

    let score = 0;

    // Check each topic keyword
    for (const topic of topics) {
      const topicLower = topic.toLowerCase();

      // Higher weight for section heading matches
      if (section.includes(topicLower)) {
        score += 10;
      }

      // Count occurrences in content
      const escapedTopic = escapeRegex(topicLower);
      const matches = (content.match(new RegExp(escapedTopic, 'g')) || []).length;
      score += matches * 2;

      // Bonus for topic appearing in first 200 chars (likely important)
      if (content.slice(0, 200).includes(topicLower)) {
        score += 5;
      }
    }

    return { chunk, score };
  });

  // Sort by score and return top chunks
  const relevantChunks = scoredChunks
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(({ chunk }) => chunk);

  console.log(`[RAG] Found ${relevantChunks.length} relevant chunks`);
  return relevantChunks;
}

// Semantic search delegated to offscreen document via offscreenService.ts
// Offscreen document has DOM access needed for Transformers.js

/**
 * Get relevant chunks using semantic search (EmbeddingGemma)
 * This function now just falls back to keyword search when called from background
 *
 * @param paperId - Paper ID
 * @param query - Search query
 * @param limit - Maximum number of chunks to return
 * @returns Array of relevant chunks sorted by similarity
 */
export async function getRelevantChunksSemantic(
  paperId: string,
  query: string,
  limit: number = 5
): Promise<ContentChunk[]> {
  console.log('[dbService] Semantic search requested for:', query);

  try {
    // Check if chunks have embeddings
    const chunks = await getPaperChunks(paperId);
    const hasEmbeddings = chunks.some(chunk => chunk.embedding !== undefined);

    if (!hasEmbeddings) {
      console.log('[dbService] No embeddings available, falling back to keyword search');
      return await getRelevantChunks(paperId, query, limit);
    }

    // Delegate to offscreen document for semantic search calculation
    const { searchSemanticOffscreen } = await import('../background/services/offscreenService.ts');
    const result = await searchSemanticOffscreen(paperId, query, limit);

    if (result.success && result.chunkIds && result.chunkIds.length > 0) {
      // Fetch the chunks in the ranked order
      const rankedChunks = result.chunkIds
        .map(chunkId => chunks.find(c => c.id === chunkId))
        .filter(c => c !== undefined) as ContentChunk[];

      console.log('[dbService] ✓ Semantic search found', rankedChunks.length, 'chunks');
      return rankedChunks;
    } else {
      console.log('[dbService] Semantic search failed, falling back to keyword search');
      return await getRelevantChunks(paperId, query, limit);
    }
  } catch (error) {
    console.error('[dbService] Error in semantic search, falling back to keyword search:', error);
    return await getRelevantChunks(paperId, query, limit);
  }
}

/**
 * Get relevant chunks using semantic search for multiple topic keywords
 * DEPRECATED: Use semanticSearchService from content script instead
 * This function now just falls back to keyword search when called from background
 * Enhanced version for analysis operations (methodology, limitations, etc.)
 * Falls back to keyword search if embeddings are not available
 *
 * @param paperId - Paper ID
 * @param topics - Array of topic keywords
 * @param limit - Maximum number of chunks to return
 * @returns Array of relevant chunks sorted by similarity
 */
export async function getRelevantChunksByTopicSemantic(
  paperId: string,
  topics: string[],
  limit: number = 3
): Promise<ContentChunk[]> {
  // This function is deprecated in background worker context
  // Use content/services/semanticSearchService.ts from content script instead
  console.log('[dbService] Semantic search by topic called from background, using keyword fallback');
  return await getRelevantChunksByTopic(paperId, topics, limit);
}

// Note: Embedding generation and semantic search delegated to offscreen document
// (background/services/offscreenService.ts) which has DOM access for Transformers.js

/**
 * Check if a paper is already stored
 */
export async function isPaperStored(url: string): Promise<boolean> {
  const paper = await getPaperByUrl(url);
  return paper !== null;
}

/**
 * Get storage statistics
 */
export async function getStorageStats(): Promise<{
  paperCount: number;
  totalChunks: number;
  oldestPaper: number;
  newestPaper: number;
}> {
  const papers = await getAllPapers();

  if (papers.length === 0) {
    return {
      paperCount: 0,
      totalChunks: 0,
      oldestPaper: 0,
      newestPaper: 0,
    };
  }

  const totalChunks = papers.reduce((sum, paper) => sum + paper.chunkCount, 0);
  const storedTimes = papers.map(p => p.storedAt);

  return {
    paperCount: papers.length,
    totalChunks,
    oldestPaper: Math.min(...storedTimes),
    newestPaper: Math.max(...storedTimes),
  };
}
