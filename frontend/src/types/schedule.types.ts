/**
 * Schedule Type Definitions
 *
 * Types for managing staff work schedule templates and user assignments.
 * Templates define the schedule ("what"), assignments define who uses it ("who/when").
 *
 * @see infrastructure/supabase/contracts/asyncapi/domains/schedule.yaml
 * @see api.create_schedule_template()
 * @see api.list_schedule_templates()
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

/** A schedule template from the projection table */
export interface ScheduleTemplate {
  id: string;
  organization_id: string;
  org_unit_id?: string | null;
  org_unit_name?: string | null;
  schedule_name: string;
  schedule: WeeklySchedule;
  is_active: boolean;
  assigned_user_count: number;
  created_at?: string;
  updated_at?: string;
}

/** A user assignment to a schedule template */
export interface ScheduleAssignment {
  id: string;
  schedule_template_id: string;
  user_id: string;
  user_name?: string;
  user_email?: string;
  effective_from?: string | null;
  effective_until?: string | null;
  is_active: boolean;
}

/** Template detail including assigned users (from api.get_schedule_template) */
export interface ScheduleTemplateDetail extends ScheduleTemplate {
  assigned_users: ScheduleAssignment[];
}

/** Structured error from delete operations */
export interface ScheduleDeleteError {
  success: false;
  error: string;
  errorDetails?: {
    code: 'STILL_ACTIVE' | 'HAS_USERS';
    count?: number;
  };
}
