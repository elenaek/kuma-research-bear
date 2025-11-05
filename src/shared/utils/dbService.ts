import { ResearchPaper, StoredPaper, ContentChunk, ImageExplanation, ChatMessage, ConversationState } from '../types/index.ts';
import { logger } from './logger.ts';

/**
 * Database Service - Facade Pattern
 *
 * This file acts as a thin facade over the repository layer, providing
 * backward compatibility for existing code while delegating all operations
 * to the appropriate repositories.
 *
 * Repository Classes (in src/core/repositories/):
 * - PaperRepository: Paper CRUD operations
 * - ChunkRepository: Chunk operations
 * - ImageRepository: Image explanations, chats, captures
 * - CitationRepository: Citations
 *
 * New code should use repositories directly:
 * `import { getPaperRepository, getChunkRepository, getImageRepository, getCitationRepository } from '../../core/repositories/index.ts';`
 */

// Import repositories
import {
  getPaperRepository,
  getChunkRepository,
  getImageRepository,
  getCitationRepository,
  CHUNKS_STORE,
} from '../../core/repositories/index.ts';

// Re-export constants for backward compatibility
export {
  DB_NAME,
  DB_VERSION,
  PAPERS_STORE,
  CHUNKS_STORE,
  IMAGE_EXPLANATIONS_STORE,
  IMAGE_CHATS_STORE,
  CITATIONS_STORE,
  CITATIONS_SETTINGS_STORE,
  SCREEN_CAPTURES_STORE,
} from '../../core/repositories/index.ts';

// Re-export types for backward compatibility
export type { ImageChatEntry, ScreenCaptureEntry } from '../../core/repositories/index.ts';

/**
 * =============================================================================
 * DATABASE INITIALIZATION
 * =============================================================================
 */

/**
 * Initialize IndexedDB
 * @deprecated Use DatabaseConnection.getInstance().openDatabase() instead
 */
export async function initDB(): Promise<IDBDatabase> {
  const { DatabaseConnection } = await import('../../core/repositories/DatabaseConnection.ts');
  return DatabaseConnection.getInstance().openDatabase();
}

/**
 * =============================================================================
 * PAPER OPERATIONS
 * =============================================================================
 */

/**
 * Generate unique paper ID from URL
 */
export function generatePaperId(url: string): string {
  return getPaperRepository().generatePaperId(url);
}

/**
 * Store a new research paper with its content chunks
 */
export async function storePaper(
  paper: ResearchPaper,
  fullText?: string,
  qaHistory?: any[],
  onChunkProgress?: (current: number, total: number) => void,
  preChunkedData?: {
    chunks: ContentChunk[];
    metadata?: { averageChunkSize?: number };
  }
): Promise<StoredPaper> {
  logger.debug('DATABASE', '[IndexedDB] storePaper called:', {
    title: paper.title,
    url: paper.url,
    source: paper.source,
    hasPreChunkedData: !!preChunkedData,
  });

  const db = await initDB();
  const { normalizeUrl } = await import('./urlUtils.ts');
  const { getOutputLanguage } = await import('./settingsService.ts');

  try {
    const paperId = generatePaperId(paper.url);
    logger.debug('DATABASE', '[IndexedDB] Generated paper ID:', paperId, 'for URL:', paper.url);

    // LEVEL 3 DEDUPLICATION: Check if paper already exists (transaction-level check)
    // This prevents race conditions when multiple tabs try to store the same paper
    const existingPaper = await getPaperById(paperId);
    if (existingPaper) {
      logger.debug('DATABASE', '[IndexedDB] ⏭ Paper already stored, skipping duplicate storage:', paperId);
      return existingPaper;
    }

    let extractedText: string;
    let contentChunks: ContentChunk[];

    // If pre-chunked data provided, use it directly
    if (preChunkedData && preChunkedData.chunks && preChunkedData.chunks.length > 0) {
      logger.debug('DATABASE', '[IndexedDB] Using pre-chunked data from research paper extraction');
      contentChunks = preChunkedData.chunks;

      // Reconstruct full text from chunks for hierarchical summary
      extractedText = contentChunks.map(c => c.content).join('\n\n');

      logger.debug('DATABASE', `[IndexedDB] Pre-chunked: ${contentChunks.length} chunks, avgSize: ${preChunkedData.metadata?.averageChunkSize || 'unknown'} chars`);
    } else {
      logger.debug('DATABASE', '[IndexedDB] No pre-chunked data, falling back to simple chunking');

      // Extract full text if not provided (only works in content script context)
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
      contentChunks = extractorChunks.map((chunk, index) => ({
        id: `chunk_${paperId}_${index}`,
        paperId,
        content: chunk.content,
        index,
        section: chunk.heading,
        startChar: chunk.startIndex,
        endChar: chunk.endIndex,
        tokenCount: Math.ceil(chunk.content.length / 4),
      }));

      logger.debug('DATABASE', `[IndexedDB] Simple chunking: ${contentChunks.length} chunks created`);
    }

    // Get user's preferred output language from settings
    const outputLanguage = await getOutputLanguage();

    // Create stored paper object (hierarchical summary will be added after chunk storage)
    const storedPaper: StoredPaper = {
      ...paper,
      url: normalizeUrl(paper.url), // Ensure URL is normalized before storage
      id: paperId,
      fullText: extractedText,
      chunkCount: contentChunks.length,
      storedAt: Date.now(),
      lastAccessedAt: Date.now(),
      hierarchicalSummary: undefined,  // Will be generated after chunks are stored
      qaHistory: qaHistory || [],
      metadata: {
        ...paper.metadata,  // Preserve existing metadata (e.g., originalLanguage from detection)
        outputLanguage: outputLanguage,  // Add user's preferred output language
        ...(preChunkedData?.metadata ? {
          averageChunkSize: preChunkedData.metadata.averageChunkSize,
        } : {}),
      },
    };

    // Store paper using repository
    await getPaperRepository().save(storedPaper);

    // Store chunks using repository in batches
    const BATCH_SIZE = 20;
    for (let batchStart = 0; batchStart < contentChunks.length; batchStart += BATCH_SIZE) {
      const batchEnd = Math.min(batchStart + BATCH_SIZE, contentChunks.length);
      const batch = contentChunks.slice(batchStart, batchEnd);

      await getChunkRepository().saveAll(batch);

      // Yield to event loop between batches to prevent UI freezing
      if (batchEnd < contentChunks.length) {
        await new Promise(resolve => setTimeout(resolve, 0));
      }

      // Report progress
      if (onChunkProgress) {
        onChunkProgress(batchEnd, contentChunks.length);
      }
    }

    logger.debug('DATABASE', `✓ Stored paper: ${paper.title} (${contentChunks.length} chunks)`);

    return storedPaper;
  } catch (error) {
    logger.error('DATABASE', 'Error storing paper:', error);
    throw error;
  }
}

/**
 * Get paper by URL
 */
export async function getPaperByUrl(url: string): Promise<StoredPaper | null> {
  return getPaperRepository().getByUrl(url);
}

/**
 * Get paper by ID
 */
export async function getPaperById(id: string): Promise<StoredPaper | null> {
  return getPaperRepository().getById(id);
}

/**
 * Get all papers
 */
export async function getAllPapers(): Promise<StoredPaper[]> {
  return getPaperRepository().getAll();
}

/**
 * Delete paper and all related data
 */
export async function deletePaper(paperId: string): Promise<boolean> {
  try {
    await getPaperRepository().delete(paperId);
    return true;
  } catch (error) {
    logger.error('DATABASE', 'Error deleting paper:', error);
    return false;
  }
}

/**
 * Update paper with partial data
 */
export async function updatePaper(paperId: string, updates: Partial<StoredPaper>): Promise<boolean> {
  return getPaperRepository().update(paperId, updates);
}

/**
 * Update paper Q&A history
 */
export async function updatePaperQAHistory(paperId: string, qaHistory: any[]): Promise<boolean> {
  return getPaperRepository().updateQAHistory(paperId, qaHistory);
}

/**
 * Update paper explanation
 */
export async function updatePaperExplanation(
  paperId: string,
  explanation: string,
  outputLanguage?: string
): Promise<boolean> {
  return getPaperRepository().updateExplanation(paperId, explanation, outputLanguage);
}

/**
 * Update paper analysis
 */
export async function updatePaperAnalysis(paperId: string, analysis: any, outputLanguage?: string): Promise<boolean> {
  return getPaperRepository().updateAnalysis(paperId, analysis, outputLanguage);
}

/**
 * Update partial paper analysis (single section)
 */
export async function updatePartialPaperAnalysis(
  paperId: string,
  sectionKey: string,
  sectionValue: any,
  outputLanguage?: string
): Promise<boolean> {
  return getPaperRepository().updatePartialAnalysis(paperId, sectionKey, sectionValue, outputLanguage);
}

/**
 * Update paper glossary
 */
export async function updatePaperGlossary(paperId: string, glossary: any, outputLanguage?: string): Promise<boolean> {
  return getPaperRepository().updateGlossary(paperId, glossary, outputLanguage);
}

/**
 * Update partial paper glossary (add new terms)
 */
export async function updatePartialPaperGlossary(
  paperId: string,
  newTerms: any[]
): Promise<boolean> {
  return getPaperRepository().updatePartialGlossary(paperId, newTerms);
}

/**
 * Search papers by title, author, or abstract
 */
export async function searchPapers(query: string): Promise<StoredPaper[]> {
  return getPaperRepository().searchPapers(query);
}

/**
 * Check if paper is stored
 */
export async function isPaperStored(url: string): Promise<boolean> {
  return getPaperRepository().isPaperStored(url);
}

/**
 * Get storage statistics
 */
export async function getStorageStats(): Promise<{
  totalPapers: number;
  totalChunks: number;
  totalSize: number;
}> {
  return getPaperRepository().getStorageStats();
}

/**
 * =============================================================================
 * CHUNK OPERATIONS
 * =============================================================================
 */

/**
 * Escape special regex characters in a string
 * Prevents regex injection when creating RegExp from user input
 */
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Get all chunks for a paper
 */
export async function getPaperChunks(paperId: string): Promise<ContentChunk[]> {
  return getChunkRepository().findByPaperId(paperId);
}

/**
 * Update chunk embeddings
 */
export async function updateChunkEmbeddings(paperId: string, embeddings: Float32Array[]): Promise<void> {
  return getChunkRepository().updateEmbeddings(paperId, embeddings);
}

/**
 * Update chunk terms (for keyword search)
 */
export async function updateChunkTerms(
  paperId: string,
  chunkTerms: Array<{ chunkId: string; terms: string[] }>
): Promise<void> {
  const db = await initDB();

  try {
    logger.debug('DATABASE', `Updating terms for ${chunkTerms.length} chunks for paper: ${paperId}`);

    // Update chunks in batches to prevent UI blocking
    const BATCH_SIZE = 20;

    for (let batchStart = 0; batchStart < chunkTerms.length; batchStart += BATCH_SIZE) {
      const batchEnd = Math.min(batchStart + BATCH_SIZE, chunkTerms.length);

      // Create transaction for this batch
      const transaction = db.transaction([CHUNKS_STORE], 'readwrite');
      const store = transaction.objectStore(CHUNKS_STORE);

      // Update chunks in this batch
      for (let i = batchStart; i < batchEnd; i++) {
        const { chunkId, terms } = chunkTerms[i];

        // Get the chunk, update terms, and save
        const chunk = await new Promise<ContentChunk | null>((resolve) => {
          const request = store.get(chunkId);
          request.onsuccess = () => resolve(request.result || null);
          request.onerror = () => resolve(null);
        });

        if (chunk) {
          chunk.terms = terms;

          await new Promise<void>((resolve, reject) => {
            const request = store.put(chunk);
            request.onsuccess = () => resolve();
            request.onerror = () => reject(new Error('Failed to update chunk terms'));
          });
        }
      }

      // Yield to event loop between batches
      if (batchEnd < chunkTerms.length) {
        await new Promise(resolve => setTimeout(resolve, 0));
      }
    }

    logger.debug('DATABASE', `✓ Updated terms for ${chunkTerms.length} chunks`);
  } catch (error) {
    logger.error('DATABASE', 'Error updating chunk terms:', error);
    throw error;
  }
}

/**
 * Get relevant chunks using BM25 keyword search
 * Routes through offscreen service for proper BM25 scoring
 */
export async function getRelevantChunks(
  paperId: string,
  query: string,
  limit: number = 5
): Promise<ContentChunk[]> {
  try {
    const chunks = await getPaperChunks(paperId);

    if (chunks.length === 0) {
      return [];
    }

    // Use hybrid search (BM25 + semantic if embeddings available, otherwise BM25-only)
    const { DEFAULT_HYBRID_CONFIG } = await import('../types/embedding.ts');
    const { searchHybridOffscreen } = await import('../../background/services/offscreenService.ts');

    const result = await searchHybridOffscreen(
      paperId,
      query,
      limit,
      DEFAULT_HYBRID_CONFIG.alpha
    );

    if (result.success && result.chunkIds && result.chunkIds.length > 0) {
      // Fetch the chunks in the ranked order
      const rankedChunks = result.chunkIds
        .map(chunkId => chunks.find(c => c.id === chunkId))
        .filter(c => c !== undefined) as ContentChunk[];

      logger.debug('DATABASE', '[getRelevantChunks] ✓ BM25 search found', rankedChunks.length, 'chunks');
      return rankedChunks;
    }

    logger.debug('DATABASE', '[getRelevantChunks] No results from BM25 search');
    return [];
  } catch (error) {
    logger.error('DATABASE', '[getRelevantChunks] Error in BM25 search:', error);
    return [];
  }
}

/**
 * Get relevant chunks by topic using BM25 keyword search
 * Routes through offscreen service for proper BM25 scoring
 */
export async function getRelevantChunksByTopic(
  paperId: string,
  topics: string[],
  limit: number = 3
): Promise<ContentChunk[]> {
  try {
    const chunks = await getPaperChunks(paperId);

    if (chunks.length === 0) {
      return [];
    }

    logger.debug('RAG', `[RAG] BM25 search for ${chunks.length} chunks with topics:`, topics);

    // Combine topics into a single query for BM25
    const query = topics.join(' ');

    // Use hybrid search (BM25 + semantic if embeddings available, otherwise BM25-only)
    const { DEFAULT_HYBRID_CONFIG } = await import('../types/embedding.ts');
    const { searchHybridOffscreen } = await import('../../background/services/offscreenService.ts');

    const result = await searchHybridOffscreen(
      paperId,
      query,
      limit,
      DEFAULT_HYBRID_CONFIG.alpha
    );

    if (result.success && result.chunkIds && result.chunkIds.length > 0) {
      // Fetch the chunks in the ranked order
      const rankedChunks = result.chunkIds
        .map(chunkId => chunks.find(c => c.id === chunkId))
        .filter(c => c !== undefined) as ContentChunk[];

      logger.debug('RAG', `[RAG] ✓ BM25 search found ${rankedChunks.length} relevant chunks`);
      return rankedChunks;
    }

    logger.debug('RAG', '[RAG] No results from BM25 search');
    return [];
  } catch (error) {
    logger.error('RAG', '[RAG] Error in BM25 topic search:', error);
    return [];
  }
}

/**
 * Get relevant chunks using semantic search (embeddings)
 * Now uses hybrid search (semantic + keyword) by default for better coverage
 * Falls back to keyword-only search when embeddings are unavailable
 */
export async function getRelevantChunksSemantic(
  paperId: string,
  query: string,
  limit: number = 5
): Promise<ContentChunk[]> {
  logger.debug('DATABASE', '[dbService] Search requested for:', query);

  try {
    // Check if chunks have embeddings
    const chunks = await getPaperChunks(paperId);
    const hasEmbeddings = chunks.some(chunk => chunk.embedding !== undefined);

    if (!hasEmbeddings) {
      logger.debug('DATABASE', '[dbService] No embeddings available, falling back to keyword search');
      return await getRelevantChunks(paperId, query, limit);
    }

    // Import hybrid search config
    const { DEFAULT_HYBRID_CONFIG } = await import('../types/embedding.ts');

    // Delegate to offscreen document for search calculation
    // Use hybrid search (semantic + keyword) by default for better coverage
    if (DEFAULT_HYBRID_CONFIG.enabled) {
      const { searchHybridOffscreen } = await import('../../background/services/offscreenService.ts');
      const result = await searchHybridOffscreen(paperId, query, limit, DEFAULT_HYBRID_CONFIG.alpha);

      if (result.success && result.chunkIds && result.chunkIds.length > 0) {
        // Fetch the chunks in the ranked order
        const rankedChunks = result.chunkIds
          .map(chunkId => chunks.find(c => c.id === chunkId))
          .filter(c => c !== undefined) as ContentChunk[];

        logger.debug('DATABASE', '[dbService] ✓ Hybrid search found', rankedChunks.length, 'chunks');
        return rankedChunks;
      } else {
        logger.debug('DATABASE', '[dbService] Hybrid search failed, falling back to keyword search');
        return await getRelevantChunks(paperId, query, limit);
      }
    } else {
      // Hybrid disabled, use pure semantic search
      const { searchSemanticOffscreen } = await import('../../background/services/offscreenService.ts');
      const result = await searchSemanticOffscreen(paperId, query, limit);

      if (result.success && result.chunkIds && result.chunkIds.length > 0) {
        // Fetch the chunks in the ranked order
        const rankedChunks = result.chunkIds
          .map(chunkId => chunks.find(c => c.id === chunkId))
          .filter(c => c !== undefined) as ContentChunk[];

        logger.debug('DATABASE', '[dbService] ✓ Semantic search found', rankedChunks.length, 'chunks');
        return rankedChunks;
      } else {
        logger.debug('DATABASE', '[dbService] Semantic search failed, falling back to keyword search');
        return await getRelevantChunks(paperId, query, limit);
      }
    }
  } catch (error) {
    logger.error('DATABASE', '[dbService] Error in search, falling back to keyword search:', error);
    return await getRelevantChunks(paperId, query, limit);
  }
}

/**
 * Get relevant chunks by topic using semantic search
 */
export async function getRelevantChunksByTopicSemantic(
  paperId: string,
  topics: string[],
  limit: number = 3
): Promise<ContentChunk[]> {
  // This function is deprecated in background worker context
  // Use content/services/semanticSearchService.ts from content script instead
  logger.debug('DATABASE', '[dbService] Semantic search by topic called from background, using keyword fallback');
  return await getRelevantChunksByTopic(paperId, topics, limit);
}

/**
 * =============================================================================
 * IMAGE EXPLANATION OPERATIONS
 * =============================================================================
 */

// Helper function to generate image explanation ID
function generateImageExplanationId(paperId: string, imageUrl: string): string {
  let hash = 0;
  const combined = `${paperId}_${imageUrl}`;
  for (let i = 0; i < combined.length; i++) {
    const char = combined.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return `img_${Math.abs(hash)}`;
}

/**
 * Store an image explanation
 */
export async function storeImageExplanation(
  paperId: string,
  imageUrl: string,
  title: string,
  explanation: string,
  imageHash?: string
): Promise<ImageExplanation> {
  try {
    const id = generateImageExplanationId(paperId, imageUrl);

    const imageExplanation: ImageExplanation = {
      id,
      paperId,
      imageUrl,
      imageHash,
      title,
      explanation,
      timestamp: Date.now(),
    };

    await getImageRepository().saveExplanation(imageExplanation);
    logger.debug('DATABASE', '✓ Stored image explanation for:', imageUrl);
    return imageExplanation;
  } catch (error) {
    logger.error('DATABASE', 'Error storing image explanation:', error);
    throw error;
  }
}

/**
 * Get an image explanation
 */
export async function getImageExplanation(
  paperId: string,
  imageUrl: string
): Promise<ImageExplanation | null> {
  try {
    return await getImageRepository().findExplanationByImageUrl(paperId, imageUrl);
  } catch (error) {
    logger.error('DATABASE', 'Error getting image explanation:', error);
    return null;
  }
}

/**
 * Get all image explanations for a paper
 */
export async function getImageExplanationsByPaper(paperId: string): Promise<ImageExplanation[]> {
  try {
    return await getImageRepository().findExplanationsByPaperId(paperId);
  } catch (error) {
    logger.error('DATABASE', 'Error getting image explanations for paper:', error);
    return [];
  }
}

/**
 * Delete an image explanation
 */
export async function deleteImageExplanation(
  paperId: string,
  imageUrl: string
): Promise<void> {
  try {
    const id = generateImageExplanationId(paperId, imageUrl);
    await getImageRepository().delete(id);
    logger.debug('DATABASE', '✓ Deleted image explanation for:', imageUrl);
  } catch (error) {
    logger.error('DATABASE', 'Error deleting image explanation:', error);
    throw error;
  }
}

/**
 * Delete all image explanations for a paper
 */
export async function deleteImageExplanationsByPaper(paperId: string): Promise<number> {
  return getImageRepository().deleteExplanationsByPaperId(paperId);
}

/**
 * =============================================================================
 * IMAGE CHAT OPERATIONS
 * =============================================================================
 */

// Helper function to generate image chat ID
function generateImageChatId(paperId: string, imageUrl: string): string {
  let hash = 0;
  for (let i = 0; i < imageUrl.length; i++) {
    const char = imageUrl.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return `${paperId}-img_${Math.abs(hash)}`;
}

/**
 * Get image chat
 */
export async function getImageChat(
  paperId: string,
  imageUrl: string
): Promise<{ chatHistory: ChatMessage[]; conversationState: ConversationState } | null> {
  try {
    const id = generateImageChatId(paperId, imageUrl);
    const chat = await getImageRepository().getChatById(id);

    if (!chat) {
      return null;
    }

    return {
      chatHistory: chat.chatHistory || [],
      conversationState: chat.conversationState || {
        summary: null,
        recentMessages: [],
        lastSummarizedIndex: -1,
        summaryCount: 0,
      },
    };
  } catch (error) {
    logger.error('DATABASE', 'Error getting image chat:', error);
    return null;
  }
}

/**
 * Update image chat
 */
export async function updateImageChat(
  paperId: string,
  imageUrl: string,
  updates: {
    chatHistory?: ChatMessage[];
    conversationState?: ConversationState;
  }
): Promise<void> {
  try {
    const id = generateImageChatId(paperId, imageUrl);

    // Get existing chat or create new entry
    let chat = await getImageRepository().getChatById(id);

    if (!chat) {
      chat = {
        id,
        paperId,
        imageUrl,
        chatHistory: [],
        conversationState: {
          summary: null,
          recentMessages: [],
          lastSummarizedIndex: -1,
          summaryCount: 0,
        },
        lastUpdated: Date.now(),
      };
    }

    // Apply updates
    if (updates.chatHistory !== undefined) {
      chat.chatHistory = updates.chatHistory;
    }
    if (updates.conversationState !== undefined) {
      chat.conversationState = updates.conversationState;
    }
    chat.lastUpdated = Date.now();

    await getImageRepository().saveChat(chat);
    logger.debug('DATABASE', '✓ Updated image chat for:', imageUrl);
  } catch (error) {
    logger.error('DATABASE', 'Error updating image chat:', error);
    throw error;
  }
}

/**
 * Delete image chat
 */
export async function deleteImageChat(
  paperId: string,
  imageUrl: string
): Promise<void> {
  try {
    const id = generateImageChatId(paperId, imageUrl);
    await getImageRepository().deleteChatById(id);
    logger.debug('DATABASE', '✓ Deleted image chat for:', imageUrl);
  } catch (error) {
    logger.error('DATABASE', 'Error deleting image chat:', error);
    throw error;
  }
}

/**
 * Get all image chats for a paper
 */
export async function getAllImageChatsForPaper(paperId: string): Promise<any[]> {
  try {
    return await getImageRepository().findChatsByPaperId(paperId);
  } catch (error) {
    logger.error('DATABASE', 'Error getting image chats for paper:', error);
    return [];
  }
}

/**
 * Delete all image chats for a paper
 */
export async function deleteImageChatsByPaper(paperId: string): Promise<number> {
  return getImageRepository().deleteChatsByPaperId(paperId);
}

/**
 * =============================================================================
 * SCREEN CAPTURE OPERATIONS
 * =============================================================================
 */

// Helper function to generate screen capture ID
function generateScreenCaptureId(paperId: string, imageUrl: string): string {
  return `${paperId}-${imageUrl}`;
}

/**
 * Store a screen capture
 */
export async function storeScreenCapture(
  paperId: string,
  imageUrl: string,
  blob: Blob,
  overlayPosition?: {
    pageX: number;
    pageY: number;
    width: number;
    height: number;
  }
): Promise<void> {
  try {
    const id = generateScreenCaptureId(paperId, imageUrl);

    const entry = {
      id,
      paperId,
      imageUrl,
      blob,
      timestamp: Date.now(),
      overlayPosition,
    };

    await getImageRepository().saveCapture(entry);
    logger.debug('DATABASE', '✓ Stored screen capture:', imageUrl);
  } catch (error) {
    logger.error('DATABASE', 'Error storing screen capture:', error);
    throw error;
  }
}

/**
 * Get a screen capture
 */
export async function getScreenCapture(
  paperId: string,
  imageUrl: string
): Promise<{ blob: Blob; overlayPosition?: any } | null> {
  try {
    const capture = await getImageRepository().getCaptureByImageUrl(paperId, imageUrl);

    if (!capture) {
      return null;
    }

    return {
      blob: capture.blob,
      overlayPosition: capture.overlayPosition,
    };
  } catch (error) {
    logger.error('DATABASE', 'Error getting screen capture:', error);
    return null;
  }
}

/**
 * Delete a screen capture
 */
export async function deleteScreenCapture(
  paperId: string,
  imageUrl: string
): Promise<void> {
  try {
    const id = generateScreenCaptureId(paperId, imageUrl);
    await getImageRepository().deleteCaptureById(id);
    logger.debug('DATABASE', '✓ Deleted screen capture:', imageUrl);
  } catch (error) {
    logger.error('DATABASE', 'Error deleting screen capture:', error);
    throw error;
  }
}

/**
 * Delete all screen captures for a paper
 */
export async function deleteScreenCapturesByPaper(paperId: string): Promise<number> {
  return getImageRepository().deleteCapturesByPaperId(paperId);
}
