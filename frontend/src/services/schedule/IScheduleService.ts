/**
 * Schedule Service Interface
 *
 * Defines the contract for managing schedule templates and user assignments.
 *
 * Implementations:
 * - SupabaseScheduleService: Production (calls api.* RPCs)
 * - MockScheduleService: Development (in-memory)
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

export interface ScheduleDeleteResult {
  success: boolean;
  error?: string;
  errorDetails?: {
    code: 'STILL_ACTIVE' | 'HAS_USERS';
    count?: number;
  };
}

export interface IScheduleService {
  // Template CRUD
  listTemplates(params: {
    orgId?: string;
    status?: 'all' | 'active' | 'inactive';
    search?: string;
  }): Promise<ScheduleTemplate[]>;

  getTemplate(templateId: string): Promise<ScheduleTemplateDetail | null>;

  createTemplate(params: {
    name: string;
    schedule: WeeklySchedule;
    orgUnitId?: string;
    userIds: string[];
  }): Promise<{ templateId: string }>;

  updateTemplate(params: {
    templateId: string;
    name?: string;
    schedule?: WeeklySchedule;
    orgUnitId?: string | null;
  }): Promise<void>;

  deactivateTemplate(params: { templateId: string; reason?: string }): Promise<void>;

  reactivateTemplate(params: { templateId: string }): Promise<void>;

  deleteTemplate(params: { templateId: string; reason?: string }): Promise<ScheduleDeleteResult>;

  // User assignments
  assignUser(params: {
    templateId: string;
    userId: string;
    effectiveFrom?: string;
    effectiveUntil?: string;
  }): Promise<void>;

  unassignUser(params: { templateId: string; userId: string; reason?: string }): Promise<void>;

  // Assignment management (batch operations)
  listUsersForScheduleManagement(
    params: ListUsersForScheduleManagementParams
  ): Promise<ScheduleManageableUser[]>;
  syncScheduleAssignments(
    params: SyncScheduleAssignmentsParams
  ): Promise<SyncScheduleAssignmentsResult>;
}
