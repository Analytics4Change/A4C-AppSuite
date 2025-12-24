/**
 * Role Service Factory
 *
 * Factory function that creates the appropriate role service based on
 * deployment mode configuration. This is the single point of control
 * for switching between mock and production implementations.
 *
 * Configuration via VITE_APP_MODE environment variable:
 * - "mock" - MockRoleService for fast local development
 * - "integration-auth" - MockRoleService (auth testing, no Supabase roles yet)
 * - "production" - SupabaseRoleService for production
 *
 * Usage:
 *   const roleService = getRoleService();
 *   const roles = await roleService.getRoles({ status: 'active' });
 *
 * @see IRoleService for interface documentation
 * @see MockRoleService for mock implementation
 * @see SupabaseRoleService for production implementation
 */

import type { IRoleService } from './IRoleService';
import { MockRoleService } from './MockRoleService';
import { SupabaseRoleService } from './SupabaseRoleService';
import { getDeploymentConfig } from '@/config/deployment.config';
import { Logger } from '@/utils/logger';

const log = Logger.getLogger('api');

/**
 * Role service types
 */
export type RoleServiceType = 'mock' | 'supabase';

/**
 * Get the configured role service type based on deployment mode
 */
export function getRoleServiceType(): RoleServiceType {
  const { useMockOrganizationUnit } = getDeploymentConfig();
  // Use same config as OU service - they share the same deployment modes
  return useMockOrganizationUnit ? 'mock' : 'supabase';
}

/**
 * Create and return the configured role service
 *
 * @returns Role service instance
 */
export function createRoleService(): IRoleService {
  const serviceType = getRoleServiceType();

  switch (serviceType) {
    case 'mock':
      log.info('Creating MockRoleService (mock data)');
      log.warn('Using mock role data - NOT for production!');
      return new MockRoleService();

    case 'supabase':
      log.info('Creating SupabaseRoleService (real data)');
      return new SupabaseRoleService();

    default:
      log.warn(`Unknown service type: ${serviceType}, defaulting to mock`);
      return new MockRoleService();
  }
}

/**
 * Singleton role service instance
 * Ensures only one service is created per application lifecycle
 */
let roleServiceInstance: IRoleService | null = null;

/**
 * Get the singleton role service instance
 * Creates the service on first call, returns cached instance on subsequent calls
 */
export function getRoleService(): IRoleService {
  if (!roleServiceInstance) {
    roleServiceInstance = createRoleService();
  }
  return roleServiceInstance;
}

/**
 * Reset the role service instance (useful for testing)
 * CAUTION: Only use this in tests or when intentionally switching services
 */
export function resetRoleService(): void {
  roleServiceInstance = null;
}

/**
 * Check if mock role service is active
 */
export function isMockRoleService(): boolean {
  return getRoleServiceType() === 'mock';
}

/**
 * Get human-readable service mode description
 */
export function getRoleServiceModeDescription(): string {
  const serviceType = getRoleServiceType();

  switch (serviceType) {
    case 'mock':
      return 'Mock Role Data (Development Mode)';
    case 'supabase':
      return import.meta.env.PROD
        ? 'Supabase Role Data (Production)'
        : 'Supabase Role Data (Integration Testing)';
    default:
      return 'Unknown Role Service Mode';
  }
}

/**
 * Log current role service configuration
 * Useful for debugging and ensuring correct service is loaded
 */
export function logRoleServiceConfig(): void {
  const mode = getRoleServiceModeDescription();
  const serviceType = getRoleServiceType();

  log.info('='.repeat(60));
  log.info('Role Service Configuration');
  log.info('='.repeat(60));
  log.info(`Service Type: ${serviceType}`);
  log.info(`Mode: ${mode}`);
  log.info(`Environment: ${import.meta.env.MODE}`);
  log.info(`Production: ${import.meta.env.PROD}`);

  if (serviceType === 'supabase') {
    log.info(`Supabase URL: ${import.meta.env.VITE_SUPABASE_URL}`);
  } else if (serviceType === 'mock') {
    log.info('Using localStorage-backed mock data (4 roles, 20+ permissions)');
  }

  log.info('='.repeat(60));
}
