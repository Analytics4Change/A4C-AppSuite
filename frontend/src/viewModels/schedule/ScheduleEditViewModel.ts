/**
 * Schedule Edit ViewModel
 *
 * Manages state for editing a single user's weekly schedule.
 * Supports creating new schedules or editing existing ones.
 */

import { makeAutoObservable, runInAction } from 'mobx';
import type {
  UserSchedulePolicy,
  WeeklySchedule,
  DaySchedule,
  DayOfWeek,
} from '@/types/schedule.types';
import { DAYS_OF_WEEK } from '@/types/schedule.types';
import type { IScheduleService } from '@/services/schedule/IScheduleService';
import { getScheduleService } from '@/services/schedule/ScheduleServiceFactory';
import { Logger } from '@/utils/logger';

const log = Logger.getLogger('viewmodel');

const EMPTY_SCHEDULE: WeeklySchedule = {
  monday: null,
  tuesday: null,
  wednesday: null,
  thursday: null,
  friday: null,
  saturday: null,
  sunday: null,
};

const DEFAULT_DAY: DaySchedule = { begin: '0800', end: '1600' };

export class ScheduleEditViewModel {
  existingSchedule: UserSchedulePolicy | null = null;
  editedSchedule: WeeklySchedule = { ...EMPTY_SCHEDULE };
  userId: string | null = null;
  orgUnitId: string | null = null;
  effectiveFrom: string | null = null;
  effectiveUntil: string | null = null;
  reason = '';

  isLoading = false;
  isSaving = false;
  error: string | null = null;
  saveError: string | null = null;
  saveSuccess = false;

  constructor(
    private service: IScheduleService = getScheduleService()
  ) {
    makeAutoObservable(this);
  }

  get isNewSchedule(): boolean {
    return this.existingSchedule === null;
  }

  get hasChanges(): boolean {
    if (this.isNewSchedule) {
      return DAYS_OF_WEEK.some((day) => this.editedSchedule[day] !== null);
    }
    return JSON.stringify(this.editedSchedule) !== JSON.stringify(this.existingSchedule?.schedule);
  }

  get isReasonValid(): boolean {
    return this.reason.trim().length >= 10;
  }

  get canSave(): boolean {
    return this.hasChanges && this.isReasonValid && !this.isSaving;
  }

  async loadSchedule(userId: string): Promise<void> {
    runInAction(() => {
      this.userId = userId;
      this.isLoading = true;
      this.error = null;
    });

    try {
      const schedules = await this.service.listSchedules({
        userId,
        activeOnly: true,
      });

      runInAction(() => {
        if (schedules.length > 0) {
          this.existingSchedule = schedules[0];
          this.editedSchedule = { ...schedules[0].schedule };
          this.orgUnitId = schedules[0].org_unit_id ?? null;
          this.effectiveFrom = schedules[0].effective_from ?? null;
          this.effectiveUntil = schedules[0].effective_until ?? null;
        } else {
          this.existingSchedule = null;
          this.editedSchedule = { ...EMPTY_SCHEDULE };
        }
        this.isLoading = false;
        this.reason = '';
        this.saveSuccess = false;
      });

      log.debug('Schedule loaded for user', { userId, isNew: schedules.length === 0 });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to load schedule';
      runInAction(() => {
        this.error = message;
        this.isLoading = false;
      });
      log.error('Failed to load schedule', { error, userId });
    }
  }

  toggleDay(day: DayOfWeek): void {
    runInAction(() => {
      if (this.editedSchedule[day]) {
        this.editedSchedule = { ...this.editedSchedule, [day]: null };
      } else {
        this.editedSchedule = { ...this.editedSchedule, [day]: { ...DEFAULT_DAY } };
      }
      this.saveSuccess = false;
    });
  }

  setDayTime(day: DayOfWeek, field: 'begin' | 'end', value: string): void {
    const current = this.editedSchedule[day];
    if (!current) return;

    // Convert HH:MM to HHMM
    const hhmm = value.replace(':', '');

    runInAction(() => {
      this.editedSchedule = {
        ...this.editedSchedule,
        [day]: { ...current, [field]: hhmm },
      };
      this.saveSuccess = false;
    });
  }

  setReason(value: string): void {
    runInAction(() => {
      this.reason = value;
      this.saveSuccess = false;
    });
  }

  async save(): Promise<boolean> {
    if (!this.userId || !this.canSave) return false;

    runInAction(() => {
      this.isSaving = true;
      this.saveError = null;
      this.saveSuccess = false;
    });

    try {
      if (this.isNewSchedule) {
        await this.service.createSchedule({
          userId: this.userId,
          schedule: this.editedSchedule,
          orgUnitId: this.orgUnitId ?? undefined,
          effectiveFrom: this.effectiveFrom ?? undefined,
          effectiveUntil: this.effectiveUntil ?? undefined,
          reason: this.reason.trim(),
        });
      } else {
        await this.service.updateSchedule({
          scheduleId: this.existingSchedule!.id,
          schedule: this.editedSchedule,
          reason: this.reason.trim(),
        });
      }

      // Reload to confirm server state
      await this.loadSchedule(this.userId);

      runInAction(() => {
        this.isSaving = false;
        this.saveSuccess = true;
        this.reason = '';
      });

      log.info('Schedule saved', { userId: this.userId });
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to save schedule';
      runInAction(() => {
        this.saveError = message;
        this.isSaving = false;
      });
      log.error('Failed to save schedule', { error });
      return false;
    }
  }

  resetChanges(): void {
    runInAction(() => {
      if (this.existingSchedule) {
        this.editedSchedule = { ...this.existingSchedule.schedule };
      } else {
        this.editedSchedule = { ...EMPTY_SCHEDULE };
      }
      this.reason = '';
      this.saveError = null;
      this.saveSuccess = false;
    });
  }
}
