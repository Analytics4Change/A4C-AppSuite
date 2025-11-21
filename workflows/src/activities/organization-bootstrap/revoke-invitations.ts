/**
 * RevokeInvitationsActivity (Compensation)
 *
 * Revokes all pending invitations for an organization after workflow failure.
 * Marks invitations as 'deleted' so they cannot be accepted.
 *
 * Flow:
 * 1. Find all pending invitations for organization
 * 2. Update status to 'deleted'
 * 3. Emit InvitationRevoked events
 *
 * Idempotency:
 * - Safe to call multiple times
 * - No-op if no pending invitations
 * - Event emission idempotent via event_id
 *
 * Note:
 * - Only revokes 'pending' invitations
 * - Already accepted invitations are not affected
 * - This is a soft delete (records remain for audit)
 */

import type { RevokeInvitationsParams } from '@shared/types';
import { getSupabaseClient } from '@shared/utils/supabase';
import { emitEvent, buildTags } from '@shared/utils/emit-event';

/**
 * Revoke invitations activity (compensation)
 * @param params - Revocation parameters
 * @returns Number of invitations revoked
 */
export async function revokeInvitations(
  params: RevokeInvitationsParams
): Promise<number> {
  console.log(`[RevokeInvitations] Starting for org: ${params.orgId}`);

  const supabase = getSupabaseClient();

  try {
    // Find all pending invitations via RPC (PostgREST only exposes 'api' schema)
    const { data: invitations, error: fetchError } = await supabase
      .schema('api')
      .rpc('get_pending_invitations_by_org', {
        p_org_id: params.orgId
      });

    if (fetchError) {
      console.error(`[RevokeInvitations] Error fetching invitations: ${fetchError.message}`);
      return 0; // Don't fail compensation
    }

    if (!invitations || invitations.length === 0) {
      console.log(`[RevokeInvitations] No pending invitations to revoke`);
      return 0;
    }

    console.log(`[RevokeInvitations] Found ${invitations.length} pending invitations`);

    // Emit InvitationRevoked events for each invitation
    // CQRS pattern: Let the trigger update the projection, not direct UPDATE
    const revokedAt = new Date().toISOString();
    const tags = buildTags();

    for (const invitation of invitations) {
      await emitEvent({
        event_type: 'invitation.revoked',
        aggregate_type: 'invitation',
        aggregate_id: invitation.invitation_id,
        event_data: {
          org_id: params.orgId,
          invitation_id: invitation.invitation_id,
          email: invitation.email,
          revoked_at: revokedAt,
          reason: 'workflow_failure'
        },
        tags
      });
    }

    console.log(`[RevokeInvitations] Emitted ${invitations.length} InvitationRevoked events`);

    return invitations.length;
  } catch (error) {
    // Log error but don't fail compensation
    if (error instanceof Error) {
      console.error(`[RevokeInvitations] Error (non-fatal): ${error.message}`);
    }
    return 0; // Don't fail workflow
  }
}
