/**
 * Organization Query Service Factory
 *
 * Factory function that creates the appropriate organization query service
 * based on deployment mode configuration. This is the single point of control
 * for switching between mock and production organization query implementations.
 *
 * Configuration via VITE_APP_MODE environment variable:
 * - "mock" - MockOrganizationQueryService for fast local development
 * - "production" - SupabaseOrganizationQueryService for integration testing and production
 *
 * Usage:
 *   const orgQueryService = getOrganizationQueryService();
 *   const orgs = await orgQueryService.getOrganizations({ type: 'provider' });
 */

import type { IOrganizationQueryService } from './IOrganizationQueryService';
import { MockOrganizationQueryService } from './MockOrganizationQueryService';
import { SupabaseOrganizationQueryService } from './SupabaseOrganizationQueryService';
import { getDeploymentConfig } from '@/config/deployment.config';
import { Logger } from '@/utils/logger';

const log = Logger.getLogger('api');

/**
 * Organization query service types
 */
export type OrganizationQueryServiceType = 'mock' | 'supabase';

/**
 * Get the configured organization query service type based on deployment mode
 */
export function getOrganizationQueryServiceType(): OrganizationQueryServiceType {
  const { useMockOrganization } = getDeploymentConfig();
  return useMockOrganization ? 'mock' : 'supabase';
}

/**
 * Create and return the configured organization query service
 *
 * @returns Organization query service instance
 */
export function createOrganizationQueryService(): IOrganizationQueryService {
  const serviceType = getOrganizationQueryServiceType();

  switch (serviceType) {
    case 'mock':
      log.info('🔧 Creating MockOrganizationQueryService (mock data)');
      log.warn('⚠️  Using mock organization data - NOT for production!');
      return new MockOrganizationQueryService();

    case 'supabase':
      log.info('🔐 Creating SupabaseOrganizationQueryService (real data)');
      return new SupabaseOrganizationQueryService();

    default:
      log.warn(`Unknown service type: ${serviceType}, defaulting to Supabase`);
      return new SupabaseOrganizationQueryService();
  }
}

/**
 * Singleton organization query service instance
 * Ensures only one service is created per application lifecycle
 */
let orgQueryServiceInstance: IOrganizationQueryService | null = null;

/**
 * Get the singleton organization query service instance
 * Creates the service on first call, returns cached instance on subsequent calls
 */
export function getOrganizationQueryService(): IOrganizationQueryService {
  if (!orgQueryServiceInstance) {
    orgQueryServiceInstance = createOrganizationQueryService();
  }
  return orgQueryServiceInstance;
}

/**
 * Reset the organization query service instance (useful for testing)
 * CAUTION: Only use this in tests or when intentionally switching services
 */
export function resetOrganizationQueryService(): void {
  orgQueryServiceInstance = null;
}

/**
 * Check if mock organization service is active
 */
export function isMockOrganizationService(): boolean {
  return getOrganizationQueryServiceType() === 'mock';
}

/**
 * Get human-readable service mode description
 */
export function getOrganizationServiceModeDescription(): string {
  const serviceType = getOrganizationQueryServiceType();

  switch (serviceType) {
    case 'mock':
      return 'Mock Organization Data (Development Mode)';
    case 'supabase':
      return import.meta.env.PROD
        ? 'Supabase Organization Data (Production)'
        : 'Supabase Organization Data (Integration Testing)';
    default:
      return 'Unknown Organization Service Mode';
  }
}

/**
 * Log current organization service configuration
 * Useful for debugging and ensuring correct service is loaded
 */
export function logOrganizationServiceConfig(): void {
  const mode = getOrganizationServiceModeDescription();
  const serviceType = getOrganizationQueryServiceType();

  log.info('='.repeat(60));
  log.info('Organization Query Service Configuration');
  log.info('='.repeat(60));
  log.info(`Service Type: ${serviceType}`);
  log.info(`Mode: ${mode}`);
  log.info(`Environment: ${import.meta.env.MODE}`);
  log.info(`Production: ${import.meta.env.PROD}`);

  if (serviceType === 'supabase') {
    log.info(`Supabase URL: ${import.meta.env.VITE_SUPABASE_URL}`);
  } else if (serviceType === 'mock') {
    log.info('Using in-memory mock data (10 organizations)');
  }

  log.info('='.repeat(60));
}
