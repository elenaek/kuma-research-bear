import { BaseRepository } from './base/BaseRepository.ts';
import { ContentChunk } from '../../shared/types/index.ts';
import { CHUNKS_STORE } from './DatabaseConnection.ts';
import { requestAsPromise } from './DatabaseConnection.ts';
import { logger } from '../../shared/utils/logger.ts';

/**
 * ChunkRepository - Data access layer for content chunks
 *
 * Handles:
 * - Chunk CRUD operations
 * - Chunk queries by paper
 * - Embedding updates
 * - Bulk operations
 */
export class ChunkRepository extends BaseRepository<ContentChunk> {
  protected readonly storeName = CHUNKS_STORE;

  /**
   * Get all chunks for a paper (sorted by index)
   */
  async findByPaperId(paperId: string): Promise<ContentChunk[]> {
    try {
      const chunks = await this.findByIndex('paperId', paperId);
      // Sort by index
      return chunks.sort((a, b) => a.index - b.index);
    } catch (error) {
      logger.error('CHUNK_REPO', 'Error getting chunks for paper:', error);
      return [];
    }
  }

  /**
   * Save multiple chunks (batch operation)
   * Optimized for initial paper chunking
   */
  async saveChunks(chunks: ContentChunk[], onProgress?: (current: number, total: number) => void): Promise<void> {
    if (chunks.length === 0) return;

    try {
      logger.debug('CHUNK_REPO', `Saving ${chunks.length} chunks...`);

      // Use batch save from base repository
      await this.saveAll(chunks);

      // Report progress if callback provided
      if (onProgress) {
        onProgress(chunks.length, chunks.length);
      }

      logger.debug('CHUNK_REPO', `✓ Saved ${chunks.length} chunks`);
    } catch (error) {
      logger.error('CHUNK_REPO', 'Error saving chunks:', error);
      throw error;
    }
  }

  /**
   * Update embeddings for chunks
   */
  async updateEmbeddings(paperId: string, embeddings: Float32Array[]): Promise<void> {
    try {
      const chunks = await this.findByPaperId(paperId);

      if (chunks.length !== embeddings.length) {
        throw new Error(`Embedding count (${embeddings.length}) does not match chunk count (${chunks.length})`);
      }

      // Update each chunk with its embedding
      await this.connection.transaction(
        this.storeName,
        'readwrite',
        async (store) => {
          for (let i = 0; i < chunks.length; i++) {
            const chunk = chunks[i];
            chunk.embedding = Array.from(embeddings[i]); // Convert Float32Array to regular array

            const request = (store as IDBObjectStore).put(chunk);
            await requestAsPromise(request);
          }
        }
      );

      logger.debug('CHUNK_REPO', `✓ Updated embeddings for ${chunks.length} chunks`);
    } catch (error) {
      logger.error('CHUNK_REPO', 'Error updating embeddings:', error);
      throw error;
    }
  }

  /**
   * Get chunks with embeddings (for RAG queries)
   */
  async findByPaperIdWithEmbeddings(paperId: string): Promise<ContentChunk[]> {
    try {
      const chunks = await this.findByPaperId(paperId);
      // Filter to only chunks that have embeddings
      return chunks.filter(chunk => chunk.embedding && chunk.embedding.length > 0);
    } catch (error) {
      logger.error('CHUNK_REPO', 'Error getting chunks with embeddings:', error);
      return [];
    }
  }

  /**
   * Delete all chunks for a paper
   */
  async deleteByPaperId(paperId: string): Promise<number> {
    try {
      const chunks = await this.findByPaperId(paperId);
      const chunkIds = chunks.map(chunk => chunk.id);

      if (chunkIds.length > 0) {
        await this.deleteAll(chunkIds);
      }

      logger.debug('CHUNK_REPO', `Deleted ${chunkIds.length} chunks for paper ${paperId}`);
      return chunkIds.length;
    } catch (error) {
      logger.error('CHUNK_REPO', 'Error deleting chunks by paper ID:', error);
      return 0;
    }
  }

  /**
   * Count chunks for a paper
   */
  async countByPaperId(paperId: string): Promise<number> {
    try {
      const chunks = await this.findByPaperId(paperId);
      return chunks.length;
    } catch (error) {
      logger.error('CHUNK_REPO', 'Error counting chunks for paper:', error);
      return 0;
    }
  }

  /**
   * Get chunk statistics for a paper
   */
  async getChunkStats(paperId: string): Promise<{
    total: number;
    withEmbeddings: number;
    averageLength: number;
  }> {
    try {
      const chunks = await this.findByPaperId(paperId);

      const total = chunks.length;
      const withEmbeddings = chunks.filter(c => c.embedding && c.embedding.length > 0).length;
      const averageLength = chunks.length > 0
        ? chunks.reduce((sum, c) => sum + c.content.length, 0) / chunks.length
        : 0;

      return {
        total,
        withEmbeddings,
        averageLength: Math.round(averageLength),
      };
    } catch (error) {
      logger.error('CHUNK_REPO', 'Error getting chunk stats:', error);
      return { total: 0, withEmbeddings: 0, averageLength: 0 };
    }
  }

  /**
   * Search chunks by content (simple text search)
   */
  async searchByContent(paperId: string, query: string): Promise<ContentChunk[]> {
    try {
      const chunks = await this.findByPaperId(paperId);
      const queryLower = query.toLowerCase();

      return chunks.filter(chunk =>
        chunk.content.toLowerCase().includes(queryLower)
      );
    } catch (error) {
      logger.error('CHUNK_REPO', 'Error searching chunks by content:', error);
      return [];
    }
  }

  /**
   * Get chunks by section (for hierarchical navigation)
   */
  async findBySection(paperId: string, sectionTitle: string): Promise<ContentChunk[]> {
    try {
      const chunks = await this.findByPaperId(paperId);

      return chunks.filter(chunk => {
        // Check if chunk belongs to this section
        if (chunk.sectionTitle === sectionTitle) return true;

        // Check parent sections for hierarchical match
        if (chunk.parentSectionTitle === sectionTitle) return true;

        return false;
      }).sort((a, b) => a.index - b.index);
    } catch (error) {
      logger.error('CHUNK_REPO', 'Error finding chunks by section:', error);
      return [];
    }
  }
}
