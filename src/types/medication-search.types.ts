/**
 * Types for medication search functionality
 */

import { Medication } from './models';

/**
 * RXNorm API response structure
 * The displaynames API returns an array of medication name strings
 */
export interface RXNormDisplayNamesResponse {
  displayTermsList: {
    term: string[];
  };
}

/**
 * Cache entry with metadata
 */
export interface CacheEntry<T> {
  data: T;
  timestamp: number;
  expiresAt: number;
  hitCount: number;
}

/**
 * Search result with metadata
 */
export interface SearchResult {
  medications: Medication[];
  source: 'memory' | 'indexeddb' | 'api' | 'fallback';
  searchTime: number;
  query: string;
  timestamp: number;
}

/**
 * Cache statistics for monitoring
 */
export interface CacheStats {
  entryCount: number;
  sizeBytes: number;
  hitRate: number;
  oldestEntry: Date | null;
  newestEntry: Date | null;
  evictionCount: number;
}

/**
 * Search options for medication search
 */
export interface SearchOptions {
  limit?: number;
  fuzzyMatch?: boolean;
  includeGenerics?: boolean;
  signal?: AbortSignal;
}

/**
 * Circuit breaker state
 */
export type CircuitState = 'closed' | 'open' | 'half-open';

/**
 * Circuit breaker configuration
 */
export interface CircuitBreakerConfig {
  failureThreshold: number;
  resetTimeout: number;
  halfOpenRequests: number;
  monitoringPeriod: number;
}

/**
 * HTTP request configuration
 */
export interface HttpRequestConfig {
  url: string;
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  headers?: Record<string, string>;
  timeout?: number;
  retries?: number;
  retryDelay?: number;
  signal?: AbortSignal;
}

/**
 * Cache configuration
 */
export interface CacheConfig {
  maxMemoryEntries: number;
  memoryTTL: number; // milliseconds
  maxIndexedDBSize: number; // bytes
  indexedDBTTL: number; // milliseconds
  evictionPolicy: 'lru' | 'lfu' | 'fifo';
}

/**
 * API health status
 */
export interface HealthStatus {
  isOnline: boolean;
  lastSuccessTime: Date | null;
  lastFailureTime: Date | null;
  failureCount: number;
  successRate: number;
  averageResponseTime: number;
}