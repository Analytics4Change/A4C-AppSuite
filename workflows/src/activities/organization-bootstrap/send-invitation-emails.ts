/**
 * SendInvitationEmailsActivity
 *
 * Sends invitation emails to users using configured email provider.
 *
 * Flow:
 * 1. Get organization details for email content
 * 2. For each invitation:
 *    - Build invitation email HTML
 *    - Send email via provider
 *    - Emit InvitationEmailSent event
 * 3. Return success/failure counts
 *
 * Provider:
 * - Uses email provider from factory (Resend/SMTP/Mock/Logging)
 * - Provider determined by WORKFLOW_MODE and EMAIL_PROVIDER
 *
 * Error Handling:
 * - Individual email failures don't fail the entire activity
 * - Failures are collected and returned
 * - Workflow can decide whether to retry based on failure count
 */

import type {
  SendInvitationEmailsParams,
  SendInvitationEmailsResult,
  Invitation
} from '@shared/types';
import { createEmailProvider } from '@shared/providers/email/factory';
import { getSupabaseClient, emitEvent, buildTags, getLogger, buildTracingForEvent } from '@shared/utils';
import { AGGREGATE_TYPES } from '@shared/constants';
import { getWorkflowsEnv } from '@shared/config/env-schema';

const log = getLogger('SendInvitationEmails');

/**
 * Build invitation email HTML
 * @param invitation - Invitation details
 * @param orgName - Organization name
 * @param frontendUrl - Frontend URL for invitation acceptance
 * @returns HTML email content
 */
function buildInvitationEmailHTML(
  invitation: Invitation,
  orgName: string,
  frontendUrl: string
): string {
  const invitationUrl = `${frontendUrl}/accept-invitation?token=${invitation.token}`;
  // Convert to Date (Temporal serializes Date objects as ISO strings)
  const expiresAt = new Date(invitation.expiresAt);
  const expiresDate = expiresAt.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  });

  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Invitation to ${orgName}</title>
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
  <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 30px; text-align: center; border-radius: 8px 8px 0 0;">
    <h1 style="color: white; margin: 0; font-size: 28px;">You're Invited!</h1>
  </div>

  <div style="background: #ffffff; padding: 40px; border: 1px solid #e0e0e0; border-top: none; border-radius: 0 0 8px 8px;">
    <p style="font-size: 18px; color: #333; margin-top: 0;">Hello!</p>

    <p style="font-size: 16px; color: #555;">
      You've been invited to join <strong>${orgName}</strong> on Analytics4Change.
    </p>

    <p style="font-size: 16px; color: #555;">
      Click the button below to accept your invitation and set up your account:
    </p>

    <div style="text-align: center; margin: 30px 0;">
      <a href="${invitationUrl}" style="display: inline-block; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; text-decoration: none; padding: 14px 40px; border-radius: 6px; font-size: 16px; font-weight: 600;">
        Accept Invitation
      </a>
    </div>

    <p style="font-size: 14px; color: #777; margin-top: 30px;">
      This invitation expires on <strong>${expiresDate}</strong>.
    </p>

    <p style="font-size: 14px; color: #777;">
      If the button doesn't work, copy and paste this link into your browser:<br>
      <a href="${invitationUrl}" style="color: #667eea; word-break: break-all;">${invitationUrl}</a>
    </p>

    <hr style="border: none; border-top: 1px solid #e0e0e0; margin: 30px 0;">

    <p style="font-size: 12px; color: #999; text-align: center;">
      If you didn't expect this invitation, you can safely ignore this email.
    </p>
  </div>
</body>
</html>
  `.trim();
}

/**
 * Build invitation email plain text
 * @param invitation - Invitation details
 * @param orgName - Organization name
 * @param frontendUrl - Frontend URL for invitation acceptance
 * @returns Plain text email content
 */
function buildInvitationEmailText(
  invitation: Invitation,
  orgName: string,
  frontendUrl: string
): string {
  const invitationUrl = `${frontendUrl}/accept-invitation?token=${invitation.token}`;
  // Convert to Date (Temporal serializes Date objects as ISO strings)
  const expiresAt = new Date(invitation.expiresAt);
  const expiresDate = expiresAt.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  });

  return `
You're Invited to ${orgName}!

Hello!

You've been invited to join ${orgName} on Analytics4Change.

Accept your invitation by visiting:
${invitationUrl}

This invitation expires on ${expiresDate}.

If you didn't expect this invitation, you can safely ignore this email.
  `.trim();
}

/**
 * Send invitation emails activity
 * @param params - Email sending parameters
 * @returns Result with success/failure counts
 */
export async function sendInvitationEmails(
  params: SendInvitationEmailsParams
): Promise<SendInvitationEmailsResult> {
  log.info('Starting email send', {
    orgId: params.orgId,
    count: params.invitations.length
  });

  const supabase = getSupabaseClient();
  const emailProvider = createEmailProvider();
  const tags = buildTags();

  // Get organization details via RPC (PostgREST only exposes 'api' schema)
  const { data: orgName, error: orgError } = await supabase
    .schema('api')
    .rpc('get_organization_name', {
      p_org_id: params.orgId
    });

  if (orgError || !orgName) {
    throw new Error(`Failed to get organization details: ${orgError?.message}`);
  }
  let successCount = 0;
  const failures: Array<{ email: string; error: string }> = [];

  // Use frontendUrl from params or default to FRONTEND_URL from env config
  const frontendUrl = params.frontendUrl ?? getWorkflowsEnv().FRONTEND_URL;

  // Extract parent domain for email sender (e.g., firstovertheline.com from poc-test1.firstovertheline.com)
  // This ensures we send from the verified domain, not the subdomain
  const domainParts = params.domain.split('.');
  const parentDomain = domainParts.slice(-2).join('.');

  // Send emails
  for (const invitation of params.invitations) {
    try {
      log.debug('Sending email', { email: invitation.email });

      const html = buildInvitationEmailHTML(invitation, orgName, frontendUrl);
      const text = buildInvitationEmailText(invitation, orgName, frontendUrl);

      await emailProvider.sendEmail({
        from: `Analytics4Change <noreply@${parentDomain}>`,
        to: invitation.email,
        subject: `Invitation to join ${orgName}`,
        html,
        text
      });

      successCount++;

      // Emit InvitationEmailSent event
      await emitEvent({
        event_type: 'invitation.email.sent',
        aggregate_type: AGGREGATE_TYPES.ORGANIZATION,
        aggregate_id: params.orgId,
        event_data: {
          org_id: params.orgId,
          invitation_id: invitation.invitationId,
          email: invitation.email,
          sent_at: new Date().toISOString()
        },
        tags,
        ...buildTracingForEvent(params.tracing, 'sendInvitationEmail')
      });

      log.debug('Email sent', { email: invitation.email });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      log.error('Failed to send email', { email: invitation.email, error: errorMessage });

      failures.push({
        email: invitation.email,
        error: errorMessage
      });
    }
  }

  log.info('Email send completed', {
    sent: successCount,
    failed: failures.length
  });

  return {
    successCount,
    failures
  };
}
