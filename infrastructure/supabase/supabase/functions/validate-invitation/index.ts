/**
 * Validate Invitation Edge Function
 *
 * This Edge Function validates an invitation token and returns invitation details.
 * Called by the frontend InvitationAcceptanceViewModel before accepting an invitation.
 *
 * Returns organization details and invitation status.
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// CORS headers for frontend requests
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface InvitationValidation {
  valid: boolean;
  token: string;
  email: string;
  organizationName: string;
  organizationId: string;
  expiresAt: string;
  expired: boolean;
  alreadyAccepted: boolean;
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

    // Get invitation token from URL params
    const url = new URL(req.url);
    const token = url.searchParams.get('token');

    if (!token) {
      return new Response(
        JSON.stringify({ error: 'Missing token parameter' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Query invitation from database
    // Table: invitations_projection (CQRS read model)
    // Schema: id, token, email, organization_id, expires_at, accepted_at, created_at
    const { data: invitation, error: invitationError } = await supabase
      .from('invitations_projection')
      .select('*, organizations_projection!inner(name)')
      .eq('token', token)
      .single();

    if (invitationError || !invitation) {
      return new Response(
        JSON.stringify({
          valid: false,
          error: 'Invalid invitation token',
        }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Check if invitation has expired
    const expiresAt = new Date(invitation.expires_at);
    const now = new Date();
    const expired = expiresAt < now;

    // Check if invitation has already been accepted
    const alreadyAccepted = invitation.accepted_at !== null;

    // Build validation response
    const response: InvitationValidation = {
      valid: !expired && !alreadyAccepted,
      token,
      email: invitation.email,
      organizationName: invitation.organizations_projection.name,
      organizationId: invitation.organization_id,
      expiresAt: invitation.expires_at,
      expired,
      alreadyAccepted,
    };

    return new Response(
      JSON.stringify(response),
      {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );

  } catch (error) {
    console.error('Validate invitation edge function error:', error);
    return new Response(
      JSON.stringify({ error: 'Internal server error', details: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
