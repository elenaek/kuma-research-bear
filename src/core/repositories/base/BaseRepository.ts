import { DatabaseConnection, requestAsPromise, cursorIterate } from '../DatabaseConnection.ts';
import { logger } from '../../../shared/utils/logger.ts';

/**
 * BaseRepository - Abstract base class for all repositories
 *
 * Provides common CRUD operations and transaction handling.
 * Repositories extend this class and implement specific business logic.
 *
 * @template T - The entity type (must have 'id' field)
 */
export abstract class BaseRepository<T extends { id: string }> {
  protected readonly connection: DatabaseConnection;
  protected abstract readonly storeName: string;

  constructor() {
    this.connection = DatabaseConnection.getInstance();
  }

  /**
   * Get entity by ID
   *
   * @param id - Entity ID
   * @returns Entity or null if not found
   */
  async getById(id: string): Promise<T | null> {
    try {
      return await this.connection.transaction(
        this.storeName,
        'readonly',
        async (store) => {
          const request = (store as IDBObjectStore).get(id);
          const result = await requestAsPromise(request);
          return result || null;
        }
      );
    } catch (error) {
      logger.error('REPOSITORY', `Error getting ${this.storeName} by id ${id}:`, error);
      throw error;
    }
  }

  /**
   * Get all entities
   *
   * @returns Array of all entities
   */
  async getAll(): Promise<T[]> {
    try {
      return await this.connection.transaction(
        this.storeName,
        'readonly',
        async (store) => {
          const request = (store as IDBObjectStore).getAll();
          return await requestAsPromise(request);
        }
      );
    } catch (error) {
      logger.error('REPOSITORY', `Error getting all ${this.storeName}:`, error);
      throw error;
    }
  }

  /**
   * Save entity (insert or update)
   *
   * @param entity - Entity to save
   */
  async save(entity: T): Promise<void> {
    try {
      await this.connection.transaction(
        this.storeName,
        'readwrite',
        async (store) => {
          const request = (store as IDBObjectStore).put(entity);
          await requestAsPromise(request);
        }
      );

      logger.debug('REPOSITORY', `Saved ${this.storeName} with id:`, entity.id);
    } catch (error) {
      logger.error('REPOSITORY', `Error saving ${this.storeName}:`, error);
      throw error;
    }
  }

  /**
   * Save multiple entities (batch operation)
   *
   * @param entities - Array of entities to save
   */
  async saveAll(entities: T[]): Promise<void> {
    if (entities.length === 0) return;

    try {
      await this.connection.transaction(
        this.storeName,
        'readwrite',
        async (store) => {
          const promises = entities.map(entity => {
            const request = (store as IDBObjectStore).put(entity);
            return requestAsPromise(request);
          });

          await Promise.all(promises);
        }
      );

      logger.debug('REPOSITORY', `Saved ${entities.length} ${this.storeName} entities`);
    } catch (error) {
      logger.error('REPOSITORY', `Error saving batch of ${this.storeName}:`, error);
      throw error;
    }
  }

  /**
   * Update entity (partial update)
   *
   * @param id - Entity ID
   * @param updates - Partial entity with fields to update
   */
  async update(id: string, updates: Partial<T>): Promise<void> {
    try {
      await this.connection.transaction(
        this.storeName,
        'readwrite',
        async (store) => {
          // Get existing entity
          const getRequest = (store as IDBObjectStore).get(id);
          const existing = await requestAsPromise(getRequest);

          if (!existing) {
            throw new Error(`${this.storeName} with id ${id} not found`);
          }

          // Merge updates
          const updated = { ...existing, ...updates };

          // Save updated entity
          const putRequest = (store as IDBObjectStore).put(updated);
          await requestAsPromise(putRequest);
        }
      );

      logger.debug('REPOSITORY', `Updated ${this.storeName} with id:`, id);
    } catch (error) {
      logger.error('REPOSITORY', `Error updating ${this.storeName}:`, error);
      throw error;
    }
  }

  /**
   * Delete entity by ID
   *
   * @param id - Entity ID
   */
  async delete(id: string): Promise<void> {
    try {
      await this.connection.transaction(
        this.storeName,
        'readwrite',
        async (store) => {
          const request = (store as IDBObjectStore).delete(id);
          await requestAsPromise(request);
        }
      );

      logger.debug('REPOSITORY', `Deleted ${this.storeName} with id:`, id);
    } catch (error) {
      logger.error('REPOSITORY', `Error deleting ${this.storeName}:`, error);
      throw error;
    }
  }

  /**
   * Delete multiple entities (batch operation)
   *
   * @param ids - Array of entity IDs to delete
   */
  async deleteAll(ids: string[]): Promise<void> {
    if (ids.length === 0) return;

    try {
      await this.connection.transaction(
        this.storeName,
        'readwrite',
        async (store) => {
          const promises = ids.map(id => {
            const request = (store as IDBObjectStore).delete(id);
            return requestAsPromise(request);
          });

          await Promise.all(promises);
        }
      );

      logger.debug('REPOSITORY', `Deleted ${ids.length} ${this.storeName} entities`);
    } catch (error) {
      logger.error('REPOSITORY', `Error deleting batch of ${this.storeName}:`, error);
      throw error;
    }
  }

  /**
   * Check if entity exists
   *
   * @param id - Entity ID
   * @returns True if exists, false otherwise
   */
  async exists(id: string): Promise<boolean> {
    try {
      return await this.connection.transaction(
        this.storeName,
        'readonly',
        async (store) => {
          const request = (store as IDBObjectStore).count(id);
          const count = await requestAsPromise(request);
          return count > 0;
        }
      );
    } catch (error) {
      logger.error('REPOSITORY', `Error checking existence of ${this.storeName}:`, error);
      throw error;
    }
  }

  /**
   * Count entities
   *
   * @returns Total count
   */
  async count(): Promise<number> {
    try {
      return await this.connection.transaction(
        this.storeName,
        'readonly',
        async (store) => {
          const request = (store as IDBObjectStore).count();
          return await requestAsPromise(request);
        }
      );
    } catch (error) {
      logger.error('REPOSITORY', `Error counting ${this.storeName}:`, error);
      throw error;
    }
  }

  /**
   * Clear all entities from store
   */
  async clear(): Promise<void> {
    try {
      await this.connection.transaction(
        this.storeName,
        'readwrite',
        async (store) => {
          const request = (store as IDBObjectStore).clear();
          await requestAsPromise(request);
        }
      );

      logger.debug('REPOSITORY', `Cleared all ${this.storeName}`);
    } catch (error) {
      logger.error('REPOSITORY', `Error clearing ${this.storeName}:`, error);
      throw error;
    }
  }

  /**
   * Find entities by index
   *
   * @param indexName - Index name
   * @param value - Value to search for
   * @returns Array of matching entities
   */
  protected async findByIndex(indexName: string, value: any): Promise<T[]> {
    try {
      return await this.connection.transaction(
        this.storeName,
        'readonly',
        async (store) => {
          const index = (store as IDBObjectStore).index(indexName);
          const request = index.getAll(value);
          return await requestAsPromise(request);
        }
      );
    } catch (error) {
      logger.error('REPOSITORY', `Error finding ${this.storeName} by index ${indexName}:`, error);
      throw error;
    }
  }

  /**
   * Find single entity by index
   *
   * @param indexName - Index name
   * @param value - Value to search for
   * @returns First matching entity or null
   */
  protected async findOneByIndex(indexName: string, value: any): Promise<T | null> {
    try {
      return await this.connection.transaction(
        this.storeName,
        'readonly',
        async (store) => {
          const index = (store as IDBObjectStore).index(indexName);
          const request = index.get(value);
          const result = await requestAsPromise(request);
          return result || null;
        }
      );
    } catch (error) {
      logger.error('REPOSITORY', `Error finding one ${this.storeName} by index ${indexName}:`, error);
      throw error;
    }
  }

  /**
   * Iterate through all entities with cursor
   *
   * @param callback - Function to call for each entity
   */
  protected async iterateAll(callback: (entity: T) => void | Promise<void>): Promise<void> {
    try {
      await this.connection.transaction(
        this.storeName,
        'readonly',
        async (store) => {
          const request = (store as IDBObjectStore).openCursor();
          await cursorIterate(request, async (cursor) => {
            await callback(cursor.value as T);
          });
        }
      );
    } catch (error) {
      logger.error('REPOSITORY', `Error iterating ${this.storeName}:`, error);
      throw error;
    }
  }

  /**
   * Iterate through entities matching index with cursor
   *
   * @param indexName - Index name
   * @param value - Value to search for
   * @param callback - Function to call for each matching entity
   */
  protected async iterateByIndex(
    indexName: string,
    value: any,
    callback: (entity: T) => void | Promise<void>
  ): Promise<void> {
    try {
      await this.connection.transaction(
        this.storeName,
        'readonly',
        async (store) => {
          const index = (store as IDBObjectStore).index(indexName);
          const request = index.openCursor(value);
          await cursorIterate(request, async (cursor) => {
            await callback(cursor.value as T);
          });
        }
      );
    } catch (error) {
      logger.error('REPOSITORY', `Error iterating ${this.storeName} by index ${indexName}:`, error);
      throw error;
    }
  }
}
