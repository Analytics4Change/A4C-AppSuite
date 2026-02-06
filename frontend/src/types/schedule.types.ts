/**
 * Schedule Type Definitions
 *
 * Types for managing staff work schedules within organizations.
 * Schedules define when staff members are available for notifications
 * and client assignments.
 *
 * @see infrastructure/supabase/contracts/asyncapi/domains/user.yaml
 * @see api.create_user_schedule()
 * @see api.list_user_schedules()
 */

/** A single day's work schedule with begin/end times in HHMM format */
export interface DaySchedule {
  /** Start time in HHMM format (e.g., "0800") */
  begin: string;
  /** End time in HHMM format (e.g., "1600") */
  end: string;
}

/** Weekly schedule mapping days to their schedules (null = day off) */
export interface WeeklySchedule {
  monday?: DaySchedule | null;
  tuesday?: DaySchedule | null;
  wednesday?: DaySchedule | null;
  thursday?: DaySchedule | null;
  friday?: DaySchedule | null;
  saturday?: DaySchedule | null;
  sunday?: DaySchedule | null;
}

/** All days of the week in order */
export const DAYS_OF_WEEK = [
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
  'sunday',
] as const;

export type DayOfWeek = (typeof DAYS_OF_WEEK)[number];

/** A user schedule policy from the projection table */
export interface UserSchedulePolicy {
  id: string;
  user_id: string;
  user_name?: string;
  user_email?: string;
  organization_id: string;
  org_unit_id?: string | null;
  org_unit_name?: string | null;
  schedule_name: string;
  schedule: WeeklySchedule;
  effective_from?: string | null;
  effective_until?: string | null;
  is_active: boolean;
  created_at?: string;
  updated_at?: string;
}
