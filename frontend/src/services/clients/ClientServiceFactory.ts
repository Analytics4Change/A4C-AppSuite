/**
 * Client Service Factory
 *
 * Uses smart detection via getDeploymentConfig() to determine
 * whether to use mock or production implementation.
 */

import type { IClientService } from './IClientService';
import { MockClientService } from './MockClientService';
import { SupabaseClientService } from './SupabaseClientService';
import { getDeploymentConfig } from '@/config/deployment.config';
import { Logger } from '@/utils/logger';

const log = Logger.getLogger('api');

export type ClientServiceType = 'mock' | 'supabase';

export function getClientServiceType(): ClientServiceType {
  const { useMockOrganization } = getDeploymentConfig();
  return useMockOrganization ? 'mock' : 'supabase';
}

export function createClientService(): IClientService {
  const serviceType = getClientServiceType();

  switch (serviceType) {
    case 'mock':
      log.info('Creating MockClientService');
      return new MockClientService();

    case 'supabase':
      log.info('Creating SupabaseClientService');
      return new SupabaseClientService();

    default:
      log.warn(`Unknown service type: ${serviceType}, defaulting to mock`);
      return new MockClientService();
  }
}

let serviceInstance: IClientService | null = null;

export function getClientService(): IClientService {
  if (!serviceInstance) {
    serviceInstance = createClientService();
  }
  return serviceInstance;
}

export function resetClientService(): void {
  serviceInstance = null;
}
