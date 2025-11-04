import { BaseRepository } from './base/BaseRepository.ts';
import { ImageExplanation } from '../../shared/types/index.ts';
import {
  IMAGE_EXPLANATIONS_STORE,
  IMAGE_CHATS_STORE,
  SCREEN_CAPTURES_STORE
} from './DatabaseConnection.ts';
import { requestAsPromise } from './DatabaseConnection.ts';
import { logger } from '../../shared/utils/logger.ts';

/**
 * Image chat entry stored in IndexedDB
 * Keyed by composite ID: `${paperId}-${hashCode(imageUrl)}`
 */
export interface ImageChatEntry {
  id: string; // Composite ID: `${paperId}-${hashCode(imageUrl)}`
  paperId: string;
  imageUrl: string;
  chatHistory: any[]; // ChatMessage[]
  conversationState: any; // ConversationState
  lastUpdated: number;
}

/**
 * Screen capture entry stored in IndexedDB
 * Keyed by composite ID: `${paperId}-${imageUrl}`
 */
export interface ScreenCaptureEntry {
  id: string;           // Composite: `${paperId}-${imageUrl}`
  paperId: string;
  imageUrl: string;     // The synthetic URL (screen-capture-xxx or pdf-capture-xxx)
  blob: Blob;           // The actual image blob
  timestamp: number;
  // Optional overlay position for HTML pages (not PDFs)
  overlayPosition?: {
    pageX: number;
    pageY: number;
    width: number;
    height: number;
  };
}

/**
 * ImageRepository - Data access layer for image-related data
 *
 * Handles three types of image data:
 * 1. Image Explanations - AI-generated explanations of images in papers
 * 2. Image Chats - Chat conversations about specific images
 * 3. Screen Captures - User-captured screen areas with explanations
 */
export class ImageRepository extends BaseRepository<ImageExplanation> {
  protected readonly storeName = IMAGE_EXPLANATIONS_STORE;

  // === IMAGE EXPLANATIONS ===

  /**
   * Get all image explanations for a paper
   */
  async findExplanationsByPaperId(paperId: string): Promise<ImageExplanation[]> {
    try {
      return await this.findByIndex('paperId', paperId);
    } catch (error) {
      logger.error('IMAGE_REPO', 'Error getting image explanations for paper:', error);
      return [];
    }
  }

  /**
   * Get image explanation by image URL
   */
  async findExplanationByImageUrl(paperId: string, imageUrl: string): Promise<ImageExplanation | null> {
    try {
      // Need to iterate since we can't do composite index queries easily
      const explanations = await this.findExplanationsByPaperId(paperId);
      return explanations.find(e => e.imageUrl === imageUrl) || null;
    } catch (error) {
      logger.error('IMAGE_REPO', 'Error getting image explanation by URL:', error);
      return null;
    }
  }

  /**
   * Save image explanation
   */
  async saveExplanation(explanation: ImageExplanation): Promise<void> {
    try {
      await this.save(explanation);
      logger.debug('IMAGE_REPO', 'Saved image explanation:', explanation.id);
    } catch (error) {
      logger.error('IMAGE_REPO', 'Error saving image explanation:', error);
      throw error;
    }
  }

  /**
   * Delete all image explanations for a paper
   */
  async deleteExplanationsByPaperId(paperId: string): Promise<number> {
    try {
      const explanations = await this.findExplanationsByPaperId(paperId);
      const ids = explanations.map(e => e.id);

      if (ids.length > 0) {
        await this.deleteAll(ids);
      }

      logger.debug('IMAGE_REPO', `Deleted ${ids.length} image explanations for paper ${paperId}`);
      return ids.length;
    } catch (error) {
      logger.error('IMAGE_REPO', 'Error deleting image explanations by paper:', error);
      return 0;
    }
  }

  // === IMAGE CHATS ===

  /**
   * Get all image chats for a paper
   */
  async findChatsByPaperId(paperId: string): Promise<ImageChatEntry[]> {
    try {
      return await this.connection.transaction(
        IMAGE_CHATS_STORE,
        'readonly',
        async (store) => {
          const index = (store as IDBObjectStore).index('paperId');
          const request = index.getAll(paperId);
          return await requestAsPromise(request);
        }
      );
    } catch (error) {
      logger.error('IMAGE_REPO', 'Error getting image chats for paper:', error);
      return [];
    }
  }

  /**
   * Get image chat by composite ID
   */
  async getChatById(id: string): Promise<ImageChatEntry | null> {
    try {
      return await this.connection.transaction(
        IMAGE_CHATS_STORE,
        'readonly',
        async (store) => {
          const request = (store as IDBObjectStore).get(id);
          const result = await requestAsPromise(request);
          return result || null;
        }
      );
    } catch (error) {
      logger.error('IMAGE_REPO', 'Error getting image chat by ID:', error);
      return null;
    }
  }

  /**
   * Save or update image chat
   */
  async saveChat(chat: ImageChatEntry): Promise<void> {
    try {
      await this.connection.transaction(
        IMAGE_CHATS_STORE,
        'readwrite',
        async (store) => {
          const request = (store as IDBObjectStore).put(chat);
          await requestAsPromise(request);
        }
      );

      logger.debug('IMAGE_REPO', 'Saved image chat:', chat.id);
    } catch (error) {
      logger.error('IMAGE_REPO', 'Error saving image chat:', error);
      throw error;
    }
  }

  /**
   * Delete image chat by ID
   */
  async deleteChatById(id: string): Promise<void> {
    try {
      await this.connection.transaction(
        IMAGE_CHATS_STORE,
        'readwrite',
        async (store) => {
          const request = (store as IDBObjectStore).delete(id);
          await requestAsPromise(request);
        }
      );

      logger.debug('IMAGE_REPO', 'Deleted image chat:', id);
    } catch (error) {
      logger.error('IMAGE_REPO', 'Error deleting image chat:', error);
      throw error;
    }
  }

  /**
   * Delete all image chats for a paper
   */
  async deleteChatsByPaperId(paperId: string): Promise<number> {
    try {
      const chats = await this.findChatsByPaperId(paperId);

      await this.connection.transaction(
        IMAGE_CHATS_STORE,
        'readwrite',
        async (store) => {
          for (const chat of chats) {
            const request = (store as IDBObjectStore).delete(chat.id);
            await requestAsPromise(request);
          }
        }
      );

      logger.debug('IMAGE_REPO', `Deleted ${chats.length} image chats for paper ${paperId}`);
      return chats.length;
    } catch (error) {
      logger.error('IMAGE_REPO', 'Error deleting image chats by paper:', error);
      return 0;
    }
  }

  // === SCREEN CAPTURES ===

  /**
   * Get all screen captures for a paper
   */
  async findCapturesByPaperId(paperId: string): Promise<ScreenCaptureEntry[]> {
    try {
      return await this.connection.transaction(
        SCREEN_CAPTURES_STORE,
        'readonly',
        async (store) => {
          const index = (store as IDBObjectStore).index('paperId');
          const request = index.getAll(paperId);
          return await requestAsPromise(request);
        }
      );
    } catch (error) {
      logger.error('IMAGE_REPO', 'Error getting screen captures for paper:', error);
      return [];
    }
  }

  /**
   * Get screen capture by composite ID
   */
  async getCaptureById(id: string): Promise<ScreenCaptureEntry | null> {
    try {
      return await this.connection.transaction(
        SCREEN_CAPTURES_STORE,
        'readonly',
        async (store) => {
          const request = (store as IDBObjectStore).get(id);
          const result = await requestAsPromise(request);
          return result || null;
        }
      );
    } catch (error) {
      logger.error('IMAGE_REPO', 'Error getting screen capture by ID:', error);
      return null;
    }
  }

  /**
   * Get screen capture by image URL
   */
  async getCaptureByImageUrl(paperId: string, imageUrl: string): Promise<ScreenCaptureEntry | null> {
    try {
      logger.debug('IMAGE_REPO', '🔍 getCaptureByImageUrl called with paperId:', paperId, 'imageUrl:', imageUrl);
      const captures = await this.findCapturesByPaperId(paperId);
      logger.debug('IMAGE_REPO', '🔍 Found', captures.length, 'total captures for paper');
      if (captures.length > 0) {
        logger.debug('IMAGE_REPO', '🔍 Capture imageUrls:', captures.map(c => c.imageUrl));
      }
      const found = captures.find(c => c.imageUrl === imageUrl) || null;
      logger.debug('IMAGE_REPO', found ? '✓ Found matching capture' : '❌ No matching capture found');
      return found;
    } catch (error) {
      logger.error('IMAGE_REPO', '❌ Error getting screen capture by URL:', error);
      return null;
    }
  }

  /**
   * Save or update screen capture
   */
  async saveCapture(capture: ScreenCaptureEntry): Promise<void> {
    try {
      logger.debug('IMAGE_REPO', '🔍 saveCapture called with:', capture.id, 'paperId:', capture.paperId, 'imageUrl:', capture.imageUrl);
      await this.connection.transaction(
        SCREEN_CAPTURES_STORE,
        'readwrite',
        async (store) => {
          const request = (store as IDBObjectStore).put(capture);
          await requestAsPromise(request);
        }
      );

      logger.debug('IMAGE_REPO', '✓ Saved screen capture:', capture.id);
    } catch (error) {
      logger.error('IMAGE_REPO', '❌ Error saving screen capture:', error);
      throw error;
    }
  }

  /**
   * Delete screen capture by ID
   */
  async deleteCaptureById(id: string): Promise<void> {
    try {
      await this.connection.transaction(
        SCREEN_CAPTURES_STORE,
        'readwrite',
        async (store) => {
          const request = (store as IDBObjectStore).delete(id);
          await requestAsPromise(request);
        }
      );

      logger.debug('IMAGE_REPO', 'Deleted screen capture:', id);
    } catch (error) {
      logger.error('IMAGE_REPO', 'Error deleting screen capture:', error);
      throw error;
    }
  }

  /**
   * Delete all screen captures for a paper
   */
  async deleteCapturesByPaperId(paperId: string): Promise<number> {
    try {
      const captures = await this.findCapturesByPaperId(paperId);

      await this.connection.transaction(
        SCREEN_CAPTURES_STORE,
        'readwrite',
        async (store) => {
          for (const capture of captures) {
            const request = (store as IDBObjectStore).delete(capture.id);
            await requestAsPromise(request);
          }
        }
      );

      logger.debug('IMAGE_REPO', `Deleted ${captures.length} screen captures for paper ${paperId}`);
      return captures.length;
    } catch (error) {
      logger.error('IMAGE_REPO', 'Error deleting screen captures by paper:', error);
      return 0;
    }
  }

  /**
   * Get all image-related data for a paper (explanations, chats, captures)
   */
  async getAllImageDataForPaper(paperId: string): Promise<{
    explanations: ImageExplanation[];
    chats: ImageChatEntry[];
    captures: ScreenCaptureEntry[];
  }> {
    try {
      const [explanations, chats, captures] = await Promise.all([
        this.findExplanationsByPaperId(paperId),
        this.findChatsByPaperId(paperId),
        this.findCapturesByPaperId(paperId),
      ]);

      return { explanations, chats, captures };
    } catch (error) {
      logger.error('IMAGE_REPO', 'Error getting all image data for paper:', error);
      return { explanations: [], chats: [], captures: [] };
    }
  }

  /**
   * Delete all image-related data for a paper (cascade delete)
   */
  async deleteAllImageDataForPaper(paperId: string): Promise<{
    explanations: number;
    chats: number;
    captures: number;
  }> {
    try {
      const [explanations, chats, captures] = await Promise.all([
        this.deleteExplanationsByPaperId(paperId),
        this.deleteChatsByPaperId(paperId),
        this.deleteCapturesByPaperId(paperId),
      ]);

      logger.debug('IMAGE_REPO', `Deleted all image data for paper ${paperId}:`, {
        explanations,
        chats,
        captures,
      });

      return { explanations, chats, captures };
    } catch (error) {
      logger.error('IMAGE_REPO', 'Error deleting all image data for paper:', error);
      return { explanations: 0, chats: 0, captures: 0 };
    }
  }
}
