/**
 * In-memory LRU cache for medication search results
 * Provides instant access to recently searched medications
 */

import { CacheEntry, CacheStats } from '@/types/medication-search.types';
import { Logger } from '@/utils/logger';

const log = Logger.getLogger('cache');

interface MemoryCacheOptions {
  maxEntries: number;
  ttl: number; // milliseconds
}

export class MemoryCache<K, V> {
  private cache: Map<K, CacheEntry<V>>;
  private accessOrder: K[];
  private readonly maxEntries: number;
  private readonly ttl: number;
  private hitCount = 0;
  private missCount = 0;
  private evictionCount = 0;

  constructor(options: MemoryCacheOptions) {
    this.cache = new Map();
    this.accessOrder = [];
    this.maxEntries = options.maxEntries;
    this.ttl = options.ttl;
    
    log.debug('MemoryCache initialized', {
      maxEntries: this.maxEntries,
      ttl: this.ttl
    });
  }

  /**
   * Get value from cache
   * Updates access order for LRU
   */
  get(key: K): V | null {
    const entry = this.cache.get(key);
    
    if (!entry) {
      this.missCount++;
      return null;
    }
    
    // Check if expired
    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      this.removeFromAccessOrder(key);
      this.missCount++;
      log.debug('Cache entry expired', { key });
      return null;
    }
    
    // Update access order (move to end)
    this.updateAccessOrder(key);
    
    // Update hit count
    entry.hitCount++;
    this.hitCount++;
    
    return entry.data;
  }

  /**
   * Set value in cache
   * Evicts LRU entry if cache is full
   */
  set(key: K, value: V, customTTL?: number): void {
    // Remove existing entry if present
    if (this.cache.has(key)) {
      this.removeFromAccessOrder(key);
    }
    
    // Evict LRU entry if cache is full
    if (this.cache.size >= this.maxEntries && !this.cache.has(key)) {
      this.evictLRU();
    }
    
    // Create new cache entry
    const entry: CacheEntry<V> = {
      data: value,
      timestamp: Date.now(),
      expiresAt: Date.now() + (customTTL || this.ttl),
      hitCount: 0
    };
    
    // Add to cache and access order
    this.cache.set(key, entry);
    this.accessOrder.push(key);
    
    log.debug('Cache entry added', {
      key,
      expiresAt: new Date(entry.expiresAt)
    });
  }

  /**
   * Check if key exists and is not expired
   */
  has(key: K): boolean {
    const entry = this.cache.get(key);
    if (!entry) return false;
    
    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      this.removeFromAccessOrder(key);
      return false;
    }
    
    return true;
  }

  /**
   * Delete specific entry
   */
  delete(key: K): boolean {
    const deleted = this.cache.delete(key);
    if (deleted) {
      this.removeFromAccessOrder(key);
    }
    return deleted;
  }

  /**
   * Clear all entries
   */
  clear(): void {
    this.cache.clear();
    this.accessOrder = [];
    log.info('Cache cleared');
  }

  /**
   * Get cache statistics
   */
  getStats(): CacheStats {
    const entries = Array.from(this.cache.values());
    const validEntries = entries.filter(e => Date.now() <= e.expiresAt);
    
    const timestamps = validEntries.map(e => e.timestamp);
    const oldestEntry = timestamps.length > 0 
      ? new Date(Math.min(...timestamps))
      : null;
    const newestEntry = timestamps.length > 0
      ? new Date(Math.max(...timestamps))
      : null;
    
    const totalRequests = this.hitCount + this.missCount;
    const hitRate = totalRequests > 0 ? this.hitCount / totalRequests : 0;
    
    // Estimate size (rough approximation)
    const sizeBytes = JSON.stringify(Array.from(this.cache.entries())).length;
    
    return {
      entryCount: validEntries.length,
      sizeBytes,
      hitRate,
      oldestEntry,
      newestEntry,
      evictionCount: this.evictionCount
    };
  }

  /**
   * Clean up expired entries
   */
  cleanupExpired(): number {
    const now = Date.now();
    let cleanedCount = 0;
    
    for (const [key, entry] of this.cache.entries()) {
      if (now > entry.expiresAt) {
        this.cache.delete(key);
        this.removeFromAccessOrder(key);
        cleanedCount++;
      }
    }
    
    if (cleanedCount > 0) {
      log.debug(`Cleaned up ${cleanedCount} expired entries`);
    }
    
    return cleanedCount;
  }

  /**
   * Update access order for LRU
   */
  private updateAccessOrder(key: K): void {
    const index = this.accessOrder.indexOf(key);
    if (index > -1) {
      this.accessOrder.splice(index, 1);
    }
    this.accessOrder.push(key);
  }

  /**
   * Remove from access order
   */
  private removeFromAccessOrder(key: K): void {
    const index = this.accessOrder.indexOf(key);
    if (index > -1) {
      this.accessOrder.splice(index, 1);
    }
  }

  /**
   * Evict least recently used entry
   */
  private evictLRU(): void {
    if (this.accessOrder.length === 0) return;
    
    const lruKey = this.accessOrder[0];
    this.cache.delete(lruKey);
    this.accessOrder.shift();
    this.evictionCount++;
    
    log.debug('Evicted LRU entry', { key: lruKey });
  }
}