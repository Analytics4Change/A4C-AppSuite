/**
 * Supabase Schedule Service
 *
 * Production implementation using api.* schema RPC functions.
 * Follows CQRS pattern: writes emit events, reads query projections.
 *
 * @see api.create_schedule_template()
 * @see api.update_schedule_template()
 * @see api.deactivate_schedule_template()
 * @see api.reactivate_schedule_template()
 * @see api.delete_schedule_template()
 * @see api.list_schedule_templates()
 * @see api.get_schedule_template()
 * @see api.assign_user_to_schedule()
 * @see api.unassign_user_from_schedule()
 */

import { supabaseService } from '@/services/auth/supabase.service';
import { Logger } from '@/utils/logger';
import type {
  ScheduleTemplate,
  ScheduleTemplateDetail,
  WeeklySchedule,
} from '@/types/schedule.types';
import type {
  ScheduleManageableUser,
  SyncScheduleAssignmentsResult,
  ListUsersForScheduleManagementParams,
  SyncScheduleAssignmentsParams,
} from '@/types/bulk-assignment.types';
import type { IScheduleService, ScheduleDeleteResult } from './IScheduleService';

const log = Logger.getLogger('api');

export class SupabaseScheduleService implements IScheduleService {
  // -------------------------------------------------------------------------
  // Q6 — most envelope methods THROW on `!env.success` (pre-migration
  // `parseOrThrow` contract). Only `deleteTemplate` RETURNS the typed envelope
  // because consumers need `errorDetails.code` for the cannot-delete dialog
  // (HAS_USERS / STILL_ACTIVE).
  // -------------------------------------------------------------------------

  async listTemplates(params: {
    orgId?: string;
    status?: 'all' | 'active' | 'inactive';
    search?: string;
  }): Promise<ScheduleTemplate[]> {
    log.debug('Listing schedule templates', params);

    const env = await supabaseService.apiRpcEnvelope<{ data?: ScheduleTemplate[] }>(
      'list_schedule_templates',
      {
        p_org_id: params.orgId ?? null,
        p_status: params.status ?? 'all',
        p_search: params.search ?? null,
      }
    );

    if (!env.success) {
      log.error('Failed to list schedule templates', { error: env.error });
      throw new Error(`Failed to list schedule templates: ${env.error}`);
    }

    return env.data ?? [];
  }

  async getTemplate(templateId: string): Promise<ScheduleTemplateDetail | null> {
    log.debug('Getting schedule template', { templateId });

    const env = await supabaseService.apiRpcEnvelope<{
      template?: Omit<ScheduleTemplateDetail, 'assigned_users' | 'assigned_user_count'>;
      assigned_users?: ScheduleTemplateDetail['assigned_users'];
    }>('get_schedule_template', { p_template_id: templateId });

    if (!env.success) {
      log.error('Failed to get schedule template', { error: env.error });
      throw new Error(`Failed to get schedule template: ${env.error}`);
    }

    if (!env.template) return null;

    return {
      ...env.template,
      assigned_users: env.assigned_users ?? [],
      assigned_user_count: env.assigned_users?.length ?? 0,
    } as ScheduleTemplateDetail;
  }

  async createTemplate(params: {
    name: string;
    schedule: WeeklySchedule;
    orgUnitId?: string;
    userIds: string[];
  }): Promise<{ templateId: string }> {
    log.debug('Creating schedule template', {
      name: params.name,
      userCount: params.userIds.length,
    });

    const env = await supabaseService.apiRpcEnvelope<{ template_id?: string }>(
      'create_schedule_template',
      {
        p_name: params.name,
        p_schedule: params.schedule,
        p_org_unit_id: params.orgUnitId ?? null,
        p_user_ids: params.userIds,
      }
    );

    if (!env.success) {
      log.error('Failed to create schedule template', { error: env.error });
      throw new Error(`Failed to create schedule template: ${env.error}`);
    }

    log.info('Schedule template created', { templateId: env.template_id });
    return { templateId: env.template_id as string };
  }

  async updateTemplate(params: {
    templateId: string;
    name?: string;
    schedule?: WeeklySchedule;
    orgUnitId?: string | null;
  }): Promise<void> {
    log.debug('Updating schedule template', { templateId: params.templateId });

    const env = await supabaseService.apiRpcEnvelope('update_schedule_template', {
      p_template_id: params.templateId,
      p_name: params.name ?? null,
      p_schedule: params.schedule ?? null,
      p_org_unit_id: params.orgUnitId ?? null,
    });

    if (!env.success) {
      log.error('Failed to update schedule template', { error: env.error });
      throw new Error(`Failed to update schedule template: ${env.error}`);
    }

    log.info('Schedule template updated', { templateId: params.templateId });
  }

  async deactivateTemplate(params: { templateId: string; reason?: string }): Promise<void> {
    log.debug('Deactivating schedule template', { templateId: params.templateId });

    const env = await supabaseService.apiRpcEnvelope('deactivate_schedule_template', {
      p_template_id: params.templateId,
      p_reason: params.reason ?? null,
    });

    if (!env.success) {
      log.error('Failed to deactivate schedule template', { error: env.error });
      throw new Error(`Failed to deactivate schedule template: ${env.error}`);
    }

    log.info('Schedule template deactivated', { templateId: params.templateId });
  }

  async reactivateTemplate(params: { templateId: string }): Promise<void> {
    log.debug('Reactivating schedule template', { templateId: params.templateId });

    const env = await supabaseService.apiRpcEnvelope('reactivate_schedule_template', {
      p_template_id: params.templateId,
    });

    if (!env.success) {
      log.error('Failed to reactivate schedule template', { error: env.error });
      throw new Error(`Failed to reactivate schedule template: ${env.error}`);
    }

    log.info('Schedule template reactivated', { templateId: params.templateId });
  }

  /**
   * Q6 exception: this method RETURNS on `!env.success` (pre-migration
   * `parseRpcResult` contract). Consumers branch on `result.success` to render
   * the cannot-delete dialog with `errorDetails.code` (HAS_USERS / STILL_ACTIVE)
   * and `errorDetails.count`.
   */
  async deleteTemplate(params: {
    templateId: string;
    reason?: string;
  }): Promise<ScheduleDeleteResult> {
    log.debug('Deleting schedule template', { templateId: params.templateId });

    const env = await supabaseService.apiRpcEnvelope('delete_schedule_template', {
      p_template_id: params.templateId,
      p_reason: params.reason ?? null,
    });

    if (!env.success) {
      log.warn('Delete schedule template returned error', {
        templateId: params.templateId,
        error: env.error,
        errorDetails: env.errorDetails,
      });
      return {
        success: false,
        error: env.error,
        errorDetails: env.errorDetails as ScheduleDeleteResult['errorDetails'],
      };
    }

    log.info('Schedule template deleted', { templateId: params.templateId });
    return { success: true };
  }

  async assignUser(params: {
    templateId: string;
    userId: string;
    effectiveFrom?: string;
    effectiveUntil?: string;
  }): Promise<void> {
    log.debug('Assigning user to schedule', {
      templateId: params.templateId,
      userId: params.userId,
    });

    const env = await supabaseService.apiRpcEnvelope('assign_user_to_schedule', {
      p_template_id: params.templateId,
      p_user_id: params.userId,
      p_effective_from: params.effectiveFrom ?? null,
      p_effective_until: params.effectiveUntil ?? null,
    });

    if (!env.success) {
      log.error('Failed to assign user to schedule', { error: env.error });
      throw new Error(`Failed to assign user to schedule: ${env.error}`);
    }

    log.info('User assigned to schedule', {
      templateId: params.templateId,
      userId: params.userId,
    });
  }

  async unassignUser(params: {
    templateId: string;
    userId: string;
    reason?: string;
  }): Promise<void> {
    log.debug('Unassigning user from schedule', {
      templateId: params.templateId,
      userId: params.userId,
    });

    const env = await supabaseService.apiRpcEnvelope('unassign_user_from_schedule', {
      p_template_id: params.templateId,
      p_user_id: params.userId,
      p_reason: params.reason ?? null,
    });

    if (!env.success) {
      log.error('Failed to unassign user from schedule', { error: env.error });
      throw new Error(`Failed to unassign user from schedule: ${env.error}`);
    }

    log.info('User unassigned from schedule', {
      templateId: params.templateId,
      userId: params.userId,
    });
  }

  async listUsersForScheduleManagement(
    params: ListUsersForScheduleManagementParams
  ): Promise<ScheduleManageableUser[]> {
    log.debug('Listing users for schedule management', params);

    const { data, error } = await supabaseService.apiRpc<Record<string, unknown>[]>(
      'list_users_for_schedule_management',
      {
        p_template_id: params.templateId,
        p_search_term: params.searchTerm ?? null,
        p_limit: params.limit ?? 100,
        p_offset: params.offset ?? 0,
      }
    );

    if (error) {
      log.error('Failed to list users for schedule management', { error });
      throw new Error(`Failed to list users for schedule management: ${error.message}`);
    }

    // This RPC returns TABLE rows directly (not wrapped in envelope)
    const rows = data ?? [];
    return rows.map((row) => ({
      id: row.id as string,
      displayName: (row.display_name as string) || (row.email as string),
      email: row.email as string,
      isActive: row.is_active as boolean,
      isAssigned: row.is_assigned as boolean,
      currentScheduleId: (row.current_schedule_id as string) || null,
      currentScheduleName: (row.current_schedule_name as string) || null,
    }));
  }

  async syncScheduleAssignments(
    params: SyncScheduleAssignmentsParams
  ): Promise<SyncScheduleAssignmentsResult> {
    log.debug('Syncing schedule assignments', {
      templateId: params.templateId,
      addCount: params.userIdsToAdd.length,
      removeCount: params.userIdsToRemove.length,
    });

    const correlationId = params.correlationId || globalThis.crypto.randomUUID();

    const { data, error } = await supabaseService.apiRpc<{
      added?: {
        successful: string[];
        failed: Array<{ userId: string; reason: string; sqlstate?: string }>;
      };
      removed?: {
        successful: string[];
        failed: Array<{ userId: string; reason: string; sqlstate?: string }>;
      };
      transferred?: unknown[];
      correlationId?: string;
    }>('sync_schedule_assignments', {
      p_template_id: params.templateId,
      p_user_ids_to_add: params.userIdsToAdd,
      p_user_ids_to_remove: params.userIdsToRemove,
      p_correlation_id: correlationId,
      p_reason: params.reason ?? 'Schedule assignment update',
    });

    if (error) {
      log.error('Failed to sync schedule assignments', { error });
      throw new Error(`Failed to sync schedule assignments: ${error.message}`);
    }

    log.info('Schedule assignments synced', {
      addedSuccessful: data?.added?.successful?.length ?? 0,
      removedSuccessful: data?.removed?.successful?.length ?? 0,
      transferred: data?.transferred?.length ?? 0,
      correlationId: data?.correlationId,
    });

    return {
      added: {
        successful: data?.added?.successful ?? [],
        failed: data?.added?.failed ?? [],
      },
      removed: {
        successful: data?.removed?.successful ?? [],
        failed: data?.removed?.failed ?? [],
      },
      transferred: (data?.transferred ?? []) as SyncScheduleAssignmentsResult['transferred'],
      correlationId: data?.correlationId ?? correlationId,
    };
  }
}
