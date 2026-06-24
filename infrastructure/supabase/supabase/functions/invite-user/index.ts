/**
 * Invite User Edge Function
 *
 * Sends an invitation to a user to join an organization.
 * Implements smart email lookup and lazy expiration detection.
 *
 * CQRS-compliant: Emits user.invited domain event.
 * Permission required: user.create
 *
 * # Cross-provider invitation boundary gate (2026-05-13, card reject-cross-provider-invitations)
 *
 * When `checkEmailStatus` returns `other_org_member` (user exists in some
 * organization other than the target), this function calls
 * `api.check_invitation_acceptance_eligibility(invitee_user_id, target_org_id)`
 * BEFORE generating the invitation token or emitting `user.invited`.
 *
 * If the RPC returns `eligible=false` with `error='cross_provider_invitation_blocked'`,
 * the request is rejected with HTTP 422. No invitation token is issued; no
 * `user.invited` event is emitted. This is the canonical (pre-issuance) gate
 * — preferred over the `accept-invitation` Sally-path gate because it
 * prevents a bad token from ever reaching the invitee.
 *
 * Rationale: per `documentation/architecture/data/provider-partners-architecture.md`,
 * cross-tenant access between `type='provider'` orgs is reserved for users
 * whose home org is `type='provider_partner'`, mediated by
 * `cross_tenant_access_grants_projection`. Direct cross-provider invitations
 * were silently creating native multi-tenant role rows — closed in this commit.
 *
 * Defense-in-depth: `accept-invitation/index.ts` runs the SAME eligibility
 * check at acceptance time (returns 403). Both gates call the same RPC.
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import {
  validateEdgeFunctionEnv,
  createEnvErrorResponse,
  validateEmailFunctionEnv,
  validateAdminFunctionEnv,
} from '../_shared/env-schema.ts';
import { resolveAnonKey, resolveServiceRoleKey } from '../_shared/api-key-resolution.ts';
import { AnySchemaSupabaseClient, JWTPayload, hasPermission } from '../_shared/types.ts';
import {
  handleRpcError,
  createInternalError,
  createCorsPreflightResponse,
  standardCorsHeaders,
  createErrorResponse,
} from '../_shared/error-response.ts';
import { checkInvitationEligibility } from '../_shared/check-invitation-eligibility.ts';
import {
  extractTracingContext,
  createSpan,
  endSpan,
  type TracingContext,
} from '../_shared/tracing-context.ts';
import { buildEventMetadata } from '../_shared/emit-event.ts';
import { maskPii } from '../_shared/maskPii.ts';

// Deployment version tracking
const DEPLOY_VERSION = 'v20-route-existing-users-narrow-scope';

// CORS headers for frontend requests
const corsHeaders = standardCorsHeaders;

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
 * Phone number to create when invitation is accepted (Phase 6)
 */
interface InvitationPhone {
  label: string;           // e.g., "Mobile", "Work"
  type: 'mobile' | 'office' | 'fax' | 'emergency';
  number: string;          // Phone number
  countryCode?: string;    // Default: '+1'
  smsCapable?: boolean;    // Can receive SMS?
  isPrimary?: boolean;     // Primary phone?
}

/**
 * Supported operations
 *
 * Note: `revoke` was extracted to `api.revoke_invitation` (migration
 * `20260424221149_extract_revoke_invitation_rpc.sql`) per
 * adr-edge-function-vs-sql-rpc.md; frontend calls the RPC directly.
 */
type Operation = 'create' | 'resend';

/**
 * Request format from frontend
 */
interface InviteUserRequest {
  operation?: Operation;              // Default: 'create'
  invitationId?: string;              // Required for resend operation
  email?: string;                     // Required for create operation
  firstName?: string;                 // Required for create operation
  lastName?: string;                  // Required for create operation
  roles?: RoleReference[];
  accessStartDate?: string | null;    // ISO date (YYYY-MM-DD) or null
  accessExpirationDate?: string | null; // ISO date (YYYY-MM-DD) or null
  notificationPreferences?: NotificationPreferences;
  phones?: InvitationPhone[];         // Phase 6: phones to create on accept
}

/**
 * Email lookup result statuses
 */
type EmailStatus =
  | 'not_found'             // No user with this email
  | 'pending_invitation'    // Has pending invitation in this org
  | 'expired_invitation'    // Has expired invitation in this org
  | 'active_member'         // Active member of this org
  | 'deactivated'           // Deactivated member of this org
  | 'existing_user_no_roles' // User exists, zero roles anywhere (zombie)
  | 'other_org_member';     // User exists with ≥1 role in another org

/**
 * What invite-user actually DID — discriminates the success response so the
 * frontend can show the right message. `invitation_sent` = greenfield/expired
 * (token issued); `role_assigned` = existing user assigned directly (no token);
 * `user_reactivated_and_role_assigned` = deactivated user reactivated then assigned.
 */
export type InviteUserAction =
  | 'invitation_sent'
  | 'role_assigned'
  | 'user_reactivated_and_role_assigned';

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
  action?: InviteUserAction;
  invitationId?: string;
  userId?: string;
  emailStatus?: EmailStatus;
  suggestedAction?: string;
  error?: string;
  errorDetails?: { code?: string; context?: Record<string, unknown> };
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
export async function checkEmailStatus(
  supabase: AnySchemaSupabaseClient,
  email: string,
  orgId: string,
  tracingContext?: TracingContext
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
      await emitExpirationEvent(supabase, invitation, orgId, tracingContext);
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

  // Check if user exists in system (other orgs).
  // PR #64 closeout (Finding #3): api.check_user_exists now filters
  // `deleted_at IS NULL`, so a soft-deleted email returns no row here and is
  // treated as greenfield (correct for re-invite-after-delete flow). The
  // downstream cross-provider eligibility gate also relies on this filter
  // to avoid blocking re-invitations of formerly-deleted users; the audit
  // query in migration 20260513203931:185-187 mirrors the same filter, so
  // audit and runtime are now aligned.
  const { data: existingUser, error: userError } = await supabase
    .rpc('check_user_exists', { p_email: email });

  if (userError) {
    console.error(`[invite-user v${DEPLOY_VERSION}] User check error:`, userError);
  }

  if (existingUser?.[0]) {
    const existingUserId = existingUser[0].user_id;
    // Split the overloaded "user exists but not in this org" case: a user with
    // zero role assignments anywhere is a roleless existing user ("zombie",
    // route: direct assign), distinct from a member of another org (route:
    // cross-provider gate then assign). api.check_user_has_any_role supplies the
    // missing signal. On error, default to other_org_member — the conservative
    // path that still runs the cross-provider eligibility gate.
    const { data: hasRole, error: roleAnyError } = await supabase
      .rpc('check_user_has_any_role', { p_user_id: existingUserId });
    if (roleAnyError) {
      console.error(`[invite-user v${DEPLOY_VERSION}] has-any-role check error:`, roleAnyError);
    }
    return {
      status: (roleAnyError || hasRole) ? 'other_org_member' : 'existing_user_no_roles',
      userId: existingUserId,
    };
  }

  return { status: 'not_found' };
}

/**
 * Outcome of an existing-user write path. `done` carries the HTTP Response to
 * return as-is; `fallback_to_invite` signals the caller to fall through to the
 * normal invitation flow because the target is NOT addressable by the role RPCs
 * from this org — a cross-org existing user whose home org
 * (`users.current_organization_id`) differs from the caller's, which
 * `api.modify_user_roles` rejects with code `NOT_FOUND`. Narrow scope: cross-org
 * direct assignment is deferred to the grant pipeline
 * (see dev/active/cross-org-existing-user-direct-role-assign/).
 */
type ExistingUserOutcome =
  | { kind: 'done'; response: Response }
  | { kind: 'fallback_to_invite' };

/**
 * Same-org existing-user routing: assign the requested roles to a user who already
 * exists, via api.modify_user_roles called with the CALLER's JWT
 * (supabaseUser.schema('api')) so the RPC's permission + scope gates evaluate
 * against the inviter (Rule 19). No invitation token, no user.invited/user.created —
 * only user.role.assigned is emitted (by the RPC). Correlation chains automatically
 * (modify_user_roles sets app.correlation_id from users.correlation_id).
 *
 * Role-grant authority was already pre-validated for this request by the shared
 * validate_role_assignment block; modify_user_roles re-checks internally, so this
 * helper does not re-call it. The envelope surfaces RPC-side failures as
 * success:false. The tenancy NOT_FOUND case (cross-org target) returns
 * `fallback_to_invite` so the caller resumes the normal invitation flow.
 */
export async function assignRolesToExistingUser(
  supabaseUser: AnySchemaSupabaseClient,
  userId: string,
  roleIds: string[],
  reason: string,
  action: InviteUserAction,
  correlationId: string,
  corsHeaders: Record<string, string>,
): Promise<ExistingUserOutcome> {
  const { data: envelope, error: rpcError } = await supabaseUser
    .schema('api')
    .rpc('modify_user_roles', {
      p_user_id: userId,
      p_role_ids_to_add: roleIds,
      p_role_ids_to_remove: [],
      p_reason: reason,
    });

  if (rpcError) {
    return {
      kind: 'done',
      response: handleRpcError(rpcError, correlationId, corsHeaders, 'Assign role to existing user'),
    };
  }

  // modify_user_roles envelope (deployed shape, verified): failures are
  // { success:false, error:'<CODE>', errorDetails:{code,message} } — except
  // VALIDATION_FAILED, which carries top-level `violations`. `error` IS the code.
  const env_ = (envelope ?? {}) as {
    success?: boolean;
    error?: string;
    errorDetails?: { code?: string; message?: string };
    violations?: unknown;
  };

  if (!env_.success) {
    // Tenancy mismatch: the target's home org (users.current_organization_id)
    // differs from the caller's org, so modify_user_roles returns code NOT_FOUND.
    // The target is a cross-org existing user; fall back to the invitation flow
    // (status quo) rather than hard-failing. Cross-org direct assignment is
    // deferred to the grant pipeline (cross-org-existing-user-direct-role-assign).
    if (env_.error === 'NOT_FOUND') {
      console.log(`[invite-user v${DEPLOY_VERSION}] Existing user not addressable from this org (cross-org) — falling back to invitation`);
      return { kind: 'fallback_to_invite' };
    }
    const code = env_.errorDetails?.code ?? env_.error;
    const message = env_.errorDetails?.message ?? env_.error ?? 'Role assignment failed';
    console.warn(`[invite-user v${DEPLOY_VERSION}] modify_user_roles envelope failure:`, code);
    return {
      kind: 'done',
      response: new Response(
        JSON.stringify({
          success: false,
          error: message,
          // Thread role-validation violations through so the rich UsersErrorBanner
          // can render them (parity with the edit-roles path). N3.
          errorDetails:
            code || env_.violations
              ? {
                  code,
                  ...(env_.violations ? { context: { violations: env_.violations } } : {}),
                }
              : undefined,
        } as InviteUserResponse),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      ),
    };
  }

  return {
    kind: 'done',
    response: new Response(
      JSON.stringify({ success: true, action, userId } as InviteUserResponse),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    ),
  };
}

/**
 * Deactivated-member routing: reactivate the user (projection via
 * api.reactivate_user + clear the Supabase Auth ban, LB1) then additively assign
 * the requested roles. modify_user_roles rejects deactivated targets
 * (TARGET_DEACTIVATED), so reactivation must precede assignment.
 *
 * Reached only for `deactivated` — i.e. the target is a member of THIS org
 * (check_user_org_membership INNER-JOINs a role row here). In the current
 * single-org-per-user model their `current_organization_id` equals this org, so
 * both RPCs' tenancy guards pass; a multi-org member whose home org differs is an
 * extreme edge case that surfaces the RPC's NOT_FOUND envelope (handled below).
 *
 * Partial-failure: reactivate ok + unban fails → warn-and-proceed (recoverable);
 * reactivate ok + assign fails → the assign error is returned, the user stays
 * reactivated, admin retries.
 */
async function reactivateThenAssign(
  supabaseUser: AnySchemaSupabaseClient,
  supabaseAdmin: AnySchemaSupabaseClient,
  userId: string,
  roleIds: string[],
  correlationId: string,
  corsHeaders: Record<string, string>,
): Promise<Response> {
  const { data: envelope, error: rpcError } = await supabaseUser
    .schema('api')
    .rpc('reactivate_user', {
      p_user_id: userId,
      p_reason: 'Reactivated to add existing user to organization via invite flow',
    });

  if (rpcError) {
    return handleRpcError(rpcError, correlationId, corsHeaders, 'Reactivate user');
  }

  const env_ = (envelope ?? {}) as { success?: boolean; error?: string };
  if (!env_.success) {
    console.warn(`[invite-user v${DEPLOY_VERSION}] reactivate_user envelope failure:`, env_.error);
    return new Response(
      JSON.stringify({ success: false, error: env_.error ?? 'Failed to reactivate user' } as InviteUserResponse),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  // LB1: clear the Supabase Auth ban set at deactivation, else the reactivated
  // user (is_active=true in the projection) still cannot log in. Warn-and-proceed
  // on failure (idempotently retriable; the projection is the source of truth for
  // is_active). Mirrors manage-user's reactivate path.
  const { error: unbanError } = await supabaseAdmin.auth.admin.updateUserById(
    userId,
    { ban_duration: 'none' }
  );
  if (unbanError) {
    console.warn(`[invite-user v${DEPLOY_VERSION}] Failed to clear auth ban after reactivate:`, unbanError);
  }

  // Additively assign the requested roles on top of the user's restored roles.
  const outcome = await assignRolesToExistingUser(
    supabaseUser,
    userId,
    roleIds,
    'Added existing user to organization via invite flow (post-reactivation)',
    'user_reactivated_and_role_assigned',
    correlationId,
    corsHeaders,
  );
  if (outcome.kind === 'done') {
    return outcome.response;
  }

  // Defensive: if reactivate passed its tenancy guard, current_organization_id ==
  // caller org, so the assign's identical guard passes too — this branch is
  // effectively unreachable. If it ever fires (multi-org), the user is already
  // reactivated; surface a clear error rather than silently issuing a token.
  return new Response(
    JSON.stringify({
      success: false,
      error: 'User was reactivated but their roles must be assigned from their home organization',
    } as InviteUserResponse),
    { status: 409, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  );
}

/**
 * Emit invitation.expired event (lazy expiration detection)
 */
async function emitExpirationEvent(
  supabase: AnySchemaSupabaseClient,
  invitation: { id: string; email: string; expires_at: string },
  orgId: string,
  tracingContext?: TracingContext
): Promise<void> {
  console.log(`[invite-user v${DEPLOY_VERSION}] Emitting lazy expiration event for invitation ${invitation.id}`);

  // Build metadata with tracing if context provided
  const metadata = tracingContext
    ? buildEventMetadata(tracingContext, 'invitation.expired', undefined, {
        trigger: 'lazy_expiration_detection',
        detected_by: 'invite-user-edge-function',
      })
    : {
        trigger: 'lazy_expiration_detection',
        detected_by: 'invite-user-edge-function',
      };

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
    p_event_metadata: metadata,
  });

  if (error) {
    console.error(`[invite-user v${DEPLOY_VERSION}] Failed to emit expiration event:`, error);
  }
}

/**
 * Send invitation email via Resend API
 */
export async function sendInvitationEmail(
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
        // PII mask: Resend errorData.message can echo recipient email back.
        error: `Resend API error: ${response.status} - ${maskPii(errorData.message) || 'Unknown error'}`,
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
      // PII mask: error.message may carry email server response detail with email addresses.
      error: `Failed to send email: ${maskPii(error.message)}`,
    };
  }
}

serve(async (req) => {
  // Extract tracing context from request headers (W3C traceparent + custom headers)
  const tracingContext = extractTracingContext(req);
  const correlationId = tracingContext.correlationId;
  const span = createSpan(tracingContext, 'invite-user');

  console.log(`[invite-user v${DEPLOY_VERSION}] Processing ${req.method} request, correlation_id=${correlationId}, trace_id=${tracingContext.traceId}`);

  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return createCorsPreflightResponse(corsHeaders);
  }

  // Only allow POST
  if (req.method !== 'POST') {
    return createErrorResponse(
      { error: 'Method not allowed', code: 'METHOD_NOT_ALLOWED', status: 405, correlationId },
      corsHeaders
    );
  }

  // ==========================================================================
  // ENVIRONMENT VALIDATION - TWO-STAGE FAIL FAST
  // ==========================================================================
  // Stage 1: Zod schema validation (types and optionality)
  // Stage 2: Business logic validation (conditional requirements)
  // See: _shared/env-schema.ts for the two-stage pattern documentation
  let env;
  try {
    // Stage 1: Zod schema validation
    env = validateEdgeFunctionEnv('invite-user');

    // Stage 2: Business logic validation (this function requires admin + email)
    const adminValidation = validateAdminFunctionEnv(env, 'invite-user');
    if (!adminValidation.valid) {
      return createEnvErrorResponse('invite-user', DEPLOY_VERSION,
        adminValidation.errors.join('; '), corsHeaders);
    }

    const emailValidation = validateEmailFunctionEnv(env, 'invite-user');
    if (!emailValidation.valid) {
      return createEnvErrorResponse('invite-user', DEPLOY_VERSION,
        emailValidation.errors.join('; '), corsHeaders);
    }
  } catch (error) {
    return createEnvErrorResponse('invite-user', DEPLOY_VERSION, error.message, corsHeaders);
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

    // Extract and decode JWT token to access custom claims
    // Custom claims are added to the JWT payload via database hook, NOT to user.app_metadata
    // See: infrastructure/supabase/sql/03-functions/authorization/003-supabase-auth-jwt-hook.sql
    const jwt = authHeader.replace('Bearer ', '');
    const jwtParts = jwt.split('.');

    if (jwtParts.length !== 3) {
      return new Response(
        JSON.stringify({ error: 'Invalid JWT token format' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Decode JWT payload (base64)
    let jwtPayload: JWTPayload;
    try {
      jwtPayload = JSON.parse(atob(jwtParts[1]));
    } catch (_e) {
      return new Response(
        JSON.stringify({ error: 'Failed to decode JWT token' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Create Supabase client with user's JWT for auth validation
    const supabaseUser = createClient(env.SUPABASE_URL, resolveAnonKey(req, env), {
      global: { headers: { Authorization: authHeader } },
    });

    // Validate the JWT by calling getUser
    const { data: { user }, error: authError } = await supabaseUser.auth.getUser();
    if (authError || !user) {
      return new Response(
        JSON.stringify({ error: 'Invalid or expired token' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Check if user's organization is deactivated (access blocked via JWT hook)
    if (jwtPayload.access_blocked) {
      console.log(`[invite-user ${DEPLOY_VERSION}] Access blocked for user ${user.id}: ${jwtPayload.access_block_reason || 'organization_deactivated'}`);
      return new Response(
        JSON.stringify({ error: 'Access blocked: organization is deactivated' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Extract custom claims from decoded JWT payload (not from user.app_metadata!)
    // The JWT hook adds claims directly to the token payload
    const orgId = jwtPayload.org_id;
    const effectivePermissions = jwtPayload.effective_permissions;

    if (!orgId) {
      return new Response(
        JSON.stringify({ error: 'No organization context in token' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Check user.create permission
    if (!hasPermission(effectivePermissions, 'user.create')) {
      console.log(`[invite-user v${DEPLOY_VERSION}] Permission denied: user ${user.id} lacks user.create`);
      return new Response(
        JSON.stringify({ error: 'Permission denied: user.create required' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`[invite-user v${DEPLOY_VERSION}] User ${user.id} authorized for org ${orgId}`);

    // ==========================================================================
    // ADMIN CLIENT SETUP (needed for both resend and create operations)
    // ==========================================================================
    // Use service role for database operations
    // Note: APP_SECRET_KEY or SUPABASE_SERVICE_ROLE_KEY is guaranteed by Stage 2 validation above
    const supabaseAdmin = createClient(env.SUPABASE_URL, resolveServiceRoleKey(env)!, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
      db: {
        schema: 'api',
      },
    });

    // ==========================================================================
    // REQUEST PARSING
    // ==========================================================================
    const requestData: InviteUserRequest = await req.json();
    const operation = requestData.operation || 'create';

    console.log(`[invite-user v${DEPLOY_VERSION}] Operation: ${operation}`);

    // ==========================================================================
    // RESEND OPERATION
    // ==========================================================================
    if (operation === 'resend') {
      if (!requestData.invitationId) {
        return new Response(
          JSON.stringify({ error: 'Missing invitationId for resend operation' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      console.log(`[invite-user v${DEPLOY_VERSION}] Resending invitation ${requestData.invitationId}`);

      // Lookup existing invitation via CQRS-compliant RPC
      const { data: invitationData, error: lookupError } = await supabaseAdmin
        .rpc('get_invitation_for_resend', {
          p_invitation_id: requestData.invitationId,
          p_org_id: orgId,
        });

      const existingInvitation = invitationData?.[0];
      if (lookupError || !existingInvitation) {
        console.error(`[invite-user v${DEPLOY_VERSION}] Invitation not found:`, lookupError);
        return new Response(
          JSON.stringify({ error: 'Invitation not found or access denied' }),
          { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      if (existingInvitation.status === 'accepted') {
        return new Response(
          JSON.stringify({ error: 'Cannot resend accepted invitation' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      if (existingInvitation.status === 'revoked') {
        return new Response(
          JSON.stringify({ error: 'Cannot resend revoked invitation' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      // Generate new token and expiration
      const newToken = generateSecureToken();
      const newExpiresAt = new Date();
      newExpiresAt.setDate(newExpiresAt.getDate() + INVITATION_EXPIRY_DAYS);

      // Get organization name for email via CQRS-compliant RPC
      const { data: orgData } = await supabaseAdmin
        .rpc('get_organization_by_id', { p_org_id: orgId });

      const orgName = orgData?.[0]?.name || 'Analytics4Change';

      // Emit invitation.resent event (distinct event type for resend operations)
      // Use proper TracingContext for W3C trace context propagation
      const eventMetadata = buildEventMetadata(tracingContext, 'invitation.resent', req, {
        user_id: user.id,
        reason: 'Invitation resent by administrator',
        invitation_id: existingInvitation.invitation_id,
      });

      const { error: eventError } = await (supabaseAdmin as AnySchemaSupabaseClient)
        .schema('api')
        .rpc('emit_domain_event', {
          p_stream_id: existingInvitation.invitation_id,  // Stream ID is invitation (matches other invitation lifecycle events)
          p_stream_type: 'invitation',
          p_event_type: 'invitation.resent',
          p_event_data: {
            invitation_id: existingInvitation.invitation_id,
            org_id: orgId,
            email: existingInvitation.email,
            token: newToken,
            expires_at: newExpiresAt.toISOString(),
            resent_by: user.id,
            // previous_token intentionally omitted for security (don't store old tokens)
          },
          p_event_metadata: eventMetadata,
        });

      if (eventError) {
        console.error(`[invite-user v${DEPLOY_VERSION}] Failed to emit resend event:`, eventError);
        return handleRpcError(eventError, correlationId, corsHeaders, 'resend invitation');
      }

      // Send the invitation email
      const emailResult = await sendInvitationEmail(env.RESEND_API_KEY!, {
        email: existingInvitation.email,
        firstName: existingInvitation.first_name || 'User',
        lastName: existingInvitation.last_name || '',
        orgName,
        token: newToken,
        expiresAt: newExpiresAt,
        frontendUrl: env.FRONTEND_URL,
        baseDomain: env.PLATFORM_BASE_DOMAIN,
      });

      if (!emailResult.success) {
        console.error(`[invite-user v${DEPLOY_VERSION}] Email send failed:`, emailResult.error);
        // Event already emitted, so invitation is updated - just warn about email
        return new Response(
          JSON.stringify({
            success: true,
            invitationId: existingInvitation.id,
            warning: 'Invitation updated but email delivery failed',
            emailError: emailResult.error,
          }),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      console.log(`[invite-user v${DEPLOY_VERSION}] Invitation resent successfully: ${existingInvitation.id}`);

      return new Response(
        JSON.stringify({
          success: true,
          invitationId: existingInvitation.id,
          emailStatus: 'pending_invitation',
        }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // ==========================================================================
    // CREATE OPERATION - REQUEST VALIDATION
    // ==========================================================================
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

    // NOTE: roles array is optional - empty array means user has no permissions until assigned
    // This allows inviting users who will have roles assigned later by organization admin

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(requestData.email)) {
      return new Response(
        JSON.stringify({ error: 'Invalid email format' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // ==========================================================================
    // ROLE ASSIGNMENT VALIDATION
    // ==========================================================================
    // Validate that inviter can assign the requested roles (permission subset + scope hierarchy)
    // Empty roles array is always valid (no-role invitations allowed)
    if (requestData.roles && requestData.roles.length > 0) {
      const roleIds = requestData.roles.map(r => r.role_id);
      console.log(`[invite-user v${DEPLOY_VERSION}] Validating role assignment for ${roleIds.length} roles...`);

      // Create a Supabase client with the user's JWT to validate as them
      // This uses their permissions/scopes to check what they can assign
      const supabaseUserApi = createClient(env.SUPABASE_URL, resolveAnonKey(req, env), {
        global: { headers: { Authorization: authHeader } },
        db: { schema: 'api' },
      });

      const { data: validationResult, error: validationError } = await supabaseUserApi
        .rpc('validate_role_assignment', { p_role_ids: roleIds });

      if (validationError) {
        console.error(`[invite-user v${DEPLOY_VERSION}] Role validation error:`, validationError);
        return new Response(
          JSON.stringify({ error: 'Failed to validate role assignment', details: validationError.message }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      if (validationResult && !validationResult.valid) {
        const violations = validationResult.violations || [];
        const firstViolation = violations[0];
        console.log(`[invite-user v${DEPLOY_VERSION}] Role assignment denied:`, firstViolation);

        return new Response(
          JSON.stringify({
            success: false,
            error: firstViolation?.message || 'Role assignment not permitted',
            errorDetails: {
              code: firstViolation?.error_code || 'ROLE_ASSIGNMENT_VIOLATION',
              role_id: firstViolation?.role_id,
              role_name: firstViolation?.role_name,
              violations: violations,
            },
          }),
          { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      console.log(`[invite-user v${DEPLOY_VERSION}] Role assignment validated successfully`);
    }

    // ==========================================================================
    // SMART EMAIL LOOKUP
    // ==========================================================================
    // Note: supabaseAdmin already declared above (shared for resend and create)
    const emailStatus = await checkEmailStatus(supabaseAdmin, requestData.email, orgId, tracingContext);
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
    // CROSS-PROVIDER INVITATION GATE (pre-issuance, defense in depth)
    // ==========================================================================
    // Card: reject-cross-provider-invitations (2026-05-13).
    // If checkEmailStatus identified the invitee as a member of some OTHER
    // organization (other_org_member), run api.check_invitation_acceptance_eligibility
    // to confirm the cross-org invitation is allowed. Block at 422 BEFORE
    // generating the invitation token / emitting user.invited.
    //
    // See top-of-file docblock for full rationale + reference to the
    // acceptance-time gate in accept-invitation/index.ts.
    if (emailStatus.status === 'other_org_member' && emailStatus.userId) {
      const gate = await checkInvitationEligibility({
        client: supabaseAdmin,
        inviteeUserId: emailStatus.userId,
        targetOrgId: orgId,
        correlationId,
        corsHeaders,
        blockedStatus: 422,
        logTag: `[invite-user v${DEPLOY_VERSION}]`,
      });
      if ('response' in gate) {
        return gate.response;
      }
    }

    // ==========================================================================
    // EXISTING-USER ROUTING — direct assign / reactivate-then-assign (no token)
    // ==========================================================================
    // Card: invite-user-route-existing-users-to-role-assign (epic PR 3).
    // For a same-org existing user the correct write is a direct role assignment
    // (or reactivate-then-assign), NOT an invitation token + acceptance ceremony.
    // These paths emit ONLY user.role.assigned / user.reactivated (via the RPCs) —
    // no misleading user.invited / no-op user.created. Correlation chains
    // automatically (the RPCs set app.correlation_id from users.correlation_id).
    //
    // NARROW SCOPE: only same-org-addressable existing users are routed here.
    //   - `deactivated` — member of THIS org (check_user_org_membership matched a
    //     role row here); reactivate + assign.
    //   - `existing_user_no_roles` — a roleless ("zombie") existing user; assign
    //     directly. If the target's home org differs from the caller's, the role
    //     RPC returns NOT_FOUND and we FALL BACK to the invitation flow (status quo).
    //   - `other_org_member` (≥1 role in another org) is NOT routed here — it
    //     stays on the invitation path below (status quo, after the cross-provider
    //     gate). Cross-org direct role assignment is deferred to the grant pipeline
    //     (dev/active/cross-org-existing-user-direct-role-assign/).
    if (emailStatus.userId && emailStatus.status === 'deactivated') {
      const roleIds = (requestData.roles ?? []).map((r) => r.role_id);
      if (roleIds.length === 0) {
        return new Response(
          JSON.stringify({
            success: false,
            error: 'At least one role is required to add an existing user to the organization',
          } as InviteUserResponse),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      console.log(`[invite-user v${DEPLOY_VERSION}] Existing deactivated member — reactivate then assign roles`);
      return await reactivateThenAssign(
        supabaseUser, supabaseAdmin, emailStatus.userId, roleIds, correlationId, corsHeaders,
      );
    }

    if (emailStatus.userId && emailStatus.status === 'existing_user_no_roles') {
      const roleIds = (requestData.roles ?? []).map((r) => r.role_id);
      if (roleIds.length === 0) {
        return new Response(
          JSON.stringify({
            success: false,
            error: 'At least one role is required to add an existing user to the organization',
          } as InviteUserResponse),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      console.log(`[invite-user v${DEPLOY_VERSION}] Existing roleless user — assign roles directly`);
      const outcome = await assignRolesToExistingUser(
        supabaseUser,
        emailStatus.userId,
        roleIds,
        'Added existing user to organization via invite flow',
        'role_assigned',
        correlationId,
        corsHeaders,
      );
      if (outcome.kind === 'done') {
        return outcome.response;
      }
      // outcome.kind === 'fallback_to_invite' (cross-org zombie) → continue to
      // CREATE INVITATION below (status quo: issue a token).
    }

    // ==========================================================================
    // CREATE INVITATION
    // (greenfield `not_found`, stale-token `expired_invitation`, `other_org_member`,
    //  and cross-org existing-user fallbacks)
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
    // Phase 6: Include phones if provided
    if (requestData.phones && requestData.phones.length > 0) {
      eventData.phones = requestData.phones;
    }

    // Emit user.invited event - routes to USER aggregate via process_user_event()
    // stream_id is invitation_id (user_id doesn't exist until invitation is accepted)
    console.log(`[invite-user v${DEPLOY_VERSION}] Emitting user.invited event...`);
    const { data: eventId, error: eventError } = await supabaseAdmin
      .rpc('emit_domain_event', {
        p_stream_id: invitationId, // Events on user aggregate (invitation is user lifecycle)
        p_stream_type: 'user',
        p_event_type: 'user.invited',
        p_event_data: eventData,
        p_event_metadata: buildEventMetadata(tracingContext, 'user.invited', req, {
          user_id: user.id,
          reason: 'Manual user invitation',
        }),
      });

    if (eventError) {
      console.error(`[invite-user v${DEPLOY_VERSION}] Failed to emit event:`, eventError);
      return handleRpcError(eventError, correlationId, corsHeaders, 'Create invitation');
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
          action: 'invitation_sent',
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
      action: 'invitation_sent',
      invitationId,
      emailStatus: emailStatus.status,
    };

    // End span with success status
    const completedSpan = endSpan(span, 'ok');
    console.log(`[invite-user v${DEPLOY_VERSION}] Completed in ${completedSpan.durationMs}ms, correlation_id=${correlationId}`);

    return new Response(
      JSON.stringify(response),
      { status: 201, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    // End span with error status
    const completedSpan = endSpan(span, 'error');
    console.error(`[invite-user v${DEPLOY_VERSION}] Unhandled error after ${completedSpan.durationMs}ms:`, error);
    return createInternalError(correlationId, corsHeaders, error.message);
  }
});
