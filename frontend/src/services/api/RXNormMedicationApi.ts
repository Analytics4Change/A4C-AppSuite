/**
 * Production-ready RXNorm-based medication API implementation
 * Provides real medication data from NIH RXNorm service with robust caching
 */

import { IMedicationApi } from '@/services/api/interfaces/IMedicationApi';
import { Medication, MedicationHistory, DosageInfo } from '@/types/models';
import { MedicationSearchService } from '@/services/search/MedicationSearchService';
import { Logger } from '@/utils/logger';

const log = Logger.getLogger('api');

export class RXNormMedicationApi implements IMedicationApi {
  private searchService: MedicationSearchService;
  private medicationHistory: Map<string, MedicationHistory>;
  private medicationCache: Map<string, Medication>;
  private nextHistoryId = 1;

  constructor() {
    this.searchService = new MedicationSearchService();
    this.medicationHistory = new Map();
    this.medicationCache = new Map();
    
    // Initialize the search service in the background
    this.initialize();
  }

  /**
   * Initialize the search service (non-blocking)
   */
  private async initialize(): Promise<void> {
    try {
      await this.searchService.initialize();
      log.info('RXNorm medication API initialized');
    } catch (error) {
      log.error('Failed to initialize RXNorm medication API', error);
    }
  }

  /**
   * Search for medications using RXNorm data with fuzzy matching
   */
  async searchMedications(query: string): Promise<Medication[]> {
    try {
      // Handle empty query
      if (!query || query.trim().length === 0) {
        return [];
      }

      // Use the search service
      const result = await this.searchService.search(query, {
        limit: 50,
        includeGenerics: true
      });

      // Cache individual medications for getMedication
      result.medications.forEach(med => {
        this.medicationCache.set(med.id, med);
      });

      log.debug('Medication search completed', {
        query,
        resultCount: result.medications.length,
        source: result.source
      });

      return result.medications;
    } catch (error) {
      log.error('Medication search failed', { query, error });
      
      // Return empty array on error to maintain UI stability
      return [];
    }
  }

  /**
   * Get a specific medication by ID
   */
  async getMedication(id: string): Promise<Medication> {
    // Check cache first
    const cached = this.medicationCache.get(id);
    if (cached) {
      return cached;
    }

    // If not in cache, search for it
    // This is a fallback - typically medications should be cached from search
    const searchTerm = id.replace(/^rxnorm-/, '');
    const results = await this.searchMedications(searchTerm);
    
    const medication = results.find(med => med.id === id);
    if (!medication) {
      throw new Error(`Medication with id ${id} not found`);
    }

    // Cache for future use
    this.medicationCache.set(id, medication);
    
    return medication;
  }

  /**
   * Save medication to patient history
   */
  async saveMedication(dosageInfo: DosageInfo): Promise<void> {
    try {
      const medication = await this.getMedication(dosageInfo.medicationId);
      
      const history: MedicationHistory = {
        id: `history-${this.nextHistoryId++}`,
        medicationId: dosageInfo.medicationId,
        medication,
        startDate: dosageInfo.startDate || new Date(),
        discontinueDate: dosageInfo.discontinueDate,
        prescribingDoctor: dosageInfo.prescribingDoctor,
        dosageInfo,
        status: 'active'
      };
      
      this.medicationHistory.set(history.id, history);
      
      log.info('Medication saved to history', {
        medicationId: dosageInfo.medicationId,
        medicationName: medication.name
      });
    } catch (error) {
      log.error('Failed to save medication', { dosageInfo, error });
      throw new Error('Failed to save medication to history');
    }
  }

  /**
   * Get medication history for a client
   */
  async getMedicationHistory(clientId: string): Promise<MedicationHistory[]> {
    // Filter for active medications
    const activeHistory = Array.from(this.medicationHistory.values())
      .filter(h => h.status === 'active');
    
    log.debug('Retrieved medication history', {
      clientId,
      count: activeHistory.length
    });
    
    return activeHistory;
  }

  /**
   * Update existing medication in history
   */
  async updateMedication(id: string, dosageInfo: Partial<DosageInfo>): Promise<void> {
    const history = this.medicationHistory.get(id);
    if (!history) {
      throw new Error(`Medication history with id ${id} not found`);
    }
    
    history.dosageInfo = {
      ...history.dosageInfo,
      ...dosageInfo
    };
    
    // Update dates if provided
    if (dosageInfo.startDate) {
      history.startDate = dosageInfo.startDate;
    }
    if (dosageInfo.discontinueDate) {
      history.discontinueDate = dosageInfo.discontinueDate;
    }
    
    log.info('Medication updated', { id, changes: dosageInfo });
  }

  /**
   * Mark medication as discontinued
   */
  async deleteMedication(id: string): Promise<void> {
    const history = this.medicationHistory.get(id);
    if (!history) {
      throw new Error(`Medication history with id ${id} not found`);
    }
    
    history.status = 'discontinued';
    history.discontinueDate = new Date();
    
    log.info('Medication discontinued', {
      id,
      medicationName: history.medication.name
    });
  }

  /**
   * Clear all caches (useful for testing or memory management)
   */
  async clearCache(): Promise<void> {
    await this.searchService.clearCache();
    this.medicationCache.clear();
    log.info('All caches cleared');
  }

  /**
   * Get API health and statistics
   */
  async getHealthStatus() {
    return await this.searchService.getStats();
  }

  /**
   * Cancel all pending API requests
   */
  cancelAllRequests(): void {
    this.searchService.cancelAllRequests();
  }
}