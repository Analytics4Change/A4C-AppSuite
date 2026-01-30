/**
 * Mock Direct Care Settings Service
 *
 * In-memory implementation for local development and testing.
 * Simulates async behavior with brief delays.
 */

import { Logger } from '@/utils/logger';
import type { DirectCareSettings } from '@/types/direct-care-settings.types';
import type { IDirectCareSettingsService } from './IDirectCareSettingsService';

const log = Logger.getLogger('api');

export class MockDirectCareSettingsService implements IDirectCareSettingsService {
  private settingsStore = new Map<string, DirectCareSettings>();

  async getSettings(orgId: string): Promise<DirectCareSettings> {
    log.debug('[Mock] Fetching direct care settings', { orgId });
    await this.simulateDelay();

    const settings = this.settingsStore.get(orgId);
    if (!settings) {
      return {
        enable_staff_client_mapping: false,
        enable_schedule_enforcement: false,
      };
    }

    return { ...settings };
  }

  async updateSettings(
    orgId: string,
    enableStaffClientMapping: boolean | null,
    enableScheduleEnforcement: boolean | null,
    reason: string,
  ): Promise<DirectCareSettings> {
    log.debug('[Mock] Updating direct care settings', {
      orgId,
      enableStaffClientMapping,
      enableScheduleEnforcement,
      reason,
    });
    await this.simulateDelay();

    const current = this.settingsStore.get(orgId) ?? {
      enable_staff_client_mapping: false,
      enable_schedule_enforcement: false,
    };

    const updated: DirectCareSettings = {
      enable_staff_client_mapping:
        enableStaffClientMapping !== null
          ? enableStaffClientMapping
          : current.enable_staff_client_mapping,
      enable_schedule_enforcement:
        enableScheduleEnforcement !== null
          ? enableScheduleEnforcement
          : current.enable_schedule_enforcement,
    };

    this.settingsStore.set(orgId, updated);
    log.info('[Mock] Direct care settings updated', { orgId, updated });

    return { ...updated };
  }

  private simulateDelay(): Promise<void> {
    const delay = import.meta.env.MODE === 'test' ? 0 : 300;
    return new Promise((resolve) => setTimeout(resolve, delay));
  }
}
