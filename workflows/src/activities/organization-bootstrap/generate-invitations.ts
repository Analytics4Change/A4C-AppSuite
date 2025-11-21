/**
 * GenerateInvitationsActivity
 *
 * Generates user invitation tokens and emits UserInvited events.
 *
 * Flow:
 * 1. Check if invitations already exist (idempotency)
 * 2. Generate secure tokens for new users
 * 3. Emit UserInvited events (triggers insert into invitations_projection)
 * 4. Return invitation details for email sending
 *
 * Security:
 * - Tokens are cryptographically secure (32 bytes, base64url)
 * - Tokens expire after 7 days
 * - Each token can only be used once
 *
 * Tags:
 * - Invitations inherit tags from organization
 * - Tags propagate through event metadata
 */

import { randomBytes } from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import type { GenerateInvitationsParams, Invitation } from '@shared/types';
import { getSupabaseClient } from '@shared/utils/supabase';
import { emitEvent, buildTags } from '@shared/utils/emit-event';

/**
 * Generate secure invitation token
 * @returns URL-safe base64 token (256 bits)
 */
function generateInvitationToken(): string {
  return randomBytes(32).toString('base64url');
}

/**
 * Generate invitations activity
 * @param params - Invitation generation parameters
 * @returns Array of generated invitations
 */
export async function generateInvitations(
  params: GenerateInvitationsParams
): Promise<Invitation[]> {
  console.log(`[GenerateInvitations] Starting for org: ${params.orgId}`);
  console.log(`[GenerateInvitations] Generating ${params.users.length} invitations`);

  const supabase = getSupabaseClient();
  const invitations: Invitation[] = [];
  const tags = buildTags();

  // Calculate expiration (7 days from now)
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + 7);

  for (const user of params.users) {
    console.log(`[GenerateInvitations] Processing invitation for: ${user.email}`);

    // Check if invitation already exists (idempotency) via RPC
    const { data: existingData } = await supabase
      .schema('api')
      .rpc('get_invitation_by_org_and_email', {
        p_org_id: params.orgId,
        p_email: user.email
      });

    const existing = existingData && existingData.length > 0 ? existingData[0] : null;

    if (existing) {
      console.log(`[GenerateInvitations] Invitation already exists for ${user.email}`);
      invitations.push({
        invitationId: existing.invitation_id,
        email: existing.email,
        token: existing.token,
        expiresAt: new Date(existing.expires_at)
      });
      continue;
    }

    // Generate new invitation
    const invitationId = uuidv4();
    const token = generateInvitationToken();

    // Emit UserInvited event (triggers projection update)
    await emitEvent({
      event_type: 'user.invited',
      aggregate_type: 'Organization',
      aggregate_id: params.orgId,
      event_data: {
        invitation_id: invitationId,
        org_id: params.orgId,
        email: user.email,
        first_name: user.firstName,
        last_name: user.lastName,
        role: user.role,
        token,
        expires_at: expiresAt.toISOString()
      },
      tags
    });

    console.log(`[GenerateInvitations] Generated invitation for ${user.email}`);

    invitations.push({
      invitationId,
      email: user.email,
      token,
      expiresAt
    });
  }

  console.log(`[GenerateInvitations] Generated ${invitations.length} invitations`);

  return invitations;
}
