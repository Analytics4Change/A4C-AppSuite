/**
 * Supabase Organization Command Service
 *
 * Production implementation of IOrganizationCommandService using dedicated RPC functions.
 * Each method calls a backend RPC that handles permission checks, event emission,
 * and read-back verification server-side.
 *
 * Pattern: CQRS — RPCs emit events, handlers update projections, RPCs read back results.
 * Contract: infrastructure/supabase/contracts/asyncapi/domains/organization.yaml
 */

import { supabase } from '@/lib/supabase';
import { Logger } from '@/utils/logger';
import type {
  OrganizationUpdateData,
  OrganizationOperationResult,
} from '@/types/organization.types';
import type { IOrganizationCommandService } from './IOrganizationCommandService';

const log = Logger.getLogger('api');

export class SupabaseOrganizationCommandService implements IOrganizationCommandService {
  async updateOrganization(
    orgId: string,
    data: OrganizationUpdateData,
    reason?: string
  ): Promise<OrganizationOperationResult> {
    try {
      log.debug('Updating organization via RPC', { orgId, data, reason });

      const { data: result, error } = await supabase.schema('api').rpc('update_organization', {
        p_org_id: orgId,
        p_data: data,
        p_reason: reason ?? null,
      });

      if (error) {
        log.error('Failed to call update_organization RPC', { error, orgId });
        return { success: false, error: error.message };
      }

      if (!result?.success) {
        log.warn('update_organization returned failure', { result, orgId });
        return { success: false, error: result?.error ?? 'Update failed' };
      }

      log.info('Organization updated', { orgId, organization: result.organization });
      return { success: true, organization: result.organization };
    } catch (error) {
      log.error('Error in updateOrganization', { error, orgId });
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  }

  async deactivateOrganization(
    orgId: string,
    reason?: string
  ): Promise<OrganizationOperationResult> {
    try {
      log.debug('Deactivating organization', { orgId, reason });

      const { data: result, error } = await supabase.schema('api').rpc('deactivate_organization', {
        p_org_id: orgId,
        p_reason: reason ?? null,
      });

      if (error) {
        log.error('Failed to call deactivate_organization RPC', { error, orgId });
        return { success: false, error: error.message };
      }

      if (!result?.success) {
        log.warn('deactivate_organization returned failure', { result, orgId });
        return { success: false, error: result?.error ?? 'Deactivation failed' };
      }

      log.info('Organization deactivated', { orgId, organization: result.organization });
      return { success: true, organization: result.organization };
    } catch (error) {
      log.error('Error in deactivateOrganization', { error, orgId });
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  }

  async reactivateOrganization(orgId: string): Promise<OrganizationOperationResult> {
    try {
      log.debug('Reactivating organization', { orgId });

      const { data: result, error } = await supabase.schema('api').rpc('reactivate_organization', {
        p_org_id: orgId,
      });

      if (error) {
        log.error('Failed to call reactivate_organization RPC', { error, orgId });
        return { success: false, error: error.message };
      }

      if (!result?.success) {
        log.warn('reactivate_organization returned failure', { result, orgId });
        return { success: false, error: result?.error ?? 'Reactivation failed' };
      }

      log.info('Organization reactivated', { orgId, organization: result.organization });
      return { success: true, organization: result.organization };
    } catch (error) {
      log.error('Error in reactivateOrganization', { error, orgId });
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  }

  async deleteOrganization(orgId: string, reason?: string): Promise<OrganizationOperationResult> {
    try {
      log.debug('Deleting organization', { orgId, reason });

      const { data: result, error } = await supabase.schema('api').rpc('delete_organization', {
        p_org_id: orgId,
        p_reason: reason ?? null,
      });

      if (error) {
        log.error('Failed to call delete_organization RPC', { error, orgId });
        return { success: false, error: error.message };
      }

      if (!result?.success) {
        log.warn('delete_organization returned failure', { result, orgId });
        return { success: false, error: result?.error ?? 'Deletion failed' };
      }

      log.info('Organization deleted', { orgId, organization: result.organization });
      return { success: true, organization: result.organization };
    } catch (error) {
      log.error('Error in deleteOrganization', { error, orgId });
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  }
}
