/**
 * Configuration for medication search functionality
 */

import { CacheConfig, CircuitBreakerConfig } from '@/types/medication-search.types';

/**
 * Cache configuration with iOS-safe limits
 */
export const CACHE_CONFIG: CacheConfig = {
  // Memory cache settings
  maxMemoryEntries: 100,
  memoryTTL: 30 * 60 * 1000, // 30 minutes
  
  // IndexedDB settings (iOS safe - 45MB limit)
  maxIndexedDBSize: 45 * 1024 * 1024, // 45MB
  indexedDBTTL: 24 * 60 * 60 * 1000, // 24 hours
  
  // Eviction policy
  evictionPolicy: 'lru'
};

/**
 * Circuit breaker configuration for API resilience
 */
export const CIRCUIT_BREAKER_CONFIG: CircuitBreakerConfig = {
  failureThreshold: 5,
  resetTimeout: 60 * 1000, // 1 minute
  halfOpenRequests: 3,
  monitoringPeriod: 10 * 60 * 1000 // 10 minutes
};

/**
 * API configuration
 */
export const API_CONFIG = {
  rxnormBaseUrl: 'https://rxnav.nlm.nih.gov/REST',
  displayNamesEndpoint: '/displaynames.json',
  requestTimeout: 10000, // 10 seconds
  maxRetries: 3,
  retryDelay: 1000, // 1 second
  
  // Search configuration
  searchDebounceMs: 300,
  minSearchLength: 1,
  maxSearchResults: 15,
  
  // Fuzzy search settings
  fuzzySearchThreshold: 0.3,
  fuzzySearchMinMatchLength: 2
};

/**
 * IndexedDB configuration
 */
export const INDEXED_DB_CONFIG = {
  dbName: 'MedicationSearchDB',
  version: 1,
  stores: {
    medications: 'medications',
    searchCache: 'searchCache',
    metadata: 'metadata'
  }
};

/**
 * Get environment-based configuration
 */
export const getEnvironmentConfig = () => {
  const isDevelopment = import.meta.env.DEV;
  const isTest = import.meta.env.MODE === 'test';
  const useRXNorm = import.meta.env.VITE_USE_RXNORM === 'true';
  
  return {
    isDevelopment,
    isTest,
    useRXNorm,
    
    // Override configurations for different environments
    cache: {
      ...CACHE_CONFIG,
      // Shorter TTL in development for testing
      memoryTTL: isDevelopment ? 5 * 60 * 1000 : CACHE_CONFIG.memoryTTL,
      indexedDBTTL: isDevelopment ? 60 * 60 * 1000 : CACHE_CONFIG.indexedDBTTL
    },
    
    api: {
      ...API_CONFIG,
      // Faster debounce in test environment
      searchDebounceMs: isTest ? 0 : API_CONFIG.searchDebounceMs
    }
  };
};