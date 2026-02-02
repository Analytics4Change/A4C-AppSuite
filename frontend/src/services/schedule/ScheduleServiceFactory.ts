/**
 * Schedule Service Factory
 *
 * Uses smart detection via getDeploymentConfig() to determine
 * whether to use mock or production implementation.
 *
 * @see DirectCareSettingsServiceFactory for the pattern being followed
 * @see deployment.config.ts for detection logic
 */

import type { IScheduleService } from './IScheduleService';
import { MockScheduleService } from './MockScheduleService';
import { SupabaseScheduleService } from './SupabaseScheduleService';
import { getDeploymentConfig } from '@/config/deployment.config';
import { Logger } from '@/utils/logger';

const log = Logger.getLogger('api');

export type ScheduleServiceType = 'mock' | 'supabase';

export function getScheduleServiceType(): ScheduleServiceType {
  const { useMockOrganization } = getDeploymentConfig();
  return useMockOrganization ? 'mock' : 'supabase';
}

export function createScheduleService(): IScheduleService {
  const serviceType = getScheduleServiceType();

  switch (serviceType) {
    case 'mock':
      log.info('Creating MockScheduleService');
      return new MockScheduleService();

    case 'supabase':
      log.info('Creating SupabaseScheduleService');
      return new SupabaseScheduleService();

    default:
      log.warn(`Unknown service type: ${serviceType}, defaulting to mock`);
      return new MockScheduleService();
  }
}

let serviceInstance: IScheduleService | null = null;

export function getScheduleService(): IScheduleService {
  if (!serviceInstance) {
    serviceInstance = createScheduleService();
  }
  return serviceInstance;
}

export function resetScheduleService(): void {
  serviceInstance = null;
}
