import { BaseRepository } from './base/BaseRepository.ts';
import { CITATIONS_STORE, CITATIONS_SETTINGS_STORE } from './DatabaseConnection.ts';
import { requestAsPromise } from './DatabaseConnection.ts';
import { logger } from '../../shared/utils/logger.ts';

/**
 * Citation entry stored in IndexedDB
 */
export interface CitationEntry {
  id: string;
  paperId: string;
  title: string;
  authors?: string[];
  year?: number;
  doi?: string;
  url?: string;
  source?: string;
  abstract?: string;
  addedAt: number;
  customOrder?: number;
}

/**
 * Citation settings (formatting preferences, etc.)
 */
export interface CitationSettings {
  id: string; // Usually 'global' or per-paper
  format?: 'APA' | 'MLA' | 'Chicago' | 'BibTeX';
  sortBy?: 'addedAt' | 'customOrder' | 'author' | 'year';
  includeAbstract?: boolean;
}

/**
 * CitationRepository - Data access layer for citations
 *
 * Handles:
 * - Citation CRUD operations
 * - Citation queries by paper
 * - Citation settings management
 * - Custom ordering
 */
export class CitationRepository extends BaseRepository<CitationEntry> {
  protected readonly storeName = CITATIONS_STORE;

  /**
   * Get all citations for a paper
   */
  async findByPaperId(paperId: string): Promise<CitationEntry[]> {
    try {
      const citations = await this.findByIndex('paperId', paperId);
      // Sort by custom order or added date
      return this.sortCitations(citations);
    } catch (error) {
      logger.error('CITATION_REPO', 'Error getting citations for paper:', error);
      return [];
    }
  }

  /**
   * Save citation
   */
  async saveCitation(citation: CitationEntry): Promise<void> {
    try {
      // Set addedAt if not provided
      if (!citation.addedAt) {
        citation.addedAt = Date.now();
      }

      await this.save(citation);
      logger.debug('CITATION_REPO', 'Saved citation:', citation.id);
    } catch (error) {
      logger.error('CITATION_REPO', 'Error saving citation:', error);
      throw error;
    }
  }

  /**
   * Delete all citations for a paper
   */
  async deleteByPaperId(paperId: string): Promise<number> {
    try {
      const citations = await this.findByPaperId(paperId);
      const ids = citations.map(c => c.id);

      if (ids.length > 0) {
        await this.deleteAll(ids);
      }

      logger.debug('CITATION_REPO', `Deleted ${ids.length} citations for paper ${paperId}`);
      return ids.length;
    } catch (error) {
      logger.error('CITATION_REPO', 'Error deleting citations by paper:', error);
      return 0;
    }
  }

  /**
   * Update citation order (for custom sorting)
   */
  async updateOrder(citationId: string, customOrder: number): Promise<void> {
    try {
      await this.update(citationId, { customOrder });
      logger.debug('CITATION_REPO', `Updated order for citation ${citationId} to ${customOrder}`);
    } catch (error) {
      logger.error('CITATION_REPO', 'Error updating citation order:', error);
      throw error;
    }
  }

  /**
   * Reorder citations (batch update)
   */
  async reorderCitations(citationIds: string[]): Promise<void> {
    try {
      await this.connection.transaction(
        this.storeName,
        'readwrite',
        async (store) => {
          for (let i = 0; i < citationIds.length; i++) {
            const getRequest = (store as IDBObjectStore).get(citationIds[i]);
            const citation = await requestAsPromise(getRequest);

            if (citation) {
              citation.customOrder = i;
              const putRequest = (store as IDBObjectStore).put(citation);
              await requestAsPromise(putRequest);
            }
          }
        }
      );

      logger.debug('CITATION_REPO', `Reordered ${citationIds.length} citations`);
    } catch (error) {
      logger.error('CITATION_REPO', 'Error reordering citations:', error);
      throw error;
    }
  }

  /**
   * Sort citations based on settings
   */
  private sortCitations(citations: CitationEntry[]): CitationEntry[] {
    return citations.sort((a, b) => {
      // Primary sort: custom order if set
      if (a.customOrder !== undefined && b.customOrder !== undefined) {
        return a.customOrder - b.customOrder;
      }

      // Secondary sort: added date (most recent first)
      return b.addedAt - a.addedAt;
    });
  }

  // === CITATION SETTINGS ===

  /**
   * Get citation settings
   */
  async getSettings(id: string = 'global'): Promise<CitationSettings | null> {
    try {
      return await this.connection.transaction(
        CITATIONS_SETTINGS_STORE,
        'readonly',
        async (store) => {
          const request = (store as IDBObjectStore).get(id);
          const result = await requestAsPromise(request);
          return result || null;
        }
      );
    } catch (error) {
      logger.error('CITATION_REPO', 'Error getting citation settings:', error);
      return null;
    }
  }

  /**
   * Save citation settings
   */
  async saveSettings(settings: CitationSettings): Promise<void> {
    try {
      await this.connection.transaction(
        CITATIONS_SETTINGS_STORE,
        'readwrite',
        async (store) => {
          const request = (store as IDBObjectStore).put(settings);
          await requestAsPromise(request);
        }
      );

      logger.debug('CITATION_REPO', 'Saved citation settings:', settings.id);
    } catch (error) {
      logger.error('CITATION_REPO', 'Error saving citation settings:', error);
      throw error;
    }
  }

  /**
   * Delete citation settings
   */
  async deleteSettings(id: string = 'global'): Promise<void> {
    try {
      await this.connection.transaction(
        CITATIONS_SETTINGS_STORE,
        'readwrite',
        async (store) => {
          const request = (store as IDBObjectStore).delete(id);
          await requestAsPromise(request);
        }
      );

      logger.debug('CITATION_REPO', 'Deleted citation settings:', id);
    } catch (error) {
      logger.error('CITATION_REPO', 'Error deleting citation settings:', error);
      throw error;
    }
  }

  /**
   * Get or create default settings
   */
  async getOrCreateDefaultSettings(): Promise<CitationSettings> {
    try {
      let settings = await this.getSettings('global');

      if (!settings) {
        settings = {
          id: 'global',
          format: 'APA',
          sortBy: 'addedAt',
          includeAbstract: false,
        };

        await this.saveSettings(settings);
      }

      return settings;
    } catch (error) {
      logger.error('CITATION_REPO', 'Error getting or creating default settings:', error);
      // Return default settings without saving
      return {
        id: 'global',
        format: 'APA',
        sortBy: 'addedAt',
        includeAbstract: false,
      };
    }
  }
}
