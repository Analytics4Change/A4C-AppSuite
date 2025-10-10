/**
 * IndexedDB cache for offline medication search
 * iOS-safe implementation with 45MB limit
 */

import { CacheEntry, CacheStats } from '@/types/medication-search.types';
import { INDEXED_DB_CONFIG, CACHE_CONFIG } from '@/config/medication-search.config';
import { Logger } from '@/utils/logger';

const log = Logger.getLogger('cache');

export class IndexedDBCache<V> {
  private db: IDBDatabase | null = null;
  private readonly dbName: string;
  private readonly storeName: string;
  private readonly maxSize: number;
  private readonly ttl: number;
  private currentSize = 0;
  private isInitialized = false;

  constructor(storeName: string = INDEXED_DB_CONFIG.stores.searchCache) {
    this.dbName = INDEXED_DB_CONFIG.dbName;
    this.storeName = storeName;
    this.maxSize = CACHE_CONFIG.maxIndexedDBSize;
    this.ttl = CACHE_CONFIG.indexedDBTTL;
  }

  /**
   * Initialize IndexedDB connection
   */
  async initialize(): Promise<void> {
    if (this.isInitialized) return;
    
    try {
      const request = indexedDB.open(this.dbName, INDEXED_DB_CONFIG.version);
      
      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;
        
        // Create stores if they don't exist
        if (!db.objectStoreNames.contains(this.storeName)) {
          const store = db.createObjectStore(this.storeName, { keyPath: 'key' });
          store.createIndex('timestamp', 'timestamp', { unique: false });
          store.createIndex('expiresAt', 'expiresAt', { unique: false });
        }
      };
      
      this.db = await new Promise<IDBDatabase>((resolve, reject) => {
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      
      this.isInitialized = true;
      await this.calculateCurrentSize();
      
      log.info('IndexedDB cache initialized', {
        dbName: this.dbName,
        storeName: this.storeName,
        currentSize: this.currentSize
      });
    } catch (error) {
      log.error('Failed to initialize IndexedDB', error);
      throw error;
    }
  }

  /**
   * Get value from cache
   */
  async get(key: string): Promise<V | null> {
    await this.ensureInitialized();
    
    try {
      const transaction = this.db!.transaction([this.storeName], 'readonly');
      const store = transaction.objectStore(this.storeName);
      const request = store.get(key);
      
      const result = await new Promise<any>((resolve, reject) => {
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      
      if (!result) return null;
      
      // Check if expired
      if (Date.now() > result.expiresAt) {
        await this.delete(key);
        return null;
      }
      
      // Update hit count
      await this.updateHitCount(key);
      
      return result.data;
    } catch (error) {
      log.error('Failed to get from IndexedDB', { key, error });
      return null;
    }
  }

  /**
   * Set value in cache
   */
  async set(key: string, value: V, customTTL?: number): Promise<void> {
    await this.ensureInitialized();
    
    try {
      // Check if we need to make space
      const estimatedSize = this.estimateSize(value);
      if (this.currentSize + estimatedSize > this.maxSize) {
        await this.evictOldest(estimatedSize);
      }
      
      const entry = {
        key,
        data: value,
        timestamp: Date.now(),
        expiresAt: Date.now() + (customTTL || this.ttl),
        hitCount: 0,
        size: estimatedSize
      };
      
      const transaction = this.db!.transaction([this.storeName], 'readwrite');
      const store = transaction.objectStore(this.storeName);
      
      // Check if key exists (for size calculation)
      const existingRequest = store.get(key);
      const existing = await new Promise<any>((resolve) => {
        existingRequest.onsuccess = () => resolve(existingRequest.result);
        existingRequest.onerror = () => resolve(null);
      });
      
      // Update size tracking
      if (existing) {
        this.currentSize -= existing.size || 0;
      }
      this.currentSize += estimatedSize;
      
      // Put the new entry
      const putRequest = store.put(entry);
      
      await new Promise<void>((resolve, reject) => {
        putRequest.onsuccess = () => resolve();
        putRequest.onerror = () => reject(putRequest.error);
      });
      
      log.debug('IndexedDB cache entry added', {
        key,
        size: estimatedSize,
        totalSize: this.currentSize
      });
    } catch (error) {
      log.error('Failed to set in IndexedDB', { key, error });
      throw error;
    }
  }

  /**
   * Delete specific entry
   */
  async delete(key: string): Promise<boolean> {
    await this.ensureInitialized();
    
    try {
      const transaction = this.db!.transaction([this.storeName], 'readwrite');
      const store = transaction.objectStore(this.storeName);
      
      // Get existing entry for size tracking
      const getRequest = store.get(key);
      const existing = await new Promise<any>((resolve) => {
        getRequest.onsuccess = () => resolve(getRequest.result);
        getRequest.onerror = () => resolve(null);
      });
      
      if (existing) {
        this.currentSize -= existing.size || 0;
        
        const deleteRequest = store.delete(key);
        await new Promise<void>((resolve, reject) => {
          deleteRequest.onsuccess = () => resolve();
          deleteRequest.onerror = () => reject(deleteRequest.error);
        });
        
        return true;
      }
      
      return false;
    } catch (error) {
      log.error('Failed to delete from IndexedDB', { key, error });
      return false;
    }
  }

  /**
   * Clear all entries
   */
  async clear(): Promise<void> {
    await this.ensureInitialized();
    
    try {
      const transaction = this.db!.transaction([this.storeName], 'readwrite');
      const store = transaction.objectStore(this.storeName);
      const request = store.clear();
      
      await new Promise<void>((resolve, reject) => {
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
      });
      
      this.currentSize = 0;
      log.info('IndexedDB cache cleared');
    } catch (error) {
      log.error('Failed to clear IndexedDB', error);
      throw error;
    }
  }

  /**
   * Get cache statistics
   */
  async getStats(): Promise<CacheStats> {
    await this.ensureInitialized();
    
    try {
      const transaction = this.db!.transaction([this.storeName], 'readonly');
      const store = transaction.objectStore(this.storeName);
      const countRequest = store.count();
      
      const count = await new Promise<number>((resolve, reject) => {
        countRequest.onsuccess = () => resolve(countRequest.result);
        countRequest.onerror = () => reject(countRequest.error);
      });
      
      // Get oldest and newest entries
      const getAllRequest = store.getAll();
      const entries = await new Promise<any[]>((resolve, reject) => {
        getAllRequest.onsuccess = () => resolve(getAllRequest.result);
        getAllRequest.onerror = () => reject(getAllRequest.error);
      });
      
      const validEntries = entries.filter(e => Date.now() <= e.expiresAt);
      const timestamps = validEntries.map(e => e.timestamp);
      
      return {
        entryCount: validEntries.length,
        sizeBytes: this.currentSize,
        hitRate: 0, // Not tracked for IndexedDB
        oldestEntry: timestamps.length > 0 ? new Date(Math.min(...timestamps)) : null,
        newestEntry: timestamps.length > 0 ? new Date(Math.max(...timestamps)) : null,
        evictionCount: 0 // Not tracked for IndexedDB
      };
    } catch (error) {
      log.error('Failed to get IndexedDB stats', error);
      return {
        entryCount: 0,
        sizeBytes: 0,
        hitRate: 0,
        oldestEntry: null,
        newestEntry: null,
        evictionCount: 0
      };
    }
  }

  /**
   * Clean up expired entries
   */
  async cleanupExpired(): Promise<number> {
    await this.ensureInitialized();
    
    try {
      const transaction = this.db!.transaction([this.storeName], 'readwrite');
      const store = transaction.objectStore(this.storeName);
      const index = store.index('expiresAt');
      const range = IDBKeyRange.upperBound(Date.now());
      const request = index.openCursor(range);
      
      let deletedCount = 0;
      
      await new Promise<void>((resolve, reject) => {
        request.onsuccess = () => {
          const cursor = request.result;
          if (cursor) {
            const entry = cursor.value;
            this.currentSize -= entry.size || 0;
            cursor.delete();
            deletedCount++;
            cursor.continue();
          } else {
            resolve();
          }
        };
        request.onerror = () => reject(request.error);
      });
      
      if (deletedCount > 0) {
        log.info(`Cleaned up ${deletedCount} expired IndexedDB entries`);
      }
      
      return deletedCount;
    } catch (error) {
      log.error('Failed to cleanup expired entries', error);
      return 0;
    }
  }

  /**
   * Ensure IndexedDB is initialized
   */
  private async ensureInitialized(): Promise<void> {
    if (!this.isInitialized) {
      await this.initialize();
    }
  }

  /**
   * Calculate current cache size
   */
  private async calculateCurrentSize(): Promise<void> {
    try {
      const transaction = this.db!.transaction([this.storeName], 'readonly');
      const store = transaction.objectStore(this.storeName);
      const request = store.getAll();
      
      const entries = await new Promise<any[]>((resolve, reject) => {
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      
      this.currentSize = entries.reduce((total, entry) => {
        return total + (entry.size || this.estimateSize(entry.data));
      }, 0);
    } catch (error) {
      log.error('Failed to calculate cache size', error);
      this.currentSize = 0;
    }
  }

  /**
   * Estimate size of data in bytes
   */
  private estimateSize(data: any): number {
    try {
      return new Blob([JSON.stringify(data)]).size;
    } catch {
      // Fallback estimation
      return JSON.stringify(data).length * 2; // Rough estimate for UTF-16
    }
  }

  /**
   * Evict oldest entries to make space
   */
  private async evictOldest(requiredSpace: number): Promise<void> {
    try {
      const transaction = this.db!.transaction([this.storeName], 'readwrite');
      const store = transaction.objectStore(this.storeName);
      const index = store.index('timestamp');
      const request = index.openCursor();
      
      let freedSpace = 0;
      
      await new Promise<void>((resolve, reject) => {
        request.onsuccess = () => {
          const cursor = request.result;
          if (cursor && freedSpace < requiredSpace) {
            const entry = cursor.value;
            freedSpace += entry.size || 0;
            this.currentSize -= entry.size || 0;
            cursor.delete();
            cursor.continue();
          } else {
            resolve();
          }
        };
        request.onerror = () => reject(request.error);
      });
      
      log.debug(`Evicted entries to free ${freedSpace} bytes`);
    } catch (error) {
      log.error('Failed to evict old entries', error);
    }
  }

  /**
   * Update hit count for an entry
   */
  private async updateHitCount(key: string): Promise<void> {
    try {
      const transaction = this.db!.transaction([this.storeName], 'readwrite');
      const store = transaction.objectStore(this.storeName);
      const request = store.get(key);
      
      const entry = await new Promise<any>((resolve, reject) => {
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      
      if (entry) {
        entry.hitCount = (entry.hitCount || 0) + 1;
        store.put(entry);
      }
    } catch (error) {
      // Non-critical error, just log
      log.debug('Failed to update hit count', { key, error });
    }
  }
}