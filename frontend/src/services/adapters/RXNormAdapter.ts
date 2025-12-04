/**
 * Adapter for RXNorm displaynames API
 * Fetches and transforms medication data from NIH RXNorm service
 */

import { Medication } from '@/types/models';
import {
  RXNormDisplayNamesResponse,
  ControlledStatus,
  PsychotropicStatus,
  RXNormClassResponse,
  MedicationPurpose
} from '@/types/medication-search.types';
import { ResilientHttpClient } from '../http/ResilientHttpClient';
import { API_CONFIG } from '@/config/medication-search.config';
import { Logger } from '@/utils/logger';
import { normalizeMedicationDisplay } from '@/utils/stringHelpers';

const log = Logger.getLogger('api');

export class RXNormAdapter {
  private httpClient: ResilientHttpClient;
  private readonly baseUrl: string;
  private cachedDisplayNames: Medication[] | null = null;
  private lastFetchTime: number | null = null;
  private readonly cacheValidityPeriod = 6 * 60 * 60 * 1000; // 6 hours

  constructor() {
    this.httpClient = new ResilientHttpClient();
    this.baseUrl = API_CONFIG.rxnormBaseUrl + API_CONFIG.displayNamesEndpoint;
  }

  /**
   * Fetch all display names from RXNorm API
   * This is called once and cached for the session
   */
  async fetchDisplayNames(forceRefresh = false): Promise<Medication[]> {
    // Check if we have valid cached data
    if (!forceRefresh && this.cachedDisplayNames && this.lastFetchTime) {
      const age = Date.now() - this.lastFetchTime;
      if (age < this.cacheValidityPeriod) {
        log.debug('Using cached RXNorm display names', {
          age: Math.round(age / 1000 / 60) + ' minutes',
          count: this.cachedDisplayNames.length
        });
        return this.cachedDisplayNames;
      }
    }

    try {
      log.info('Fetching RXNorm display names...');
      const startTime = Date.now();

      // Fetch from RXNorm API
      const response = await this.httpClient.request<RXNormDisplayNamesResponse>({
        url: this.baseUrl,
        timeout: 30000, // 30 seconds for large payload
        retries: 2
      });

      // Process the response
      const medications = this.processDisplayNames(response);
      
      // Cache the results
      this.cachedDisplayNames = medications;
      this.lastFetchTime = Date.now();

      const fetchTime = Date.now() - startTime;
      log.info(`Fetched ${medications.length} medications from RXNorm in ${fetchTime}ms`);

      return medications;
    } catch (error) {
      log.error('Failed to fetch RXNorm display names', error);
      
      // Return cached data if available (even if stale)
      if (this.cachedDisplayNames) {
        log.warn('Using stale cached data due to API failure');
        return this.cachedDisplayNames;
      }

      // Return empty array as last resort
      return [];
    }
  }

  /**
   * Process and transform RXNorm response into Medication objects
   */
  private processDisplayNames(response: RXNormDisplayNamesResponse): Medication[] {
    try {
      // Extract medication names from response
      const displayNames = response.displayTermsList?.term || [];
      
      if (displayNames.length === 0) {
        log.warn('No medications found in RXNorm response');
        return [];
      }

      // Transform to Medication objects with deduplication
      const medicationMap = new Map<string, Medication>();
      
      for (const displayName of displayNames) {
        // The displayNames are strings directly
        if (!displayName || displayName.trim().length === 0) {
          continue;
        }

        // Apply sentence case formatting
        const name = normalizeMedicationDisplay(displayName);
        const key = name.toLowerCase();
        
        // Skip duplicates
        if (medicationMap.has(key)) {
          continue;
        }

        // Parse medication information from name
        const medication = this.parseMedicationInfo(name);
        medicationMap.set(key, medication);
      }

      // Convert to array and sort alphabetically
      const medications = Array.from(medicationMap.values())
        .sort((a, b) => a.name.localeCompare(b.name));

      log.debug(`Processed ${medications.length} unique medications from ${displayNames.length} display names`);
      
      return medications;
    } catch (error) {
      log.error('Error processing RXNorm display names', error);
      return [];
    }
  }

  /**
   * Parse medication information from display name
   * Extracts generic name, brand names, and other metadata
   */
  private parseMedicationInfo(displayName: string): Medication {
    // Generate a stable ID based on the name
    const id = this.generateMedicationId(displayName);
    
    // Extract generic and brand names (basic parsing)
    let genericName: string | undefined;
    let brandNames: string[] = [];
    
    // Check for common patterns like "Generic (Brand)" or "Brand [Generic]"
    const parenMatch = displayName.match(/^([^(]+)\s*\(([^)]+)\)/);
    const bracketMatch = displayName.match(/^([^[]+)\s*\[([^\]]+)\]/);
    
    if (parenMatch) {
      genericName = normalizeMedicationDisplay(parenMatch[1]);
      brandNames = [normalizeMedicationDisplay(parenMatch[2])];
    } else if (bracketMatch) {
      brandNames = [normalizeMedicationDisplay(bracketMatch[1])];
      genericName = normalizeMedicationDisplay(bracketMatch[2]);
    } else {
      // Use the display name as is (already formatted)
      genericName = displayName;
    }
    
    // Categorize the medication (simplified)
    const category = this.categorizeMedication(displayName);
    
    return {
      id,
      name: displayName,
      genericName,
      brandNames: brandNames.length > 0 ? brandNames : undefined,
      categories: category,
      flags: {
        isPsychotropic: false,
        isControlled: false,
        isNarcotic: false,
        requiresMonitoring: false
      }
    };
  }

  /**
   * Normalize medication name
   */
  private normalizeMedicationName(name: string): string {
    return name
      .trim()
      .replace(/\s+/g, ' ') // Normalize whitespace
      .replace(/^\W+|\W+$/g, ''); // Remove leading/trailing non-word characters
  }

  /**
   * Generate stable ID for medication
   */
  private generateMedicationId(name: string): string {
    // Simple hash function for generating IDs
    let hash = 0;
    for (let i = 0; i < name.length; i++) {
      const char = name.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32bit integer
    }
    return `rxnorm-${Math.abs(hash)}`;
  }

  /**
   * Categorize medication based on name patterns
   * This is a simplified categorization - in production, would use RxCUI for accurate classification
   */
  private categorizeMedication(name: string): { broad: string; specific: string } {
    const lowerName = name.toLowerCase();
    
    // Pain medications
    if (lowerName.includes('ibuprofen') || lowerName.includes('acetaminophen') || 
        lowerName.includes('aspirin') || lowerName.includes('naproxen')) {
      return { broad: 'Pain Management', specific: 'Analgesics' };
    }
    
    // Antibiotics
    if (lowerName.includes('amoxicillin') || lowerName.includes('azithromycin') ||
        lowerName.includes('ciprofloxacin') || lowerName.endsWith('cillin') ||
        lowerName.endsWith('mycin')) {
      return { broad: 'Antibiotics', specific: 'Antibacterial' };
    }
    
    // Cardiovascular
    if (lowerName.includes('atenolol') || lowerName.includes('lisinopril') ||
        lowerName.includes('metoprolol') || lowerName.endsWith('pril') ||
        lowerName.endsWith('olol')) {
      return { broad: 'Cardiovascular', specific: 'Heart Medications' };
    }
    
    // Diabetes
    if (lowerName.includes('metformin') || lowerName.includes('insulin') ||
        lowerName.includes('glipizide')) {
      return { broad: 'Diabetes', specific: 'Antidiabetic' };
    }
    
    // Mental Health
    if (lowerName.includes('sertraline') || lowerName.includes('fluoxetine') ||
        lowerName.includes('escitalopram') || lowerName.includes('lorazepam')) {
      return { broad: 'Mental Health', specific: 'Psychiatric' };
    }
    
    // Cholesterol
    if (lowerName.includes('atorvastatin') || lowerName.includes('simvastatin') ||
        lowerName.endsWith('statin')) {
      return { broad: 'Cardiovascular', specific: 'Cholesterol' };
    }
    
    // Default category
    return { broad: 'General', specific: 'Miscellaneous' };
  }

  /**
   * Get health status of the adapter
   */
  getHealthStatus() {
    return this.httpClient.getHealthStatus();
  }

  /**
   * Cancel all pending requests
   */
  cancelAllRequests() {
    this.httpClient.cancelAllRequests();
  }

  /**
   * Get medication purposes (diseases/conditions it treats/prevents)
   * Uses RXNorm class API with MEDRT source - matches A4C-BMS implementation
   */
  async getMedicationPurposes(drugName: string): Promise<MedicationPurpose[]> {
    try {
      log.debug(`Getting medication purposes for: ${drugName}`);
      
      // Use byDrugName endpoint with MEDRT disease classification
      const url = `${API_CONFIG.rxnormBaseUrl}/rxclass/class/byDrugName.json`;
      const params = new URLSearchParams({
        drugName,
        relaSource: 'MEDRT',
        relas: 'may_treat may_prevent'
      });
      
      const fullUrl = `${url}?${params.toString()}`;
      log.debug('Request URL:', fullUrl);
      
      const response = await this.httpClient.request<RXNormClassResponse>({
        url: fullUrl,
        timeout: 10000,
        retries: 1
      });

      log.debug('Medication purposes response:', response);

      // Extract disease/condition classes
      const drugInfo = response.rxclassDrugInfoList?.rxclassDrugInfo || [];
      const purposes: MedicationPurpose[] = [];
      const seenPurposes = new Set<string>(); // To avoid duplicates
      
      for (const info of drugInfo) {
        const className = info.rxclassMinConceptItem?.className;
        const classType = info.rxclassMinConceptItem?.classType;
        const rela = info.rela;
        
        if (className && !seenPurposes.has(className)) {
          seenPurposes.add(className);
          purposes.push({
            className,
            classType: classType || 'Disease',
            rela: rela || 'may_treat'
          });
        }
      }

      // Sort purposes alphabetically
      purposes.sort((a, b) => a.className.localeCompare(b.className));
      
      log.info(`Found ${purposes.length} purposes for ${drugName}`);
      return purposes;
    } catch (error) {
      log.error(`Failed to get medication purposes for ${drugName}`, error);
      return [];
    }
  }

  /**
   * Check if a medication is a controlled substance
   * Uses RXNorm class API to check for DEA schedule - matches A4C-BMS implementation
   */
  async checkControlledStatus(drugName: string): Promise<ControlledStatus> {
    try {
      log.debug(`Checking controlled status for: ${drugName}`);
      
      // Use byDrugName endpoint as in A4C-BMS
      const url = `${API_CONFIG.rxnormBaseUrl}/rxclass/class/byDrugName.json`;
      const params = new URLSearchParams({
        drugName,
        relaSource: 'RXNORM',
        relas: 'has_schedule'
      });
      
      const fullUrl = `${url}?${params.toString()}`;
      log.debug('Request URL:', fullUrl);
      
      const response = await this.httpClient.request<RXNormClassResponse>({
        url: fullUrl,
        timeout: 10000,
        retries: 1
      });

      log.debug('Controlled substance response:', response);

      // Check if any schedule classes exist
      const drugInfo = response.rxclassDrugInfoList?.rxclassDrugInfo || [];
      
      for (const info of drugInfo) {
        const className = info.rxclassMinConceptItem?.className;
        if (className) {
          // Extract schedule from class name (e.g., "Schedule II substance" -> "II")
          const scheduleMatch = className.match(/Schedule\s+([IVX]+)/i);
          if (scheduleMatch) {
            log.info(`Found controlled substance: ${drugName} is ${className}`);
            return {
              isControlled: true,
              scheduleClass: `Schedule ${scheduleMatch[1]}`
            };
          }
        }
      }

      // No schedule found - not controlled
      log.debug(`${drugName} is not a controlled substance`);
      return {
        isControlled: false
      };
    } catch (error) {
      log.error(`Failed to check controlled status for ${drugName}`, error);
      return {
        isControlled: false,
        error: 'Failed to check controlled status'
      };
    }
  }

  /**
   * Check if a medication is psychotropic
   * Uses RXNorm class API to check ATC codes - matches A4C-BMS implementation
   */
  async checkPsychotropicStatus(drugName: string): Promise<PsychotropicStatus> {
    try {
      log.debug(`Checking psychotropic status for: ${drugName}`);
      
      // Use byDrugName endpoint with ATC classification as in A4C-BMS
      const url = `${API_CONFIG.rxnormBaseUrl}/rxclass/class/byDrugName.json`;
      const params = new URLSearchParams({
        drugName,
        relaSource: 'ATC'
      });
      
      const fullUrl = `${url}?${params.toString()}`;
      log.debug('Request URL:', fullUrl);
      
      const response = await this.httpClient.request<RXNormClassResponse>({
        url: fullUrl,
        timeout: 10000,
        retries: 1
      });

      log.debug('Psychotropic response:', response);

      // Check for psychotropic ATC codes
      const drugInfo = response.rxclassDrugInfoList?.rxclassDrugInfo || [];
      const psychotropicATCs: string[] = [];
      let category: string | undefined;

      for (const info of drugInfo) {
        const classId = info.rxclassMinConceptItem?.classId;

        if (classId) {
          // Check if ATC code starts with N05 or N06 (psychotropic drugs)
          if (classId.startsWith('N05') || classId.startsWith('N06')) {
            psychotropicATCs.push(classId);
            
            // Determine category based on ATC code (matching A4C-BMS logic)
            if (!category) {
              if (classId.startsWith('N05A')) {
                category = 'Antipsychotic';
              } else if (classId.startsWith('N05B')) {
                category = 'Anxiolytic';
              } else if (classId.startsWith('N05C')) {
                category = 'Hypnotic/Sedative';
              } else if (classId.startsWith('N06A')) {
                category = 'Antidepressant';
              } else if (classId.startsWith('N06B')) {
                category = 'Psychostimulant';
              } else if (classId.startsWith('N06C')) {
                category = 'Combination Psychotropic';
              } else if (classId.startsWith('N06D')) {
                category = 'Anti-dementia';
              } else {
                category = 'Other Psychotropic';
              }
            }
          }
        }
      }

      if (psychotropicATCs.length > 0) {
        log.info(`Found psychotropic medication: ${drugName} - Category: ${category}`);
        return {
          isPsychotropic: true,
          atcCodes: psychotropicATCs,
          category
        };
      }

      // Not psychotropic
      log.debug(`${drugName} is not a psychotropic medication`);
      return {
        isPsychotropic: false
      };
    } catch (error) {
      log.error(`Failed to check psychotropic status for ${drugName}`, error);
      return {
        isPsychotropic: false,
        error: 'Failed to check psychotropic status'
      };
    }
  }

}