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
import { getSupabaseClient, emitEvent, buildTags, getLogger, buildTracingForEvent } from '@shared/utils';
import { AGGREGATE_TYPES } from '@shared/constants';

const log = getLogger('GenerateInvitations');

/**
 * RPC result from api.get_invitation_by_org_and_email
 */
interface InvitationRpcResult {
  invitation_id: string;
  email: string;
  token: string;
  expires_at: string;
  contact_id: string | null;
}

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
  log.info('Starting invitation generation', {
    orgId: params.orgId,
    count: params.users.length,
    contactCount: params.contactsByEmail ? Object.keys(params.contactsByEmail).length : 0
  });

  const supabase = getSupabaseClient();
  const invitations: Invitation[] = [];
  const tags = buildTags();

  // Calculate expiration (7 days from now)
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + 7);

  for (const user of params.users) {
    // Look up contact_id for this user's email (if contact was created during org bootstrap)
    const contactId = params.contactsByEmail?.[user.email.toLowerCase()];
    log.debug('Processing invitation', { email: user.email, contactId });

    // Check if invitation already exists (idempotency) via RPC
    const { data: existingData } = await supabase
      .schema('api')
      .rpc('get_invitation_by_org_and_email', {
        p_org_id: params.orgId,
        p_email: user.email
      });

    const existing = existingData && existingData.length > 0
      ? (existingData[0] as InvitationRpcResult)
      : null;

    if (existing) {
      log.debug('Invitation already exists', { email: user.email });
      invitations.push({
        invitationId: existing.invitation_id,
        email: existing.email,
        token: existing.token,
        expiresAt: new Date(existing.expires_at),
        contactId: existing.contact_id ?? undefined
      });
      continue;
    }

    // Generate new invitation
    const invitationId = uuidv4();
    const token = generateInvitationToken();

    // Emit UserInvited event (triggers projection update via process_user_event)
    // Routes to USER aggregate with invitation_id as stream_id (user_id doesn't exist yet)
    // Include contact_id when user is also a contact (for contact-user linking)
    await emitEvent({
      event_type: 'user.invited',
      aggregate_type: AGGREGATE_TYPES.USER,
      aggregate_id: invitationId,
      event_data: {
        invitation_id: invitationId,
        org_id: params.orgId,
        email: user.email,
        first_name: user.firstName,
        last_name: user.lastName,
        roles: [{ role_id: null, role_name: user.role }],
        token,
        expires_at: expiresAt.toISOString(),
        // Include contact_id for contact-user linking when user accepts invitation
        ...(contactId ? { contact_id: contactId } : {})
      },
      tags,
      ...buildTracingForEvent(params.tracing, 'generateInvitation')
    });

    log.debug('Generated invitation', { email: user.email, contactId });

    invitations.push({
      invitationId,
      email: user.email,
      token,
      expiresAt,
      contactId
    });
  }

  log.info('Invitation generation completed', { count: invitations.length });

  return invitations;
}
