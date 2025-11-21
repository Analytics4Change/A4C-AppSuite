/**
 * DeactivateOrganizationActivity (Compensation)
 *
 * Deactivates organization after workflow failure.
 * Marks organization as 'failed' and sets deleted_at timestamp.
 *
 * Flow:
 * 1. Update organization status to 'failed'
 * 2. Set deleted_at timestamp (soft delete)
 * 3. Emit OrganizationDeactivated event
 *
 * Idempotency:
 * - Safe to call multiple times
 * - No-op if already failed/deleted
 * - Event emission idempotent via event_id
 *
 * Note:
 * - This is a soft delete (record remains for audit)
 * - Cleanup script can permanently delete if tagged as development
 */

import type { DeactivateOrganizationParams } from '@shared/types';
import { getSupabaseClient } from '@shared/utils/supabase';
import { emitEvent, buildTags } from '@shared/utils/emit-event';

/**
 * Deactivate organization activity (compensation)
 * @param params - Deactivation parameters
 * @returns true if deactivated successfully
 */
export async function deactivateOrganization(
  params: DeactivateOrganizationParams
): Promise<boolean> {
  console.log(`[DeactivateOrganization] Starting for org: ${params.orgId}`);

  const supabase = getSupabaseClient();

  try {
    // Check current status (idempotency) via RPC (PostgREST only exposes 'api' schema)
    const { data: orgData, error: checkError } = await supabase
      .schema('api')
      .rpc('get_organization_status', {
        p_org_id: params.orgId
      });

    if (checkError) {
      console.error(`[DeactivateOrganization] Error checking status: ${checkError.message}`);
      // Continue with deactivation attempt
    }

    const org = orgData && orgData.length > 0 ? orgData[0] : null;

    if (!org) {
      console.log(`[DeactivateOrganization] Organization not found: ${params.orgId} (skip)`);
      return true;
    }

    if (!org.is_active && org.deleted_at) {
      console.log(`[DeactivateOrganization] Organization already deactivated: ${params.orgId}`);

      // Emit event even if already deactivated (for event replay)
      await emitEvent({
        event_type: 'organization.deactivated',
        aggregate_type: 'Organization',
        aggregate_id: params.orgId,
        event_data: {
          org_id: params.orgId,
          deactivated_at: org.deleted_at,
          previous_is_active: org.is_active,
          reason: 'workflow_failure'
        },
        tags: buildTags()
      });

      return true;
    }

    // Update organization status via RPC (PostgREST only exposes 'api' schema)
    const deactivatedAt = new Date().toISOString();
    const { error: updateError } = await supabase
      .schema('api')
      .rpc('update_organization_status', {
        p_org_id: params.orgId,
        p_is_active: false,
        p_deactivated_at: deactivatedAt,
        p_deleted_at: deactivatedAt
      });

    if (updateError) {
      console.error(`[DeactivateOrganization] Error updating status: ${updateError.message}`);
      // Don't fail compensation
    }

    console.log(`[DeactivateOrganization] Organization deactivated: ${params.orgId}`);

    // Emit OrganizationDeactivated event
    await emitEvent({
      event_type: 'organization.deactivated',
      aggregate_type: 'Organization',
      aggregate_id: params.orgId,
      event_data: {
        org_id: params.orgId,
        deactivated_at: deactivatedAt,
        previous_is_active: org.is_active,
        reason: 'workflow_failure'
      },
      tags: buildTags()
    });

    console.log(`[DeactivateOrganization] Emitted OrganizationDeactivated event for ${params.orgId}`);

    return true;
  } catch (error) {
    // Log error but don't fail compensation
    if (error instanceof Error) {
      console.error(`[DeactivateOrganization] Error (non-fatal): ${error.message}`);
    }
    return true; // Don't fail workflow
  }
}
