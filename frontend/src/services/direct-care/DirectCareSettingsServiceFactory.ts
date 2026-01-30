/**
 * Direct Care Settings Service Factory
 *
 * Uses smart detection via getDeploymentConfig() to determine
 * whether to use mock or production implementation.
 *
 * @see RoleServiceFactory for the pattern being followed
 * @see deployment.config.ts for detection logic
 */

import type { IDirectCareSettingsService } from './IDirectCareSettingsService';
import { MockDirectCareSettingsService } from './MockDirectCareSettingsService';
import { SupabaseDirectCareSettingsService } from './SupabaseDirectCareSettingsService';
import { getDeploymentConfig } from '@/config/deployment.config';
import { Logger } from '@/utils/logger';

const log = Logger.getLogger('api');

export type DirectCareServiceType = 'mock' | 'supabase';

export function getDirectCareServiceType(): DirectCareServiceType {
  const { useMockOrganization } = getDeploymentConfig();
  return useMockOrganization ? 'mock' : 'supabase';
}

export function createDirectCareSettingsService(): IDirectCareSettingsService {
  const serviceType = getDirectCareServiceType();

  switch (serviceType) {
    case 'mock':
      log.info('Creating MockDirectCareSettingsService');
      return new MockDirectCareSettingsService();

    case 'supabase':
      log.info('Creating SupabaseDirectCareSettingsService');
      return new SupabaseDirectCareSettingsService();

    default:
      log.warn(`Unknown service type: ${serviceType}, defaulting to mock`);
      return new MockDirectCareSettingsService();
  }
}

let serviceInstance: IDirectCareSettingsService | null = null;

export function getDirectCareSettingsService(): IDirectCareSettingsService {
  if (!serviceInstance) {
    serviceInstance = createDirectCareSettingsService();
  }
  return serviceInstance;
}

export function resetDirectCareSettingsService(): void {
  serviceInstance = null;
}
