import { logger } from '../../shared/utils/logger.ts';

/**
 * Database connection constants
 */
export const DB_NAME = 'KumaResearchBearDB';
export const DB_VERSION = 7;

/**
 * Object store names
 */
export const PAPERS_STORE = 'papers';
export const CHUNKS_STORE = 'chunks';
export const IMAGE_EXPLANATIONS_STORE = 'imageExplanations';
export const IMAGE_CHATS_STORE = 'imageChats';
export const CITATIONS_STORE = 'citations';
export const CITATIONS_SETTINGS_STORE = 'citationsSettings';
export const SCREEN_CAPTURES_STORE = 'screenCaptures';

/**
 * DatabaseConnection - Centralized database connection management
 *
 * Handles:
 * - Opening database connections
 * - Transaction management
 * - Connection pooling/reuse
 * - Error handling
 */
export class DatabaseConnection {
  private static instance: DatabaseConnection;
  private dbPromise: Promise<IDBDatabase> | null = null;

  private constructor() {}

  /**
   * Get singleton instance
   */
  static getInstance(): DatabaseConnection {
    if (!DatabaseConnection.instance) {
      DatabaseConnection.instance = new DatabaseConnection();
    }
    return DatabaseConnection.instance;
  }

  /**
   * Open database connection (singleton pattern - reuses connection)
   */
  async openDatabase(): Promise<IDBDatabase> {
    // Return existing connection promise if available
    if (this.dbPromise) {
      return this.dbPromise;
    }

    // Create new connection promise
    this.dbPromise = this.createConnection();

    try {
      const db = await this.dbPromise;

      // Handle database close/error events
      db.onclose = () => {
        logger.debug('DATABASE', 'Database connection closed');
        this.dbPromise = null;
      };

      db.onerror = (event) => {
        logger.error('DATABASE', 'Database error:', event);
      };

      return db;
    } catch (error) {
      // Clear promise on error so next call will retry
      this.dbPromise = null;
      throw error;
    }
  }

  /**
   * Create new database connection
   */
  private createConnection(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onerror = () => {
        logger.error('DATABASE', 'Failed to open IndexedDB');
        reject(new Error('Failed to open IndexedDB'));
      };

      request.onsuccess = () => {
        logger.debug('DATABASE', 'Database connection opened successfully');
        resolve(request.result);
      };

      request.onupgradeneeded = (event) => {
        logger.debug('DATABASE', 'Database upgrade needed, running migrations...');
        const db = (event.target as IDBOpenDBRequest).result;
        const oldVersion = (event as IDBVersionChangeEvent).oldVersion;
        const transaction = (event.target as IDBOpenDBRequest).transaction!;

        // Run migrations
        this.runMigrations(db, oldVersion, transaction);
      };
    });
  }

  /**
   * Run database migrations
   */
  private runMigrations(db: IDBDatabase, oldVersion: number, transaction: IDBTransaction): void {
    logger.debug('DATABASE', `Running migrations from version ${oldVersion} to ${DB_VERSION}`);

    // Create papers store
    if (!db.objectStoreNames.contains(PAPERS_STORE)) {
      const papersStore = db.createObjectStore(PAPERS_STORE, { keyPath: 'id' });
      papersStore.createIndex('url', 'url', { unique: true });
      papersStore.createIndex('source', 'source', { unique: false });
      papersStore.createIndex('storedAt', 'storedAt', { unique: false });
      papersStore.createIndex('title', 'title', { unique: false });
      logger.debug('DATABASE', '✓ Created papers store');
    }

    // Create chunks store
    if (!db.objectStoreNames.contains(CHUNKS_STORE)) {
      const chunksStore = db.createObjectStore(CHUNKS_STORE, { keyPath: 'id' });
      chunksStore.createIndex('paperId', 'paperId', { unique: false });
      chunksStore.createIndex('index', 'index', { unique: false });
      logger.debug('DATABASE', '✓ Created chunks store');
    }

    // Create image explanations store (DB_VERSION 2)
    if (!db.objectStoreNames.contains(IMAGE_EXPLANATIONS_STORE)) {
      const imageExplanationsStore = db.createObjectStore(IMAGE_EXPLANATIONS_STORE, { keyPath: 'id' });
      imageExplanationsStore.createIndex('paperId', 'paperId', { unique: false });
      imageExplanationsStore.createIndex('imageUrl', 'imageUrl', { unique: false });
      imageExplanationsStore.createIndex('timestamp', 'timestamp', { unique: false });
      logger.debug('DATABASE', '✓ Created image explanations store');
    }

    // Migration: Add title field to existing image explanations (DB_VERSION 2 -> 3)
    if (oldVersion < 3 && db.objectStoreNames.contains(IMAGE_EXPLANATIONS_STORE)) {
      const imageExplanationsStore = transaction.objectStore(IMAGE_EXPLANATIONS_STORE);
      const cursorRequest = imageExplanationsStore.openCursor();

      cursorRequest.onsuccess = (e) => {
        const cursor = (e.target as IDBRequest).result;
        if (cursor) {
          const record = cursor.value;
          // Add title field if it doesn't exist
          if (!record.title) {
            record.title = 'Image Explanation';
            cursor.update(record);
          }
          cursor.continue();
        }
      };

      logger.debug('DATABASE', '✓ Migrated image explanations to DB_VERSION 3 (added title field)');
    }

    // Create image chats store (DB_VERSION 4)
    if (!db.objectStoreNames.contains(IMAGE_CHATS_STORE)) {
      const imageChatsStore = db.createObjectStore(IMAGE_CHATS_STORE, { keyPath: 'id' });
      imageChatsStore.createIndex('paperId', 'paperId', { unique: false });
      imageChatsStore.createIndex('imageUrl', 'imageUrl', { unique: false });
      imageChatsStore.createIndex('lastUpdated', 'lastUpdated', { unique: false });
      logger.debug('DATABASE', '✓ Created image chats store (DB_VERSION 4)');
    }

    // Create citations store (DB_VERSION 5)
    if (!db.objectStoreNames.contains(CITATIONS_STORE)) {
      const citationsStore = db.createObjectStore(CITATIONS_STORE, { keyPath: 'id' });
      citationsStore.createIndex('paperId', 'paperId', { unique: false });
      citationsStore.createIndex('addedAt', 'addedAt', { unique: false });
      citationsStore.createIndex('customOrder', 'customOrder', { unique: false });
      logger.debug('DATABASE', '✓ Created citations store (DB_VERSION 5)');
    }

    // Create citations settings store (DB_VERSION 5)
    if (!db.objectStoreNames.contains(CITATIONS_SETTINGS_STORE)) {
      db.createObjectStore(CITATIONS_SETTINGS_STORE, { keyPath: 'id' });
      logger.debug('DATABASE', '✓ Created citations settings store (DB_VERSION 5)');
    }

    // Create screen captures store (DB_VERSION 6)
    if (!db.objectStoreNames.contains(SCREEN_CAPTURES_STORE)) {
      const screenCapturesStore = db.createObjectStore(SCREEN_CAPTURES_STORE, { keyPath: 'id' });
      screenCapturesStore.createIndex('paperId', 'paperId', { unique: false });
      screenCapturesStore.createIndex('imageUrl', 'imageUrl', { unique: false });
      screenCapturesStore.createIndex('timestamp', 'timestamp', { unique: false });
      logger.debug('DATABASE', '✓ Created screen captures store (DB_VERSION 6)');
    }

    logger.debug('DATABASE', '✓ All migrations complete, database at version', DB_VERSION);
  }

  /**
   * Execute operation in transaction
   *
   * @param storeNames - Store names to access
   * @param mode - Transaction mode ('readonly' or 'readwrite')
   * @param callback - Operation to execute with store(s)
   */
  async transaction<T>(
    storeNames: string | string[],
    mode: IDBTransactionMode,
    callback: (stores: IDBObjectStore | IDBObjectStore[]) => Promise<T>
  ): Promise<T> {
    const db = await this.openDatabase();
    const storeNamesArray = Array.isArray(storeNames) ? storeNames : [storeNames];

    const tx = db.transaction(storeNamesArray, mode);
    const stores = storeNamesArray.map(name => tx.objectStore(name));

    try {
      // Execute callback with single store or array of stores
      const result = await callback(stores.length === 1 ? stores[0] : stores);

      // Wait for transaction to complete
      await this.waitForTransaction(tx);

      return result;
    } catch (error) {
      // Transaction will auto-abort on error
      logger.error('DATABASE', 'Transaction error:', error);
      throw error;
    }
  }

  /**
   * Wait for transaction to complete
   */
  private waitForTransaction(tx: IDBTransaction): Promise<void> {
    return new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(new Error('Transaction aborted'));
    });
  }

  /**
   * Close database connection (for cleanup)
   */
  async closeConnection(): Promise<void> {
    if (this.dbPromise) {
      const db = await this.dbPromise;
      db.close();
      this.dbPromise = null;
      logger.debug('DATABASE', 'Database connection closed manually');
    }
  }

  /**
   * Delete database (for testing/cleanup)
   */
  static async deleteDatabase(): Promise<void> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.deleteDatabase(DB_NAME);

      request.onsuccess = () => {
        logger.debug('DATABASE', 'Database deleted successfully');
        resolve();
      };

      request.onerror = () => {
        logger.error('DATABASE', 'Failed to delete database');
        reject(new Error('Failed to delete database'));
      };
    });
  }
}

/**
 * Helper to execute IDB request as Promise
 */
export function requestAsPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/**
 * Helper to execute cursor operation
 */
export function cursorIterate<T>(
  request: IDBRequest<IDBCursorWithValue | null>,
  callback: (cursor: IDBCursorWithValue) => void | Promise<void>
): Promise<void> {
  return new Promise((resolve, reject) => {
    request.onsuccess = async (event) => {
      const cursor = (event.target as IDBRequest).result;
      if (cursor) {
        try {
          await callback(cursor);
          cursor.continue();
        } catch (error) {
          reject(error);
        }
      } else {
        resolve();
      }
    };

    request.onerror = () => reject(request.error);
  });
}
