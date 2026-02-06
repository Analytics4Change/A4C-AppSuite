/**
 * Schedule List ViewModel
 *
 * Manages state and business logic for schedule list display and CRUD operations.
 * Mirrors RolesViewModel pattern with named-schedule grouping.
 *
 * @see IScheduleService
 * @see ScheduleFormViewModel for form state
 */

import { makeAutoObservable, runInAction } from 'mobx';
import { Logger } from '@/utils/logger';
import type { IScheduleService } from '@/services/schedule/IScheduleService';
import { getScheduleService } from '@/services/schedule/ScheduleServiceFactory';
import type { UserSchedulePolicy } from '@/types/schedule.types';

const log = Logger.getLogger('viewmodel');

export type ScheduleStatusFilter = 'all' | 'active' | 'inactive';

export class ScheduleListViewModel {
  // Observable State
  private rawSchedules: UserSchedulePolicy[] = [];
  selectedScheduleId: string | null = null;
  isLoading = false;
  error: string | null = null;
  statusFilter: ScheduleStatusFilter = 'all';
  searchTerm = '';

  constructor(private service: IScheduleService = getScheduleService()) {
    makeAutoObservable(this);
    log.debug('ScheduleListViewModel initialized');
  }

  // Computed Properties

  get schedules(): UserSchedulePolicy[] {
    let result = [...this.rawSchedules];

    if (this.statusFilter === 'active') {
      result = result.filter((s) => s.is_active);
    } else if (this.statusFilter === 'inactive') {
      result = result.filter((s) => !s.is_active);
    }

    if (this.searchTerm.trim()) {
      const term = this.searchTerm.toLowerCase();
      result = result.filter(
        (s) =>
          s.schedule_name.toLowerCase().includes(term) ||
          s.user_name?.toLowerCase().includes(term) ||
          s.user_email?.toLowerCase().includes(term)
      );
    }

    return result;
  }

  get selectedSchedule(): UserSchedulePolicy | null {
    if (!this.selectedScheduleId) return null;
    return this.rawSchedules.find((s) => s.id === this.selectedScheduleId) ?? null;
  }

  /** Unique schedule names with their user counts and active status */
  get scheduleGroups(): {
    name: string;
    count: number;
    activeCount: number;
    schedules: UserSchedulePolicy[];
  }[] {
    const groups = new Map<string, UserSchedulePolicy[]>();
    for (const s of this.schedules) {
      const existing = groups.get(s.schedule_name) ?? [];
      existing.push(s);
      groups.set(s.schedule_name, existing);
    }
    return Array.from(groups.entries()).map(([name, schedules]) => ({
      name,
      count: schedules.length,
      activeCount: schedules.filter((s) => s.is_active).length,
      schedules,
    }));
  }

  get scheduleCount(): number {
    return this.rawSchedules.length;
  }

  get activeScheduleCount(): number {
    return this.rawSchedules.filter((s) => s.is_active).length;
  }

  get canEdit(): boolean {
    const s = this.selectedSchedule;
    return s !== null && s.is_active;
  }

  get canDeactivate(): boolean {
    const s = this.selectedSchedule;
    return s !== null && s.is_active;
  }

  get canReactivate(): boolean {
    const s = this.selectedSchedule;
    return s !== null && !s.is_active;
  }

  get canDelete(): boolean {
    const s = this.selectedSchedule;
    return s !== null && !s.is_active;
  }

  // Actions - Data Loading

  async loadSchedules(): Promise<void> {
    log.debug('Loading schedules');

    runInAction(() => {
      this.isLoading = true;
      this.error = null;
    });

    try {
      const schedules = await this.service.listSchedules({ activeOnly: false });

      runInAction(() => {
        this.rawSchedules = schedules;
        this.isLoading = false;
        log.info('Loaded schedules', { count: schedules.length });
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to load schedules';
      runInAction(() => {
        this.isLoading = false;
        this.error = message;
      });
      log.error('Failed to load schedules', error);
    }
  }

  async refresh(): Promise<void> {
    await this.loadSchedules();
  }

  // Actions - Selection

  selectSchedule(scheduleId: string | null): void {
    runInAction(() => {
      this.selectedScheduleId = scheduleId;
      log.debug('Selected schedule', { scheduleId });
    });
  }

  clearSelection(): void {
    this.selectSchedule(null);
  }

  // Actions - Filtering

  setStatusFilter(status: ScheduleStatusFilter): void {
    runInAction(() => {
      this.statusFilter = status;
    });
  }

  setSearchTerm(term: string): void {
    runInAction(() => {
      this.searchTerm = term;
    });
  }

  // Actions - CRUD Operations

  async deactivateSchedule(
    scheduleId: string,
    reason: string
  ): Promise<{ success: boolean; error?: string }> {
    log.debug('Deactivating schedule', { scheduleId });

    runInAction(() => {
      this.isLoading = true;
      this.error = null;
    });

    try {
      await this.service.deactivateSchedule({ scheduleId, reason });

      runInAction(() => {
        const idx = this.rawSchedules.findIndex((s) => s.id === scheduleId);
        if (idx !== -1) {
          this.rawSchedules = [
            ...this.rawSchedules.slice(0, idx),
            { ...this.rawSchedules[idx], is_active: false },
            ...this.rawSchedules.slice(idx + 1),
          ];
        }
        this.isLoading = false;
      });
      log.info('Deactivated schedule', { scheduleId });
      return { success: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to deactivate schedule';
      runInAction(() => {
        this.error = message;
        this.isLoading = false;
      });
      log.error('Error deactivating schedule', error);
      return { success: false, error: message };
    }
  }

  async reactivateSchedule(
    scheduleId: string,
    reason: string
  ): Promise<{ success: boolean; error?: string }> {
    log.debug('Reactivating schedule', { scheduleId });

    runInAction(() => {
      this.isLoading = true;
      this.error = null;
    });

    try {
      await this.service.reactivateSchedule({ scheduleId, reason });

      runInAction(() => {
        const idx = this.rawSchedules.findIndex((s) => s.id === scheduleId);
        if (idx !== -1) {
          this.rawSchedules = [
            ...this.rawSchedules.slice(0, idx),
            { ...this.rawSchedules[idx], is_active: true },
            ...this.rawSchedules.slice(idx + 1),
          ];
        }
        this.isLoading = false;
      });
      log.info('Reactivated schedule', { scheduleId });
      return { success: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to reactivate schedule';
      runInAction(() => {
        this.error = message;
        this.isLoading = false;
      });
      log.error('Error reactivating schedule', error);
      return { success: false, error: message };
    }
  }

  async deleteSchedule(
    scheduleId: string,
    reason: string
  ): Promise<{ success: boolean; error?: string }> {
    log.debug('Deleting schedule', { scheduleId });

    runInAction(() => {
      this.isLoading = true;
      this.error = null;
    });

    try {
      await this.service.deleteSchedule({ scheduleId, reason });

      runInAction(() => {
        this.rawSchedules = this.rawSchedules.filter((s) => s.id !== scheduleId);
        if (this.selectedScheduleId === scheduleId) {
          this.selectedScheduleId = null;
        }
        this.isLoading = false;
      });
      log.info('Deleted schedule', { scheduleId });
      return { success: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to delete schedule';
      runInAction(() => {
        this.error = message;
        this.isLoading = false;
      });
      log.error('Error deleting schedule', error);
      return { success: false, error: message };
    }
  }

  // Utility

  clearError(): void {
    runInAction(() => {
      this.error = null;
    });
  }

  getScheduleById(scheduleId: string): UserSchedulePolicy | null {
    return this.rawSchedules.find((s) => s.id === scheduleId) ?? null;
  }
}
