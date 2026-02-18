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

import { supabase } from '@/lib/supabase';
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

/** Parse RPC response envelope: { success, error?, data?, errorDetails? } */
function parseRpcResult(data: unknown): {
  success: boolean;
  error?: string;
  data?: unknown;
  template_id?: string;
  errorDetails?: { code: string; count?: number };
} {
  const result = typeof data === 'string' ? JSON.parse(data) : data;
  return result;
}

/** Parse and throw on failure */
function parseOrThrow(data: unknown): ReturnType<typeof parseRpcResult> {
  const result = parseRpcResult(data);
  if (!result?.success) {
    throw new Error(result?.error ?? 'RPC call failed');
  }
  return result;
}

export class SupabaseScheduleService implements IScheduleService {
  async listTemplates(params: {
    orgId?: string;
    status?: 'all' | 'active' | 'inactive';
    search?: string;
  }): Promise<ScheduleTemplate[]> {
    log.debug('Listing schedule templates', params);

    const { data, error } = await supabase.schema('api').rpc('list_schedule_templates', {
      p_org_id: params.orgId ?? null,
      p_status: params.status ?? 'all',
      p_search: params.search ?? null,
    });

    if (error) {
      log.error('Failed to list schedule templates', { error });
      throw new Error(`Failed to list schedule templates: ${error.message}`);
    }

    const result = parseOrThrow(data);
    return (result.data as ScheduleTemplate[]) ?? [];
  }

  async getTemplate(templateId: string): Promise<ScheduleTemplateDetail | null> {
    log.debug('Getting schedule template', { templateId });

    const { data, error } = await supabase.schema('api').rpc('get_schedule_template', {
      p_template_id: templateId,
    });

    if (error) {
      log.error('Failed to get schedule template', { error });
      throw new Error(`Failed to get schedule template: ${error.message}`);
    }

    const result = parseOrThrow(data);

    // get_schedule_template returns { success, template, assigned_users }
    const parsed = result as unknown as {
      template: Omit<ScheduleTemplateDetail, 'assigned_users' | 'assigned_user_count'>;
      assigned_users: ScheduleTemplateDetail['assigned_users'];
    };
    if (!parsed.template) return null;

    return {
      ...parsed.template,
      assigned_users: parsed.assigned_users ?? [],
      assigned_user_count: parsed.assigned_users?.length ?? 0,
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

    const { data, error } = await supabase.schema('api').rpc('create_schedule_template', {
      p_name: params.name,
      p_schedule: params.schedule,
      p_org_unit_id: params.orgUnitId ?? null,
      p_user_ids: params.userIds,
    });

    if (error) {
      log.error('Failed to create schedule template', { error });
      throw new Error(`Failed to create schedule template: ${error.message}`);
    }

    const result = parseOrThrow(data);
    log.info('Schedule template created', { templateId: result.template_id });
    return { templateId: result.template_id as string };
  }

  async updateTemplate(params: {
    templateId: string;
    name?: string;
    schedule?: WeeklySchedule;
    orgUnitId?: string | null;
  }): Promise<void> {
    log.debug('Updating schedule template', { templateId: params.templateId });

    const { data, error } = await supabase.schema('api').rpc('update_schedule_template', {
      p_template_id: params.templateId,
      p_name: params.name ?? null,
      p_schedule: params.schedule ?? null,
      p_org_unit_id: params.orgUnitId ?? null,
    });

    if (error) {
      log.error('Failed to update schedule template', { error });
      throw new Error(`Failed to update schedule template: ${error.message}`);
    }

    parseOrThrow(data);
    log.info('Schedule template updated', { templateId: params.templateId });
  }

  async deactivateTemplate(params: { templateId: string; reason?: string }): Promise<void> {
    log.debug('Deactivating schedule template', { templateId: params.templateId });

    const { data, error } = await supabase.schema('api').rpc('deactivate_schedule_template', {
      p_template_id: params.templateId,
      p_reason: params.reason ?? null,
    });

    if (error) {
      log.error('Failed to deactivate schedule template', { error });
      throw new Error(`Failed to deactivate schedule template: ${error.message}`);
    }

    parseOrThrow(data);
    log.info('Schedule template deactivated', { templateId: params.templateId });
  }

  async reactivateTemplate(params: { templateId: string }): Promise<void> {
    log.debug('Reactivating schedule template', { templateId: params.templateId });

    const { data, error } = await supabase.schema('api').rpc('reactivate_schedule_template', {
      p_template_id: params.templateId,
    });

    if (error) {
      log.error('Failed to reactivate schedule template', { error });
      throw new Error(`Failed to reactivate schedule template: ${error.message}`);
    }

    parseOrThrow(data);
    log.info('Schedule template reactivated', { templateId: params.templateId });
  }

  async deleteTemplate(params: {
    templateId: string;
    reason?: string;
  }): Promise<ScheduleDeleteResult> {
    log.debug('Deleting schedule template', { templateId: params.templateId });

    const { data, error } = await supabase.schema('api').rpc('delete_schedule_template', {
      p_template_id: params.templateId,
      p_reason: params.reason ?? null,
    });

    if (error) {
      log.error('Failed to delete schedule template', { error });
      throw new Error(`Failed to delete schedule template: ${error.message}`);
    }

    const result = parseRpcResult(data);

    if (!result.success) {
      log.warn('Delete schedule template returned error', {
        templateId: params.templateId,
        error: result.error,
        errorDetails: result.errorDetails,
      });
      return {
        success: false,
        error: result.error ?? 'Failed to delete schedule template',
        errorDetails: result.errorDetails as ScheduleDeleteResult['errorDetails'],
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

    const { data, error } = await supabase.schema('api').rpc('assign_user_to_schedule', {
      p_template_id: params.templateId,
      p_user_id: params.userId,
      p_effective_from: params.effectiveFrom ?? null,
      p_effective_until: params.effectiveUntil ?? null,
    });

    if (error) {
      log.error('Failed to assign user to schedule', { error });
      throw new Error(`Failed to assign user to schedule: ${error.message}`);
    }

    parseOrThrow(data);
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

    const { data, error } = await supabase.schema('api').rpc('unassign_user_from_schedule', {
      p_template_id: params.templateId,
      p_user_id: params.userId,
      p_reason: params.reason ?? null,
    });

    if (error) {
      log.error('Failed to unassign user from schedule', { error });
      throw new Error(`Failed to unassign user from schedule: ${error.message}`);
    }

    parseOrThrow(data);
    log.info('User unassigned from schedule', {
      templateId: params.templateId,
      userId: params.userId,
    });
  }

  async listUsersForScheduleManagement(
    params: ListUsersForScheduleManagementParams
  ): Promise<ScheduleManageableUser[]> {
    log.debug('Listing users for schedule management', params);

    const { data, error } = await supabase.schema('api').rpc('list_users_for_schedule_management', {
      p_template_id: params.templateId,
      p_search_term: params.searchTerm ?? null,
      p_limit: params.limit ?? 100,
      p_offset: params.offset ?? 0,
    });

    if (error) {
      log.error('Failed to list users for schedule management', { error });
      throw new Error(`Failed to list users for schedule management: ${error.message}`);
    }

    // This RPC returns TABLE rows directly (not wrapped in envelope)
    const rows = Array.isArray(data) ? data : [];
    return rows.map((row: Record<string, unknown>) => ({
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

    const { data, error } = await supabase.schema('api').rpc('sync_schedule_assignments', {
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

    const result = typeof data === 'string' ? JSON.parse(data) : data;
    log.info('Schedule assignments synced', {
      addedSuccessful: result.added?.successful?.length ?? 0,
      removedSuccessful: result.removed?.successful?.length ?? 0,
      transferred: result.transferred?.length ?? 0,
      correlationId: result.correlationId,
    });

    return {
      added: {
        successful: result.added?.successful ?? [],
        failed: result.added?.failed ?? [],
      },
      removed: {
        successful: result.removed?.successful ?? [],
        failed: result.removed?.failed ?? [],
      },
      transferred: result.transferred ?? [],
      correlationId: result.correlationId ?? correlationId,
    };
  }
}
