import { BaseRepository } from './base/BaseRepository.ts';
import { StoredPaper, ContentChunk } from '../../shared/types/index.ts';
import { PAPERS_STORE, CHUNKS_STORE } from './DatabaseConnection.ts';
import { requestAsPromise, cursorIterate } from './DatabaseConnection.ts';
import { logger } from '../../shared/utils/logger.ts';
import { normalizeUrl } from '../../shared/utils/urlUtils.ts';

/**
 * PaperRepository - Data access layer for research papers
 *
 * Handles:
 * - Paper CRUD operations
 * - Paper search and queries
 * - Explanation, analysis, glossary, Q&A updates
 * - Cascade deletion of related data
 */
export class PaperRepository extends BaseRepository<StoredPaper> {
  protected readonly storeName = PAPERS_STORE;

  /**
   * Generate unique paper ID from URL
   */
  generatePaperId(url: string): string {
    // Normalize URL before hashing to ensure consistent IDs
    const normalizedUrl = normalizeUrl(url);

    // Simple hash function for URL
    let hash = 0;
    for (let i = 0; i < normalizedUrl.length; i++) {
      const char = normalizedUrl.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return `paper_${Math.abs(hash)}`;
  }

  /**
   * Get paper by ID (overridden to update lastAccessedAt)
   */
  async getById(id: string): Promise<StoredPaper | null> {
    try {
      const paper = await super.getById(id);

      // Update last accessed timestamp
      if (paper) {
        paper.lastAccessedAt = Date.now();
        await this.connection.transaction(
          this.storeName,
          'readwrite',
          async (store) => {
            const request = (store as IDBObjectStore).put(paper);
            await requestAsPromise(request);
          }
        );
      }

      return paper;
    } catch (error) {
      logger.error('PAPER_REPO', 'Error getting paper by ID:', error);
      return null;
    }
  }

  /**
   * Get all papers (sorted by most recently stored)
   */
  async getAll(): Promise<StoredPaper[]> {
    try {
      const papers = await super.getAll();
      // Sort by most recently stored
      return papers.sort((a, b) => b.storedAt - a.storedAt);
    } catch (error) {
      logger.error('PAPER_REPO', 'Error getting all papers:', error);
      return [];
    }
  }

  /**
   * Get paper by URL
   */
  async getByUrl(url: string): Promise<StoredPaper | null> {
    try {
      const normalizedUrl = normalizeUrl(url);
      const paper = await this.findOneByIndex('url', normalizedUrl);

      // Update last accessed timestamp
      if (paper) {
        paper.lastAccessedAt = Date.now();
        await this.save(paper);
      }

      return paper;
    } catch (error) {
      logger.error('PAPER_REPO', 'Error getting paper by URL:', error);
      return null;
    }
  }

  /**
   * Check if paper exists by URL
   */
  async isPaperStored(url: string): Promise<boolean> {
    try {
      const normalizedUrl = normalizeUrl(url);
      const paper = await this.findOneByIndex('url', normalizedUrl);
      return paper !== null;
    } catch (error) {
      logger.error('PAPER_REPO', 'Error checking if paper stored:', error);
      return false;
    }
  }

  /**
   * Search papers by title
   */
  async searchPapers(query: string): Promise<StoredPaper[]> {
    try {
      const queryLower = query.toLowerCase();
      const results: StoredPaper[] = [];

      await this.iterateAll((paper) => {
        if (paper.title?.toLowerCase().includes(queryLower)) {
          results.push(paper);
        }
      });

      // Sort by relevance (exact match first, then partial, then by date)
      return results.sort((a, b) => {
        const aTitle = a.title?.toLowerCase() || '';
        const bTitle = b.title?.toLowerCase() || '';

        // Exact match
        if (aTitle === queryLower && bTitle !== queryLower) return -1;
        if (bTitle === queryLower && aTitle !== queryLower) return 1;

        // Starts with query
        if (aTitle.startsWith(queryLower) && !bTitle.startsWith(queryLower)) return -1;
        if (bTitle.startsWith(queryLower) && !aTitle.startsWith(queryLower)) return 1;

        // Fall back to most recent
        return b.storedAt - a.storedAt;
      });
    } catch (error) {
      logger.error('PAPER_REPO', 'Error searching papers:', error);
      return [];
    }
  }

  /**
   * Update paper explanation
   */
  async updateExplanation(paperId: string, explanation: string, outputLanguage?: string): Promise<boolean> {
    try {
      const updates: Partial<StoredPaper> = {
        explanation,
        explanationLanguage: outputLanguage,
      };

      await this.update(paperId, updates);
      return true;
    } catch (error) {
      logger.error('PAPER_REPO', 'Error updating explanation:', error);
      return false;
    }
  }

  /**
   * Update paper analysis
   */
  async updateAnalysis(paperId: string, analysis: any, outputLanguage?: string): Promise<boolean> {
    try {
      const updates: Partial<StoredPaper> = {
        analysis,
        analysisLanguage: outputLanguage,
      };

      await this.update(paperId, updates);
      logger.debug('PAPER_REPO', 'Updated analysis for paper:', paperId);
      return true;
    } catch (error) {
      logger.error('PAPER_REPO', 'Error updating analysis:', error);
      return false;
    }
  }

  /**
   * Update partial analysis (specific section)
   */
  async updatePartialAnalysis(paperId: string, sectionKey: string, sectionValue: any, outputLanguage?: string): Promise<boolean> {
    try {
      const paper = await this.getById(paperId);
      if (!paper) {
        throw new Error(`Paper ${paperId} not found`);
      }

      // Update specific analysis section
      const analysis = paper.analysis || {};
      analysis[sectionKey] = sectionValue;

      const updates: Partial<StoredPaper> = {
        analysis,
        analysisLanguage: outputLanguage,
      };

      await this.update(paperId, updates);
      logger.debug('PAPER_REPO', `Updated analysis section ${sectionKey} for paper:`, paperId);
      return true;
    } catch (error) {
      logger.error('PAPER_REPO', 'Error updating partial analysis:', error);
      return false;
    }
  }

  /**
   * Update paper glossary
   */
  async updateGlossary(paperId: string, glossary: any, outputLanguage?: string): Promise<boolean> {
    try {
      const updates: Partial<StoredPaper> = {
        glossary,
        glossaryLanguage: outputLanguage,
      };

      await this.update(paperId, updates);
      logger.debug('PAPER_REPO', 'Updated glossary for paper:', paperId);
      return true;
    } catch (error) {
      logger.error('PAPER_REPO', 'Error updating glossary:', error);
      return false;
    }
  }

  /**
   * Update partial glossary (add/update specific terms)
   */
  async updatePartialGlossary(paperId: string, newTerms: any[]): Promise<boolean> {
    try {
      const paper = await this.getById(paperId);
      if (!paper) {
        throw new Error(`Paper ${paperId} not found`);
      }

      // Merge new terms with existing glossary
      const existingGlossary = paper.glossary?.terms || [];
      const existingTermNames = new Set(existingGlossary.map((t: any) => t.term.toLowerCase()));

      // Add only new terms (avoid duplicates)
      const termsToAdd = newTerms.filter(term => !existingTermNames.has(term.term.toLowerCase()));

      const updatedGlossary = {
        ...paper.glossary,
        terms: [...existingGlossary, ...termsToAdd],
      };

      await this.update(paperId, { glossary: updatedGlossary });
      logger.debug('PAPER_REPO', `Added ${termsToAdd.length} new terms to glossary for paper:`, paperId);
      return true;
    } catch (error) {
      logger.error('PAPER_REPO', 'Error updating partial glossary:', error);
      return false;
    }
  }

  /**
   * Update paper Q&A history
   */
  async updateQAHistory(paperId: string, qaHistory: any[]): Promise<boolean> {
    try {
      const updates: Partial<StoredPaper> = {
        qaHistory,
      };

      await this.update(paperId, updates);
      return true;
    } catch (error) {
      logger.error('PAPER_REPO', 'Error updating Q&A history:', error);
      return false;
    }
  }

  /**
   * Delete paper with cascade (deletes related data)
   *
   * Note: This method coordinates deletion across multiple repositories.
   * In a more complete refactoring, this would use a service layer.
   * For now, it handles the cascading directly.
   */
  async delete(paperId: string): Promise<void> {
    try {
      // Delete paper and chunks
      await this.connection.transaction(
        [PAPERS_STORE, CHUNKS_STORE],
        'readwrite',
        async (stores) => {
          const [paperStore, chunkStore] = stores as IDBObjectStore[];

          // Delete paper
          const paperRequest = paperStore.delete(paperId);
          await requestAsPromise(paperRequest);

          // Delete all chunks for this paper
          const chunkIndex = chunkStore.index('paperId');
          const chunksRequest = chunkIndex.getAll(paperId);
          const chunks = await requestAsPromise(chunksRequest) as ContentChunk[];

          // Delete each chunk
          for (const chunk of chunks) {
            const deleteRequest = chunkStore.delete(chunk.id);
            await requestAsPromise(deleteRequest);
          }

          logger.debug('PAPER_REPO', `Deleted paper ${paperId} and ${chunks.length} chunks`);
        }
      );

      // Cascade delete: Delete related image explanations, chats, and screen captures
      const { getImageRepository } = await import('./index.ts');
      const imageDeleteResult = await getImageRepository().deleteAllImageDataForPaper(paperId);

      logger.debug('PAPER_REPO', `Cascade deleted image data:`, imageDeleteResult);
    } catch (error) {
      logger.error('PAPER_REPO', 'Error deleting paper:', error);
      throw error;
    }
  }
}
