/**
 * Supabase Direct Care Settings Service
 *
 * Production implementation using api.* schema RPC functions.
 * Follows CQRS pattern: all queries via api schema RPCs.
 *
 * @see api.get_organization_direct_care_settings()
 * @see api.update_organization_direct_care_settings()
 */

import { supabaseService } from '@/services/auth/supabase.service';
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

    const { data, error } = await supabaseService.apiRpc<DirectCareSettings | null>(
      'get_organization_direct_care_settings',
      { p_org_id: orgId }
    );

    if (error) {
      log.error('Failed to fetch direct care settings', { error, orgId });
      throw new Error(`Failed to fetch settings: ${error.message}`);
    }

    if (!data) {
      log.debug('No settings found, returning defaults', { orgId });
      return { ...DEFAULT_SETTINGS };
    }

    return {
      enable_staff_client_mapping: data.enable_staff_client_mapping ?? false,
      enable_schedule_enforcement: data.enable_schedule_enforcement ?? false,
    };
  }

  /**
   * Migrated to envelope-only consumption (PR-B 2026-05-11).
   *
   * Legacy/v2 dual-shape parse removed per architect targeted-review:
   *  - Migration `20260423060052` deployed the envelope shape ~3 weeks ago.
   *  - PR #44's M3 RPC-shape registry tags `update_organization_direct_care_settings`
   *    as `EnvelopeRpcs` (frontend/src/services/api/rpc-registry.generated.ts:95).
   *    Wrong shape from the RPC is now a TypeScript compile error.
   *  - All callers of this method went through dev rollout post-migration.
   *
   * If the v1 raw shape ever surfaces again, `unwrapApiEnvelope` will treat it
   * as success (no `success: false`) and spread it onto the envelope; the
   * `env.settings` read below would be undefined and we'd fall back to defaults.
   * That's a soft failure rather than the previous explicit dual-parse.
   */
  async updateSettings(
    orgId: string,
    enableStaffClientMapping: boolean | null,
    enableScheduleEnforcement: boolean | null,
    reason: string
  ): Promise<DirectCareSettings> {
    log.debug('Updating direct care settings', {
      orgId,
      enableStaffClientMapping,
      enableScheduleEnforcement,
      reason,
    });

    const env = await supabaseService.apiRpcEnvelope<{ settings?: Partial<DirectCareSettings> }>(
      'update_organization_direct_care_settings',
      {
        p_org_id: orgId,
        p_enable_staff_client_mapping: enableStaffClientMapping,
        p_enable_schedule_enforcement: enableScheduleEnforcement,
        p_reason: reason,
      }
    );

    if (!env.success) {
      log.error('Direct care settings update failed', { orgId, error: env.error });
      throw new Error(env.error ?? 'Failed to update direct care settings');
    }

    const settings = env.settings ?? {};
    log.info('Direct care settings updated', { orgId, settings });
    return {
      enable_staff_client_mapping: settings.enable_staff_client_mapping ?? false,
      enable_schedule_enforcement: settings.enable_schedule_enforcement ?? false,
    };
  }
}
