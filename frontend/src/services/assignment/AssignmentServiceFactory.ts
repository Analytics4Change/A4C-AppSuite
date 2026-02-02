/**
 * Assignment Service Factory
 *
 * Uses smart detection via getDeploymentConfig() to determine
 * whether to use mock or production implementation.
 *
 * @see ScheduleServiceFactory for the pattern being followed
 * @see deployment.config.ts for detection logic
 */

import type { IAssignmentService } from './IAssignmentService';
import { MockAssignmentService } from './MockAssignmentService';
import { SupabaseAssignmentService } from './SupabaseAssignmentService';
import { getDeploymentConfig } from '@/config/deployment.config';
import { Logger } from '@/utils/logger';

const log = Logger.getLogger('api');

export type AssignmentServiceType = 'mock' | 'supabase';

export function getAssignmentServiceType(): AssignmentServiceType {
  const { useMockOrganization } = getDeploymentConfig();
  return useMockOrganization ? 'mock' : 'supabase';
}

export function createAssignmentService(): IAssignmentService {
  const serviceType = getAssignmentServiceType();

  switch (serviceType) {
    case 'mock':
      log.info('Creating MockAssignmentService');
      return new MockAssignmentService();

    case 'supabase':
      log.info('Creating SupabaseAssignmentService');
      return new SupabaseAssignmentService();

    default:
      log.warn(`Unknown service type: ${serviceType}, defaulting to mock`);
      return new MockAssignmentService();
  }
}

let serviceInstance: IAssignmentService | null = null;

export function getAssignmentService(): IAssignmentService {
  if (!serviceInstance) {
    serviceInstance = createAssignmentService();
  }
  return serviceInstance;
}

export function resetAssignmentService(): void {
  serviceInstance = null;
}
