/**
 * Accept Invitation Edge Function
 *
 * This Edge Function accepts an invitation and creates a user account.
 * It handles both email/password and OAuth (Google) authentication methods.
 *
 * CQRS-compliant: Emits domain events for user creation and role assignment.
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { validateEdgeFunctionEnv, createEnvErrorResponse } from '../_shared/env-schema.ts';
import {
  handleRpcError,
  createValidationError,
  createNotFoundError,
  createInternalError,
  createCorsPreflightResponse,
  standardCorsHeaders,
} from '../_shared/error-response.ts';
import {
  extractTracingContext,
  createSpan,
  endSpan,
} from '../_shared/tracing-context.ts';
import { buildEventMetadata } from '../_shared/emit-event.ts';

// Deployment version tracking
const DEPLOY_VERSION = 'v20-phone-emit-index-preservation';

// CORS headers for frontend requests
const corsHeaders = standardCorsHeaders;

/**
 * Phone shape carried in the invitation envelope. Mirrors the frontend's
 * InvitationPhone type at `frontend/src/pages/users/UsersManagePage.tsx`.
 */
export interface InvitationPhone {
  label: string;
  type: 'mobile' | 'office' | 'fax' | 'emergency';
  number: string;
  countryCode?: string;
  smsCapable?: boolean;
  isPrimary?: boolean;
}

/**
 * Pairing of a freshly-minted phone UUID with the InvitationPhone payload it
 * was created from. The accept-invitation handler builds this array in
 * iteration order from the invitation's `phones[]`; the index correspondence
 * is load-bearing for `resolveInvitationPhonePlaceholder` (do NOT reorder).
 *
 * `phoneId` is `string | null` to support sentinel slots: if a per-phone
 * `user.phone.added` emit fails (non-fatal in this saga), the call site
 * pushes `{ phoneId: null, phone }` to preserve index correspondence
 * with the frontend's `phones[]` array. Without this, a failed emit would
 * silently shift subsequent indexes and route SMS to the wrong phone
 * (closed in v20-phone-emit-index-preservation, 2026-04-29).
 */
export interface CreatedInvitationPhone {
  phoneId: string | null;
  phone: InvitationPhone;
}

/**
 * Resolve an `invitation-phone-N` placeholder phoneId to the real phone UUID
 * created earlier in this invitation-acceptance flow.
 *
 * The frontend invitation form (`UsersManagePage.tsx:847`) generates
 * placeholders of the form `invitation-phone-${index}` because it doesn't
 * yet know the real UUIDs that will be minted at acceptance time. The
 * backend is responsible for substituting the real UUID once phones exist.
 *
 * Pre-conditions:
 *   - createdPhoneIds is in the same iteration order as the frontend's
 *     phones[] array (stable insertion-order index correspondence). The
 *     accept-invitation handler at the call site iterates phones in array
 *     order and pushes into createdPhoneIds without reordering.
 *   - rawPhoneId is one of: null, undefined, an `invitation-phone-N` string,
 *     or a UUID belonging to this user's createdPhoneIds. Any other input
 *     is normalized to null + warn.
 *   - context: correlationId/userId/invitationId for joinable structured logs.
 *
 * Post-conditions:
 *   - Returns either null or a string that is byte-identical to one of the
 *     UUIDs in createdPhoneIds. Never returns a placeholder. Never throws.
 *   - For input `invitation-phone-N` with N in [0, createdPhoneIds.length),
 *     output === createdPhoneIds[N].phoneId.
 *
 * Cases:
 *   - null/undefined input → null (no SMS phone selected; auto-select may fire)
 *   - "invitation-phone-N" with N in range → createdPhoneIds[N].phoneId
 *   - "invitation-phone-N" with N out of range → null + warn (auto-select may fire)
 *   - Valid UUID matching an entry in createdPhoneIds → pass through
 *   - Valid UUID NOT in createdPhoneIds → null + warn (defense in depth: prevents
 *     a hand-crafted invitation payload from pointing this user's
 *     sms_phone_id at another user's phone or a fabricated UUID)
 *   - Other malformed string → null + warn (avoids silent handler ::UUID cast failure)
 *
 * Behavior with sms.enabled=false:
 *   The helper is invoked unconditionally (regardless of prefs.sms.enabled)
 *   so that any placeholder is always normalized to a clean UUID-or-null
 *   before reaching the handler's ::UUID cast. If the inviter set SMS off
 *   but left a placeholder selected, the projection will end up with
 *   sms_enabled=false and sms_phone_id=<resolved UUID> — consistent with the
 *   read-back contract of api.update_user_notification_preferences and a
 *   harmless tombstone of the inviter's intent.
 *
 * Index correspondence under partial phone-emit failure (closed):
 *   The phone-loop at the call site treats per-phone emit failures as
 *   non-fatal. To preserve index correspondence, the call site pushes a
 *   sentinel `{ phoneId: null, phone }` into createdPhoneIds for each
 *   failed emit. This helper observes sentinels via the in-range null
 *   path: createdPhoneIds[N].phoneId === null falls through to a
 *   `null + warn` branch identical to out-of-range, and the auto-select
 *   fallback at the call site filters `phoneId !== null`. Net effect:
 *   inviter intent is honored when index lands on a successful slot;
 *   gracefully degrades to auto-select when index lands on a sentinel.
 *   Prior to v20, a failed emit silently shifted index correspondence
 *   and could route SMS to the wrong phone. See
 *   `dev/active/fix-phone-emit-index-preservation/` for the fix history.
 *
 * Edge case — smsCapable mismatch on placeholder path:
 *   The helper passes through a placeholder-resolved UUID even if the
 *   underlying phone has smsCapable=false. The auto-select branch at
 *   the call site explicitly filters smsCapable=true; the placeholder
 *   path does not. This is intentional — the placeholder represents the
 *   inviter's stated intent ("send SMS to phone N"), and the helper
 *   honors it. If the inviter chose a non-SMS-capable phone, the
 *   resulting projection state (sms_enabled=true, sms_phone_id=<non-sms
 *   capable phone>) reflects their decision; downstream notification
 *   delivery (in workflows/) is responsible for skipping or escalating
 *   based on phone capability.
 */
export function resolveInvitationPhonePlaceholder(
  rawPhoneId: string | null | undefined,
  createdPhoneIds: CreatedInvitationPhone[],
  context: { correlationId?: string; userId: string; invitationId: string }
): string | null {
  if (!rawPhoneId) return null;

  const placeholderMatch = rawPhoneId.match(/^invitation-phone-(\d+)$/);
  if (placeholderMatch) {
    const index = parseInt(placeholderMatch[1], 10);
    if (index >= 0 && index < createdPhoneIds.length) {
      const slot = createdPhoneIds[index];
      if (slot.phoneId === null) {
        // Sentinel slot — phone emit failed for this index. Surface as a
        // distinct warn so the silent-degradation case the card was filed
        // to close has a diagnostic signal at exactly the failure mode.
        console.warn(
          `[accept-invitation v${DEPLOY_VERSION}] Placeholder phoneId resolves to a sentinel slot (phone emit failed for this index); falling back to null`,
          {
            rawPhoneId,
            index,
            phoneLabel: slot.phone.label,
            correlationId: context.correlationId,
            userId: context.userId,
            invitationId: context.invitationId,
          }
        );
        return null;
      }
      return slot.phoneId;
    }
    console.warn(
      `[accept-invitation v${DEPLOY_VERSION}] Placeholder phoneId out of range; falling back to null`,
      {
        rawPhoneId,
        createdPhoneIdsLength: createdPhoneIds.length,
        correlationId: context.correlationId,
        userId: context.userId,
        invitationId: context.invitationId,
      }
    );
    return null;
  }

  // Validate it looks like a UUID; if not, refuse to pass through to avoid
  // silent handler ::UUID cast failures (the bug this function exists to prevent).
  const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (uuidPattern.test(rawPhoneId)) {
    // Defense in depth: a UUID must correspond to a phone we just created
    // for this user. Reject anything else — prevents a hand-crafted invitation
    // payload from setting sms_phone_id to another user's phone or a
    // fabricated UUID.
    const isOwnedPhone = createdPhoneIds.some((p) => p.phoneId === rawPhoneId);
    if (isOwnedPhone) {
      return rawPhoneId;
    }
    console.warn(
      `[accept-invitation v${DEPLOY_VERSION}] phoneId is a UUID but not in createdPhoneIds; falling back to null`,
      {
        rawPhoneId,
        createdPhoneIdsLength: createdPhoneIds.length,
        correlationId: context.correlationId,
        userId: context.userId,
        invitationId: context.invitationId,
      }
    );
    return null;
  }

  console.warn(
    `[accept-invitation v${DEPLOY_VERSION}] phoneId is neither a placeholder nor a UUID; falling back to null`,
    {
      rawPhoneId,
      correlationId: context.correlationId,
      userId: context.userId,
      invitationId: context.invitationId,
    }
  );
  return null;
}

/**
 * Supported OAuth providers (matches frontend OAuthProvider type)
 * See: frontend/src/types/auth.types.ts
 */
type OAuthProvider = 'google' | 'github' | 'facebook' | 'apple' | 'azure' | 'okta' | 'keycloak';

/**
 * SSO configuration for enterprise SAML auth
 */
interface SSOConfig {
  type: 'saml';
  domain: string;
}

/**
 * Auth method discriminated union (matches frontend AuthMethod type)
 * See: frontend/src/types/auth.types.ts
 */
type AuthMethod =
  | { type: 'email_password' }
  | { type: 'oauth'; provider: OAuthProvider }
  | { type: 'sso'; config: SSOConfig };

/**
 * User credentials from frontend
 * See: frontend/src/types/organization.types.ts
 */
interface UserCredentials {
  email: string;
  password?: string;           // For email/password auth
  authMethod?: AuthMethod;     // For OAuth/SSO auth
  authenticatedUserId?: string; // Pre-authenticated OAuth user ID
}

/**
 * Request format from frontend:
 * - Email/password: { token, credentials: { email, password } }
 * - OAuth: { token, credentials: { email, authMethod: { type: 'oauth', provider: 'google' }, authenticatedUserId }, platform }
 * - SSO: { token, credentials: { email, authMethod: { type: 'sso', config: { type: 'saml', domain: 'acme.com' } }, authenticatedUserId }, platform }
 */
interface AcceptInvitationRequest {
  token: string;
  credentials: UserCredentials;
  platform?: 'web' | 'ios' | 'android';
}

/**
 * Response format (matches frontend AcceptInvitationResult)
 * See: frontend/src/types/organization.types.ts
 */
interface AcceptInvitationResponse {
  success: boolean;
  userId?: string;
  orgId?: string;        // Frontend expects orgId, not organizationId
  redirectUrl?: string;
  error?: string;
}

serve(async (req) => {
  // Extract initial tracing context from request headers
  // NOTE: We'll override correlationId with stored value from invitation for lifecycle tracing
  let tracingContext = extractTracingContext(req);
  let correlationId = tracingContext.correlationId;
  const span = createSpan(tracingContext, 'accept-invitation');

  console.log(`[accept-invitation v${DEPLOY_VERSION}] Processing ${req.method} request, initial_correlation_id=${correlationId}, trace_id=${tracingContext.traceId}`);

  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return createCorsPreflightResponse(corsHeaders);
  }

  // ==========================================================================
  // ENVIRONMENT VALIDATION - FAIL FAST
  // Zod validates required env vars and returns typed object
  // ==========================================================================
  let env;
  try {
    env = validateEdgeFunctionEnv('accept-invitation');
  } catch (error) {
    return createEnvErrorResponse('accept-invitation', DEPLOY_VERSION, error.message, corsHeaders);
  }

  // This function requires service role key (not auto-set by Supabase)
  if (!env.SUPABASE_SERVICE_ROLE_KEY) {
    return createEnvErrorResponse('accept-invitation', DEPLOY_VERSION, 'SUPABASE_SERVICE_ROLE_KEY is required', corsHeaders);
  }

  try {
    // Initialize Supabase client with service role
    // Use 'api' schema since that's what's exposed through PostgREST
    const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
      db: {
        schema: 'api',
      },
    });


    // Parse request body
    const requestData: AcceptInvitationRequest = await req.json();

    // Validate request
    if (!requestData.token) {
      return createValidationError('Missing token', correlationId, corsHeaders, 'token');
    }

    if (!requestData.credentials) {
      return createValidationError('Missing credentials', correlationId, corsHeaders, 'credentials');
    }

    // Determine auth method from credentials
    const authMethodType = requestData.credentials.authMethod?.type;
    const isOAuth = authMethodType === 'oauth' || authMethodType === 'sso';
    const isEmailPassword = !!requestData.credentials.password;

    if (!isOAuth && !isEmailPassword) {
      return createValidationError('Missing password or authMethod', correlationId, corsHeaders);
    }

    console.log(`[accept-invitation v${DEPLOY_VERSION}] Auth method: ${authMethodType || 'email_password'}`);

    // Query invitation via RPC function in api schema (bypasses public schema restriction)
    console.log(`[accept-invitation v${DEPLOY_VERSION}] Querying invitation via RPC...`);
    const { data: invitations, error: invitationError } = await supabase
      .rpc('get_invitation_by_token', { p_token: requestData.token });

    if (invitationError) {
      console.error(`[accept-invitation v${DEPLOY_VERSION}] RPC error:`, invitationError);
      return handleRpcError(invitationError, correlationId, corsHeaders, 'Query invitation');
    }

    // RPC returns array, get first result
    const invitation = invitations?.[0];

    if (!invitation) {
      return createNotFoundError('Invitation', correlationId, corsHeaders);
    }

    console.log(`[accept-invitation v${DEPLOY_VERSION}] Found invitation: ${invitation.id}`);

    // ========================================================================
    // BUSINESS-SCOPED CORRELATION ID PATTERN
    // Use the stored correlation_id from the invitation for lifecycle tracing.
    // This ties together: user.invited → invitation.resent → invitation.accepted
    // ========================================================================
    if (invitation.correlation_id) {
      correlationId = invitation.correlation_id;
      tracingContext = { ...tracingContext, correlationId };
      console.log(`[accept-invitation v${DEPLOY_VERSION}] Using stored correlation_id for lifecycle tracing: ${correlationId}`);
    } else {
      console.log(`[accept-invitation v${DEPLOY_VERSION}] No stored correlation_id, using request correlation_id: ${correlationId}`);
    }

    // Validate invitation
    const expiresAt = new Date(invitation.expires_at);
    const now = new Date();
    if (expiresAt < now) {
      return new Response(
        JSON.stringify({ error: 'Invitation has expired' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (invitation.accepted_at) {
      return new Response(
        JSON.stringify({ error: 'Invitation has already been accepted' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Create user account based on auth method
    let userId: string | undefined;
    const { credentials } = requestData;

    if (isEmailPassword) {
      // Create user with email/password
      console.log(`[accept-invitation v${DEPLOY_VERSION}] Creating user with email/password...`);
      const { data: authData, error: createError } = await supabase.auth.admin.createUser({
        email: invitation.email,
        password: credentials.password!,
        email_confirm: true, // Auto-confirm email since they're accepting an invitation
        user_metadata: {
          organization_id: invitation.organization_id,
          invited_via: 'organization_bootstrap',
        },
      });

      if (createError) {
        // Check if user already exists (from previous failed attempt)
        // This can happen if user creation succeeded but event emission failed
        if (createError.message?.includes('already been registered')) {
          console.log(`[accept-invitation v${DEPLOY_VERSION}] User already exists, looking up...`);

          // Look up existing user by email using listUsers with filter
          const { data: existingUsers, error: listError } = await supabase.auth.admin.listUsers();

          if (listError) {
            console.error(`[accept-invitation v${DEPLOY_VERSION}] Failed to list users:`, listError);
            return new Response(
              JSON.stringify({ error: 'Failed to look up existing user', details: listError.message }),
              { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            );
          }

          const existingUser = existingUsers.users.find(u => u.email === invitation.email);
          if (existingUser) {
            userId = existingUser.id;
            console.log(`[accept-invitation v${DEPLOY_VERSION}] Found existing user: ${userId}`);
          } else {
            // User claimed to exist but not found - unexpected state
            console.error(`[accept-invitation v${DEPLOY_VERSION}] User exists error but user not found`);
            return new Response(
              JSON.stringify({ error: 'User exists but not found', details: 'Inconsistent auth state' }),
              { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            );
          }
        } else {
          // Other auth errors are still fatal
          console.error(`[accept-invitation v${DEPLOY_VERSION}] User creation failed:`, createError);
          return new Response(
            JSON.stringify({ error: 'Failed to create user account', details: createError.message }),
            { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }
      } else {
        userId = authData.user.id;
        console.log(`[accept-invitation v${DEPLOY_VERSION}] User created: ${userId}`);
      }
    } else if (isOAuth) {
      // OAuth/SSO flow: User has already authenticated via browser redirect, we complete the invitation
      const authenticatedUserId = credentials.authenticatedUserId;
      const authMethod = credentials.authMethod!;
      const provider = authMethod.type === 'oauth'
        ? authMethod.provider
        : (authMethod as { type: 'sso'; config: SSOConfig }).config.type;

      console.log(`[accept-invitation v${DEPLOY_VERSION}] Processing ${authMethod.type} authentication`, {
        provider,
        platform: requestData.platform || 'web',
      });

      if (!authenticatedUserId) {
        return new Response(
          JSON.stringify({
            error: 'Authentication required',
            message: `Please complete ${provider} sign-in first.`,
            correlationId,
          }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      // Verify authenticated user exists in Supabase Auth
      const { data: { user: authUser }, error: userError } =
        await supabase.auth.admin.getUserById(authenticatedUserId);

      if (userError || !authUser) {
        console.error(`[accept-invitation v${DEPLOY_VERSION}] Failed to verify user:`, userError);
        return new Response(
          JSON.stringify({ error: 'Failed to verify authenticated user', correlationId }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      // Verify email matches invitation (case-insensitive)
      if (authUser.email?.toLowerCase() !== invitation.email.toLowerCase()) {
        console.warn(`[accept-invitation v${DEPLOY_VERSION}] Email mismatch: ${authUser.email} vs ${invitation.email}`);
        return new Response(
          JSON.stringify({
            error: 'Email mismatch',
            message: `Your ${provider} account (${authUser.email}) doesn't match the invitation email (${invitation.email}). Please sign in with the correct account.`,
            correlationId,
          }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      userId = authUser.id;
      console.log(`[accept-invitation v${DEPLOY_VERSION}] ${provider} user verified: ${userId}`);

      // Check if user is new or existing (has roles in ANY organization - "Sally scenario")
      // Sally: user with role in Org A accepts invite to Org B → skip user.created
      //
      // Soft-deleted users are treated as NEW for this check — a deleted user
      // being re-invited should receive the full user.created flow, since the
      // prior public.users row is tombstoned and logically orphaned role rows
      // should not short-circuit the onboarding path.
      const { data: userRow } = await supabase
        .from('users')
        .select('deleted_at')
        .eq('id', userId)
        .maybeSingle();

      const isDeleted = !!userRow?.deleted_at;

      let existingRoles: Array<{ id: string }> | null = null;
      let rolesCheckError: unknown = null;

      if (!isDeleted) {
        const result = await supabase
          .from('user_roles_projection')
          .select('id')
          .eq('user_id', userId)
          .limit(1);
        existingRoles = result.data;
        rolesCheckError = result.error;
      }

      if (rolesCheckError) {
        console.warn(`[accept-invitation v${DEPLOY_VERSION}] Failed to check existing roles:`, rolesCheckError);
        // Continue - we'll emit user.created to be safe (idempotent via projections)
      }

      const isExistingUser = !isDeleted && !!existingRoles && existingRoles.length > 0;

      // Only emit user.created for NEW users (Sally scenario: skip for existing)
      if (!isExistingUser) {
        const { data: _oauthEventId, error: oauthEventError } = await supabase
          .rpc('emit_domain_event', {
            p_stream_id: userId,
            p_stream_type: 'user',
            p_event_type: 'user.created',
            p_event_data: {
              user_id: userId,
              email: invitation.email,
              first_name: invitation.first_name,
              last_name: invitation.last_name,
              organization_id: invitation.organization_id,
              invited_via: 'organization_bootstrap',
              auth_method: authMethod.type,
              auth_provider: provider,
              platform: requestData.platform || 'web',
              // Include contact_id for contact-user linking (if user is also a contact)
              ...(invitation.contact_id ? { contact_id: invitation.contact_id } : {}),
            },
            p_event_metadata: buildEventMetadata(tracingContext, 'user.created', req, {
              user_id: userId,
              organization_id: invitation.organization_id,
              automated: true,
            })
          });

        if (oauthEventError) {
          console.error(`[accept-invitation v${DEPLOY_VERSION}] Failed to emit user.created for OAuth user:`, oauthEventError);
          return handleRpcError(oauthEventError, correlationId, corsHeaders, 'Emit user.created event (OAuth)');
        }
        console.log(`[accept-invitation v${DEPLOY_VERSION}] user.created event emitted for new ${provider} user, contact_id=${invitation.contact_id || 'none'}`);

        // Emit contact.user.linked if user is also a contact
        if (invitation.contact_id) {
          const { error: linkEventError } = await supabase
            .rpc('emit_domain_event', {
              p_stream_id: invitation.contact_id,
              p_stream_type: 'contact',
              p_event_type: 'contact.user.linked',
              p_event_data: {
                contact_id: invitation.contact_id,
                user_id: userId,
                organization_id: invitation.organization_id,
                linked_reason: 'User accepted invitation for contact email',
              },
              p_event_metadata: buildEventMetadata(tracingContext, 'contact.user.linked', req, {
                user_id: userId,
                organization_id: invitation.organization_id,
                invitation_id: invitation.id,
                automated: true,
              })
            });

          if (linkEventError) {
            console.error(`[accept-invitation v${DEPLOY_VERSION}] Failed to emit contact.user.linked:`, linkEventError);
            // Non-fatal: user is created but contact link failed
          } else {
            console.log(`[accept-invitation v${DEPLOY_VERSION}] contact.user.linked event emitted: contact=${invitation.contact_id}, user=${userId}`);
          }
        }
      } else {
        console.log(`[accept-invitation v${DEPLOY_VERSION}] Existing user (Sally scenario) - skipping user.created event`);
      }
    }

    // At this point, userId should be set (either from creation or lookup)
    if (!userId) {
      console.error('Failed to create or find user: userId is not set');
      return new Response(
        JSON.stringify({ error: 'Failed to create user account', details: 'User ID not assigned' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // NOTE: Legacy RPC removed (2025-12-22)
    // The invitation.accepted event now handles all projection updates
    // via process_invitation_event() trigger. This removes dual-write pattern.

    // Query organization data for tenant redirect via RPC
    const { data: orgResults, error: orgError } = await supabase
      .rpc('get_organization_by_id', { p_org_id: invitation.organization_id });

    if (orgError) {
      console.warn('Failed to query organization for redirect:', orgError);
    }

    const orgData = orgResults?.[0];

    // Enhanced logging for redirect decision debugging
    console.log(`[accept-invitation v${DEPLOY_VERSION}] Org query result:`, JSON.stringify({
      orgId: invitation.organization_id,
      slug: orgData?.slug,
      subdomain_status: orgData?.subdomain_status,
      hasOrgData: !!orgData,
    }));

    // Emit user.created event for email/password users only
    // OAuth users already have this event emitted in the OAuth block above (lines 335-393)
    if (isEmailPassword) {
      const { data: _eventId, error: eventError } = await supabase
        .rpc('emit_domain_event', {
          p_stream_id: userId,
          p_stream_type: 'user',
          p_event_type: 'user.created',
          p_event_data: {
            user_id: userId,
            email: invitation.email,
            first_name: invitation.first_name,
            last_name: invitation.last_name,
            organization_id: invitation.organization_id,
            invited_via: 'organization_bootstrap',
            auth_method: 'email_password',
            // Include contact_id for contact-user linking (if user is also a contact)
            ...(invitation.contact_id ? { contact_id: invitation.contact_id } : {}),
          },
          p_event_metadata: buildEventMetadata(tracingContext, 'user.created', req, {
            user_id: userId,
            organization_id: invitation.organization_id,
            invitation_token: requestData.token,
            automated: true,
          })
        });

      if (eventError) {
        console.error('Failed to emit user.created event:', eventError);
        // CRITICAL: Event emission failure or processing failure
        // User account exists but has no role - return error to prevent silent failure
        return handleRpcError(eventError, correlationId, corsHeaders, 'Emit user.created event');
      }
      console.log(`[accept-invitation v${DEPLOY_VERSION}] user.created event emitted: event_id=${_eventId}, user_id=${userId}, org_id=${invitation.organization_id}, contact_id=${invitation.contact_id || 'none'}`);

      // Emit contact.user.linked if user is also a contact
      if (invitation.contact_id) {
        const { error: linkEventError } = await supabase
          .rpc('emit_domain_event', {
            p_stream_id: invitation.contact_id,
            p_stream_type: 'contact',
            p_event_type: 'contact.user.linked',
            p_event_data: {
              contact_id: invitation.contact_id,
              user_id: userId,
              organization_id: invitation.organization_id,
              linked_reason: 'User accepted invitation for contact email',
            },
            p_event_metadata: buildEventMetadata(tracingContext, 'contact.user.linked', req, {
              user_id: userId,
              organization_id: invitation.organization_id,
              invitation_id: invitation.id,
              automated: true,
            })
          });

        if (linkEventError) {
          console.error(`[accept-invitation v${DEPLOY_VERSION}] Failed to emit contact.user.linked:`, linkEventError);
          // Non-fatal: user is created but contact link failed
        } else {
          console.log(`[accept-invitation v${DEPLOY_VERSION}] contact.user.linked event emitted: contact=${invitation.contact_id}, user=${userId}`);
        }
      }
    }

    // ==========================================================================
    // EMIT user.role.assigned EVENTS FOR ROLES FROM INVITATION
    // This populates user_roles_projection via process_user_event() trigger
    // ==========================================================================

    // Get roles from new format (roles array) or legacy format (single role string)
    interface RoleRef {
      role_id: string | null;
      role_name: string;
    }
    const roles: RoleRef[] = invitation.roles?.length > 0
      ? invitation.roles
      : invitation.role
        ? [{ role_id: null, role_name: invitation.role }]
        : [];

    console.log(`[accept-invitation v${DEPLOY_VERSION}] Processing ${roles.length} role(s) from invitation`);

    for (const role of roles) {
      const roleName = role.role_name;
      let roleId = role.role_id;

      // CRITICAL: role_id is NOT NULL in user_roles_projection
      // Must resolve role_id if not provided
      if (!roleId) {
        console.log(`[accept-invitation v${DEPLOY_VERSION}] Looking up role_id for role_name: ${roleName}, org: ${invitation.organization_id}`);

        // Use RPC function in api schema (follows CQRS pattern)
        const { data: roleResults, error: lookupError } = await supabase
          .rpc('get_role_by_name', {
            p_org_id: invitation.organization_id,
            p_role_name: roleName
          });

        const roleData = roleResults?.[0];
        if (lookupError || !roleData?.id) {
          // FAIL the acceptance - role assignment is critical for first user
          console.error(`[accept-invitation v${DEPLOY_VERSION}] CRITICAL: Cannot resolve role_id for "${roleName}":`, lookupError);
          return new Response(
            JSON.stringify({
              error: 'role_lookup_failed',
              message: `Cannot find role "${roleName}" in organization. Contact administrator.`,
              details: lookupError?.message,
            }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        roleId = roleData.id;
        console.log(`[accept-invitation v${DEPLOY_VERSION}] Resolved role "${roleName}" to id: ${roleId}`);
      }

      // Emit user.role.assigned event
      const { data: roleEventId, error: roleError } = await supabase
        .rpc('emit_domain_event', {
          p_stream_id: userId,
          p_stream_type: 'user',
          p_event_type: 'user.role.assigned',
          p_event_data: {
            user_id: userId,
            role_id: roleId,  // Now guaranteed non-null
            role_name: roleName,
            org_id: invitation.organization_id,
            scope_path: null,  // Organization-level scope
          },
          p_event_metadata: buildEventMetadata(tracingContext, 'user.role.assigned', req, {
            user_id: userId,
            organization_id: invitation.organization_id,
            invitation_id: invitation.id,
            reason: 'Role assigned via invitation acceptance',
          })
        });

      if (roleError) {
        console.error(`[accept-invitation v${DEPLOY_VERSION}] Failed to emit user.role.assigned for ${roleName}:`, roleError);
        // Continue with other roles - partial success is better than total failure
      } else {
        console.log(`[accept-invitation v${DEPLOY_VERSION}] ✓ Role assigned: ${roleName} (${roleId}) to user ${userId}, event_id=${roleEventId}`);
      }
    }

    // ==========================================================================
    // PHASE 6: EMIT user.phone.added EVENTS FOR PHONES FROM INVITATION
    // This populates user_phones via process_user_event() trigger
    //
    // INVARIANT: createdPhoneIds is built in iteration order from phones[]
    // and MUST NOT be reordered (e.g., do not sort by is_primary first).
    // resolveInvitationPhonePlaceholder depends on stable insertion-order
    // index correspondence with the frontend's phones[] array to map
    // `invitation-phone-N` placeholders to real UUIDs.
    // ==========================================================================
    const phones: InvitationPhone[] = invitation.phones || [];
    console.log(`[accept-invitation v${DEPLOY_VERSION}] Processing ${phones.length} phone(s) from invitation`);

    // Track created phone IDs for SMS phone selection + placeholder resolution
    const createdPhoneIds: CreatedInvitationPhone[] = [];

    for (const phone of phones) {
      const phoneId = crypto.randomUUID();

      const { data: phoneEventId, error: phoneError } = await supabase
        .rpc('emit_domain_event', {
          p_stream_id: userId,
          p_stream_type: 'user',
          p_event_type: 'user.phone.added',
          p_event_data: {
            phone_id: phoneId,
            user_id: userId,
            org_id: null, // Global phone, not org-specific override
            label: phone.label,
            type: phone.type,
            number: phone.number,
            country_code: phone.countryCode || '+1',
            is_primary: phone.isPrimary || false,
            is_active: true,
            sms_capable: phone.smsCapable || false,
          },
          p_event_metadata: buildEventMetadata(tracingContext, 'user.phone.added', req, {
            user_id: userId,
            organization_id: invitation.organization_id,
            invitation_id: invitation.id,
            reason: 'Phone added via invitation acceptance',
          })
        });

      if (phoneError) {
        console.error(`[accept-invitation v${DEPLOY_VERSION}] Failed to emit user.phone.added for ${phone.label}:`, phoneError);
        // Non-fatal: continue with other phones, but push a sentinel
        // `{ phoneId: null, phone }` to preserve index correspondence with
        // the frontend's phones[] array. resolveInvitationPhonePlaceholder
        // observes the null phoneId and degrades gracefully (warn + auto-
        // select fallback) rather than silently shifting subsequent
        // indexes — closes the silent-mis-routed-SMS bug class for
        // partial-failure flows.
        createdPhoneIds.push({ phoneId: null, phone });
      } else {
        console.log(`[accept-invitation v${DEPLOY_VERSION}] ✓ Phone added: ${phone.label} (${phoneId}) to user ${userId}, event_id=${phoneEventId}`);
        createdPhoneIds.push({ phoneId, phone });
      }
    }

    // ==========================================================================
    // PHASE 6: EMIT user.notification_preferences.updated EVENT
    // This populates user_notification_preferences_projection via trigger
    // ==========================================================================
    interface NotificationPreferences {
      email?: boolean;
      sms?: {
        enabled?: boolean;
        phoneId?: string | null;
      };
      inApp?: boolean;
    }

    const prefs: NotificationPreferences = invitation.notification_preferences || {
      email: true,
      sms: { enabled: false, phoneId: null },
      inApp: false,
    };

    // Resolve any `invitation-phone-N` placeholder phoneId to the real UUID
    // created above. The frontend generates these placeholders at form-fill time
    // because it doesn't yet know the real UUIDs; the backend must substitute
    // them here, before emitting `user.notification_preferences.updated` (the
    // handler casts phoneId to UUID and would otherwise fail). Out-of-range
    // placeholders, foreign UUIDs, and malformed strings normalize to null,
    // which triggers the existing auto-select fallback below.
    if (prefs.sms) {
      prefs.sms.phoneId = resolveInvitationPhonePlaceholder(prefs.sms.phoneId, createdPhoneIds, {
        correlationId,
        userId,
        invitationId: invitation.id,
      });
    }

    // If SMS is enabled but no phoneId specified (or placeholder normalized to null),
    // use first SMS-capable phone
    if (prefs.sms?.enabled && !prefs.sms?.phoneId) {
      const smsCapablePhone = createdPhoneIds.find(p => p.phoneId !== null && p.phone.smsCapable);
      if (smsCapablePhone) {
        prefs.sms.phoneId = smsCapablePhone.phoneId;
        console.log(`[accept-invitation v${DEPLOY_VERSION}] Auto-selected SMS phone: ${smsCapablePhone.phone.label} (${smsCapablePhone.phoneId})`);
      }
    }

    console.log(`[accept-invitation v${DEPLOY_VERSION}] Setting notification preferences:`, JSON.stringify(prefs));

    const { data: prefsEventId, error: prefsError } = await supabase
      .rpc('emit_domain_event', {
        p_stream_id: userId,
        p_stream_type: 'user',
        p_event_type: 'user.notification_preferences.updated',
        p_event_data: {
          user_id: userId,
          org_id: invitation.organization_id,
          notification_preferences: {
            email: prefs.email ?? true,
            sms: {
              enabled: prefs.sms?.enabled ?? false,
              phoneId: prefs.sms?.phoneId ?? null,
            },
            inApp: prefs.inApp ?? false,
          },
        },
        p_event_metadata: buildEventMetadata(tracingContext, 'user.notification_preferences.updated', req, {
          user_id: userId,
          organization_id: invitation.organization_id,
          invitation_id: invitation.id,
          reason: 'Notification preferences set via invitation acceptance',
        })
      });

    if (prefsError) {
      console.error(`[accept-invitation v${DEPLOY_VERSION}] Failed to emit user.notification_preferences.updated:`, prefsError);
      // Non-fatal: user is created but preferences not set (will use defaults)
    } else {
      console.log(`[accept-invitation v${DEPLOY_VERSION}] ✓ Notification preferences set for user ${userId}, event_id=${prefsEventId}`);
    }

    // Emit invitation.accepted event per AsyncAPI contract
    const { data: _acceptedEventId, error: acceptedEventError } = await supabase
      .rpc('emit_domain_event', {
        p_stream_id: invitation.id,
        p_stream_type: 'invitation',
        p_event_type: 'invitation.accepted',
        p_event_data: {
          invitation_id: invitation.id,
          org_id: invitation.organization_id,
          user_id: userId,
          email: invitation.email,
          role: invitation.role,
          accepted_at: new Date().toISOString(),
        },
        p_event_metadata: buildEventMetadata(tracingContext, 'invitation.accepted', req, {
          user_id: userId,
          organization_id: invitation.organization_id,
          automated: true,
        })
      });

    if (acceptedEventError) {
      console.error('Failed to emit invitation.accepted event:', acceptedEventError);
      // CRITICAL: This event triggers role assignment via database trigger
      // Without it, user has no role and will default to 'viewer' in JWT hook
      return handleRpcError(acceptedEventError, correlationId, corsHeaders, 'Emit invitation.accepted event');
    }
    console.log(`Invitation accepted event emitted: event_id=${_acceptedEventId}, invitation_id=${invitation.id}`);

    // Build redirect URL based on organization subdomain status
    // If subdomain is verified, redirect to tenant subdomain (cross-origin)
    // Otherwise, fall back to organization ID path (same-origin)
    console.log(`[accept-invitation v${DEPLOY_VERSION}] Redirect decision:`, JSON.stringify({
      condition: {
        hasSlug: !!orgData?.slug,
        slugValue: orgData?.slug,
        subdomainStatus: orgData?.subdomain_status,
        isVerified: orgData?.subdomain_status === 'verified',
        baseDomain: env.PLATFORM_BASE_DOMAIN,
      },
      willUseSubdomain: !!(orgData?.slug && orgData?.subdomain_status === 'verified'),
    }));

    let redirectUrl: string;
    if (orgData?.slug && orgData?.subdomain_status === 'verified') {
      // Tenant subdomain redirect (cross-origin)
      const baseDomain = env.PLATFORM_BASE_DOMAIN;
      redirectUrl = `https://${orgData.slug}.${baseDomain}/dashboard`;
      console.log(`[accept-invitation] Redirecting to tenant subdomain: ${redirectUrl}`);
    } else {
      // Fallback to org ID path (same-origin relative URL)
      redirectUrl = `/organizations/${invitation.organization_id}/dashboard`;
      console.log(`[accept-invitation] Redirecting to org ID path: ${redirectUrl} (subdomain_status: ${orgData?.subdomain_status || 'unknown'})`);
    }

    // Build response
    const response: AcceptInvitationResponse = {
      success: true,
      userId,
      orgId: invitation.organization_id,
      redirectUrl,
    };

    // End span with success status
    const completedSpan = endSpan(span, 'ok');
    console.log(`[accept-invitation v${DEPLOY_VERSION}] Completed in ${completedSpan.durationMs}ms, correlation_id=${correlationId}`);

    return new Response(
      JSON.stringify(response),
      {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );

  } catch (error) {
    // End span with error status
    const completedSpan = endSpan(span, 'error');
    console.error(`[accept-invitation v${DEPLOY_VERSION}] Unhandled error after ${completedSpan.durationMs}ms:`, error);
    return createInternalError(correlationId, corsHeaders, error.message);
  }
});
