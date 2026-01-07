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
import { validateEdgeFunctionEnv, createEnvErrorResponse } from '../_shared/env-schema.ts';
import {
  handleRpcError,
  createValidationError,
  createNotFoundError,
  createInternalError,
  createCorsPreflightResponse,
  standardCorsHeaders,
} from '../_shared/error-response.ts';
import { extractTracingContext } from '../_shared/tracing-context.ts';

// Deployment version tracking
const DEPLOY_VERSION = 'v10-tracing';

// CORS headers for frontend requests
const corsHeaders = standardCorsHeaders;

interface InvitationValidation {
  valid: boolean;
  token: string;
  email: string;
  orgName: string;  // Frontend expects orgName, not organizationName
  organizationId: string;
  role: string;  // Frontend expects role
  expiresAt: string;
  expired: boolean;
  alreadyAccepted: boolean;
}

serve(async (req) => {
  // Extract tracing context from request headers (W3C traceparent + custom headers)
  const tracingContext = extractTracingContext(req);
  const correlationId = tracingContext.correlationId;

  console.log(`[validate-invitation v${DEPLOY_VERSION}] Processing ${req.method} request, correlation_id=${correlationId}, trace_id=${tracingContext.traceId}`);

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
    env = validateEdgeFunctionEnv('validate-invitation');
  } catch (error) {
    return createEnvErrorResponse('validate-invitation', DEPLOY_VERSION, error.message, corsHeaders);
  }

  // This function requires service role key (not auto-set by Supabase)
  if (!env.SUPABASE_SERVICE_ROLE_KEY) {
    return createEnvErrorResponse('validate-invitation', DEPLOY_VERSION, 'SUPABASE_SERVICE_ROLE_KEY is required', corsHeaders);
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

    // Get invitation token from request body (POST) or URL params (GET)
    let token: string | null = null;

    if (req.method === 'POST') {
      // Frontend sends token in POST body via supabase.functions.invoke()
      const body = await req.json();
      token = body.token;
      console.log(`[validate-invitation v${DEPLOY_VERSION}] Token from POST: ${token ? 'present' : 'missing'}`);
    } else {
      // Fallback to URL params for GET requests
      const url = new URL(req.url);
      token = url.searchParams.get('token');
      console.log(`[validate-invitation v${DEPLOY_VERSION}] Token from URL: ${token ? 'present' : 'missing'}`);
    }

    if (!token) {
      return createValidationError('Missing token parameter', correlationId, corsHeaders, 'token');
    }

    // Query invitation via RPC function in api schema (bypasses public schema restriction)
    console.log(`[validate-invitation v${DEPLOY_VERSION}] Querying invitation via RPC...`);
    const { data: invitations, error: invitationError } = await supabase
      .rpc('get_invitation_by_token', { p_token: token });

    if (invitationError) {
      console.error(`[validate-invitation v${DEPLOY_VERSION}] RPC error:`, invitationError);
      return handleRpcError(invitationError, correlationId, corsHeaders, 'Query invitation');
    }

    // RPC returns array, get first result
    const invitation = invitations?.[0];

    if (!invitation) {
      console.log(`[validate-invitation v${DEPLOY_VERSION}] No invitation found for token`);
      return createNotFoundError('Invitation', correlationId, corsHeaders);
    }

    console.log(`[validate-invitation v${DEPLOY_VERSION}] Found invitation: ${invitation.id}`);

    // Organization name comes from RPC join
    const orgName = invitation.organization_name || 'Unknown Organization';

    // Check if invitation has expired
    const expiresAt = new Date(invitation.expires_at);
    const now = new Date();
    const expired = expiresAt < now;

    // Check if invitation has already been accepted
    const alreadyAccepted = invitation.accepted_at !== null;

    // Build validation response
    // Frontend expects: orgName, role (not organizationName)
    const response: InvitationValidation = {
      valid: !expired && !alreadyAccepted,
      token,
      email: invitation.email,
      orgName,
      organizationId: invitation.organization_id,
      role: invitation.role,
      expiresAt: invitation.expires_at,
      expired,
      alreadyAccepted,
    };

    console.log(`[validate-invitation v${DEPLOY_VERSION}] Success - valid: ${response.valid}`);

    return new Response(
      JSON.stringify(response),
      {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );

  } catch (error) {
    console.error(`[validate-invitation v${DEPLOY_VERSION}] Unhandled error:`, error);
    return createInternalError(correlationId, corsHeaders, error.message);
  }
});
