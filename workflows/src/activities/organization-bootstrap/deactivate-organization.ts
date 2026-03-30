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
    // Use api.safety_net_deactivate_organization RPC — direct .from() queries
    // fail because PostgREST only exposes the api schema.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
    const { data: result, error } = await (supabase.schema('api') as any).rpc(
      'safety_net_deactivate_organization',
      { p_org_id: params.orgId }
    ) as { data: { found: boolean; already_deactivated?: boolean; deactivated?: boolean; deactivated_at?: string } | null; error: { message: string } | null };

    if (error) {
      log.error('Safety net: RPC failed', {
        orgId: params.orgId,
        error: error.message,
      });
      // Don't throw — compensation must not fail the workflow
      return true;
    }

    if (!result?.found) {
      log.info('Safety net: organization not found, skipping', { orgId: params.orgId });
      return true;
    }

    if (result.already_deactivated) {
      log.info('Safety net: organization already deactivated', { orgId: params.orgId });
      return true;
    }

    log.info('Safety net: organization deactivated via RPC', {
      orgId: params.orgId,
      deactivatedAt: result.deactivated_at,
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
