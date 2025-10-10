import { IOrganizationService } from './organization/IOrganizationService';
import { MockOrganizationService } from './organization/MockOrganizationService';
import { ProductionOrganizationService } from './organization/ProductionOrganizationService';
import { Logger } from '@/utils/logger';

const log = Logger.getLogger('main');

/**
 * Service Factory for Dependency Injection
 *
 * Provides centralized service instantiation based on environment configuration.
 * Enables easy switching between mock and production implementations.
 *
 * Environment Variables:
 * - VITE_USE_MOCK_ORGANIZATION: Set to 'true' to use mock organization service
 */
class ServiceFactory {
  private organizationService: IOrganizationService | null = null;

  /**
   * Get organization service instance
   *
   * Returns mock or production implementation based on environment.
   */
  getOrganizationService(): IOrganizationService {
    if (!this.organizationService) {
      const useMock = import.meta.env.VITE_USE_MOCK_ORGANIZATION === 'true';

      if (useMock) {
        log.info('Using MockOrganizationService (VITE_USE_MOCK_ORGANIZATION=true)');
        this.organizationService = new MockOrganizationService();
      } else {
        log.info('Using ProductionOrganizationService');
        this.organizationService = new ProductionOrganizationService();
      }
    }

    return this.organizationService;
  }

  /**
   * Reset all service instances
   * Useful for testing or when switching environments
   */
  reset(): void {
    this.organizationService = null;
    log.info('ServiceFactory reset');
  }
}

export const serviceFactory = new ServiceFactory();
