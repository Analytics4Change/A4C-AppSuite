/**
 * Organization Entity Service Factory
 *
 * Factory for creating organization entity service instances (contact/address/phone CRUD).
 * Uses getDeploymentConfig() for consistent mode detection.
 */

import { getDeploymentConfig } from '@/config/deployment.config';
import type { IOrganizationEntityService } from './IOrganizationEntityService';
import { SupabaseOrganizationEntityService } from './SupabaseOrganizationEntityService';
import { MockOrganizationEntityService } from './MockOrganizationEntityService';

export type OrganizationEntityServiceType = 'mock' | 'supabase';

export function getOrganizationEntityServiceType(): OrganizationEntityServiceType {
  const { useMockOrganization } = getDeploymentConfig();
  return useMockOrganization ? 'mock' : 'supabase';
}

export function createOrganizationEntityService(): IOrganizationEntityService {
  return getOrganizationEntityServiceType() === 'mock'
    ? new MockOrganizationEntityService()
    : new SupabaseOrganizationEntityService();
}

let instance: IOrganizationEntityService | null = null;

export function getOrganizationEntityService(): IOrganizationEntityService {
  if (!instance) instance = createOrganizationEntityService();
  return instance;
}

export function resetOrganizationEntityService(): void {
  instance = null;
}
