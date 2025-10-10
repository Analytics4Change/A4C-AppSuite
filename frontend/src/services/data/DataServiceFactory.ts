import { IDosageDataService } from './interfaces/IDosageDataService';
import { StaticDosageDataService } from './StaticDosageDataService';

export class DataServiceFactory {
  private static dosageServiceInstance: IDosageDataService | null = null;

  /**
   * Creates or returns the singleton instance of IDosageDataService
   * Environment-based switching for future extensibility:
   * - Development: StaticDosageDataService
   * - Production: StaticDosageDataService (for now, can be changed to APIDataService later)
   * - Testing: Can be overridden with mock implementation
   */
  static createDosageDataService(): IDosageDataService {
    if (!this.dosageServiceInstance) {
      // For now, always return StaticDosageDataService
      // In the future, this can be environment-based:
      // if (import.meta.env.VITE_DATA_SOURCE === 'api') {
      //   this.dosageServiceInstance = new APIDosageDataService();
      // } else {
      //   this.dosageServiceInstance = new StaticDosageDataService();
      // }
      
      this.dosageServiceInstance = new StaticDosageDataService();
    }
    
    return this.dosageServiceInstance;
  }

  /**
   * Allows overriding the dosage service instance (useful for testing)
   */
  static setDosageDataService(service: IDosageDataService): void {
    this.dosageServiceInstance = service;
  }

  /**
   * Resets the singleton instance (useful for testing)
   */
  static resetInstances(): void {
    this.dosageServiceInstance = null;
  }
}