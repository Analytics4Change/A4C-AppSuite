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
const DEPLOY_VERSION = 'v3';

// CORS headers for frontend requests
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface AcceptInvitationRequest {
  token: string;
  method: 'email_password' | 'google_oauth';
  // For email/password method
  password?: string;
  // For OAuth method
  oauthUserId?: string;
  oauthProvider?: string;
}

interface AcceptInvitationResponse {
  success: boolean;
  userId?: string;
  organizationId?: string;
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

    if (requestData.method === 'email_password' && !requestData.password) {
      return new Response(
        JSON.stringify({ error: 'Missing password for email/password method' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

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

    // Create user account based on method
    let userId: string | undefined;
    let authError: Error | null = null;

    if (requestData.method === 'email_password') {
      // Create user with email/password
      const { data: authData, error: createError } = await supabase.auth.admin.createUser({
        email: invitation.email,
        password: requestData.password,
        email_confirm: true, // Auto-confirm email since they're accepting an invitation
        user_metadata: {
          organization_id: invitation.organization_id,
          invited_via: 'organization_bootstrap',
        },
      });

      if (createError) {
        authError = createError;
      } else {
        userId = authData.user.id;
      }
    } else if (requestData.method === 'google_oauth') {
      // Link OAuth user to invitation
      // Note: OAuth user should already exist from OAuth flow
      if (!requestData.oauthUserId) {
        return new Response(
          JSON.stringify({ error: 'Missing OAuth user ID' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      userId = requestData.oauthUserId;

      // Update user metadata
      const { error: updateError } = await supabase.auth.admin.updateUserById(userId, {
        user_metadata: {
          organization_id: invitation.organization_id,
          invited_via: 'organization_bootstrap',
        },
      });

      if (updateError) {
        authError = updateError;
      }
    }

    if (authError || !userId) {
      console.error('Failed to create user:', authError);
      return new Response(
        JSON.stringify({ error: 'Failed to create user account', details: authError?.message || 'User ID not assigned' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Mark invitation as accepted via RPC
    const { error: updateError } = await supabase
      .rpc('accept_invitation', { p_invitation_id: invitation.id });

    if (updateError) {
      console.error('Failed to mark invitation as accepted:', updateError);
    }

    // Query organization data for tenant redirect via RPC
    const { data: orgResults, error: orgError } = await supabase
      .rpc('get_organization_by_id', { p_org_id: invitation.organization_id });

    if (orgError) {
      console.warn('Failed to query organization for redirect:', orgError);
    }

    const orgData = orgResults?.[0];

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
          auth_method: requestData.method,
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
      // Note: This function continues even if event emission fails
      // Consider returning error response for consistency with organization-bootstrap
    } else {
      console.log(`User created event emitted successfully: event_id=${_eventId}, user_id=${userId}, org_id=${invitation.organization_id}`);
    }

    // Build redirect URL based on organization subdomain status
    // If subdomain is verified, redirect to tenant subdomain (cross-origin)
    // Otherwise, fall back to organization ID path (same-origin)
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
      organizationId: invitation.organization_id,
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
