import { IOrganizationService } from './organization/IOrganizationService';
import { MockOrganizationService } from './organization/MockOrganizationService';
import { ProductionOrganizationService } from './organization/ProductionOrganizationService';
import { getDeploymentConfig } from '@/config/deployment.config';
import { Logger } from '@/utils/logger';

const log = Logger.getLogger('main');

/**
 * Service Factory for Dependency Injection
 *
 * Provides centralized service instantiation based on deployment mode.
 * Service implementations are determined by VITE_APP_MODE environment variable.
 *
 * Modes:
 * - mock: All services use mock implementations (fast local dev)
 * - production: All services use production implementations (integration/prod)
 */
class ServiceFactory {
  private organizationService: IOrganizationService | null = null;

  /**
   * Get organization service instance
   *
   * Returns mock or production implementation based on deployment mode.
   */
  getOrganizationService(): IOrganizationService {
    if (!this.organizationService) {
      const { useMockOrganization } = getDeploymentConfig();

      if (useMockOrganization) {
        log.info('Using MockOrganizationService (VITE_APP_MODE=mock)');
        this.organizationService = new MockOrganizationService();
      } else {
        log.info('Using ProductionOrganizationService (VITE_APP_MODE=production)');
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
