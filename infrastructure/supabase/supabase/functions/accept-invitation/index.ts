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

// Deployment version tracking
const DEPLOY_VERSION = 'v7';

// CORS headers for frontend requests
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

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
  console.log(`[accept-invitation v${DEPLOY_VERSION}] Processing ${req.method} request`);

  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
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
      return new Response(
        JSON.stringify({ error: 'Missing token' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (!requestData.credentials) {
      return new Response(
        JSON.stringify({ error: 'Missing credentials' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Determine auth method from credentials
    const isOAuth = !!requestData.credentials.oauth;
    const isEmailPassword = !!requestData.credentials.password;

    if (!isOAuth && !isEmailPassword) {
      return new Response(
        JSON.stringify({ error: 'Missing password or OAuth provider' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`[accept-invitation v${DEPLOY_VERSION}] Auth method: ${isOAuth ? 'oauth' : 'email_password'}`);

    // Query invitation via RPC function in api schema (bypasses public schema restriction)
    console.log(`[accept-invitation v${DEPLOY_VERSION}] Querying invitation via RPC...`);
    const { data: invitations, error: invitationError } = await supabase
      .rpc('get_invitation_by_token', { p_token: requestData.token });

    if (invitationError) {
      console.error(`[accept-invitation v${DEPLOY_VERSION}] RPC error:`, invitationError);
      return new Response(
        JSON.stringify({ error: 'Database error', details: invitationError.message }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // RPC returns array, get first result
    const invitation = invitations?.[0];

    if (!invitation) {
      return new Response(
        JSON.stringify({ error: 'Invalid invitation token' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
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
    let authError: Error | null = null;
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
        authError = createError;
        console.error(`[accept-invitation v${DEPLOY_VERSION}] User creation failed:`, createError);
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

    if (authError || !userId) {
      console.error('Failed to create user:', authError);
      return new Response(
        JSON.stringify({ error: 'Failed to create user account', details: authError?.message || 'User ID not assigned' }),
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
        p_stream_version: 1,
        p_event_type: 'user.created',
        p_event_data: {
          user_id: userId,
          email: invitation.email,
          organization_id: invitation.organization_id,
          invited_via: 'organization_bootstrap',
          auth_method: isEmailPassword ? 'email_password' : 'oauth',
        },
        p_event_metadata: {
          user_id: userId,
          organization_id: invitation.organization_id,
          invitation_token: requestData.token,
          automated: true,
        }
      });

    if (eventError) {
      console.error('Failed to emit user.created event:', eventError);
      // CRITICAL: Event emission failure means role assignment won't happen
      // User account exists but has no role - return error to prevent silent failure
      return new Response(
        JSON.stringify({
          error: 'Failed to emit user.created event',
          details: eventError.message,
          userId, // Include for debugging - user was created but event failed
        }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    console.log(`User created event emitted successfully: event_id=${_eventId}, user_id=${userId}, org_id=${invitation.organization_id}`);

    // Emit invitation.accepted event per AsyncAPI contract
    const { data: _acceptedEventId, error: acceptedEventError } = await supabase
      .rpc('emit_domain_event', {
        p_stream_id: invitation.id,
        p_stream_type: 'invitation',
        p_stream_version: 1,
        p_event_type: 'invitation.accepted',
        p_event_data: {
          invitation_id: invitation.id,
          org_id: invitation.organization_id,
          user_id: userId,
          email: invitation.email,
          role: invitation.role,
          accepted_at: new Date().toISOString(),
        },
        p_event_metadata: {
          user_id: userId,
          organization_id: invitation.organization_id,
          automated: true,
        }
      });

    if (acceptedEventError) {
      console.error('Failed to emit invitation.accepted event:', acceptedEventError);
      // CRITICAL: This event triggers role assignment via database trigger
      // Without it, user has no role and will default to 'viewer' in JWT hook
      return new Response(
        JSON.stringify({
          error: 'Failed to emit invitation.accepted event',
          details: acceptedEventError.message,
          userId, // User was created
          invitationId: invitation.id,
        }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
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

    return new Response(
      JSON.stringify(response),
      {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );

  } catch (error) {
    console.error('Accept invitation edge function error:', error);
    return new Response(
      JSON.stringify({
        error: 'Internal server error',
        details: error.message,
        version: DEPLOY_VERSION
      }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
