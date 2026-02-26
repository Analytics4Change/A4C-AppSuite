/**
 * Organization Command Service Factory
 *
 * Factory for creating organization command service instances.
 * Uses getDeploymentConfig() for consistent mode detection (aligned with other factories).
 */

import { getDeploymentConfig } from '@/config/deployment.config';
import type { IOrganizationCommandService } from './IOrganizationCommandService';
import { SupabaseOrganizationCommandService } from './SupabaseOrganizationCommandService';
import { MockOrganizationCommandService } from './MockOrganizationCommandService';

export type OrganizationCommandServiceType = 'mock' | 'supabase';

export function getOrganizationCommandServiceType(): OrganizationCommandServiceType {
  const { useMockOrganization } = getDeploymentConfig();
  return useMockOrganization ? 'mock' : 'supabase';
}

export function createOrganizationCommandService(): IOrganizationCommandService {
  return getOrganizationCommandServiceType() === 'mock'
    ? new MockOrganizationCommandService()
    : new SupabaseOrganizationCommandService();
}

let _instance: IOrganizationCommandService | null = null;

export function getOrganizationCommandService(): IOrganizationCommandService {
  if (!_instance) _instance = createOrganizationCommandService();
  return _instance;
}

export function resetOrganizationCommandService(): void {
  _instance = null;
}
