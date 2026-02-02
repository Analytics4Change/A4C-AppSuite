/**
 * Schedule List ViewModel
 *
 * Manages state for the schedule overview page: loading, filtering,
 * and deactivating schedules.
 */

import { makeAutoObservable, runInAction } from 'mobx';
import type { UserSchedulePolicy } from '@/types/schedule.types';
import type { IScheduleService } from '@/services/schedule/IScheduleService';
import { getScheduleService } from '@/services/schedule/ScheduleServiceFactory';
import { Logger } from '@/utils/logger';

const log = Logger.getLogger('viewmodel');

export class ScheduleListViewModel {
  schedules: UserSchedulePolicy[] = [];
  isLoading = false;
  error: string | null = null;

  filterUserId: string | null = null;
  filterOrgUnitId: string | null = null;
  showInactive = false;

  constructor(
    private service: IScheduleService = getScheduleService()
  ) {
    makeAutoObservable(this);
  }

  async loadSchedules(): Promise<void> {
    runInAction(() => {
      this.isLoading = true;
      this.error = null;
    });

    try {
      const schedules = await this.service.listSchedules({
        userId: this.filterUserId ?? undefined,
        orgUnitId: this.filterOrgUnitId ?? undefined,
        activeOnly: !this.showInactive,
      });

      runInAction(() => {
        this.schedules = schedules;
        this.isLoading = false;
      });

      log.debug('Schedules loaded', { count: schedules.length });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to load schedules';
      runInAction(() => {
        this.error = message;
        this.isLoading = false;
      });
      log.error('Failed to load schedules', { error });
    }
  }

  setFilterUserId(userId: string | null): void {
    this.filterUserId = userId;
  }

  setFilterOrgUnitId(orgUnitId: string | null): void {
    this.filterOrgUnitId = orgUnitId;
  }

  setShowInactive(show: boolean): void {
    this.showInactive = show;
  }

  async deactivateSchedule(scheduleId: string, reason: string): Promise<boolean> {
    try {
      await this.service.deactivateSchedule({ scheduleId, reason });
      await this.loadSchedules();
      return true;
    } catch (error) {
      log.error('Failed to deactivate schedule', { error, scheduleId });
      return false;
    }
  }
}
