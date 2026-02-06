/**
 * Mock Schedule Service
 *
 * In-memory implementation for local development and testing.
 * Seeds realistic named schedule data on construction.
 */

import { Logger } from '@/utils/logger';
import type { UserSchedulePolicy, WeeklySchedule } from '@/types/schedule.types';
import type { IScheduleService } from './IScheduleService';

const log = Logger.getLogger('api');

/** Seed data: realistic named schedules */
function createSeedSchedules(): UserSchedulePolicy[] {
  const orgId = 'mock-org';
  const now = new Date().toISOString();

  return [
    {
      id: 'sched-001',
      user_id: 'user-001',
      user_name: 'Alice Johnson',
      user_email: 'alice@example.com',
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
      effective_from: '2026-01-01',
      effective_until: null,
      is_active: true,
      created_at: now,
      updated_at: now,
    },
    {
      id: 'sched-002',
      user_id: 'user-002',
      user_name: 'Bob Smith',
      user_email: 'bob@example.com',
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
      effective_from: '2026-01-15',
      effective_until: null,
      is_active: true,
      created_at: now,
      updated_at: now,
    },
    {
      id: 'sched-003',
      user_id: 'user-003',
      user_name: 'Carol Williams',
      user_email: 'carol@example.com',
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
      effective_from: '2026-02-01',
      effective_until: null,
      is_active: true,
      created_at: now,
      updated_at: now,
    },
    {
      id: 'sched-004',
      user_id: 'user-004',
      user_name: 'David Brown',
      user_email: 'david@example.com',
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
      effective_from: null,
      effective_until: null,
      is_active: false,
      created_at: now,
      updated_at: now,
    },
  ];
}

export class MockScheduleService implements IScheduleService {
  private schedules: UserSchedulePolicy[] = createSeedSchedules();

  async listSchedules(params: {
    orgId?: string;
    userId?: string;
    orgUnitId?: string;
    scheduleName?: string;
    activeOnly?: boolean;
  }): Promise<UserSchedulePolicy[]> {
    log.debug('[Mock] Listing schedules', params);
    await this.simulateDelay();

    return this.schedules.filter((s) => {
      if (params.userId && s.user_id !== params.userId) return false;
      if (params.orgUnitId && s.org_unit_id !== params.orgUnitId) return false;
      if (params.scheduleName && s.schedule_name !== params.scheduleName) return false;
      if (params.activeOnly !== false && !s.is_active) return false;
      return true;
    });
  }

  async getScheduleById(scheduleId: string): Promise<UserSchedulePolicy | null> {
    log.debug('[Mock] Getting schedule by ID', { scheduleId });
    await this.simulateDelay();
    return this.schedules.find((s) => s.id === scheduleId) ?? null;
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
    log.debug('[Mock] Creating schedule', {
      userId: params.userId,
      scheduleName: params.scheduleName,
    });
    await this.simulateDelay();

    const id = globalThis.crypto.randomUUID();
    this.schedules.push({
      id,
      user_id: params.userId,
      user_name: 'Mock User',
      user_email: 'mock@example.com',
      organization_id: 'mock-org',
      org_unit_id: params.orgUnitId ?? null,
      org_unit_name: params.orgUnitId ? 'Mock Unit' : null,
      schedule_name: params.scheduleName,
      schedule: params.schedule,
      effective_from: params.effectiveFrom ?? null,
      effective_until: params.effectiveUntil ?? null,
      is_active: true,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });

    return { scheduleId: id };
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
    log.debug('[Mock] Updating schedule', { scheduleId: params.scheduleId });
    await this.simulateDelay();

    const idx = this.schedules.findIndex((s) => s.id === params.scheduleId);
    if (idx === -1) throw new Error('Schedule not found');

    if (params.scheduleName !== undefined) this.schedules[idx].schedule_name = params.scheduleName;
    if (params.schedule) this.schedules[idx].schedule = params.schedule;
    if (params.orgUnitId !== undefined) this.schedules[idx].org_unit_id = params.orgUnitId;
    if (params.effectiveFrom !== undefined)
      this.schedules[idx].effective_from = params.effectiveFrom;
    if (params.effectiveUntil !== undefined)
      this.schedules[idx].effective_until = params.effectiveUntil;
    this.schedules[idx].updated_at = new Date().toISOString();
  }

  async deactivateSchedule(params: { scheduleId: string; reason?: string }): Promise<void> {
    log.debug('[Mock] Deactivating schedule', { scheduleId: params.scheduleId });
    await this.simulateDelay();

    const schedule = this.schedules.find((s) => s.id === params.scheduleId);
    if (!schedule) throw new Error('Schedule not found');
    schedule.is_active = false;
    schedule.updated_at = new Date().toISOString();
  }

  async reactivateSchedule(params: { scheduleId: string; reason?: string }): Promise<void> {
    log.debug('[Mock] Reactivating schedule', { scheduleId: params.scheduleId });
    await this.simulateDelay();

    const schedule = this.schedules.find((s) => s.id === params.scheduleId);
    if (!schedule) throw new Error('Schedule not found');
    schedule.is_active = true;
    schedule.updated_at = new Date().toISOString();
  }

  async deleteSchedule(params: { scheduleId: string; reason?: string }): Promise<void> {
    log.debug('[Mock] Deleting schedule', { scheduleId: params.scheduleId });
    await this.simulateDelay();

    const idx = this.schedules.findIndex((s) => s.id === params.scheduleId);
    if (idx === -1) throw new Error('Schedule not found');
    if (this.schedules[idx].is_active) throw new Error('Cannot delete active schedule');
    this.schedules.splice(idx, 1);
  }

  private simulateDelay(): Promise<void> {
    const delay = import.meta.env.MODE === 'test' ? 0 : 300;
    return new Promise((resolve) => setTimeout(resolve, delay));
  }
}
