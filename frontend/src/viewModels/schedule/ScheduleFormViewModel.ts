/**
 * Schedule Form ViewModel
 *
 * Manages state and business logic for schedule template create/edit forms.
 * In the template model, the form manages template fields (name, schedule, OU).
 * User assignments are managed separately via the assignment dialog.
 *
 * @see IScheduleService
 * @see ScheduleListViewModel for list state
 */

import { makeAutoObservable, runInAction } from 'mobx';
import { Logger } from '@/utils/logger';
import type { IScheduleService } from '@/services/schedule/IScheduleService';
import { getScheduleService } from '@/services/schedule/ScheduleServiceFactory';
import type {
  ScheduleTemplate,
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
  readonly editingTemplateId: string | null;

  constructor(
    private service: IScheduleService = getScheduleService(),
    mode: ScheduleFormMode = 'create',
    existingTemplate?: ScheduleTemplate
  ) {
    this.mode = mode;
    this.editingTemplateId = existingTemplate?.id ?? null;

    if (mode === 'edit' && existingTemplate) {
      this.formData = {
        scheduleName: existingTemplate.schedule_name,
        schedule: { ...existingTemplate.schedule },
        orgUnitId: existingTemplate.org_unit_id ?? null,
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
      };
    }

    this.originalData = {
      ...this.formData,
      schedule: { ...this.formData.schedule },
    };

    makeAutoObservable(this);
    log.debug('ScheduleFormViewModel initialized', {
      mode,
      editingTemplateId: this.editingTemplateId,
    });
  }

  // Computed Properties

  get hasErrors(): boolean {
    return this.errors.size > 0;
  }

  get isDirty(): boolean {
    if (this.formData.scheduleName !== this.originalData.scheduleName) return true;
    if (this.formData.orgUnitId !== this.originalData.orgUnitId) return true;
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

  async submit(): Promise<{ success: boolean; templateId?: string; error?: string }> {
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
      const cleanSchedule = sanitizeSchedule(this.formData.schedule);

      if (this.mode === 'create') {
        const result = await this.service.createTemplate({
          name: this.formData.scheduleName.trim(),
          schedule: cleanSchedule,
          orgUnitId: this.formData.orgUnitId ?? undefined,
          userIds: this.assignedUserIds,
        });

        runInAction(() => {
          this.isSubmitting = false;
          this.originalData = { ...this.formData, schedule: { ...this.formData.schedule } };
          log.info('Schedule template created', { templateId: result.templateId });
        });

        return { success: true, templateId: result.templateId };
      } else {
        if (!this.editingTemplateId) {
          throw new Error('No template ID for edit mode');
        }

        await this.service.updateTemplate({
          templateId: this.editingTemplateId,
          name: this.formData.scheduleName.trim(),
          schedule: cleanSchedule,
          orgUnitId: this.formData.orgUnitId,
        });

        runInAction(() => {
          this.isSubmitting = false;
          this.originalData = { ...this.formData, schedule: { ...this.formData.schedule } };
          log.info('Schedule template updated', { templateId: this.editingTemplateId });
        });

        return { success: true, templateId: this.editingTemplateId };
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
