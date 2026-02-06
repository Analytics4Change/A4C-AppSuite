/**
 * Schedule Form ViewModel
 *
 * Manages state and business logic for schedule create/edit forms.
 * Mirrors RoleFormViewModel pattern: form data, validation, dirty tracking, submit.
 *
 * @see IScheduleService
 * @see ScheduleListViewModel for list state
 */

import { makeAutoObservable, runInAction } from 'mobx';
import { Logger } from '@/utils/logger';
import type { IScheduleService } from '@/services/schedule/IScheduleService';
import { getScheduleService } from '@/services/schedule/ScheduleServiceFactory';
import type {
  UserSchedulePolicy,
  WeeklySchedule,
  DayOfWeek,
  DaySchedule,
} from '@/types/schedule.types';
import { DAYS_OF_WEEK } from '@/types/schedule.types';

const log = Logger.getLogger('viewmodel');

export type ScheduleFormMode = 'create' | 'edit';

const DEFAULT_DAY: DaySchedule = { begin: '0800', end: '1600' };

/** Sanitize schedule for submission: days without both begin AND end become null */
function sanitizeSchedule(schedule: WeeklySchedule): WeeklySchedule {
  const result = { ...schedule };
  for (const day of DAYS_OF_WEEK) {
    const entry = result[day];
    if (!entry || !entry.begin || !entry.end) {
      result[day] = null;
    }
  }
  return result;
}

export interface ScheduleFormData {
  scheduleName: string;
  schedule: WeeklySchedule;
  orgUnitId: string | null;
  effectiveFrom: string | null;
  effectiveUntil: string | null;
}

export class ScheduleFormViewModel {
  // Observable State
  formData: ScheduleFormData;
  private originalData: ScheduleFormData;

  /** User IDs to assign this schedule to (create mode) */
  assignedUserIds: string[] = [];

  errors: Map<string, string> = new Map();
  touchedFields: Set<string> = new Set();
  isSubmitting = false;
  submissionError: string | null = null;

  readonly mode: ScheduleFormMode;
  readonly editingScheduleId: string | null;

  constructor(
    private service: IScheduleService = getScheduleService(),
    mode: ScheduleFormMode = 'create',
    existingSchedule?: UserSchedulePolicy
  ) {
    this.mode = mode;
    this.editingScheduleId = existingSchedule?.id ?? null;

    if (mode === 'edit' && existingSchedule) {
      this.formData = {
        scheduleName: existingSchedule.schedule_name,
        schedule: { ...existingSchedule.schedule },
        orgUnitId: existingSchedule.org_unit_id ?? null,
        effectiveFrom: existingSchedule.effective_from ?? null,
        effectiveUntil: existingSchedule.effective_until ?? null,
      };
    } else {
      this.formData = {
        scheduleName: '',
        schedule: {
          monday: { begin: '', end: '' },
          tuesday: { begin: '', end: '' },
          wednesday: { begin: '', end: '' },
          thursday: { begin: '', end: '' },
          friday: { begin: '', end: '' },
          saturday: { begin: '', end: '' },
          sunday: { begin: '', end: '' },
        },
        orgUnitId: null,
        effectiveFrom: null,
        effectiveUntil: null,
      };
    }

    this.originalData = {
      ...this.formData,
      schedule: { ...this.formData.schedule },
    };

    makeAutoObservable(this);
    log.debug('ScheduleFormViewModel initialized', {
      mode,
      editingScheduleId: this.editingScheduleId,
    });
  }

  // Computed Properties

  get hasErrors(): boolean {
    return this.errors.size > 0;
  }

  get isDirty(): boolean {
    if (this.formData.scheduleName !== this.originalData.scheduleName) return true;
    if (this.formData.orgUnitId !== this.originalData.orgUnitId) return true;
    if (this.formData.effectiveFrom !== this.originalData.effectiveFrom) return true;
    if (this.formData.effectiveUntil !== this.originalData.effectiveUntil) return true;
    if (JSON.stringify(this.formData.schedule) !== JSON.stringify(this.originalData.schedule))
      return true;
    return false;
  }

  get isValid(): boolean {
    return this.validateAll();
  }

  get canSubmit(): boolean {
    return this.isDirty && !this.isSubmitting && this.validateAll();
  }

  get activeDayCount(): number {
    return DAYS_OF_WEEK.filter(
      (day) => this.formData.schedule[day] !== null && this.formData.schedule[day] !== undefined
    ).length;
  }

  // Field accessors

  getFieldError(field: string): string | null {
    if (!this.touchedFields.has(field)) return null;
    return this.errors.get(field) ?? null;
  }

  hasFieldError(field: string): boolean {
    return this.touchedFields.has(field) && this.errors.has(field);
  }

  // Actions - Field Updates

  setScheduleName(name: string): void {
    runInAction(() => {
      this.formData = { ...this.formData, scheduleName: name };
      this.touchedFields.add('scheduleName');
      this.submissionError = null;
      this.validateField('scheduleName');
    });
  }

  setOrgUnitId(id: string | null): void {
    runInAction(() => {
      this.formData = { ...this.formData, orgUnitId: id };
      this.submissionError = null;
    });
  }

  setEffectiveFrom(date: string | null): void {
    runInAction(() => {
      this.formData = { ...this.formData, effectiveFrom: date };
      this.submissionError = null;
    });
  }

  setEffectiveUntil(date: string | null): void {
    runInAction(() => {
      this.formData = { ...this.formData, effectiveUntil: date };
      this.submissionError = null;
    });
  }

  toggleDay(day: DayOfWeek): void {
    runInAction(() => {
      const current = this.formData.schedule[day];
      this.formData = {
        ...this.formData,
        schedule: {
          ...this.formData.schedule,
          [day]: current ? null : { ...DEFAULT_DAY },
        },
      };
      this.submissionError = null;
    });
  }

  setDayTime(day: DayOfWeek, field: 'begin' | 'end', value: string): void {
    const current = this.formData.schedule[day];
    if (!current) return;

    const hhmm = value.replace(':', '');
    runInAction(() => {
      this.formData = {
        ...this.formData,
        schedule: {
          ...this.formData.schedule,
          [day]: { ...current, [field]: hhmm },
        },
      };
      this.submissionError = null;
    });
  }

  setAssignedUserIds(ids: string[]): void {
    runInAction(() => {
      this.assignedUserIds = ids;
    });
  }

  touchField(field: string): void {
    runInAction(() => {
      this.touchedFields.add(field);
      this.validateField(field);
    });
  }

  touchAllFields(): void {
    runInAction(() => {
      this.touchedFields.add('scheduleName');
      this.validateAll();
    });
  }

  // Validation

  validateField(field: string): boolean {
    let error: string | null = null;

    switch (field) {
      case 'scheduleName': {
        const name = this.formData.scheduleName.trim();
        if (!name) {
          error = 'Schedule name is required';
        } else if (name.length < 3) {
          error = 'Schedule name must be at least 3 characters';
        } else if (name.length > 100) {
          error = 'Schedule name must be 100 characters or less';
        }
        break;
      }
    }

    runInAction(() => {
      if (error) {
        this.errors.set(field, error);
      } else {
        this.errors.delete(field);
      }
    });

    return !error;
  }

  validateAll(): boolean {
    return this.validateField('scheduleName');
  }

  // Submission

  async submit(): Promise<{ success: boolean; scheduleId?: string; error?: string }> {
    this.touchAllFields();

    if (!this.validateAll()) {
      log.warn('Form validation failed', { errors: Array.from(this.errors.entries()) });
      return { success: false, error: 'Please fix validation errors before submitting' };
    }

    runInAction(() => {
      this.isSubmitting = true;
      this.submissionError = null;
    });

    try {
      // Sanitize: days without both begin and end times become inactive (null)
      const cleanSchedule = sanitizeSchedule(this.formData.schedule);

      if (this.mode === 'create') {
        // For create mode, we create one schedule per assigned user
        // If no users assigned, create a "template" with a placeholder user
        const userIds = this.assignedUserIds.length > 0 ? this.assignedUserIds : [];

        let firstScheduleId: string | undefined;
        for (const userId of userIds) {
          const result = await this.service.createSchedule({
            userId,
            scheduleName: this.formData.scheduleName.trim(),
            schedule: cleanSchedule,
            orgUnitId: this.formData.orgUnitId ?? undefined,
            effectiveFrom: this.formData.effectiveFrom ?? undefined,
            effectiveUntil: this.formData.effectiveUntil ?? undefined,
          });
          if (!firstScheduleId) firstScheduleId = result.scheduleId;
        }

        runInAction(() => {
          this.isSubmitting = false;
          this.originalData = { ...this.formData, schedule: { ...this.formData.schedule } };
          log.info('Schedule(s) created', { count: userIds.length });
        });

        return { success: true, scheduleId: firstScheduleId };
      } else {
        // Edit mode
        if (!this.editingScheduleId) {
          throw new Error('No schedule ID for edit mode');
        }

        await this.service.updateSchedule({
          scheduleId: this.editingScheduleId,
          scheduleName: this.formData.scheduleName.trim(),
          schedule: cleanSchedule,
          orgUnitId: this.formData.orgUnitId ?? undefined,
          effectiveFrom: this.formData.effectiveFrom ?? undefined,
          effectiveUntil: this.formData.effectiveUntil ?? undefined,
        });

        runInAction(() => {
          this.isSubmitting = false;
          this.originalData = { ...this.formData, schedule: { ...this.formData.schedule } };
          log.info('Schedule updated', { scheduleId: this.editingScheduleId });
        });

        return { success: true, scheduleId: this.editingScheduleId };
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to submit form';
      runInAction(() => {
        this.isSubmitting = false;
        this.submissionError = message;
      });
      log.error('Form submission error', error);
      return { success: false, error: message };
    }
  }

  // Form Management

  reset(): void {
    runInAction(() => {
      this.formData = { ...this.originalData, schedule: { ...this.originalData.schedule } };
      this.errors.clear();
      this.touchedFields.clear();
      this.submissionError = null;
      log.debug('Form reset');
    });
  }

  clearSubmissionError(): void {
    runInAction(() => {
      this.submissionError = null;
    });
  }
}
