/**
 * User Service Factory
 *
 * Factory functions that create the appropriate user services based on
 * deployment mode configuration. Single point of control for switching
 * between mock and production implementations.
 *
 * Configuration via VITE_APP_MODE environment variable:
 * - "mock" - Mock services for fast local development
 * - "integration-auth" - Mock services (auth testing, no Supabase users yet)
 * - "production" - Supabase services for production
 *
 * Usage:
 *   import { getUserQueryService, getUserCommandService } from '@/services/users';
 *
 *   const queryService = getUserQueryService();
 *   const users = await queryService.getUsersPaginated();
 *
 *   const commandService = getUserCommandService();
 *   await commandService.inviteUser(request);
 *
 * @see IUserQueryService for query interface documentation
 * @see IUserCommandService for command interface documentation
 */

import type { IUserQueryService } from './IUserQueryService';
import type { IUserCommandService } from './IUserCommandService';
import { MockUserQueryService } from './MockUserQueryService';
import { MockUserCommandService } from './MockUserCommandService';
import { SupabaseUserQueryService } from './SupabaseUserQueryService';
import { SupabaseUserCommandService } from './SupabaseUserCommandService';
import { getDeploymentConfig, getAppMode } from '@/config/deployment.config';
import { Logger } from '@/utils/logger';

const log = Logger.getLogger('api');

/**
 * User service types
 */
export type UserServiceType = 'mock' | 'supabase';

/**
 * Get the configured user service type based on deployment mode
 */
export function getUserServiceType(): UserServiceType {
  const { useMockInvitation } = getDeploymentConfig();
  // Use same config as invitation service - user management and invitations are coupled
  return useMockInvitation ? 'mock' : 'supabase';
}

/**
 * Singleton query service instance
 */
let queryServiceInstance: IUserQueryService | null = null;

/**
 * Singleton command service instance
 */
let commandServiceInstance: IUserCommandService | null = null;

/**
 * Create and return the configured user query service
 *
 * @returns User query service instance
 */
export function createUserQueryService(): IUserQueryService {
  const serviceType = getUserServiceType();

  switch (serviceType) {
    case 'mock':
      log.info('Creating MockUserQueryService (mock data)');
      log.warn('Using mock user data - NOT for production!');
      return new MockUserQueryService();

    case 'supabase':
      log.info('Creating SupabaseUserQueryService (real data)');
      return new SupabaseUserQueryService();

    default:
      log.warn(`Unknown service type: ${serviceType}, defaulting to mock`);
      return new MockUserQueryService();
  }
}

/**
 * Create and return the configured user command service
 *
 * Command service requires query service for data access (mock only)
 *
 * @param queryService Optional query service instance (uses singleton if not provided, mock only)
 * @returns User command service instance
 */
export function createUserCommandService(
  queryService?: MockUserQueryService
): IUserCommandService {
  const serviceType = getUserServiceType();

  switch (serviceType) {
    case 'mock': {
      log.info('Creating MockUserCommandService (mock operations)');
      // Get or create query service for mock
      const qs = queryService || (getUserQueryService() as MockUserQueryService);
      return new MockUserCommandService(qs);
    }

    case 'supabase':
      log.info('Creating SupabaseUserCommandService (real operations)');
      return new SupabaseUserCommandService();

    default: {
      log.warn(`Unknown service type: ${serviceType}, defaulting to mock`);
      const defaultQs = queryService || (getUserQueryService() as MockUserQueryService);
      return new MockUserCommandService(defaultQs);
    }
  }
}

/**
 * Get the singleton user query service instance
 * Creates the service on first call, returns cached instance on subsequent calls
 */
export function getUserQueryService(): IUserQueryService {
  if (!queryServiceInstance) {
    queryServiceInstance = createUserQueryService();
  }
  return queryServiceInstance;
}

/**
 * Get the singleton user command service instance
 * Creates the service on first call, returns cached instance on subsequent calls
 */
export function getUserCommandService(): IUserCommandService {
  if (!commandServiceInstance) {
    commandServiceInstance = createUserCommandService();
  }
  return commandServiceInstance;
}

/**
 * Reset the service instances (useful for testing)
 * CAUTION: Only use this in tests or when intentionally switching services
 */
export function resetUserServices(): void {
  queryServiceInstance = null;
  commandServiceInstance = null;
  log.debug('User service instances reset');
}

/**
 * Check if mock user services are active
 */
export function isMockUserService(): boolean {
  return getUserServiceType() === 'mock';
}

/**
 * Get human-readable service mode description
 */
export function getUserServiceModeDescription(): string {
  const serviceType = getUserServiceType();

  switch (serviceType) {
    case 'mock':
      return 'Mock User Data (Development Mode)';
    case 'supabase':
      return import.meta.env.PROD
        ? 'Supabase User Data (Production)'
        : 'Supabase User Data (Integration Testing)';
    default:
      return 'Unknown User Service Mode';
  }
}

/**
 * Log current user service configuration
 * Useful for debugging and ensuring correct service is loaded
 */
export function logUserServiceConfig(): void {
  const mode = getUserServiceModeDescription();
  const serviceType = getUserServiceType();

  log.info('='.repeat(60));
  log.info('User Service Configuration');
  log.info('='.repeat(60));
  log.info(`Service Type: ${serviceType}`);
  log.info(`Mode: ${mode}`);
  log.info(`Environment: ${import.meta.env.MODE}`);
  log.info(`Production: ${import.meta.env.PROD}`);
  log.info(`App Mode: ${getAppMode()}`);

  if (serviceType === 'supabase') {
    log.info(`Supabase URL: ${import.meta.env.VITE_SUPABASE_URL}`);
  } else if (serviceType === 'mock') {
    log.info('Using localStorage-backed mock data (6 users, 3 invitations)');
  }

  log.info('='.repeat(60));
}
