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
import { resolveServiceRoleKey } from '../_shared/api-key-resolution.ts';
import {
  handleRpcError,
  createValidationError,
  createInternalError,
  createCorsPreflightResponse,
  standardCorsHeaders,
} from '../_shared/error-response.ts';
import { extractTracingContext } from '../_shared/tracing-context.ts';

// Deployment version tracking
const DEPLOY_VERSION = 'v12-token-state-reason';

// CORS headers for frontend requests
const corsHeaders = standardCorsHeaders;

interface InvitationRoleRef {
  role_id: string | null;
  role_name: string | null;
}

/**
 * Why a token is not usable. Mirrors `api.get_invitation_token_state`.
 *
 * `unknown` is a catch-all, not a deny-list: a token matching no row, and any
 * status outside the enumerated set, both land here. A status added later
 * degrades to `unknown` rather than leaking or erroring.
 */
export type InvitationUnusableReason = 'expired' | 'accepted' | 'revoked' | 'unknown';

/**
 * Discriminated on `valid`.
 *
 * The unusable variant carries **nothing but the reason** — no email, org name,
 * organization id, roles or expiry. That is structural, not conventional: it is
 * why the reason can be served to a pre-auth caller at all. An unusable
 * invitation therefore discloses strictly LESS than a usable one.
 *
 * Both variants are HTTP 200. The previous 404 for "no row" is gone — the
 * request succeeded, and "this token is not usable" is the answer, not an error.
 * Collapsing to one status code with a discriminant is also the structural fix
 * for the frontend defect where two code paths existed (HTTP error vs
 * 200+valid:false) and only one was handled.
 */
type InvitationValidation =
  | {
      valid: true;
      reason: 'valid';
      token: string;
      email: string;
      orgName: string;  // Frontend expects orgName, not organizationName
      organizationId: string;
      // `roles` mirrors the JSONB array on invitations_projection.roles.
      // Empty array is a legitimate state ("permissions assigned later").
      roles: InvitationRoleRef[];
      expiresAt: string;
      expired: false;
      alreadyAccepted: false;
      correlationId?: string;  // Business-scoped correlation ID for lifecycle tracing
    }
  | {
      valid: false;
      reason: InvitationUnusableReason;
      correlationId?: string;
    };

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

  // This function requires service role / secret key (APP_SECRET_KEY preferred;
  // see _shared/api-key-resolution.ts for the auto-inject workaround rationale)
  if (!env.APP_SECRET_KEY && !env.SUPABASE_SERVICE_ROLE_KEY) {
    return createEnvErrorResponse('validate-invitation', DEPLOY_VERSION, 'APP_SECRET_KEY or SUPABASE_SERVICE_ROLE_KEY is required', corsHeaders);
  }

  try {
    // Initialize Supabase client with service role
    // Use 'api' schema since that's what's exposed through PostgREST
    const supabase = createClient(env.SUPABASE_URL, resolveServiceRoleKey(env)!, {
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

    // RPC returns array, get first result.
    //
    // As of 20260731195015, `api.get_invitation_by_token` resolves ONLY
    // status='pending' invitations. So a revoked/accepted/expired-status
    // invitation arrives here as "no row" — which is exactly why the reason
    // must come from the separate classifier rather than from this row.
    const invitation = invitations?.[0];

    // Clock expiry is checked SEPARATELY from the RPC filter and both are
    // load-bearing. Expiration is lazy — nothing sweeps the projection, so
    // status='pending' with a past expires_at is a real, common state that the
    // RPC passes straight through. Dropping this because "the RPC filters now"
    // would let a clock-expired invitation render the signup form.
    const usable =
      !!invitation &&
      new Date(invitation.expires_at) >= new Date() &&
      invitation.accepted_at === null;

    if (!usable) {
      // Ask the narrow classifier WHY. It returns only an enum — no email, org,
      // roles, id or timestamps — so this branch discloses strictly less than
      // the usable branch below.
      const { data: state, error: stateError } = await supabase
        .rpc('get_invitation_token_state', { p_token: token });

      if (stateError) {
        console.error(`[validate-invitation v${DEPLOY_VERSION}] State RPC error:`, stateError);
        return handleRpcError(stateError, correlationId, corsHeaders, 'Classify invitation token');
      }

      const reason = (state as InvitationUnusableReason | null) ?? 'unknown';
      console.log(`[validate-invitation v${DEPLOY_VERSION}] Token not usable: reason=${reason}`);

      // 200, not 404: the request succeeded. "Not usable" is the answer.
      const unusable: InvitationValidation = { valid: false, reason, correlationId };
      return new Response(JSON.stringify(unusable), {
        status: 200,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json',
          // Surfaced to the browser via Access-Control-Expose-Headers so the
          // client can show a support reference. The header was already
          // *exposed* in CORS but never actually *set* on any response, so
          // extractEdgeFunctionError always read null.
          'x-correlation-id': correlationId,
        },
      });
    }

    console.log(`[validate-invitation v${DEPLOY_VERSION}] Found invitation: ${invitation.id}`);

    // Organization name comes from RPC join
    const orgName = invitation.organization_name || 'Unknown Organization';

    // Build validation response
    // Frontend expects: orgName, roles[] (the JSONB array from invitations_projection.roles).
    // The deprecated singular `role` column was dropped 2026-05-08
    // (migration 20260508170054_drop_invitations_deprecated_role_column).
    const response: InvitationValidation = {
      valid: true,
      reason: 'valid',
      token,
      email: invitation.email,
      orgName,
      organizationId: invitation.organization_id,
      roles: Array.isArray(invitation.roles) ? invitation.roles : [],
      expiresAt: invitation.expires_at,
      expired: false,
      alreadyAccepted: false,
      // Include correlation_id for business-scoped lifecycle tracing
      // Frontend should pass this to accept-invitation for event correlation
      correlationId: invitation.correlation_id,
    };

    console.log(`[validate-invitation v${DEPLOY_VERSION}] Success - valid: true`);

    return new Response(
      JSON.stringify(response),
      {
        status: 200,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json',
          'x-correlation-id': correlationId,
        },
      }
    );

  } catch (error) {
    console.error(`[validate-invitation v${DEPLOY_VERSION}] Unhandled error:`, error);
    return createInternalError(correlationId, corsHeaders, error.message);
  }
});
