/**
 * Direct Care Settings Service Interface
 *
 * Defines the contract for reading and updating direct care feature flags
 * for an organization. These settings control Temporal workflow routing
 * for medication alerts and time-sensitive notifications.
 *
 * Implementations:
 * - SupabaseDirectCareSettingsService: Production (calls api.* RPCs)
 * - MockDirectCareSettingsService: Development (in-memory)
 *
 * @see api.get_organization_direct_care_settings()
 * @see api.update_organization_direct_care_settings()
 */

import type { DirectCareSettings } from '@/types/direct-care-settings.types';

export interface IDirectCareSettingsService {
  /**
   * Get direct care settings for an organization
   *
   * @param orgId - Organization UUID
   * @returns Settings object (defaults if never set)
   */
  getSettings(orgId: string): Promise<DirectCareSettings>;

  /**
   * Update direct care settings for an organization
   *
   * @param orgId - Organization UUID
   * @param enableStaffClientMapping - Enable/disable client-specific staff routing (null = no change)
   * @param enableScheduleEnforcement - Enable/disable schedule-based filtering (null = no change)
   * @param reason - Audit reason for the change
   * @returns Updated settings
   */
  updateSettings(
    orgId: string,
    enableStaffClientMapping: boolean | null,
    enableScheduleEnforcement: boolean | null,
    reason: string,
  ): Promise<DirectCareSettings>;
}
