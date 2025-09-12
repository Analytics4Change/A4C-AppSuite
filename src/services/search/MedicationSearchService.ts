/**
 * Medication search service with fuzzy matching and caching
 * Orchestrates search across cache and RXNorm API
 */

import Fuse from 'fuse.js';
import { Medication } from '@/types/models';
import { SearchResult, SearchOptions } from '@/types/medication-search.types';
import { RXNormAdapter } from '../adapters/RXNormAdapter';
import { HybridCacheService } from '../cache/HybridCacheService';
import { API_CONFIG } from '@/config/medication-search.config';
import { Logger } from '@/utils/logger';

const log = Logger.getLogger('search');

export class MedicationSearchService {
  private rxnormAdapter: RXNormAdapter;
  private cacheService: HybridCacheService;
  private fuseIndex: Fuse<Medication> | null = null;
  private allMedications: Medication[] = [];
  private isInitialized = false;
  private initializationPromise: Promise<void> | null = null;

  constructor() {
    this.rxnormAdapter = new RXNormAdapter();
    this.cacheService = new HybridCacheService();
  }

  /**
   * Initialize the search service (lazy loading)
   */
  async initialize(): Promise<void> {
    if (this.isInitialized) {
      return;
    }

    // Prevent multiple simultaneous initializations
    if (this.initializationPromise) {
      return this.initializationPromise;
    }

    this.initializationPromise = this.doInitialize();
    await this.initializationPromise;
    this.initializationPromise = null;
  }

  /**
   * Perform the actual initialization
   */
  private async doInitialize(): Promise<void> {
    try {
      log.info('Initializing medication search service...');
      const startTime = Date.now();

      // Fetch medications from RXNorm
      this.allMedications = await this.rxnormAdapter.fetchDisplayNames();

      // Build Fuse.js search index
      this.buildSearchIndex();

      // Warm up cache with common prefixes
      await this.warmUpCache();

      this.isInitialized = true;
      const initTime = Date.now() - startTime;
      log.info(`Medication search service initialized in ${initTime}ms`, {
        medicationCount: this.allMedications.length
      });
    } catch (error) {
      log.error('Failed to initialize medication search service', error);
      // Service can still work with cache even if initialization fails
      this.isInitialized = true;
    }
  }

  /**
   * Search for medications
   */
  async search(query: string, options: SearchOptions = {}): Promise<SearchResult> {
    const startTime = Date.now();
    const normalizedQuery = query.trim().toLowerCase();

    // Validate query
    if (normalizedQuery.length < API_CONFIG.minSearchLength) {
      return {
        medications: [],
        source: 'memory',
        searchTime: Date.now() - startTime,
        query: normalizedQuery,
        timestamp: Date.now()
      };
    }

    // Check cache first
    const cachedResult = await this.cacheService.get(normalizedQuery);
    if (cachedResult) {
      log.debug('Returning cached result', { 
        query: normalizedQuery,
        source: cachedResult.source,
        count: cachedResult.medications.length
      });
      return cachedResult;
    }

    // Ensure service is initialized
    await this.initialize();

    // Perform search
    let medications: Medication[];
    
    if (this.fuseIndex && this.allMedications.length > 0) {
      medications = this.performFuzzySearch(normalizedQuery, options);
    } else {
      // Fallback to simple search if Fuse index not available
      medications = this.performSimpleSearch(normalizedQuery, options);
    }

    // Apply limit
    const limit = options.limit || API_CONFIG.maxSearchResults;
    medications = medications.slice(0, limit);

    // Cache the result
    await this.cacheService.set(normalizedQuery, medications);

    // Create result
    const result: SearchResult = {
      medications,
      source: 'api',
      searchTime: Date.now() - startTime,
      query: normalizedQuery,
      timestamp: Date.now()
    };

    log.debug('Search completed', {
      query: normalizedQuery,
      resultCount: medications.length,
      searchTime: result.searchTime
    });

    return result;
  }

  /**
   * Perform fuzzy search using Fuse.js with startsWith prioritization
   */
  private performFuzzySearch(query: string, options: SearchOptions): Medication[] {
    if (!this.fuseIndex) {
      return [];
    }

    const lowerQuery = query.toLowerCase();
    let results: Medication[] = [];

    // For very short queries (1-2 chars), use prefix matching only
    if (query.length <= 2) {
      results = this.allMedications.filter(med =>
        med.name.toLowerCase().startsWith(lowerQuery) ||
        (med.genericName && med.genericName.toLowerCase().startsWith(lowerQuery))
      );
    } else {
      // Get all medications that contain the substring
      const containsMatches = this.allMedications.filter(med => {
        const nameLower = med.name.toLowerCase();
        const genericLower = med.genericName?.toLowerCase();
        const brandsMatch = med.brandNames?.some(brand => 
          brand.toLowerCase().includes(lowerQuery)
        );
        
        return nameLower.includes(lowerQuery) || 
               genericLower?.includes(lowerQuery) || 
               brandsMatch;
      });

      // Separate into startsWith and contains groups
      const startsWithMatches: Medication[] = [];
      const containsOnlyMatches: Medication[] = [];

      containsMatches.forEach(med => {
        const nameLower = med.name.toLowerCase();
        const genericLower = med.genericName?.toLowerCase();
        
        if (nameLower.startsWith(lowerQuery) || 
            genericLower?.startsWith(lowerQuery)) {
          startsWithMatches.push(med);
        } else {
          containsOnlyMatches.push(med);
        }
      });

      // Sort each group alphabetically
      startsWithMatches.sort((a, b) => a.name.localeCompare(b.name));
      containsOnlyMatches.sort((a, b) => a.name.localeCompare(b.name));

      // Combine: startsWith first, then contains
      results = [...startsWithMatches, ...containsOnlyMatches];
    }

    // Apply limit
    const limit = options.limit || API_CONFIG.maxSearchResults;
    results = results.slice(0, limit);

    // If includeGenerics is false, filter out generic-only matches
    if (options.includeGenerics === false) {
      return results.filter(med => 
        med.name.toLowerCase().includes(lowerQuery) ||
        med.brandNames?.some(brand => brand.toLowerCase().includes(lowerQuery))
      );
    }

    // Store whether there's a single startsWith match for Enter key selection
    const startsWithCount = results.filter(med => {
      const nameLower = med.name.toLowerCase();
      const genericLower = med.genericName?.toLowerCase();
      return nameLower.startsWith(lowerQuery) || genericLower?.startsWith(lowerQuery);
    }).length;

    // Add metadata to results (we'll handle this in the component)
    results.forEach(med => {
      (med as any)._hasSingleStartsWithMatch = startsWithCount === 1;
      (med as any)._isStartsWithMatch = 
        med.name.toLowerCase().startsWith(lowerQuery) ||
        med.genericName?.toLowerCase().startsWith(lowerQuery);
    });

    return results;
  }

  /**
   * Perform simple search (fallback when Fuse is not available)
   */
  private performSimpleSearch(query: string, options: SearchOptions): Medication[] {
    const results = this.allMedications.filter(med => {
      const nameMatch = med.name.toLowerCase().includes(query);
      const genericMatch = med.genericName?.toLowerCase().includes(query);
      const brandMatch = med.brandNames?.some(brand => 
        brand.toLowerCase().includes(query)
      );

      if (options.includeGenerics === false) {
        return nameMatch || brandMatch;
      }

      return nameMatch || genericMatch || brandMatch;
    });

    // Sort by relevance (exact matches first)
    results.sort((a, b) => {
      const aExact = a.name.toLowerCase().startsWith(query);
      const bExact = b.name.toLowerCase().startsWith(query);
      
      if (aExact && !bExact) return -1;
      if (!aExact && bExact) return 1;
      
      return a.name.localeCompare(b.name);
    });

    return results;
  }

  /**
   * Build Fuse.js search index
   */
  private buildSearchIndex(): void {
    if (this.allMedications.length === 0) {
      log.warn('No medications to index');
      return;
    }

    const fuseOptions = {
      keys: [
        { name: 'name', weight: 0.6 },
        { name: 'genericName', weight: 0.3 },
        { name: 'brandNames', weight: 0.1 }
      ],
      threshold: API_CONFIG.fuzzySearchThreshold,
      includeScore: true,
      minMatchCharLength: API_CONFIG.fuzzySearchMinMatchLength,
      shouldSort: true,
      findAllMatches: false,
      ignoreLocation: true,
      useExtendedSearch: false
    };

    this.fuseIndex = new Fuse(this.allMedications, fuseOptions);
    log.info(`Search index built with ${this.allMedications.length} medications`);
  }

  /**
   * Warm up cache with common searches
   */
  private async warmUpCache(): Promise<void> {
    try {
      // Cache common single-letter and two-letter prefixes
      const commonPrefixes = [
        'a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'l', 'm', 
        'n', 'o', 'p', 'r', 's', 't', 'v', 'w', 'z',
        'as', 'at', 'bu', 'ca', 'ce', 'cl', 'co', 'di', 'do',
        'es', 'fl', 'ga', 'hy', 'ib', 'in', 'li', 'lo', 'me',
        'mo', 'na', 'ni', 'om', 'ox', 'pa', 'pr', 'se', 'si',
        'tr', 'va', 'vi', 'wa', 'zi'
      ];

      for (const prefix of commonPrefixes) {
        const results = this.performFuzzySearch(prefix, { limit: 50 });
        await this.cacheService.set(prefix, results, 7 * 24 * 60 * 60 * 1000); // 7 days
      }

      // Cache common medication names
      const commonMedications = [
        'aspirin', 'ibuprofen', 'acetaminophen', 'amoxicillin',
        'lisinopril', 'metformin', 'atorvastatin', 'metoprolol',
        'omeprazole', 'simvastatin', 'losartan', 'gabapentin',
        'sertraline', 'levothyroxine', 'amlodipine', 'prednisone'
      ];

      for (const med of commonMedications) {
        const results = this.performFuzzySearch(med, { limit: 15 });
        await this.cacheService.set(med, results, 7 * 24 * 60 * 60 * 1000); // 7 days
      }

      log.info('Cache warmed up with common searches');
    } catch (error) {
      log.error('Failed to warm up cache', error);
      // Non-critical error, continue
    }
  }

  /**
   * Clear all caches
   */
  async clearCache(): Promise<void> {
    await this.cacheService.clear();
  }

  /**
   * Get search statistics
   */
  async getStats() {
    const cacheStats = await this.cacheService.getStats();
    const healthStatus = this.rxnormAdapter.getHealthStatus();

    return {
      cache: cacheStats,
      health: healthStatus,
      search: {
        totalMedications: this.allMedications.length,
        isInitialized: this.isInitialized,
        hasSearchIndex: this.fuseIndex !== null
      }
    };
  }

  /**
   * Cancel all pending requests
   */
  cancelAllRequests(): void {
    this.rxnormAdapter.cancelAllRequests();
  }
}