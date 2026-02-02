/**
 * Mock Schedule Service
 *
 * In-memory implementation for local development and testing.
 */

import { Logger } from '@/utils/logger';
import type { UserSchedulePolicy, WeeklySchedule } from '@/types/schedule.types';
import type { IScheduleService } from './IScheduleService';

const log = Logger.getLogger('api');

export class MockScheduleService implements IScheduleService {
  private schedules: UserSchedulePolicy[] = [];

  async listSchedules(params: {
    orgId?: string;
    userId?: string;
    orgUnitId?: string;
    activeOnly?: boolean;
  }): Promise<UserSchedulePolicy[]> {
    log.debug('[Mock] Listing schedules', params);
    await this.simulateDelay();

    return this.schedules.filter((s) => {
      if (params.userId && s.user_id !== params.userId) return false;
      if (params.orgUnitId && s.org_unit_id !== params.orgUnitId) return false;
      if (params.activeOnly !== false && !s.is_active) return false;
      return true;
    });
  }

  async createSchedule(params: {
    userId: string;
    schedule: WeeklySchedule;
    orgUnitId?: string;
    effectiveFrom?: string;
    effectiveUntil?: string;
    reason?: string;
  }): Promise<{ scheduleId: string }> {
    log.debug('[Mock] Creating schedule', { userId: params.userId });
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

    if (params.schedule) this.schedules[idx].schedule = params.schedule;
    if (params.orgUnitId !== undefined) this.schedules[idx].org_unit_id = params.orgUnitId;
    if (params.effectiveFrom !== undefined) this.schedules[idx].effective_from = params.effectiveFrom;
    if (params.effectiveUntil !== undefined) this.schedules[idx].effective_until = params.effectiveUntil;
    this.schedules[idx].updated_at = new Date().toISOString();
  }

  async deactivateSchedule(params: {
    scheduleId: string;
    reason?: string;
  }): Promise<void> {
    log.debug('[Mock] Deactivating schedule', { scheduleId: params.scheduleId });
    await this.simulateDelay();

    const schedule = this.schedules.find((s) => s.id === params.scheduleId);
    if (!schedule) throw new Error('Schedule not found');
    schedule.is_active = false;
  }

  private simulateDelay(): Promise<void> {
    const delay = import.meta.env.MODE === 'test' ? 0 : 300;
    return new Promise((resolve) => setTimeout(resolve, delay));
  }
}
