/**
 * Schedule List ViewModel
 *
 * Manages state and business logic for schedule template list display and CRUD operations.
 * Operates on ScheduleTemplate[] (not per-user rows).
 *
 * @see IScheduleService
 * @see ScheduleFormViewModel for form state
 */

import { makeAutoObservable, runInAction } from 'mobx';
import { Logger } from '@/utils/logger';
import type { IScheduleService, ScheduleDeleteResult } from '@/services/schedule/IScheduleService';
import { getScheduleService } from '@/services/schedule/ScheduleServiceFactory';
import type { ScheduleTemplate } from '@/types/schedule.types';

const log = Logger.getLogger('viewmodel');

export type ScheduleStatusFilter = 'all' | 'active' | 'inactive';

export class ScheduleListViewModel {
  // Observable State
  private rawTemplates: ScheduleTemplate[] = [];
  selectedTemplateId: string | null = null;
  isLoading = false;
  error: string | null = null;
  statusFilter: ScheduleStatusFilter = 'all';
  searchTerm = '';

  constructor(private service: IScheduleService = getScheduleService()) {
    makeAutoObservable(this);
    log.debug('ScheduleListViewModel initialized');
  }

  // Computed Properties

  get templates(): ScheduleTemplate[] {
    let result = [...this.rawTemplates];

    if (this.statusFilter === 'active') {
      result = result.filter((t) => t.is_active);
    } else if (this.statusFilter === 'inactive') {
      result = result.filter((t) => !t.is_active);
    }

    if (this.searchTerm.trim()) {
      const term = this.searchTerm.toLowerCase();
      result = result.filter(
        (t) =>
          t.schedule_name.toLowerCase().includes(term) ||
          t.org_unit_name?.toLowerCase().includes(term)
      );
    }

    return result;
  }

  get selectedTemplate(): ScheduleTemplate | null {
    if (!this.selectedTemplateId) return null;
    return this.rawTemplates.find((t) => t.id === this.selectedTemplateId) ?? null;
  }

  get templateCount(): number {
    return this.rawTemplates.length;
  }

  get activeTemplateCount(): number {
    return this.rawTemplates.filter((t) => t.is_active).length;
  }

  get canEdit(): boolean {
    const t = this.selectedTemplate;
    return t !== null && t.is_active;
  }

  get canDeactivate(): boolean {
    const t = this.selectedTemplate;
    return t !== null && t.is_active;
  }

  get canReactivate(): boolean {
    const t = this.selectedTemplate;
    return t !== null && !t.is_active;
  }

  get canDelete(): boolean {
    return this.selectedTemplate !== null;
  }

  // Actions - Data Loading

  async loadTemplates(): Promise<void> {
    log.debug('Loading schedule templates');

    runInAction(() => {
      this.isLoading = true;
      this.error = null;
    });

    try {
      const templates = await this.service.listTemplates({ status: 'all' });

      runInAction(() => {
        this.rawTemplates = templates;
        this.isLoading = false;
        log.info('Loaded schedule templates', { count: templates.length });
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to load schedule templates';
      runInAction(() => {
        this.isLoading = false;
        this.error = message;
      });
      log.error('Failed to load schedule templates', error);
    }
  }

  async refresh(): Promise<void> {
    await this.loadTemplates();
  }

  // Actions - Selection

  selectTemplate(templateId: string | null): void {
    runInAction(() => {
      this.selectedTemplateId = templateId;
      log.debug('Selected template', { templateId });
    });
  }

  clearSelection(): void {
    this.selectTemplate(null);
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

  async deactivateTemplate(
    templateId: string,
    reason: string
  ): Promise<{ success: boolean; error?: string }> {
    log.debug('Deactivating schedule template', { templateId });

    runInAction(() => {
      this.isLoading = true;
      this.error = null;
    });

    try {
      await this.service.deactivateTemplate({ templateId, reason });

      runInAction(() => {
        const idx = this.rawTemplates.findIndex((t) => t.id === templateId);
        if (idx !== -1) {
          this.rawTemplates = [
            ...this.rawTemplates.slice(0, idx),
            { ...this.rawTemplates[idx], is_active: false },
            ...this.rawTemplates.slice(idx + 1),
          ];
        }
        this.isLoading = false;
      });
      log.info('Deactivated schedule template', { templateId });
      return { success: true };
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Failed to deactivate schedule template';
      runInAction(() => {
        this.error = message;
        this.isLoading = false;
      });
      log.error('Error deactivating schedule template', error);
      return { success: false, error: message };
    }
  }

  async reactivateTemplate(
    templateId: string,
    _reason: string
  ): Promise<{ success: boolean; error?: string }> {
    log.debug('Reactivating schedule template', { templateId });

    runInAction(() => {
      this.isLoading = true;
      this.error = null;
    });

    try {
      await this.service.reactivateTemplate({ templateId });

      runInAction(() => {
        const idx = this.rawTemplates.findIndex((t) => t.id === templateId);
        if (idx !== -1) {
          this.rawTemplates = [
            ...this.rawTemplates.slice(0, idx),
            { ...this.rawTemplates[idx], is_active: true },
            ...this.rawTemplates.slice(idx + 1),
          ];
        }
        this.isLoading = false;
      });
      log.info('Reactivated schedule template', { templateId });
      return { success: true };
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Failed to reactivate schedule template';
      runInAction(() => {
        this.error = message;
        this.isLoading = false;
      });
      log.error('Error reactivating schedule template', error);
      return { success: false, error: message };
    }
  }

  async deleteTemplate(templateId: string, reason: string): Promise<ScheduleDeleteResult> {
    log.debug('Deleting schedule template', { templateId });

    runInAction(() => {
      this.isLoading = true;
      this.error = null;
    });

    try {
      const result = await this.service.deleteTemplate({ templateId, reason });

      runInAction(() => {
        if (result.success) {
          this.rawTemplates = this.rawTemplates.filter((t) => t.id !== templateId);
          if (this.selectedTemplateId === templateId) {
            this.selectedTemplateId = null;
          }
        }
        this.isLoading = false;
      });

      if (result.success) {
        log.info('Deleted schedule template', { templateId });
      } else {
        log.warn('Delete schedule template returned error', { templateId, result });
      }

      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to delete schedule template';
      runInAction(() => {
        this.error = message;
        this.isLoading = false;
      });
      log.error('Error deleting schedule template', error);
      return { success: false, error: message };
    }
  }

  // Utility

  clearError(): void {
    runInAction(() => {
      this.error = null;
    });
  }

  getTemplateById(templateId: string): ScheduleTemplate | null {
    return this.rawTemplates.find((t) => t.id === templateId) ?? null;
  }
}
