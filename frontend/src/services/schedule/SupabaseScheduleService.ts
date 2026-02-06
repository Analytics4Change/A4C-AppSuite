/**
 * Supabase Schedule Service
 *
 * Production implementation using api.* schema RPC functions.
 * Follows CQRS pattern: writes emit events, reads query projections.
 *
 * @see api.create_user_schedule()
 * @see api.update_user_schedule()
 * @see api.deactivate_user_schedule()
 * @see api.reactivate_user_schedule()
 * @see api.delete_user_schedule()
 * @see api.get_schedule_by_id()
 * @see api.list_user_schedules()
 */

import { supabase } from '@/lib/supabase';
import { Logger } from '@/utils/logger';
import type { UserSchedulePolicy, WeeklySchedule } from '@/types/schedule.types';
import type { IScheduleService } from './IScheduleService';

const log = Logger.getLogger('api');

/** Parse RPC response envelope: { success, error?, data? } */
function parseRpcResult(data: unknown): {
  success: boolean;
  error?: string;
  data?: unknown;
  schedule_id?: string;
} {
  const result = typeof data === 'string' ? JSON.parse(data) : data;
  if (!result?.success) {
    throw new Error(result?.error ?? 'RPC call failed');
  }
  return result;
}

export class SupabaseScheduleService implements IScheduleService {
  async listSchedules(params: {
    orgId?: string;
    userId?: string;
    orgUnitId?: string;
    scheduleName?: string;
    activeOnly?: boolean;
  }): Promise<UserSchedulePolicy[]> {
    log.debug('Listing schedules', params);

    const { data, error } = await supabase.schema('api').rpc('list_user_schedules', {
      p_org_id: params.orgId ?? null,
      p_user_id: params.userId ?? null,
      p_org_unit_id: params.orgUnitId ?? null,
      p_schedule_name: params.scheduleName ?? null,
      p_active_only: params.activeOnly ?? true,
    });

    if (error) {
      log.error('Failed to list schedules', { error });
      throw new Error(`Failed to list schedules: ${error.message}`);
    }

    const result = parseRpcResult(data);
    return (result.data as UserSchedulePolicy[]) ?? [];
  }

  async getScheduleById(scheduleId: string): Promise<UserSchedulePolicy | null> {
    log.debug('Getting schedule by ID', { scheduleId });

    const { data, error } = await supabase.schema('api').rpc('get_schedule_by_id', {
      p_schedule_id: scheduleId,
    });

    if (error) {
      log.error('Failed to get schedule', { error });
      throw new Error(`Failed to get schedule: ${error.message}`);
    }

    const result = parseRpcResult(data);
    return (result.data as UserSchedulePolicy) ?? null;
  }

  async createSchedule(params: {
    userId: string;
    scheduleName: string;
    schedule: WeeklySchedule;
    orgUnitId?: string;
    effectiveFrom?: string;
    effectiveUntil?: string;
    reason?: string;
  }): Promise<{ scheduleId: string }> {
    log.debug('Creating schedule', { userId: params.userId, scheduleName: params.scheduleName });

    const { data, error } = await supabase.schema('api').rpc('create_user_schedule', {
      p_user_id: params.userId,
      p_schedule_name: params.scheduleName,
      p_schedule: params.schedule,
      p_org_unit_id: params.orgUnitId ?? null,
      p_effective_from: params.effectiveFrom ?? null,
      p_effective_until: params.effectiveUntil ?? null,
      p_reason: params.reason ?? null,
    });

    if (error) {
      log.error('Failed to create schedule', { error });
      throw new Error(`Failed to create schedule: ${error.message}`);
    }

    const result = parseRpcResult(data);
    log.info('Schedule created', { scheduleId: result.schedule_id });
    return { scheduleId: result.schedule_id as string };
  }

  async updateSchedule(params: {
    scheduleId: string;
    scheduleName?: string;
    schedule?: WeeklySchedule;
    orgUnitId?: string;
    effectiveFrom?: string;
    effectiveUntil?: string;
    reason?: string;
  }): Promise<void> {
    log.debug('Updating schedule', { scheduleId: params.scheduleId });

    const { data, error } = await supabase.schema('api').rpc('update_user_schedule', {
      p_schedule_id: params.scheduleId,
      p_schedule_name: params.scheduleName ?? null,
      p_schedule: params.schedule ?? null,
      p_org_unit_id: params.orgUnitId ?? null,
      p_effective_from: params.effectiveFrom ?? null,
      p_effective_until: params.effectiveUntil ?? null,
      p_reason: params.reason ?? null,
    });

    if (error) {
      log.error('Failed to update schedule', { error });
      throw new Error(`Failed to update schedule: ${error.message}`);
    }

    parseRpcResult(data);
    log.info('Schedule updated', { scheduleId: params.scheduleId });
  }

  async deactivateSchedule(params: { scheduleId: string; reason?: string }): Promise<void> {
    log.debug('Deactivating schedule', { scheduleId: params.scheduleId });

    const { data, error } = await supabase.schema('api').rpc('deactivate_user_schedule', {
      p_schedule_id: params.scheduleId,
      p_reason: params.reason ?? null,
    });

    if (error) {
      log.error('Failed to deactivate schedule', { error });
      throw new Error(`Failed to deactivate schedule: ${error.message}`);
    }

    parseRpcResult(data);
    log.info('Schedule deactivated', { scheduleId: params.scheduleId });
  }

  async reactivateSchedule(params: { scheduleId: string; reason?: string }): Promise<void> {
    log.debug('Reactivating schedule', { scheduleId: params.scheduleId });

    const { data, error } = await supabase.schema('api').rpc('reactivate_user_schedule', {
      p_schedule_id: params.scheduleId,
      p_reason: params.reason ?? null,
    });

    if (error) {
      log.error('Failed to reactivate schedule', { error });
      throw new Error(`Failed to reactivate schedule: ${error.message}`);
    }

    parseRpcResult(data);
    log.info('Schedule reactivated', { scheduleId: params.scheduleId });
  }

  async deleteSchedule(params: { scheduleId: string; reason?: string }): Promise<void> {
    log.debug('Deleting schedule', { scheduleId: params.scheduleId });

    const { data, error } = await supabase.schema('api').rpc('delete_user_schedule', {
      p_schedule_id: params.scheduleId,
      p_reason: params.reason ?? null,
    });

    if (error) {
      log.error('Failed to delete schedule', { error });
      throw new Error(`Failed to delete schedule: ${error.message}`);
    }

    parseRpcResult(data);
    log.info('Schedule deleted', { scheduleId: params.scheduleId });
  }
}
