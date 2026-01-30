/**
 * Supabase Direct Care Settings Service
 *
 * Production implementation using api.* schema RPC functions.
 * Follows CQRS pattern: all queries via api schema RPCs.
 *
 * @see api.get_organization_direct_care_settings()
 * @see api.update_organization_direct_care_settings()
 */

import { supabase } from '@/lib/supabase';
import { Logger } from '@/utils/logger';
import type { DirectCareSettings } from '@/types/direct-care-settings.types';
import type { IDirectCareSettingsService } from './IDirectCareSettingsService';

const log = Logger.getLogger('api');

const DEFAULT_SETTINGS: DirectCareSettings = {
  enable_staff_client_mapping: false,
  enable_schedule_enforcement: false,
};

export class SupabaseDirectCareSettingsService implements IDirectCareSettingsService {
  async getSettings(orgId: string): Promise<DirectCareSettings> {
    log.debug('Fetching direct care settings', { orgId });

    const { data, error } = await supabase
      .schema('api')
      .rpc('get_organization_direct_care_settings', {
        p_org_id: orgId,
      });

    if (error) {
      log.error('Failed to fetch direct care settings', { error, orgId });
      throw new Error(`Failed to fetch settings: ${error.message}`);
    }

    if (!data) {
      log.debug('No settings found, returning defaults', { orgId });
      return { ...DEFAULT_SETTINGS };
    }

    const settings = typeof data === 'string' ? JSON.parse(data) : data;

    return {
      enable_staff_client_mapping: settings.enable_staff_client_mapping ?? false,
      enable_schedule_enforcement: settings.enable_schedule_enforcement ?? false,
    };
  }

  async updateSettings(
    orgId: string,
    enableStaffClientMapping: boolean | null,
    enableScheduleEnforcement: boolean | null,
    reason: string,
  ): Promise<DirectCareSettings> {
    log.debug('Updating direct care settings', {
      orgId,
      enableStaffClientMapping,
      enableScheduleEnforcement,
      reason,
    });

    const { data, error } = await supabase
      .schema('api')
      .rpc('update_organization_direct_care_settings', {
        p_org_id: orgId,
        p_enable_staff_client_mapping: enableStaffClientMapping,
        p_enable_schedule_enforcement: enableScheduleEnforcement,
        p_reason: reason,
      });

    if (error) {
      log.error('Failed to update direct care settings', { error, orgId });
      throw new Error(`Failed to update settings: ${error.message}`);
    }

    const settings = typeof data === 'string' ? JSON.parse(data) : data;

    log.info('Direct care settings updated', { orgId, settings });

    return {
      enable_staff_client_mapping: settings.enable_staff_client_mapping ?? false,
      enable_schedule_enforcement: settings.enable_schedule_enforcement ?? false,
    };
  }
}
