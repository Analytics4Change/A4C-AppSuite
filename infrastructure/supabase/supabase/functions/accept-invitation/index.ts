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
const DEPLOY_VERSION = 'v12-tracing';

// CORS headers for frontend requests
const corsHeaders = standardCorsHeaders;

/**
 * Supported OAuth providers (matches frontend OAuthProvider type)
 * See: frontend/src/types/auth.types.ts
 */
type OAuthProvider = 'google' | 'github' | 'facebook' | 'apple';

/**
 * User credentials from frontend
 * See: frontend/src/types/organization.types.ts
 */
interface UserCredentials {
  email: string;
  password?: string;      // For email/password auth
  oauth?: OAuthProvider;  // For OAuth auth
}

/**
 * Request format from frontend:
 * - Email/password: { token, credentials: { email, password } }
 * - OAuth: { token, credentials: { email, oauth: 'google' } }
 */
interface AcceptInvitationRequest {
  token: string;
  credentials: UserCredentials;
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
  // Extract tracing context from request headers (W3C traceparent + custom headers)
  const tracingContext = extractTracingContext(req);
  const correlationId = tracingContext.correlationId;
  const span = createSpan(tracingContext, 'accept-invitation');

  console.log(`[accept-invitation v${DEPLOY_VERSION}] Processing ${req.method} request, correlation_id=${correlationId}, trace_id=${tracingContext.traceId}`);

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
    const isOAuth = !!requestData.credentials.oauth;
    const isEmailPassword = !!requestData.credentials.password;

    if (!isOAuth && !isEmailPassword) {
      return createValidationError('Missing password or OAuth provider', correlationId, corsHeaders);
    }

    console.log(`[accept-invitation v${DEPLOY_VERSION}] Auth method: ${isOAuth ? 'oauth' : 'email_password'}`);

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
      // OAuth flow: User needs to complete OAuth first, then we link the invitation
      // For now, OAuth acceptance is not implemented - user must use email/password
      // TODO: Implement OAuth acceptance flow
      console.warn(`[accept-invitation v${DEPLOY_VERSION}] OAuth acceptance not yet implemented`);
      return new Response(
        JSON.stringify({
          error: 'OAuth acceptance not yet implemented. Please use email/password.',
          provider: credentials.oauth
        }),
        { status: 501, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
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

    // Emit user.created event via API wrapper
    // Client already configured with api schema
    const { data: _eventId, error: eventError } = await supabase
      .rpc('emit_domain_event', {
        p_stream_id: userId,
        p_stream_type: 'user',
        p_event_type: 'user.created',
        p_event_data: {
          user_id: userId,
          email: invitation.email,
          organization_id: invitation.organization_id,
          invited_via: 'organization_bootstrap',
          auth_method: isEmailPassword ? 'email_password' : 'oauth',
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
    console.log(`User created event emitted successfully: event_id=${_eventId}, user_id=${userId}, org_id=${invitation.organization_id}`);

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
