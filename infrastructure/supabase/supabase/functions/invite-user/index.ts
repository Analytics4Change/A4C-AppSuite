/**
 * Invite User Edge Function
 *
 * Sends an invitation to a user to join an organization.
 * Implements smart email lookup and lazy expiration detection.
 *
 * CQRS-compliant: Emits user.invited domain event.
 * Permission required: user.create
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { validateEdgeFunctionEnv, createEnvErrorResponse } from '../_shared/env-schema.ts';

// Deployment version tracking
const DEPLOY_VERSION = 'v1';

// CORS headers for frontend requests
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Token expiration: 7 days
const INVITATION_EXPIRY_DAYS = 7;

/**
 * Role reference for invitation
 */
interface RoleReference {
  role_id: string;
  role_name?: string;
}

/**
 * Notification preferences (optional)
 */
interface NotificationPreferences {
  email?: boolean;
  sms?: {
    enabled: boolean;
    phone_id?: string | null;
  };
  in_app?: boolean;
}

/**
 * Request format from frontend
 */
interface InviteUserRequest {
  email: string;
  firstName: string;
  lastName: string;
  roles: RoleReference[];
  accessStartDate?: string | null;    // ISO date (YYYY-MM-DD) or null
  accessExpirationDate?: string | null; // ISO date (YYYY-MM-DD) or null
  notificationPreferences?: NotificationPreferences;
}

/**
 * Email lookup result statuses
 */
type EmailStatus =
  | 'not_found'           // No user with this email
  | 'pending_invitation'  // Has pending invitation in this org
  | 'expired_invitation'  // Has expired invitation in this org
  | 'active_member'       // Active member of this org
  | 'deactivated'         // Deactivated member of this org
  | 'other_org_member';   // User exists but not in this org

interface EmailLookupResult {
  status: EmailStatus;
  userId?: string;
  invitationId?: string;
  invitationExpiresAt?: string;
}

/**
 * Response format
 */
interface InviteUserResponse {
  success: boolean;
  invitationId?: string;
  emailStatus?: EmailStatus;
  suggestedAction?: string;
  error?: string;
}

/**
 * Generate a cryptographically secure 256-bit token (base64url encoded)
 */
function generateSecureToken(): string {
  const bytes = new Uint8Array(32); // 256 bits
  crypto.getRandomValues(bytes);
  // Convert to base64url (URL-safe base64 without padding)
  const base64 = btoa(String.fromCharCode(...bytes));
  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

/**
 * Check email status via smart lookup
 */
async function checkEmailStatus(
  supabase: SupabaseClient,
  email: string,
  orgId: string
): Promise<EmailLookupResult> {
  // Check for existing user in this org's user_roles_projection
  const { data: existingRole, error: roleError } = await supabase
    .rpc('check_user_org_membership', { p_email: email, p_org_id: orgId });

  if (roleError) {
    console.error(`[invite-user v${DEPLOY_VERSION}] Role check error:`, roleError);
  }

  if (existingRole?.[0]) {
    const membership = existingRole[0];
    if (membership.is_active) {
      return {
        status: 'active_member',
        userId: membership.user_id,
      };
    } else {
      return {
        status: 'deactivated',
        userId: membership.user_id,
      };
    }
  }

  // Check for pending invitation in this org
  const { data: existingInvitation, error: invError } = await supabase
    .rpc('check_pending_invitation', { p_email: email, p_org_id: orgId });

  if (invError) {
    console.error(`[invite-user v${DEPLOY_VERSION}] Invitation check error:`, invError);
  }

  if (existingInvitation?.[0]) {
    const invitation = existingInvitation[0];
    const expiresAt = new Date(invitation.expires_at);
    const now = new Date();

    if (expiresAt < now) {
      // Invitation is expired - emit lazy expiration event
      await emitExpirationEvent(supabase, invitation, orgId);
      return {
        status: 'expired_invitation',
        invitationId: invitation.id,
        invitationExpiresAt: invitation.expires_at,
      };
    } else {
      return {
        status: 'pending_invitation',
        invitationId: invitation.id,
        invitationExpiresAt: invitation.expires_at,
      };
    }
  }

  // Check if user exists in system (other orgs)
  const { data: existingUser, error: userError } = await supabase
    .rpc('check_user_exists', { p_email: email });

  if (userError) {
    console.error(`[invite-user v${DEPLOY_VERSION}] User check error:`, userError);
  }

  if (existingUser?.[0]) {
    return {
      status: 'other_org_member',
      userId: existingUser[0].user_id,
    };
  }

  return { status: 'not_found' };
}

/**
 * Emit invitation.expired event (lazy expiration detection)
 */
async function emitExpirationEvent(
  supabase: SupabaseClient,
  invitation: { id: string; email: string; expires_at: string },
  orgId: string
): Promise<void> {
  console.log(`[invite-user v${DEPLOY_VERSION}] Emitting lazy expiration event for invitation ${invitation.id}`);

  const { error } = await supabase.rpc('emit_domain_event', {
    p_stream_id: invitation.id,
    p_stream_type: 'invitation',
    p_event_type: 'invitation.expired',
    p_event_data: {
      invitation_id: invitation.id,
      org_id: orgId,
      email: invitation.email,
      expired_at: new Date().toISOString(),
      original_expires_at: invitation.expires_at,
    },
    p_event_metadata: {
      trigger: 'lazy_expiration_detection',
      detected_by: 'invite-user-edge-function',
    },
  });

  if (error) {
    console.error(`[invite-user v${DEPLOY_VERSION}] Failed to emit expiration event:`, error);
  }
}

/**
 * Send invitation email via Resend API
 */
async function sendInvitationEmail(
  resendApiKey: string,
  params: {
    email: string;
    firstName: string;
    lastName: string;
    orgName: string;
    token: string;
    expiresAt: Date;
    frontendUrl: string;
    baseDomain: string;
  }
): Promise<{ success: boolean; messageId?: string; error?: string }> {
  const invitationUrl = `${params.frontendUrl}/accept-invitation?token=${params.token}`;
  const expiresDate = params.expiresAt.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Invitation to ${params.orgName}</title>
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
  <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 30px; text-align: center; border-radius: 8px 8px 0 0;">
    <h1 style="color: white; margin: 0; font-size: 28px;">You're Invited!</h1>
  </div>

  <div style="background: #ffffff; padding: 40px; border: 1px solid #e0e0e0; border-top: none; border-radius: 0 0 8px 8px;">
    <p style="font-size: 18px; color: #333; margin-top: 0;">Hello ${params.firstName}!</p>

    <p style="font-size: 16px; color: #555;">
      You've been invited to join <strong>${params.orgName}</strong> on Analytics4Change.
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

  const text = `
You're Invited to ${params.orgName}!

Hello ${params.firstName}!

You've been invited to join ${params.orgName} on Analytics4Change.

Accept your invitation by visiting:
${invitationUrl}

This invitation expires on ${expiresDate}.

If you didn't expect this invitation, you can safely ignore this email.
  `.trim();

  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${resendApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: `Analytics4Change <noreply@${params.baseDomain}>`,
        to: params.email,
        subject: `Invitation to join ${params.orgName}`,
        html,
        text,
      }),
    });

    if (!response.ok) {
      const errorData = await response.json();
      return {
        success: false,
        error: `Resend API error: ${response.status} - ${errorData.message || 'Unknown error'}`,
      };
    }

    const data = await response.json();
    return {
      success: true,
      messageId: data.id,
    };
  } catch (error) {
    return {
      success: false,
      error: `Failed to send email: ${error.message}`,
    };
  }
}

serve(async (req) => {
  console.log(`[invite-user v${DEPLOY_VERSION}] Processing ${req.method} request`);

  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  // Only allow POST
  if (req.method !== 'POST') {
    return new Response(
      JSON.stringify({ error: 'Method not allowed' }),
      { status: 405, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  // ==========================================================================
  // ENVIRONMENT VALIDATION - FAIL FAST
  // ==========================================================================
  let env;
  try {
    env = validateEdgeFunctionEnv('invite-user');
  } catch (error) {
    return createEnvErrorResponse('invite-user', DEPLOY_VERSION, error.message, corsHeaders);
  }

  // Require service role key
  if (!env.SUPABASE_SERVICE_ROLE_KEY) {
    return createEnvErrorResponse('invite-user', DEPLOY_VERSION, 'SUPABASE_SERVICE_ROLE_KEY is required', corsHeaders);
  }

  // Require Resend API key
  if (!env.RESEND_API_KEY) {
    return createEnvErrorResponse('invite-user', DEPLOY_VERSION, 'RESEND_API_KEY is required', corsHeaders);
  }

  try {
    // ==========================================================================
    // AUTHENTICATION & AUTHORIZATION
    // ==========================================================================
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: 'Missing authorization header' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Create Supabase client with user's JWT for permission check
    const supabaseUser = createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });

    // Get user and check permissions
    const { data: { user }, error: authError } = await supabaseUser.auth.getUser();
    if (authError || !user) {
      return new Response(
        JSON.stringify({ error: 'Invalid or expired token' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Extract JWT claims
    const jwtClaims = user.app_metadata || {};
    const orgId = jwtClaims.org_id as string | undefined;
    const permissions = (jwtClaims.permissions as string[]) || [];

    if (!orgId) {
      return new Response(
        JSON.stringify({ error: 'No organization context in token' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Check user.create permission
    if (!permissions.includes('user.create')) {
      console.log(`[invite-user v${DEPLOY_VERSION}] Permission denied: user ${user.id} lacks user.create`);
      return new Response(
        JSON.stringify({ error: 'Permission denied: user.create required' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`[invite-user v${DEPLOY_VERSION}] User ${user.id} authorized for org ${orgId}`);

    // ==========================================================================
    // REQUEST VALIDATION
    // ==========================================================================
    const requestData: InviteUserRequest = await req.json();

    if (!requestData.email) {
      return new Response(
        JSON.stringify({ error: 'Missing email' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (!requestData.firstName) {
      return new Response(
        JSON.stringify({ error: 'Missing firstName' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (!requestData.lastName) {
      return new Response(
        JSON.stringify({ error: 'Missing lastName' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (!requestData.roles || requestData.roles.length === 0) {
      return new Response(
        JSON.stringify({ error: 'At least one role is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(requestData.email)) {
      return new Response(
        JSON.stringify({ error: 'Invalid email format' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // ==========================================================================
    // SMART EMAIL LOOKUP
    // ==========================================================================
    // Use service role for database operations
    const supabaseAdmin = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
      db: {
        schema: 'api',
      },
    });

    const emailStatus = await checkEmailStatus(supabaseAdmin, requestData.email, orgId);
    console.log(`[invite-user v${DEPLOY_VERSION}] Email status: ${emailStatus.status}`);

    // Handle non-invitable statuses
    if (emailStatus.status === 'active_member') {
      return new Response(
        JSON.stringify({
          success: false,
          emailStatus: emailStatus.status,
          suggestedAction: 'User is already an active member of this organization',
          error: 'User already exists in organization',
        } as InviteUserResponse),
        { status: 409, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (emailStatus.status === 'pending_invitation') {
      return new Response(
        JSON.stringify({
          success: false,
          emailStatus: emailStatus.status,
          invitationId: emailStatus.invitationId,
          suggestedAction: 'Resend existing invitation instead',
          error: 'User has a pending invitation',
        } as InviteUserResponse),
        { status: 409, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // ==========================================================================
    // CREATE INVITATION
    // ==========================================================================
    const invitationId = crypto.randomUUID();
    const token = generateSecureToken();
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + INVITATION_EXPIRY_DAYS);

    // Get organization name for email
    const { data: orgData, error: orgError } = await supabaseAdmin
      .rpc('get_organization_by_id', { p_org_id: orgId });

    if (orgError || !orgData?.[0]) {
      console.error(`[invite-user v${DEPLOY_VERSION}] Failed to get organization:`, orgError);
      return new Response(
        JSON.stringify({ error: 'Failed to get organization details' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const orgName = orgData[0].name;

    // Build event data per AsyncAPI contract
    const eventData: Record<string, unknown> = {
      invitation_id: invitationId,
      org_id: orgId,
      email: requestData.email,
      first_name: requestData.firstName,
      last_name: requestData.lastName,
      roles: requestData.roles,
      token: token,
      expires_at: expiresAt.toISOString(),
    };

    // Add optional fields
    if (requestData.accessStartDate) {
      eventData.access_start_date = requestData.accessStartDate;
    }
    if (requestData.accessExpirationDate) {
      eventData.access_expiration_date = requestData.accessExpirationDate;
    }
    if (requestData.notificationPreferences) {
      eventData.notification_preferences = requestData.notificationPreferences;
    }

    // Emit user.invited event (per AsyncAPI contract, stream_id is org_id)
    console.log(`[invite-user v${DEPLOY_VERSION}] Emitting user.invited event...`);
    const { data: eventId, error: eventError } = await supabaseAdmin
      .rpc('emit_domain_event', {
        p_stream_id: orgId, // Events on organization aggregate
        p_stream_type: 'organization',
        p_event_type: 'user.invited',
        p_event_data: eventData,
        p_event_metadata: {
          user_id: user.id,
          ip_address: req.headers.get('x-forwarded-for') || req.headers.get('x-real-ip') || null,
          user_agent: req.headers.get('user-agent') || null,
          reason: 'Manual user invitation',
        },
      });

    if (eventError) {
      console.error(`[invite-user v${DEPLOY_VERSION}] Failed to emit event:`, eventError);
      return new Response(
        JSON.stringify({ error: 'Failed to create invitation', details: eventError.message }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`[invite-user v${DEPLOY_VERSION}] Event emitted: ${eventId}`);

    // ==========================================================================
    // SEND INVITATION EMAIL
    // ==========================================================================
    console.log(`[invite-user v${DEPLOY_VERSION}] Sending invitation email to ${requestData.email}...`);
    const emailResult = await sendInvitationEmail(env.RESEND_API_KEY!, {
      email: requestData.email,
      firstName: requestData.firstName,
      lastName: requestData.lastName,
      orgName: orgName,
      token: token,
      expiresAt: expiresAt,
      frontendUrl: env.FRONTEND_URL,
      baseDomain: env.PLATFORM_BASE_DOMAIN,
    });

    if (!emailResult.success) {
      console.error(`[invite-user v${DEPLOY_VERSION}] Email send failed:`, emailResult.error);
      // Don't fail the whole request - invitation was created, email can be resent
      return new Response(
        JSON.stringify({
          success: true,
          invitationId,
          emailStatus: 'not_found',
          suggestedAction: 'Invitation created but email failed - use resend',
          error: `Email delivery failed: ${emailResult.error}`,
        } as InviteUserResponse),
        { status: 207, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`[invite-user v${DEPLOY_VERSION}] Email sent: ${emailResult.messageId}`);

    // ==========================================================================
    // SUCCESS RESPONSE
    // ==========================================================================
    const response: InviteUserResponse = {
      success: true,
      invitationId,
      emailStatus: emailStatus.status,
    };

    return new Response(
      JSON.stringify(response),
      { status: 201, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error(`[invite-user v${DEPLOY_VERSION}] Error:`, error);
    return new Response(
      JSON.stringify({
        error: 'Internal server error',
        details: error.message,
        version: DEPLOY_VERSION,
      }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
