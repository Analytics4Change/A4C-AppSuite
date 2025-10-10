/**
 * Hybrid cache service that orchestrates memory and IndexedDB caches
 * Provides seamless fallback and optimal performance
 */

import { Medication } from '@/types/models';
import { SearchResult, CacheStats } from '@/types/medication-search.types';
import { MemoryCache } from './MemoryCache';
import { IndexedDBCache } from './IndexedDBCache';
import { getEnvironmentConfig } from '@/config/medication-search.config';
import { Logger } from '@/utils/logger';

const log = Logger.getLogger('cache');

export class HybridCacheService {
  private memoryCache: MemoryCache<string, Medication[]>;
  private indexedDBCache: IndexedDBCache<Medication[]>;
  private isIndexedDBAvailable = false;
  private readonly config = getEnvironmentConfig();

  constructor() {
    // Initialize memory cache
    this.memoryCache = new MemoryCache<string, Medication[]>({
      maxEntries: this.config.cache.maxMemoryEntries,
      ttl: this.config.cache.memoryTTL
    });

    // Initialize IndexedDB cache
    this.indexedDBCache = new IndexedDBCache<Medication[]>('searchCache');
    
    // Try to initialize IndexedDB (non-blocking)
    this.initializeIndexedDB();
    
    // Schedule periodic cleanup
    this.scheduleCleanup();
  }

  /**
   * Search for medications in cache
   * Implements fallback chain: memory -> IndexedDB -> null
   */
  async get(query: string): Promise<SearchResult | null> {
    const startTime = Date.now();
    const normalizedQuery = this.normalizeQuery(query);
    
    // 1. Try memory cache first (instant)
    const memoryResult = this.memoryCache.get(normalizedQuery);
    if (memoryResult) {
      log.debug('Memory cache hit', { query: normalizedQuery });
      return {
        medications: memoryResult,
        source: 'memory',
        searchTime: Date.now() - startTime,
        query: normalizedQuery,
        timestamp: Date.now()
      };
    }
    
    // 2. Try IndexedDB if available
    if (this.isIndexedDBAvailable) {
      try {
        const indexedDBResult = await this.indexedDBCache.get(normalizedQuery);
        if (indexedDBResult) {
          log.debug('IndexedDB cache hit', { query: normalizedQuery });
          
          // Populate memory cache for next time
          this.memoryCache.set(normalizedQuery, indexedDBResult);
          
          return {
            medications: indexedDBResult,
            source: 'indexeddb',
            searchTime: Date.now() - startTime,
            query: normalizedQuery,
            timestamp: Date.now()
          };
        }
      } catch (error) {
        log.error('IndexedDB read error', error);
        // Continue to return null
      }
    }
    
    log.debug('Cache miss', { query: normalizedQuery });
    return null;
  }

  /**
   * Store search results in both caches
   */
  async set(query: string, medications: Medication[], customTTL?: number): Promise<void> {
    const normalizedQuery = this.normalizeQuery(query);
    
    // Always update memory cache
    this.memoryCache.set(normalizedQuery, medications, customTTL);
    
    // Try to update IndexedDB if available
    if (this.isIndexedDBAvailable) {
      try {
        await this.indexedDBCache.set(normalizedQuery, medications, customTTL);
      } catch (error) {
        log.error('Failed to update IndexedDB cache', error);
        // Non-critical error, continue
      }
    }
    
    log.debug('Cache updated', {
      query: normalizedQuery,
      count: medications.length,
      ttl: customTTL || 'default'
    });
  }

  /**
   * Check if query is cached
   */
  async has(query: string): Promise<boolean> {
    const normalizedQuery = this.normalizeQuery(query);
    
    // Check memory first
    if (this.memoryCache.has(normalizedQuery)) {
      return true;
    }
    
    // Check IndexedDB if available
    if (this.isIndexedDBAvailable) {
      try {
        const result = await this.indexedDBCache.get(normalizedQuery);
        return result !== null;
      } catch {
        return false;
      }
    }
    
    return false;
  }

  /**
   * Delete specific cache entry
   */
  async delete(query: string): Promise<void> {
    const normalizedQuery = this.normalizeQuery(query);
    
    // Delete from memory
    this.memoryCache.delete(normalizedQuery);
    
    // Delete from IndexedDB if available
    if (this.isIndexedDBAvailable) {
      try {
        await this.indexedDBCache.delete(normalizedQuery);
      } catch (error) {
        log.error('Failed to delete from IndexedDB', error);
      }
    }
  }

  /**
   * Clear all caches
   */
  async clear(): Promise<void> {
    // Clear memory cache
    this.memoryCache.clear();
    
    // Clear IndexedDB if available
    if (this.isIndexedDBAvailable) {
      try {
        await this.indexedDBCache.clear();
      } catch (error) {
        log.error('Failed to clear IndexedDB', error);
      }
    }
    
    log.info('All caches cleared');
  }

  /**
   * Get combined cache statistics
   */
  async getStats(): Promise<{
    memory: CacheStats;
    indexedDB: CacheStats | null;
    combined: {
      totalEntries: number;
      totalSize: number;
      isIndexedDBAvailable: boolean;
    };
  }> {
    const memoryStats = this.memoryCache.getStats();
    
    let indexedDBStats: CacheStats | null = null;
    if (this.isIndexedDBAvailable) {
      try {
        indexedDBStats = await this.indexedDBCache.getStats();
      } catch (error) {
        log.error('Failed to get IndexedDB stats', error);
      }
    }
    
    return {
      memory: memoryStats,
      indexedDB: indexedDBStats,
      combined: {
        totalEntries: memoryStats.entryCount + (indexedDBStats?.entryCount || 0),
        totalSize: memoryStats.sizeBytes + (indexedDBStats?.sizeBytes || 0),
        isIndexedDBAvailable: this.isIndexedDBAvailable
      }
    };
  }

  /**
   * Warm up cache with common medications
   */
  async warmUp(commonMedications: Medication[]): Promise<void> {
    if (!commonMedications || commonMedications.length === 0) {
      return;
    }
    
    try {
      // Group medications by first letter for efficient caching
      const groupedMedications = this.groupMedicationsByPrefix(commonMedications);
      
      // Cache common prefixes
      for (const [prefix, meds] of Object.entries(groupedMedications)) {
        await this.set(prefix.toLowerCase(), meds, 7 * 24 * 60 * 60 * 1000); // 7 days
      }
      
      log.info(`Cache warmed up with ${commonMedications.length} medications`);
    } catch (error) {
      log.error('Failed to warm up cache', error);
    }
  }

  /**
   * Initialize IndexedDB (non-blocking)
   */
  private async initializeIndexedDB(): Promise<void> {
    try {
      // Check if IndexedDB is available
      if (!('indexedDB' in window)) {
        log.warn('IndexedDB not available');
        return;
      }
      
      await this.indexedDBCache.initialize();
      this.isIndexedDBAvailable = true;
      log.info('IndexedDB cache initialized successfully');
      
      // Clean up expired entries on startup
      await this.indexedDBCache.cleanupExpired();
    } catch (error) {
      log.error('Failed to initialize IndexedDB cache', error);
      this.isIndexedDBAvailable = false;
    }
  }

  /**
   * Schedule periodic cleanup
   */
  private scheduleCleanup(): void {
    // Run cleanup every hour
    setInterval(() => {
      this.runCleanup();
    }, 60 * 60 * 1000);
    
    // Also run cleanup on visibility change
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', () => {
        if (document.hidden) {
          this.runCleanup();
        }
      });
    }
  }

  /**
   * Run cleanup tasks
   */
  private async runCleanup(): Promise<void> {
    try {
      // Clean memory cache
      const memoryCleanedCount = this.memoryCache.cleanupExpired();
      
      // Clean IndexedDB if available
      let indexedDBCleanedCount = 0;
      if (this.isIndexedDBAvailable) {
        indexedDBCleanedCount = await this.indexedDBCache.cleanupExpired();
      }
      
      if (memoryCleanedCount > 0 || indexedDBCleanedCount > 0) {
        log.info('Cache cleanup completed', {
          memory: memoryCleanedCount,
          indexedDB: indexedDBCleanedCount
        });
      }
    } catch (error) {
      log.error('Cache cleanup failed', error);
    }
  }

  /**
   * Normalize query for consistent caching
   */
  private normalizeQuery(query: string): string {
    return query.trim().toLowerCase();
  }

  /**
   * Group medications by prefix for efficient caching
   */
  private groupMedicationsByPrefix(medications: Medication[]): Record<string, Medication[]> {
    const groups: Record<string, Medication[]> = {};
    
    for (const med of medications) {
      const prefix = med.name.substring(0, 2).toLowerCase();
      if (!groups[prefix]) {
        groups[prefix] = [];
      }
      groups[prefix].push(med);
    }
    
    return groups;
  }
}