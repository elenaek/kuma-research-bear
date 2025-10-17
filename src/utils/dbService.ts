import { ResearchPaper, StoredPaper, ContentChunk } from '../types/index.ts';
import { chunkContent, extractPageText } from './contentExtractor.ts';

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
export async function storePaper(paper: ResearchPaper, fullText?: string): Promise<StoredPaper> {
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
      extractedText = extractPageText().text;
    } else {
      // We're in a background script context without fullText provided
      throw new Error('fullText must be provided when storing paper from background script context');
    }

    // Create chunks with metadata using contentExtractor
    const extractorChunks = chunkContent(extractedText, 1000, 200);

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

    // Create stored paper object
    const storedPaper: StoredPaper = {
      ...paper,
      id: paperId,
      fullText: extractedText,
      chunkCount: contentChunks.length,
      storedAt: Date.now(),
      lastAccessedAt: Date.now(),
    };

    // Store paper
    const paperTransaction = db.transaction([PAPERS_STORE], 'readwrite');
    const paperStore = paperTransaction.objectStore(PAPERS_STORE);
    await new Promise<void>((resolve, reject) => {
      const request = paperStore.put(storedPaper);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(new Error('Failed to store paper'));
    });

    // Store chunks
    const chunkTransaction = db.transaction([CHUNKS_STORE], 'readwrite');
    const chunkStore = chunkTransaction.objectStore(CHUNKS_STORE);

    for (const chunk of contentChunks) {
      await new Promise<void>((resolve, reject) => {
        const request = chunkStore.put(chunk);
        request.onsuccess = () => resolve();
        request.onerror = () => reject(new Error('Failed to store chunk'));
      });
    }

    console.log(`✓ Stored paper: ${paper.title} (${contentChunks.length} chunks)`);

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
      const matches = (content.match(new RegExp(word, 'g')) || []).length;
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
