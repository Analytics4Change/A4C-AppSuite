# Cache Service API

## Overview

The Cache Service API provides a sophisticated caching system for the A4C-FrontEnd application. It implements a hybrid approach combining in-memory caching for speed and IndexedDB for persistence, with intelligent fallback mechanisms and performance monitoring.

## Architecture

### Hybrid Cache Strategy

The cache service uses a two-tier architecture:

1. **Memory Cache (L1)**: Fast, volatile storage for frequently accessed data
2. **IndexedDB Cache (L2)**: Persistent storage for larger datasets and offline capability

```
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   Application   │───▶│  Memory Cache   │───▶│ IndexedDB Cache │
│                 │    │   (L1 - Fast)   │    │ (L2 - Persistent)│
└─────────────────┘    └─────────────────┘    └─────────────────┘
        ▲                        │                        │
        │                        ▼                        ▼
        └──────────────── Network Request ─────────────────┘
```

## Core Services

### HybridCacheService

The main cache orchestrator that coordinates between memory and persistent storage.

```typescript
class HybridCacheService {
  constructor(config?: CacheConfig);
  
  // Core operations
  async get(key: string): Promise<CacheResult | null>;
  async set(key: string, value: any, ttl?: number): Promise<void>;
  async delete(key: string): Promise<void>;
  async clear(): Promise<void>;
  
  // Cache management
  getStats(): CacheStats;
  async cleanup(): Promise<void>;
  
  // Health monitoring
  isHealthy(): boolean;
  getMetrics(): CacheMetrics;
}
```

### Usage Examples

#### Basic Caching Operations

```typescript
import { HybridCacheService } from '@/services/cache/HybridCacheService';

// Initialize cache service
const cacheService = new HybridCacheService({
  memory: {
    maxEntries: 1000,
    ttl: 300000 // 5 minutes
  },
  indexedDB: {
    dbName: 'AppCache',
    version: 1,
    maxSize: 50 * 1024 * 1024 // 50MB
  }
});

// Cache medication search results
await cacheService.set('search:lisinopril', medications, 3600); // 1 hour TTL

// Retrieve from cache
const cached = await cacheService.get('search:lisinopril');
if (cached) {
  console.log('Cache hit:', cached.data);
  console.log('Cache age:', Date.now() - cached.timestamp);
}

// Delete specific entry
await cacheService.delete('search:old-query');

// Clear all cache
await cacheService.clear();
```

#### Medication Search Integration

```typescript
class MedicationSearchService {
  constructor(
    private api: IMedicationApi,
    private cache: HybridCacheService
  ) {}

  async searchMedications(query: string): Promise<Medication[]> {
    const cacheKey = `search:${query.toLowerCase()}`;
    
    // Try cache first
    const cached = await this.cache.get(cacheKey);
    if (cached && !this.isCacheStale(cached)) {
      return cached.data;
    }

    // Fetch from API
    const medications = await this.api.searchMedications(query);
    
    // Cache the results
    await this.cache.set(cacheKey, medications, 3600); // 1 hour
    
    return medications;
  }

  private isCacheStale(cached: CacheResult): boolean {
    const age = Date.now() - cached.timestamp;
    return age > 3600000; // 1 hour
  }
}
```

#### Form Data Persistence

```typescript
class FormCacheService {
  constructor(private cache: HybridCacheService) {}

  async saveFormDraft(formId: string, data: any): Promise<void> {
    const key = `form_draft:${formId}`;
    await this.cache.set(key, {
      data,
      savedAt: new Date().toISOString(),
      userId: getCurrentUserId()
    }, 86400); // 24 hours
  }

  async loadFormDraft(formId: string): Promise<any | null> {
    const key = `form_draft:${formId}`;
    const cached = await this.cache.get(key);
    
    if (cached && this.isValidDraft(cached.data)) {
      return cached.data.data;
    }
    
    return null;
  }

  async clearFormDraft(formId: string): Promise<void> {
    await this.cache.delete(`form_draft:${formId}`);
  }

  private isValidDraft(draft: any): boolean {
    return draft && 
           draft.userId === getCurrentUserId() &&
           draft.savedAt &&
           new Date(draft.savedAt) > new Date(Date.now() - 86400000);
  }
}
```

#### Client Information Caching

```typescript
class ClientCacheService {
  constructor(private cache: HybridCacheService) {}

  async cacheClient(client: Client): Promise<void> {
    const key = `client:${client.id}`;
    await this.cache.set(key, client, 1800); // 30 minutes
  }

  async getCachedClient(clientId: string): Promise<Client | null> {
    const key = `client:${clientId}`;
    const cached = await this.cache.get(key);
    return cached?.data || null;
  }

  async cacheClientList(clients: Client[]): Promise<void> {
    // Cache individual clients
    await Promise.all(
      clients.map(client => this.cacheClient(client))
    );
    
    // Cache the list
    await this.cache.set('clients:list', clients, 600); // 10 minutes
  }

  async invalidateClient(clientId: string): Promise<void> {
    await this.cache.delete(`client:${clientId}`);
    await this.cache.delete('clients:list'); // Invalidate list too
  }
}
```

## Memory Cache (L1)

### MemoryCache

Fast, in-memory storage with LRU eviction and TTL support.

```typescript
interface MemoryCacheConfig {
  maxEntries: number;
  ttl: number; // Time to live in milliseconds
  cleanupInterval?: number;
}

class MemoryCache<K, V> {
  constructor(config: MemoryCacheConfig);
  
  get(key: K): V | null;
  set(key: K, value: V, ttl?: number): void;
  delete(key: K): boolean;
  clear(): void;
  size(): number;
  
  // LRU management
  private evictLRU(): void;
  private updateAccess(key: K): void;
}
```

#### Usage Example

```typescript
const memoryCache = new MemoryCache<string, Medication[]>({
  maxEntries: 500,
  ttl: 300000, // 5 minutes
  cleanupInterval: 60000 // Cleanup every minute
});

// Set with custom TTL
memoryCache.set('frequent-searches', medications, 600000); // 10 minutes

// Get data
const cached = memoryCache.get('frequent-searches');

// Check size and manage capacity
console.log(`Cache size: ${memoryCache.size()}/500`);
```

## IndexedDB Cache (L2)

### IndexedDBCache

Persistent browser storage for larger datasets and offline capabilities.

```typescript
interface IndexedDBConfig {
  dbName: string;
  version: number;
  storeName?: string;
  maxSize?: number;
}

class IndexedDBCache<T> {
  constructor(config: IndexedDBConfig);
  
  async get(key: string): Promise<CacheEntry<T> | null>;
  async set(key: string, value: T, ttl?: number): Promise<void>;
  async delete(key: string): Promise<void>;
  async clear(): Promise<void>;
  async getAllKeys(): Promise<string[]>;
  
  // Storage management
  async getStorageUsed(): Promise<number>;
  async cleanupExpired(): Promise<number>;
}
```

#### Usage Example

```typescript
const indexedDBCache = new IndexedDBCache<SearchResult>({
  dbName: 'MedicationApp',
  version: 1,
  storeName: 'searchCache',
  maxSize: 100 * 1024 * 1024 // 100MB
});

// Store large dataset
await indexedDBCache.set('all-medications', allMedications, 86400); // 24 hours

// Retrieve with error handling
try {
  const cached = await indexedDBCache.get('all-medications');
  if (cached && !isExpired(cached)) {
    return cached.data;
  }
} catch (error) {
  console.warn('IndexedDB unavailable, falling back to network');
}

// Cleanup expired entries
const removedCount = await indexedDBCache.cleanupExpired();
console.log(`Cleaned up ${removedCount} expired entries`);
```

## Data Types

### CacheResult

```typescript
interface CacheResult<T = any> {
  data: T;
  timestamp: number;
  ttl: number;
  source: 'memory' | 'indexeddb';
  hitCount?: number;
}
```

### CacheEntry

```typescript
interface CacheEntry<T> {
  key: string;
  value: T;
  timestamp: number;
  expiresAt: number;
  accessCount: number;
  size?: number;
}
```

### CacheStats

```typescript
interface CacheStats {
  memory: {
    entries: number;
    maxEntries: number;
    hitRate: number;
    missRate: number;
    totalSize: number;
  };
  indexedDB: {
    entries: number;
    storageUsed: number;
    maxSize: number;
    hitRate: number;
    missRate: number;
  };
  overall: {
    totalHits: number;
    totalMisses: number;
    combinedHitRate: number;
  };
}
```

### CacheMetrics

```typescript
interface CacheMetrics {
  operations: {
    gets: number;
    sets: number;
    deletes: number;
    clears: number;
  };
  performance: {
    averageGetTime: number;
    averageSetTime: number;
    memoryOperationTime: number;
    indexedDBOperationTime: number;
  };
  health: {
    memoryAvailable: boolean;
    indexedDBAvailable: boolean;
    errorRate: number;
    lastError?: string;
  };
}
```

## Configuration

### Environment-based Setup

```typescript
// src/config/cache.config.ts
interface CacheConfig {
  memory: {
    maxEntries: number;
    ttl: number;
    cleanupInterval: number;
  };
  indexedDB: {
    enabled: boolean;
    dbName: string;
    version: number;
    maxSize: number;
  };
  fallback: {
    enableNetworkCache: boolean;
    maxRetries: number;
  };
}

export const getCacheConfig = (): CacheConfig => ({
  memory: {
    maxEntries: parseInt(import.meta.env.VITE_CACHE_MEMORY_MAX_ENTRIES || '1000'),
    ttl: parseInt(import.meta.env.VITE_CACHE_MEMORY_TTL || '300000'),
    cleanupInterval: parseInt(import.meta.env.VITE_CACHE_CLEANUP_INTERVAL || '60000')
  },
  indexedDB: {
    enabled: import.meta.env.VITE_CACHE_INDEXEDDB_ENABLED !== 'false',
    dbName: import.meta.env.VITE_CACHE_DB_NAME || 'A4CCache',
    version: parseInt(import.meta.env.VITE_CACHE_DB_VERSION || '1'),
    maxSize: parseInt(import.meta.env.VITE_CACHE_MAX_SIZE || '104857600') // 100MB
  },
  fallback: {
    enableNetworkCache: import.meta.env.VITE_CACHE_NETWORK_FALLBACK === 'true',
    maxRetries: parseInt(import.meta.env.VITE_CACHE_MAX_RETRIES || '3')
  }
});
```

### Cache Factory

```typescript
// src/services/cache/CacheFactory.ts
export class CacheFactory {
  static createHybridCache(config?: Partial<CacheConfig>): HybridCacheService {
    const fullConfig = { ...getCacheConfig(), ...config };
    return new HybridCacheService(fullConfig);
  }

  static createMemoryOnlyCache(maxEntries = 500): MemoryCache<string, any> {
    return new MemoryCache({
      maxEntries,
      ttl: 300000, // 5 minutes
      cleanupInterval: 60000
    });
  }

  static createPersistentCache(dbName = 'AppCache'): IndexedDBCache<any> {
    return new IndexedDBCache({
      dbName,
      version: 1,
      maxSize: 50 * 1024 * 1024 // 50MB
    });
  }
}
```

## Performance Optimization

### Cache Warming

```typescript
class CacheWarmingService {
  constructor(
    private cache: HybridCacheService,
    private medicationApi: IMedicationApi
  ) {}

  async warmFrequentSearches(): Promise<void> {
    const frequentQueries = [
      'lisinopril', 'metformin', 'amlodipine', 'omeprazole', 'atorvastatin'
    ];

    // Warm cache with popular searches
    await Promise.all(
      frequentQueries.map(async (query) => {
        try {
          const results = await this.medicationApi.searchMedications(query);
          await this.cache.set(`search:${query}`, results, 7200); // 2 hours
        } catch (error) {
          console.warn(`Failed to warm cache for query: ${query}`);
        }
      })
    );
  }

  async preloadUserData(userId: string): Promise<void> {
    try {
      // Preload user's recent searches
      const recentSearches = await this.getUserRecentSearches(userId);
      await Promise.all(
        recentSearches.map(query => this.preloadSearch(query))
      );

      // Preload user's medications
      const userMedications = await this.getUserMedications(userId);
      await this.cache.set(`user_medications:${userId}`, userMedications, 3600);
    } catch (error) {
      console.warn('Failed to preload user data:', error);
    }
  }

  private async preloadSearch(query: string): Promise<void> {
    const cached = await this.cache.get(`search:${query}`);
    if (!cached) {
      const results = await this.medicationApi.searchMedications(query);
      await this.cache.set(`search:${query}`, results, 3600);
    }
  }
}
```

### Cache Invalidation Strategies

```typescript
class CacheInvalidationService {
  constructor(private cache: HybridCacheService) {}

  // Time-based invalidation
  async invalidateExpired(): Promise<number> {
    const stats = this.cache.getStats();
    const cleanedMemory = await this.cache.memoryCache.cleanupExpired();
    const cleanedIndexedDB = await this.cache.indexedDBCache.cleanupExpired();
    
    return cleanedMemory + cleanedIndexedDB;
  }

  // Pattern-based invalidation
  async invalidateByPattern(pattern: string): Promise<void> {
    const regex = new RegExp(pattern);
    const keys = await this.cache.getAllKeys();
    
    const keysToDelete = keys.filter(key => regex.test(key));
    await Promise.all(
      keysToDelete.map(key => this.cache.delete(key))
    );
  }

  // Event-driven invalidation
  async onDataUpdate(entityType: string, entityId: string): Promise<void> {
    switch (entityType) {
      case 'medication':
        await this.invalidateByPattern(`search:.*`); // Invalidate all searches
        await this.cache.delete(`medication:${entityId}`);
        break;
      
      case 'client':
        await this.cache.delete(`client:${entityId}`);
        await this.cache.delete('clients:list');
        break;
      
      default:
        console.warn(`Unknown entity type for cache invalidation: ${entityType}`);
    }
  }
}
```

## Testing

### Unit Tests

```typescript
// src/services/cache/__tests__/HybridCacheService.test.ts
describe('HybridCacheService', () => {
  let cacheService: HybridCacheService;

  beforeEach(() => {
    cacheService = new HybridCacheService({
      memory: { maxEntries: 100, ttl: 1000 },
      indexedDB: { enabled: false } // Disable for unit tests
    });
  });

  afterEach(async () => {
    await cacheService.clear();
  });

  describe('basic operations', () => {
    it('should store and retrieve data', async () => {
      const testData = { name: 'Lisinopril', id: '123' };
      
      await cacheService.set('test-key', testData);
      const result = await cacheService.get('test-key');
      
      expect(result).toBeTruthy();
      expect(result!.data).toEqual(testData);
      expect(result!.source).toBe('memory');
    });

    it('should respect TTL', async () => {
      const testData = { name: 'Expired' };
      
      await cacheService.set('expire-test', testData, 100); // 100ms TTL
      
      // Should be available immediately
      let result = await cacheService.get('expire-test');
      expect(result).toBeTruthy();
      
      // Should be expired after TTL
      await new Promise(resolve => setTimeout(resolve, 150));
      result = await cacheService.get('expire-test');
      expect(result).toBeNull();
    });

    it('should handle cache misses gracefully', async () => {
      const result = await cacheService.get('non-existent-key');
      expect(result).toBeNull();
    });
  });

  describe('performance', () => {
    it('should prioritize memory cache over IndexedDB', async () => {
      const testData = { name: 'Performance Test' };
      
      // Set in memory cache
      await cacheService.set('perf-test', testData);
      
      const startTime = Date.now();
      const result = await cacheService.get('perf-test');
      const endTime = Date.now();
      
      expect(result!.source).toBe('memory');
      expect(endTime - startTime).toBeLessThan(10); // Should be very fast
    });
  });

  describe('error handling', () => {
    it('should fallback gracefully when IndexedDB fails', async () => {
      // Mock IndexedDB failure
      jest.spyOn(cacheService.indexedDBCache, 'get').mockRejectedValue(new Error('IndexedDB error'));
      
      const testData = { name: 'Fallback Test' };
      await cacheService.set('fallback-test', testData);
      
      const result = await cacheService.get('fallback-test');
      expect(result!.source).toBe('memory');
    });
  });
});
```

### Integration Tests

```typescript
// src/services/cache/__tests__/cache-integration.test.ts
describe('Cache Integration', () => {
  let medicationService: MedicationSearchService;
  let cacheService: HybridCacheService;

  beforeEach(() => {
    cacheService = new HybridCacheService();
    medicationService = new MedicationSearchService(mockApi, cacheService);
  });

  it('should cache medication search results', async () => {
    const query = 'lisinopril';
    
    // First call should hit the API
    const results1 = await medicationService.searchMedications(query);
    expect(mockApi.searchMedications).toHaveBeenCalledTimes(1);
    
    // Second call should hit the cache
    const results2 = await medicationService.searchMedications(query);
    expect(mockApi.searchMedications).toHaveBeenCalledTimes(1); // No additional API call
    expect(results2).toEqual(results1);
  });

  it('should handle cache invalidation correctly', async () => {
    await medicationService.searchMedications('test-query');
    
    // Invalidate cache
    await cacheService.clear();
    
    // Should hit API again
    await medicationService.searchMedications('test-query');
    expect(mockApi.searchMedications).toHaveBeenCalledTimes(2);
  });
});
```

## Best Practices

### Cache Key Strategies

```typescript
// Consistent cache key naming
class CacheKeyBuilder {
  static medicationSearch(query: string): string {
    return `search:medication:${query.toLowerCase().trim()}`;
  }

  static client(clientId: string): string {
    return `client:${clientId}`;
  }

  static clientList(): string {
    return 'clients:list';
  }

  static userMedications(userId: string): string {
    return `user_medications:${userId}`;
  }

  static formDraft(formId: string, userId: string): string {
    return `form_draft:${formId}:${userId}`;
  }

  static withVersion(baseKey: string, version: string): string {
    return `${baseKey}:v${version}`;
  }
}
```

### Monitoring and Observability

```typescript
class CacheMonitor {
  constructor(private cache: HybridCacheService) {}

  startMonitoring(): void {
    setInterval(() => {
      const stats = this.cache.getStats();
      const metrics = this.cache.getMetrics();
      
      // Log performance metrics
      console.log('Cache Performance:', {
        hitRate: stats.overall.combinedHitRate,
        memoryUsage: stats.memory.totalSize,
        indexedDBUsage: stats.indexedDB.storageUsed,
        avgGetTime: metrics.performance.averageGetTime
      });

      // Alert on poor performance
      if (stats.overall.combinedHitRate < 0.7) {
        console.warn('Cache hit rate below threshold:', stats.overall.combinedHitRate);
      }

      if (metrics.health.errorRate > 0.05) {
        console.error('Cache error rate too high:', metrics.health.errorRate);
      }
    }, 60000); // Every minute
  }

  generateReport(): CacheReport {
    const stats = this.cache.getStats();
    const metrics = this.cache.getMetrics();
    
    return {
      timestamp: new Date().toISOString(),
      performance: {
        hitRate: stats.overall.combinedHitRate,
        averageResponseTime: metrics.performance.averageGetTime,
        memoryEfficiency: stats.memory.entries / stats.memory.maxEntries
      },
      capacity: {
        memoryUtilization: stats.memory.entries / stats.memory.maxEntries,
        indexedDBUtilization: stats.indexedDB.storageUsed / stats.indexedDB.maxSize
      },
      health: metrics.health,
      recommendations: this.generateRecommendations(stats, metrics)
    };
  }

  private generateRecommendations(stats: CacheStats, metrics: CacheMetrics): string[] {
    const recommendations: string[] = [];
    
    if (stats.overall.combinedHitRate < 0.8) {
      recommendations.push('Consider increasing cache TTL or warming more frequently');
    }
    
    if (stats.memory.entries / stats.memory.maxEntries > 0.9) {
      recommendations.push('Memory cache near capacity, consider increasing maxEntries');
    }
    
    if (metrics.health.errorRate > 0.02) {
      recommendations.push('High error rate detected, check cache health');
    }
    
    return recommendations;
  }
}
```

## Changelog

- **v1.0.0**: Initial implementation with memory cache only
- **v1.1.0**: Added IndexedDB cache for persistence
- **v1.2.0**: Implemented hybrid cache strategy with fallback
- **v1.3.0**: Added cache warming and preloading capabilities
- **v1.4.0**: Enhanced monitoring and performance metrics
- **v1.5.0**: Added intelligent invalidation strategies
- **v1.6.0**: Improved error handling and resilience