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
 * @see api.list_user_schedules()
 */

import type { UserSchedulePolicy, WeeklySchedule } from '@/types/schedule.types';

export interface IScheduleService {
  listSchedules(params: {
    orgId?: string;
    userId?: string;
    orgUnitId?: string;
    activeOnly?: boolean;
  }): Promise<UserSchedulePolicy[]>;

  createSchedule(params: {
    userId: string;
    schedule: WeeklySchedule;
    orgUnitId?: string;
    effectiveFrom?: string;
    effectiveUntil?: string;
    reason?: string;
  }): Promise<{ scheduleId: string }>;

  updateSchedule(params: {
    scheduleId: string;
    schedule?: WeeklySchedule;
    orgUnitId?: string;
    effectiveFrom?: string;
    effectiveUntil?: string;
    reason?: string;
  }): Promise<void>;

  deactivateSchedule(params: {
    scheduleId: string;
    reason?: string;
  }): Promise<void>;
}
