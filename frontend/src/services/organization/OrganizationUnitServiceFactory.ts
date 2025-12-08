/**
 * Organizational Unit Service Factory
 *
 * Factory function that creates the appropriate organizational unit service
 * based on deployment mode configuration. This is the single point of control
 * for switching between mock and production implementations.
 *
 * Configuration via VITE_APP_MODE environment variable:
 * - "mock" - MockOrganizationUnitService for fast local development
 * - "integration-auth" - MockOrganizationUnitService (auth testing, no Supabase OU yet)
 * - "production" - SupabaseOrganizationUnitService for production
 *
 * Usage:
 *   const ouService = getOrganizationUnitService();
 *   const units = await ouService.getUnits({ status: 'active' });
 *
 * @see IOrganizationUnitService for interface documentation
 * @see MockOrganizationUnitService for mock implementation
 */

import type { IOrganizationUnitService } from './IOrganizationUnitService';
import { MockOrganizationUnitService } from './MockOrganizationUnitService';
import { SupabaseOrganizationUnitService } from './SupabaseOrganizationUnitService';
import { getDeploymentConfig } from '@/config/deployment.config';
import { Logger } from '@/utils/logger';

const log = Logger.getLogger('api');

/**
 * Organizational unit service types
 */
export type OrganizationUnitServiceType = 'mock' | 'supabase';

/**
 * Get the configured organizational unit service type based on deployment mode
 */
export function getOrganizationUnitServiceType(): OrganizationUnitServiceType {
  const { useMockOrganizationUnit } = getDeploymentConfig();
  return useMockOrganizationUnit ? 'mock' : 'supabase';
}

/**
 * Create and return the configured organizational unit service
 *
 * @returns Organizational unit service instance
 */
export function createOrganizationUnitService(): IOrganizationUnitService {
  const serviceType = getOrganizationUnitServiceType();

  switch (serviceType) {
    case 'mock':
      log.info('Creating MockOrganizationUnitService (mock data)');
      log.warn('Using mock organizational unit data - NOT for production!');
      return new MockOrganizationUnitService();

    case 'supabase':
      log.info('Creating SupabaseOrganizationUnitService (real data)');
      return new SupabaseOrganizationUnitService();

    default:
      log.warn(`Unknown service type: ${serviceType}, defaulting to mock`);
      return new MockOrganizationUnitService();
  }
}

/**
 * Singleton organizational unit service instance
 * Ensures only one service is created per application lifecycle
 */
let ouServiceInstance: IOrganizationUnitService | null = null;

/**
 * Get the singleton organizational unit service instance
 * Creates the service on first call, returns cached instance on subsequent calls
 */
export function getOrganizationUnitService(): IOrganizationUnitService {
  if (!ouServiceInstance) {
    ouServiceInstance = createOrganizationUnitService();
  }
  return ouServiceInstance;
}

/**
 * Reset the organizational unit service instance (useful for testing)
 * CAUTION: Only use this in tests or when intentionally switching services
 */
export function resetOrganizationUnitService(): void {
  ouServiceInstance = null;
}

/**
 * Check if mock organizational unit service is active
 */
export function isMockOrganizationUnitService(): boolean {
  return getOrganizationUnitServiceType() === 'mock';
}

/**
 * Get human-readable service mode description
 */
export function getOrganizationUnitServiceModeDescription(): string {
  const serviceType = getOrganizationUnitServiceType();

  switch (serviceType) {
    case 'mock':
      return 'Mock Organizational Unit Data (Development Mode)';
    case 'supabase':
      return import.meta.env.PROD
        ? 'Supabase Organizational Unit Data (Production)'
        : 'Supabase Organizational Unit Data (Integration Testing)';
    default:
      return 'Unknown Organizational Unit Service Mode';
  }
}

/**
 * Log current organizational unit service configuration
 * Useful for debugging and ensuring correct service is loaded
 */
export function logOrganizationUnitServiceConfig(): void {
  const mode = getOrganizationUnitServiceModeDescription();
  const serviceType = getOrganizationUnitServiceType();

  log.info('='.repeat(60));
  log.info('Organizational Unit Service Configuration');
  log.info('='.repeat(60));
  log.info(`Service Type: ${serviceType}`);
  log.info(`Mode: ${mode}`);
  log.info(`Environment: ${import.meta.env.MODE}`);
  log.info(`Production: ${import.meta.env.PROD}`);

  if (serviceType === 'supabase') {
    log.info(`Supabase URL: ${import.meta.env.VITE_SUPABASE_URL}`);
  } else if (serviceType === 'mock') {
    log.info('Using localStorage-backed mock data (8 organizational units including root)');
  }

  log.info('='.repeat(60));
}
