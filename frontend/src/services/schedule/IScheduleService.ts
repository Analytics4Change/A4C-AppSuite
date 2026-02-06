/**
 * Schedule Service Interface
 *
 * Defines the contract for managing staff work schedules.
 *
 * Implementations:
 * - SupabaseScheduleService: Production (calls api.* RPCs)
 * - MockScheduleService: Development (in-memory)
 *
 * @see api.create_user_schedule()
 * @see api.update_user_schedule()
 * @see api.deactivate_user_schedule()
 * @see api.reactivate_user_schedule()
 * @see api.delete_user_schedule()
 * @see api.get_schedule_by_id()
 * @see api.list_user_schedules()
 */

import type { UserSchedulePolicy, WeeklySchedule } from '@/types/schedule.types';

export interface IScheduleService {
  listSchedules(params: {
    orgId?: string;
    userId?: string;
    orgUnitId?: string;
    scheduleName?: string;
    activeOnly?: boolean;
  }): Promise<UserSchedulePolicy[]>;

  getScheduleById(scheduleId: string): Promise<UserSchedulePolicy | null>;

  createSchedule(params: {
    userId: string;
    scheduleName: string;
    schedule: WeeklySchedule;
    orgUnitId?: string;
    effectiveFrom?: string;
    effectiveUntil?: string;
    reason?: string;
  }): Promise<{ scheduleId: string }>;

  updateSchedule(params: {
    scheduleId: string;
    scheduleName?: string;
    schedule?: WeeklySchedule;
    orgUnitId?: string;
    effectiveFrom?: string;
    effectiveUntil?: string;
    reason?: string;
  }): Promise<void>;

  deactivateSchedule(params: { scheduleId: string; reason?: string }): Promise<void>;

  reactivateSchedule(params: { scheduleId: string; reason?: string }): Promise<void>;

  deleteSchedule(params: { scheduleId: string; reason?: string }): Promise<void>;
}
