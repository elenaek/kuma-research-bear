/**
 * Repository exports and singleton instances
 *
 * This file provides easy access to repository instances
 * and maintains backward compatibility during the transition.
 */

import { DatabaseConnection } from './DatabaseConnection.ts';
import { PaperRepository } from './PaperRepository.ts';
import { ChunkRepository } from './ChunkRepository.ts';
import { ImageRepository } from './ImageRepository.ts';
import { CitationRepository } from './CitationRepository.ts';

// Export types
export type { ImageChatEntry, ScreenCaptureEntry } from './ImageRepository.ts';
export type { CitationEntry, CitationSettings } from './CitationRepository.ts';

// Export classes
export { DatabaseConnection } from './DatabaseConnection.ts';
export { BaseRepository } from './base/BaseRepository.ts';
export { PaperRepository } from './PaperRepository.ts';
export { ChunkRepository } from './ChunkRepository.ts';
export { ImageRepository } from './ImageRepository.ts';
export { CitationRepository } from './CitationRepository.ts';

// Export constants
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
} from './DatabaseConnection.ts';

/**
 * Repository Instances (Singleton Pattern)
 *
 * These are created lazily on first access to ensure
 * the database is only initialized when needed.
 */
class RepositoryFactory {
  private paperRepo: PaperRepository | null = null;
  private chunkRepo: ChunkRepository | null = null;
  private imageRepo: ImageRepository | null = null;
  private citationRepo: CitationRepository | null = null;

  getPaperRepository(): PaperRepository {
    if (!this.paperRepo) {
      this.paperRepo = new PaperRepository();
    }
    return this.paperRepo;
  }

  getChunkRepository(): ChunkRepository {
    if (!this.chunkRepo) {
      this.chunkRepo = new ChunkRepository();
    }
    return this.chunkRepo;
  }

  getImageRepository(): ImageRepository {
    if (!this.imageRepo) {
      this.imageRepo = new ImageRepository();
    }
    return this.imageRepo;
  }

  getCitationRepository(): CitationRepository {
    if (!this.citationRepo) {
      this.citationRepo = new CitationRepository();
    }
    return this.citationRepo;
  }

  /**
   * Clear all repository instances (useful for testing)
   */
  clearInstances(): void {
    this.paperRepo = null;
    this.chunkRepo = null;
    this.imageRepo = null;
    this.citationRepo = null;
  }
}

// Export singleton factory
export const repositoryFactory = new RepositoryFactory();

/**
 * Convenience getters for repository instances
 */
export const getPaperRepository = () => repositoryFactory.getPaperRepository();
export const getChunkRepository = () => repositoryFactory.getChunkRepository();
export const getImageRepository = () => repositoryFactory.getImageRepository();
export const getCitationRepository = () => repositoryFactory.getCitationRepository();
