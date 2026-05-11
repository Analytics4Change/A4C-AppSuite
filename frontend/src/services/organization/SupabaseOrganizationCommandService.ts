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

import { supabaseService } from '@/services/auth/supabase.service';
import { Logger } from '@/utils/logger';
import type {
  OrganizationDetailRecord,
  OrganizationUpdateData,
  OrganizationOperationResult,
} from '@/types/organization.types';
import type { IOrganizationCommandService } from './IOrganizationCommandService';
import { WorkflowClientFactory } from '@/services/workflow/WorkflowClientFactory';

const log = Logger.getLogger('api');

export class SupabaseOrganizationCommandService implements IOrganizationCommandService {
  async updateOrganization(
    orgId: string,
    data: OrganizationUpdateData,
    reason?: string
  ): Promise<OrganizationOperationResult> {
    try {
      log.debug('Updating organization via RPC', { orgId, data, reason });

      const env = await supabaseService.apiRpcEnvelope<{
        organization?: Partial<OrganizationDetailRecord>;
      }>('update_organization', { p_org_id: orgId, p_data: data, p_reason: reason ?? null });

      if (!env.success) {
        log.warn('update_organization returned failure', { error: env.error, orgId });
        return { success: false, error: env.error };
      }

      log.info('Organization updated', { orgId, organization: env.organization });
      return { success: true, organization: env.organization };
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

      const env = await supabaseService.apiRpcEnvelope<{
        organization?: Partial<OrganizationDetailRecord>;
      }>('deactivate_organization', { p_org_id: orgId, p_reason: reason ?? null });

      if (!env.success) {
        log.warn('deactivate_organization returned failure', { error: env.error, orgId });
        return { success: false, error: env.error };
      }

      log.info('Organization deactivated', { orgId, organization: env.organization });
      return { success: true, organization: env.organization };
    } catch (error) {
      log.error('Error in deactivateOrganization', { error, orgId });
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  }

  async reactivateOrganization(orgId: string): Promise<OrganizationOperationResult> {
    try {
      log.debug('Reactivating organization', { orgId });

      const env = await supabaseService.apiRpcEnvelope<{
        organization?: Partial<OrganizationDetailRecord>;
      }>('reactivate_organization', { p_org_id: orgId });

      if (!env.success) {
        log.warn('reactivate_organization returned failure', { error: env.error, orgId });
        return { success: false, error: env.error };
      }

      log.info('Organization reactivated', { orgId, organization: env.organization });
      return { success: true, organization: env.organization };
    } catch (error) {
      log.error('Error in reactivateOrganization', { error, orgId });
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  }

  async deleteOrganization(orgId: string, reason?: string): Promise<OrganizationOperationResult> {
    try {
      log.debug('Deleting organization', { orgId, reason });

      const env = await supabaseService.apiRpcEnvelope<{
        organization?: Partial<OrganizationDetailRecord>;
      }>('delete_organization', { p_org_id: orgId, p_reason: reason ?? null });

      if (!env.success) {
        log.warn('delete_organization returned failure', { error: env.error, orgId });
        return { success: false, error: env.error };
      }

      log.info('Organization deleted', { orgId, organization: env.organization });

      // Fire-and-forget: trigger async cleanup workflow (DNS removal, user banning, etc.)
      try {
        const workflowClient = WorkflowClientFactory.create();
        await workflowClient.startDeletionWorkflow(orgId, reason ?? 'Organization deleted');
        log.info('Deletion workflow triggered', { orgId });
      } catch (workflowError) {
        log.warn('Failed to trigger deletion workflow (org is already soft-deleted)', {
          orgId,
          error: workflowError instanceof Error ? workflowError.message : 'Unknown error',
        });
      }

      return { success: true, organization: env.organization };
    } catch (error) {
      log.error('Error in deleteOrganization', { error, orgId });
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  }
}
