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
import type { IScheduleService, ScheduleDeleteResult } from './IScheduleService';

const log = Logger.getLogger('api');

function createSeedData(): { templates: ScheduleTemplate[]; assignments: ScheduleAssignment[] } {
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

  return { templates, assignments };
}

export class MockScheduleService implements IScheduleService {
  private templates: ScheduleTemplate[];
  private assignments: ScheduleAssignment[];

  constructor() {
    const seed = createSeedData();
    this.templates = seed.templates;
    this.assignments = seed.assignments;
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

  private simulateDelay(): Promise<void> {
    const delay = import.meta.env.MODE === 'test' ? 0 : 300;
    return new Promise((resolve) => setTimeout(resolve, delay));
  }
}
