/**
 * Client Field Service Factory
 *
 * Uses smart detection via getDeploymentConfig() to determine
 * whether to use mock or production implementation.
 */

import type { IClientFieldService } from './IClientFieldService';
import { MockClientFieldService } from './MockClientFieldService';
import { SupabaseClientFieldService } from './SupabaseClientFieldService';
import { getDeploymentConfig } from '@/config/deployment.config';
import { Logger } from '@/utils/logger';

const log = Logger.getLogger('api');

export type ClientFieldServiceType = 'mock' | 'supabase';

export function getClientFieldServiceType(): ClientFieldServiceType {
  const { useMockOrganization } = getDeploymentConfig();
  return useMockOrganization ? 'mock' : 'supabase';
}

export function createClientFieldService(): IClientFieldService {
  const serviceType = getClientFieldServiceType();

  switch (serviceType) {
    case 'mock':
      log.info('Creating MockClientFieldService');
      return new MockClientFieldService();

    case 'supabase':
      log.info('Creating SupabaseClientFieldService');
      return new SupabaseClientFieldService();

    default:
      log.warn(`Unknown service type: ${serviceType}, defaulting to mock`);
      return new MockClientFieldService();
  }
}

let serviceInstance: IClientFieldService | null = null;

export function getClientFieldService(): IClientFieldService {
  if (!serviceInstance) {
    serviceInstance = createClientFieldService();
  }
  return serviceInstance;
}

export function resetClientFieldService(): void {
  serviceInstance = null;
}
