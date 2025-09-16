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

/**
 * Controlled substance status from RXNorm
 */
export interface ControlledStatus {
  isControlled: boolean;
  scheduleClass?: string; // DEA Schedule I-V
  error?: string;
}

/**
 * Psychotropic medication status from RXNorm
 */
export interface PsychotropicStatus {
  isPsychotropic: boolean;
  atcCodes?: string[];
  category?: string; // e.g., "Anxiolytic", "Antipsychotic", "Antidepressant"
  error?: string;
}

/**
 * RXNorm relations API response for controlled status
 */
export interface RXNormRelationsResponse {
  relatedGroup?: {
    conceptGroup?: Array<{
      tty?: string;
      conceptProperties?: Array<{
        rxcui?: string;
        name?: string;
        synonym?: string;
        tty?: string;
        language?: string;
        suppress?: string;
        umlscui?: string;
      }>;
    }>;
  };
}

/**
 * RXNorm class API response for ATC codes
 */
export interface RXNormClassResponse {
  rxclassDrugInfoList?: {
    rxclassDrugInfo?: Array<{
      minConcept?: {
        rxcui?: string;
        name?: string;
        tty?: string;
      };
      rxclassMinConceptItem?: {
        classId?: string;
        className?: string;
        classType?: string;
      };
      rela?: string;
      relaSource?: string;
    }>;
  };
}

/**
 * Medication purpose/therapeutic classification from RXNorm
 */
export interface MedicationPurpose {
  className: string;
  classType: string;
  rela: string; // may_treat or may_prevent
}