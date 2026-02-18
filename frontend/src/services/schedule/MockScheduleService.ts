/**
 * Mock Schedule Service
 *
 * In-memory implementation for local development and testing.
 * Seeds realistic template + assignment data on construction.
 */

import { Logger } from '@/utils/logger';
import type {
  ScheduleTemplate,
  ScheduleTemplateDetail,
  ScheduleAssignment,
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

interface MockUser {
  id: string;
  name: string;
  email: string;
  isActive: boolean;
}

function createSeedData(): {
  templates: ScheduleTemplate[];
  assignments: ScheduleAssignment[];
  users: MockUser[];
} {
  const orgId = 'mock-org';
  const now = new Date().toISOString();

  const templates: ScheduleTemplate[] = [
    {
      id: 'tmpl-001',
      organization_id: orgId,
      org_unit_id: 'ou-pediatrics',
      org_unit_name: 'Pediatrics',
      schedule_name: 'Day Shift M-F 8-4',
      schedule: {
        monday: { begin: '0800', end: '1600' },
        tuesday: { begin: '0800', end: '1600' },
        wednesday: { begin: '0800', end: '1600' },
        thursday: { begin: '0800', end: '1600' },
        friday: { begin: '0800', end: '1600' },
        saturday: null,
        sunday: null,
      },
      is_active: true,
      assigned_user_count: 2,
      created_at: now,
      updated_at: now,
    },
    {
      id: 'tmpl-002',
      organization_id: orgId,
      org_unit_id: 'ou-geriatrics',
      org_unit_name: 'Geriatrics',
      schedule_name: 'Night Shift 7p-7a',
      schedule: {
        monday: { begin: '1900', end: '0700' },
        tuesday: { begin: '1900', end: '0700' },
        wednesday: { begin: '1900', end: '0700' },
        thursday: null,
        friday: null,
        saturday: { begin: '1900', end: '0700' },
        sunday: { begin: '1900', end: '0700' },
      },
      is_active: true,
      assigned_user_count: 1,
      created_at: now,
      updated_at: now,
    },
    {
      id: 'tmpl-003',
      organization_id: orgId,
      org_unit_id: null,
      org_unit_name: null,
      schedule_name: 'Weekend Only',
      schedule: {
        monday: null,
        tuesday: null,
        wednesday: null,
        thursday: null,
        friday: null,
        saturday: { begin: '0800', end: '1600' },
        sunday: { begin: '0800', end: '1600' },
      },
      is_active: false,
      assigned_user_count: 0,
      created_at: now,
      updated_at: now,
    },
  ];

  const assignments: ScheduleAssignment[] = [
    {
      id: 'asgn-001',
      schedule_template_id: 'tmpl-001',
      user_id: 'user-001',
      user_name: 'Alice Johnson',
      user_email: 'alice@example.com',
      effective_from: '2026-01-01',
      effective_until: null,
      is_active: true,
    },
    {
      id: 'asgn-002',
      schedule_template_id: 'tmpl-001',
      user_id: 'user-002',
      user_name: 'Bob Smith',
      user_email: 'bob@example.com',
      effective_from: '2026-01-15',
      effective_until: null,
      is_active: true,
    },
    {
      id: 'asgn-003',
      schedule_template_id: 'tmpl-002',
      user_id: 'user-003',
      user_name: 'Carol Williams',
      user_email: 'carol@example.com',
      effective_from: '2026-02-01',
      effective_until: null,
      is_active: true,
    },
  ];

  const users = [
    { id: 'user-001', name: 'Alice Johnson', email: 'alice@example.com', isActive: true },
    { id: 'user-002', name: 'Bob Smith', email: 'bob@example.com', isActive: true },
    { id: 'user-003', name: 'Carol Williams', email: 'carol@example.com', isActive: true },
    { id: 'user-004', name: 'David Brown', email: 'david@example.com', isActive: true },
    { id: 'user-005', name: 'Eve Davis', email: 'eve@example.com', isActive: false },
  ];

  return { templates, assignments, users };
}

export class MockScheduleService implements IScheduleService {
  private templates: ScheduleTemplate[];
  private assignments: ScheduleAssignment[];
  private mockUsers: MockUser[];

  constructor() {
    const seed = createSeedData();
    this.templates = seed.templates;
    this.assignments = seed.assignments;
    this.mockUsers = seed.users;
  }

  async listTemplates(params: {
    orgId?: string;
    status?: 'all' | 'active' | 'inactive';
    search?: string;
  }): Promise<ScheduleTemplate[]> {
    log.debug('[Mock] Listing schedule templates', params);
    await this.simulateDelay();

    return this.templates.filter((t) => {
      if (params.status === 'active' && !t.is_active) return false;
      if (params.status === 'inactive' && t.is_active) return false;
      if (params.search) {
        const term = params.search.toLowerCase();
        if (!t.schedule_name.toLowerCase().includes(term)) return false;
      }
      return true;
    });
  }

  async getTemplate(templateId: string): Promise<ScheduleTemplateDetail | null> {
    log.debug('[Mock] Getting schedule template', { templateId });
    await this.simulateDelay();

    const template = this.templates.find((t) => t.id === templateId);
    if (!template) return null;

    const assigned_users = this.assignments.filter((a) => a.schedule_template_id === templateId);

    return { ...template, assigned_users };
  }

  async createTemplate(params: {
    name: string;
    schedule: WeeklySchedule;
    orgUnitId?: string;
    userIds: string[];
  }): Promise<{ templateId: string }> {
    log.debug('[Mock] Creating schedule template', { name: params.name });
    await this.simulateDelay();

    const id = globalThis.crypto.randomUUID();
    const now = new Date().toISOString();

    this.templates.push({
      id,
      organization_id: 'mock-org',
      org_unit_id: params.orgUnitId ?? null,
      org_unit_name: params.orgUnitId ? 'Mock Unit' : null,
      schedule_name: params.name,
      schedule: params.schedule,
      is_active: true,
      assigned_user_count: params.userIds.length,
      created_at: now,
      updated_at: now,
    });

    for (const userId of params.userIds) {
      this.assignments.push({
        id: globalThis.crypto.randomUUID(),
        schedule_template_id: id,
        user_id: userId,
        user_name: 'Mock User',
        user_email: 'mock@example.com',
        effective_from: null,
        effective_until: null,
        is_active: true,
      });
    }

    return { templateId: id };
  }

  async updateTemplate(params: {
    templateId: string;
    name?: string;
    schedule?: WeeklySchedule;
    orgUnitId?: string | null;
  }): Promise<void> {
    log.debug('[Mock] Updating schedule template', { templateId: params.templateId });
    await this.simulateDelay();

    const idx = this.templates.findIndex((t) => t.id === params.templateId);
    if (idx === -1) throw new Error('Template not found');

    if (params.name !== undefined) this.templates[idx].schedule_name = params.name;
    if (params.schedule) this.templates[idx].schedule = params.schedule;
    if (params.orgUnitId !== undefined) this.templates[idx].org_unit_id = params.orgUnitId;
    this.templates[idx].updated_at = new Date().toISOString();
  }

  async deactivateTemplate(params: { templateId: string; reason?: string }): Promise<void> {
    log.debug('[Mock] Deactivating schedule template', { templateId: params.templateId });
    await this.simulateDelay();

    const template = this.templates.find((t) => t.id === params.templateId);
    if (!template) throw new Error('Template not found');
    template.is_active = false;
    template.updated_at = new Date().toISOString();
  }

  async reactivateTemplate(params: { templateId: string }): Promise<void> {
    log.debug('[Mock] Reactivating schedule template', { templateId: params.templateId });
    await this.simulateDelay();

    const template = this.templates.find((t) => t.id === params.templateId);
    if (!template) throw new Error('Template not found');
    template.is_active = true;
    template.updated_at = new Date().toISOString();
  }

  async deleteTemplate(params: {
    templateId: string;
    reason?: string;
  }): Promise<ScheduleDeleteResult> {
    log.debug('[Mock] Deleting schedule template', { templateId: params.templateId });
    await this.simulateDelay();

    const template = this.templates.find((t) => t.id === params.templateId);
    if (!template) throw new Error('Template not found');

    if (template.is_active) {
      return {
        success: false,
        error: 'Cannot delete an active schedule template. Deactivate it first.',
        errorDetails: { code: 'STILL_ACTIVE' },
      };
    }

    const userCount = this.assignments.filter(
      (a) => a.schedule_template_id === params.templateId
    ).length;

    if (userCount > 0) {
      return {
        success: false,
        error: `Cannot delete schedule template with ${userCount} assigned user(s). Remove all assignments first.`,
        errorDetails: { code: 'HAS_USERS', count: userCount },
      };
    }

    this.templates = this.templates.filter((t) => t.id !== params.templateId);
    return { success: true };
  }

  async assignUser(params: {
    templateId: string;
    userId: string;
    effectiveFrom?: string;
    effectiveUntil?: string;
  }): Promise<void> {
    log.debug('[Mock] Assigning user to schedule', params);
    await this.simulateDelay();

    this.assignments.push({
      id: globalThis.crypto.randomUUID(),
      schedule_template_id: params.templateId,
      user_id: params.userId,
      user_name: 'Mock User',
      user_email: 'mock@example.com',
      effective_from: params.effectiveFrom ?? null,
      effective_until: params.effectiveUntil ?? null,
      is_active: true,
    });

    const template = this.templates.find((t) => t.id === params.templateId);
    if (template) template.assigned_user_count++;
  }

  async unassignUser(params: {
    templateId: string;
    userId: string;
    reason?: string;
  }): Promise<void> {
    log.debug('[Mock] Unassigning user from schedule', params);
    await this.simulateDelay();

    this.assignments = this.assignments.filter(
      (a) => !(a.schedule_template_id === params.templateId && a.user_id === params.userId)
    );

    const template = this.templates.find((t) => t.id === params.templateId);
    if (template && template.assigned_user_count > 0) template.assigned_user_count--;
  }

  async listUsersForScheduleManagement(
    params: ListUsersForScheduleManagementParams
  ): Promise<ScheduleManageableUser[]> {
    log.debug('[Mock] Listing users for schedule management', params);
    await this.simulateDelay();

    const { templateId, searchTerm, limit = 100, offset = 0 } = params;

    let results: ScheduleManageableUser[] = this.mockUsers.map((user) => {
      // Check if user is assigned to the target template
      const assignedToTarget = this.assignments.some(
        (a) => a.user_id === user.id && a.schedule_template_id === templateId
      );

      // Check if user is assigned to a different template
      const otherAssignment = this.assignments.find(
        (a) => a.user_id === user.id && a.schedule_template_id !== templateId
      );

      let currentScheduleId: string | null = null;
      let currentScheduleName: string | null = null;

      if (otherAssignment) {
        currentScheduleId = otherAssignment.schedule_template_id;
        const otherTemplate = this.templates.find(
          (t) => t.id === otherAssignment.schedule_template_id
        );
        currentScheduleName = otherTemplate?.schedule_name ?? null;
      }

      return {
        id: user.id,
        displayName: user.name,
        email: user.email,
        isActive: user.isActive,
        isAssigned: assignedToTarget,
        currentScheduleId,
        currentScheduleName,
      };
    });

    // Filter by search term
    if (searchTerm) {
      const term = searchTerm.toLowerCase();
      results = results.filter(
        (u) => u.displayName.toLowerCase().includes(term) || u.email.toLowerCase().includes(term)
      );
    }

    // Apply pagination
    return results.slice(offset, offset + limit);
  }

  async syncScheduleAssignments(
    params: SyncScheduleAssignmentsParams
  ): Promise<SyncScheduleAssignmentsResult> {
    log.debug('[Mock] Syncing schedule assignments', {
      templateId: params.templateId,
      addCount: params.userIdsToAdd.length,
      removeCount: params.userIdsToRemove.length,
    });
    await this.simulateDelay();

    const correlationId = params.correlationId || globalThis.crypto.randomUUID();
    const addedSuccessful: string[] = [];
    const removedSuccessful: string[] = [];
    const transferred: { userId: string; fromTemplateId: string; fromTemplateName: string }[] = [];

    // Process additions
    for (const userId of params.userIdsToAdd) {
      const user = this.mockUsers.find((u) => u.id === userId);
      if (!user) continue;

      // Check if user is on another template (auto-transfer)
      const existingAssignment = this.assignments.find(
        (a) => a.user_id === userId && a.schedule_template_id !== params.templateId
      );

      if (existingAssignment) {
        const fromTemplate = this.templates.find(
          (t) => t.id === existingAssignment.schedule_template_id
        );
        transferred.push({
          userId,
          fromTemplateId: existingAssignment.schedule_template_id,
          fromTemplateName: fromTemplate?.schedule_name ?? 'Unknown',
        });

        // Remove from old template
        this.assignments = this.assignments.filter(
          (a) =>
            !(
              a.user_id === userId &&
              a.schedule_template_id === existingAssignment.schedule_template_id
            )
        );
        if (fromTemplate && fromTemplate.assigned_user_count > 0) {
          fromTemplate.assigned_user_count--;
        }
      }

      // Remove any existing assignment to the target (idempotent)
      this.assignments = this.assignments.filter(
        (a) => !(a.user_id === userId && a.schedule_template_id === params.templateId)
      );

      // Add to target template
      this.assignments.push({
        id: globalThis.crypto.randomUUID(),
        schedule_template_id: params.templateId,
        user_id: userId,
        user_name: user.name,
        user_email: user.email,
        effective_from: null,
        effective_until: null,
        is_active: true,
      });

      addedSuccessful.push(userId);
    }

    // Process removals
    for (const userId of params.userIdsToRemove) {
      this.assignments = this.assignments.filter(
        (a) => !(a.user_id === userId && a.schedule_template_id === params.templateId)
      );
      removedSuccessful.push(userId);
    }

    // Update assigned_user_count on the target template
    const template = this.templates.find((t) => t.id === params.templateId);
    if (template) {
      template.assigned_user_count = this.assignments.filter(
        (a) => a.schedule_template_id === params.templateId
      ).length;
    }

    return {
      added: { successful: addedSuccessful, failed: [] },
      removed: { successful: removedSuccessful, failed: [] },
      transferred,
      correlationId,
    };
  }

  private simulateDelay(): Promise<void> {
    const delay = import.meta.env.MODE === 'test' ? 0 : 300;
    return new Promise((resolve) => setTimeout(resolve, delay));
  }
}
