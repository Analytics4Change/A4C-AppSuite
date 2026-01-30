/**
 * Direct Care Settings ViewModel
 *
 * Manages state and business logic for the organization direct care
 * settings page. Supports toggling feature flags with dirty checking,
 * save with audit reason, and reset.
 *
 * Usage:
 * ```typescript
 * const vm = new DirectCareSettingsViewModel();
 * await vm.loadSettings('org-uuid');
 * vm.toggleStaffClientMapping();
 * await vm.saveSettings('Enabling staff-client mapping for pilot program');
 * ```
 */

import { makeAutoObservable, runInAction } from 'mobx';
import type { DirectCareSettings } from '@/types/direct-care-settings.types';
import type { IDirectCareSettingsService } from '@/services/direct-care/IDirectCareSettingsService';
import { getDirectCareSettingsService } from '@/services/direct-care/DirectCareSettingsServiceFactory';
import { Logger } from '@/utils/logger';

const log = Logger.getLogger('viewmodel');

export class DirectCareSettingsViewModel {
  settings: DirectCareSettings | null = null;
  originalSettings: DirectCareSettings | null = null;
  orgId: string | null = null;

  isLoading = false;
  isSaving = false;
  loadError: string | null = null;
  saveError: string | null = null;
  saveSuccess = false;

  reason = '';

  constructor(
    private service: IDirectCareSettingsService = getDirectCareSettingsService()
  ) {
    makeAutoObservable(this);
    log.debug('DirectCareSettingsViewModel initialized');
  }

  async loadSettings(orgId: string): Promise<void> {
    runInAction(() => {
      this.orgId = orgId;
      this.isLoading = true;
      this.loadError = null;
      this.saveSuccess = false;
    });

    try {
      log.debug('Loading direct care settings', { orgId });
      const settings = await this.service.getSettings(orgId);

      runInAction(() => {
        this.settings = { ...settings };
        this.originalSettings = { ...settings };
        this.isLoading = false;
        this.reason = '';
      });

      log.info('Direct care settings loaded', { orgId, settings });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to load settings';
      runInAction(() => {
        this.loadError = message;
        this.isLoading = false;
      });
      log.error('Failed to load direct care settings', { error, orgId });
    }
  }

  toggleStaffClientMapping(): void {
    if (!this.settings) return;
    runInAction(() => {
      this.settings = {
        ...this.settings!,
        enable_staff_client_mapping: !this.settings!.enable_staff_client_mapping,
      };
      this.saveSuccess = false;
    });
  }

  toggleScheduleEnforcement(): void {
    if (!this.settings) return;
    runInAction(() => {
      this.settings = {
        ...this.settings!,
        enable_schedule_enforcement: !this.settings!.enable_schedule_enforcement,
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

  get hasChanges(): boolean {
    if (!this.settings || !this.originalSettings) return false;
    return (
      this.settings.enable_staff_client_mapping !== this.originalSettings.enable_staff_client_mapping ||
      this.settings.enable_schedule_enforcement !== this.originalSettings.enable_schedule_enforcement
    );
  }

  get isReasonValid(): boolean {
    return this.reason.trim().length >= 10;
  }

  get canSave(): boolean {
    return this.hasChanges && this.isReasonValid && !this.isSaving && this.settings !== null;
  }

  async saveSettings(): Promise<boolean> {
    if (!this.orgId || !this.settings || !this.canSave) {
      return false;
    }

    runInAction(() => {
      this.isSaving = true;
      this.saveError = null;
      this.saveSuccess = false;
    });

    try {
      const staffMapping = this.settings.enable_staff_client_mapping !== this.originalSettings?.enable_staff_client_mapping
        ? this.settings.enable_staff_client_mapping
        : null;
      const scheduleEnforcement = this.settings.enable_schedule_enforcement !== this.originalSettings?.enable_schedule_enforcement
        ? this.settings.enable_schedule_enforcement
        : null;

      log.debug('Saving direct care settings', {
        orgId: this.orgId,
        staffMapping,
        scheduleEnforcement,
        reason: this.reason,
      });

      await this.service.updateSettings(
        this.orgId,
        staffMapping,
        scheduleEnforcement,
        this.reason.trim(),
      );

      // Reload to confirm server state
      await this.loadSettings(this.orgId);

      runInAction(() => {
        this.isSaving = false;
        this.saveSuccess = true;
        this.reason = '';
      });

      log.info('Direct care settings saved', { orgId: this.orgId });
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to save settings';
      runInAction(() => {
        this.saveError = message;
        this.isSaving = false;
      });
      log.error('Failed to save direct care settings', { error, orgId: this.orgId });
      return false;
    }
  }

  resetChanges(): void {
    if (!this.originalSettings) return;
    runInAction(() => {
      this.settings = { ...this.originalSettings! };
      this.reason = '';
      this.saveError = null;
      this.saveSuccess = false;
    });
  }
}
