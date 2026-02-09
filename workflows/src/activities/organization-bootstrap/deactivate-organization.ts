/**
 * DeactivateOrganizationActivity (Compensation Safety Net)
 *
 * Last-resort fallback that directly updates the organizations_projection
 * when the event-driven path (emitBootstrapFailed → handler) has failed.
 *
 * This is an intentional CQRS exception: if the event system itself is broken,
 * emitting another event would also fail. A direct write is the only reliable
 * way to ensure the organization doesn't remain marked as active after a
 * failed bootstrap.
 *
 * Flow:
 * 1. Check current is_active status (idempotency)
 * 2. Direct-update organizations_projection: is_active = false, deleted_at = now
 * 3. Log the safety-net activation (no event emission — the event path already failed)
 *
 * Idempotency:
 * - Safe to call multiple times
 * - No-op if already deactivated (is_active = false AND deleted_at set)
 *
 * Note:
 * - This is a soft delete (record remains for audit via domain_events)
 * - Uses service_role_key which bypasses RLS
 * - Does NOT emit domain events — this runs only when event emission has failed
 */

import type { DeactivateOrganizationParams } from '@shared/types';
import { getSupabaseClient, getLogger } from '@shared/utils';

const log = getLogger('DeactivateOrganization');

/**
 * Deactivate organization activity (compensation safety net)
 *
 * Direct-writes to organizations_projection as a fallback when
 * emitBootstrapFailed has already failed. Does not emit events.
 *
 * @param params - Deactivation parameters
 * @returns true always (compensation must not throw)
 */
export async function deactivateOrganization(
  params: DeactivateOrganizationParams
): Promise<boolean> {
  log.info('Safety net: starting organization deactivation', { orgId: params.orgId });

  const supabase = getSupabaseClient();

  try {
    // Check current status (idempotency)
    const { data: org, error: checkError } = await supabase
      .from('organizations_projection')
      .select('id, is_active, deleted_at')
      .eq('id', params.orgId)
      .maybeSingle();

    if (checkError) {
      log.warn('Safety net: error checking org status, attempting update anyway', {
        orgId: params.orgId,
        error: checkError.message,
      });
    }

    if (!org) {
      log.info('Safety net: organization not found, skipping', { orgId: params.orgId });
      return true;
    }

    if (!org.is_active && org.deleted_at) {
      log.info('Safety net: organization already deactivated', { orgId: params.orgId });
      return true;
    }

    // Direct-write to projection (justified CQRS exception for safety net)
    const deactivatedAt = new Date().toISOString();
    const { error: updateError } = await supabase
      .from('organizations_projection')
      .update({
        is_active: false,
        deleted_at: deactivatedAt,
        updated_at: deactivatedAt,
      })
      .eq('id', params.orgId);

    if (updateError) {
      log.error('Safety net: failed to deactivate organization', {
        orgId: params.orgId,
        error: updateError.message,
      });
      // Don't throw — compensation must not fail the workflow
      return true;
    }

    log.info('Safety net: organization deactivated via direct write', {
      orgId: params.orgId,
      deactivatedAt,
    });

    return true;
  } catch (error) {
    // Log but never throw — this is compensation
    const msg = error instanceof Error ? error.message : 'Unknown error';
    log.error('Safety net: non-fatal error during deactivation', {
      orgId: params.orgId,
      error: msg,
    });
    return true;
  }
}
