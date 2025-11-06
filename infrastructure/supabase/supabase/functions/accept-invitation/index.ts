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
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    // Initialize Supabase client with service role
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

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

    // Query invitation from invitations_projection (CQRS read model)
    const { data: invitation, error: invitationError } = await supabase
      .from('invitations_projection')
      .select('*')
      .eq('token', requestData.token)
      .single();

    if (invitationError || !invitation) {
      return new Response(
        JSON.stringify({ error: 'Invalid invitation token' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
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

    // Create user account based on method
    let userId: string;
    let authError: any;

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

    if (authError) {
      console.error('Failed to create user:', authError);
      return new Response(
        JSON.stringify({ error: 'Failed to create user account', details: authError.message }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Mark invitation as accepted in invitations_projection
    const { error: updateError } = await supabase
      .from('invitations_projection')
      .update({ accepted_at: new Date().toISOString() })
      .eq('id', invitation.id);

    if (updateError) {
      console.error('Failed to mark invitation as accepted:', updateError);
    }

    // Emit user.created event
    const { error: eventError } = await supabase
      .from('domain_events')
      .insert({
        stream_id: userId,
        stream_type: 'user',
        stream_version: 1,
        event_type: 'user.created',
        event_data: {
          user_id: userId,
          email: invitation.email,
          organization_id: invitation.organization_id,
          invited_via: 'organization_bootstrap',
          auth_method: requestData.method,
        },
        event_metadata: {
          user_id: userId,
          organization_id: invitation.organization_id,
          invitation_token: requestData.token,
          automated: true,
        },
        created_at: new Date().toISOString(),
      });

    if (eventError) {
      console.error('Failed to emit user.created event:', eventError);
    }

    // Build response
    const response: AcceptInvitationResponse = {
      success: true,
      userId,
      organizationId: invitation.organization_id,
      redirectUrl: `/organizations/${invitation.organization_id}/dashboard`,
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
      JSON.stringify({ error: 'Internal server error', details: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
