/**
 * Manage User Edge Function
 *
 * Handles user lifecycle operations: deactivate, reactivate. Four operations
 * have been extracted to SQL RPCs per adr-edge-function-vs-sql-rpc.md:
 * - `update_notification_preferences` → `api.update_user_notification_preferences`
 *   (migration 20260424194102_add_update_user_notification_preferences_rpc.sql)
 * - `delete` → `api.delete_user`
 *   (migration 20260427205333_extract_delete_user_rpc.sql)
 * - `modify_roles` → `api.modify_user_roles`
 *   (migration 20260430172139_add_modify_user_roles_rpc.sql)
 * - `deactivate` (emit + Pattern A v2 read-back only) → `api.deactivate_user`
 *   (migration 20260512194836_deactivate_user_rpc_and_check_user_invitation_existence.sql)
 *   The Edge Function stays for the LB1 `auth.admin.updateUserById` ban call
 *   AFTER the RPC succeeds; the wire-tier emit + read-back the function used
 *   to do was pivoted into the SQL RPC because the deployed PostgREST exposes
 *   only the `api` schema, making cross-schema `.from(public.users)` reads
 *   impossible. See plan `~/.claude/plans/ddoes-it-make-sense-lucky-dongarra.md`
 *   for the architecture details.
 *
 * Operations:
 * - deactivate: Deactivate a user within the organization (Pattern A v2 via SQL RPC)
 * - reactivate: Reactivate a deactivated user (legacy emit flow — retrofit deferred to next card)
 *
 * CQRS-compliant: Emits domain events:
 * - user.deactivated / user.reactivated
 *
 * Permissions:
 * - user.update: deactivate/reactivate
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { validateEdgeFunctionEnv, createEnvErrorResponse } from '../_shared/env-schema.ts';
import { resolveAnonKey, resolveServiceRoleKey } from '../_shared/api-key-resolution.ts';
import { AnySchemaSupabaseClient, JWTPayload, hasPermission } from '../_shared/types.ts';
import {
  handleRpcError,
  createInternalError,
  createCorsPreflightResponse,
  standardCorsHeaders,
  createErrorResponse,
} from '../_shared/error-response.ts';
import {
  extractTracingContext,
  createSpan,
  endSpan,
} from '../_shared/tracing-context.ts';
import { buildEventMetadata } from '../_shared/emit-event.ts';

// Deployment version tracking
const DEPLOY_VERSION = 'v17-deactivate-sql-rpc-pivot';

// CORS headers for frontend requests
const corsHeaders = standardCorsHeaders;

/**
 * Supported operations
 */
type Operation = 'deactivate' | 'reactivate';

/**
 * Request format from frontend
 */
interface ManageUserRequest {
  operation: Operation;
  userId: string;
  reason?: string;
}

/**
 * Response format
 */
interface ManageUserResponse {
  success: boolean;
  userId?: string;
  operation?: Operation;
  error?: string;
  /**
   * Captured event_id from the emit (Pattern A v2 — sourced from
   * api.deactivate_user envelope for deactivate, from inline emit for
   * reactivate). Additive on success responses for audit-log deep-linking
   * in the frontend. Optional — consumers are not required to surface it.
   */
  eventId?: string;
}

/**
 * Get user details for validation (reactivate path only — the deactivate
 * path now delegates tenancy/idempotency checks to `api.deactivate_user`).
 */
async function getUserDetails(
  supabase: AnySchemaSupabaseClient,
  userId: string,
  orgId: string
): Promise<{ exists: boolean; isActive: boolean; email?: string }> {
  const { data, error } = await supabase
    .rpc('get_user_org_details', { p_user_id: userId, p_org_id: orgId });

  if (error) {
    console.error(`[manage-user v${DEPLOY_VERSION}] Error getting user details:`, error);
    return { exists: false, isActive: false };
  }

  if (!data?.[0]) {
    return { exists: false, isActive: false };
  }

  return {
    exists: true,
    isActive: data[0].is_active,
    email: data[0].email,
  };
}

serve(async (req) => {
  // Extract tracing context from request headers (W3C traceparent + custom headers)
  const tracingContext = extractTracingContext(req);
  const correlationId = tracingContext.correlationId;
  const span = createSpan(tracingContext, 'manage-user');

  console.log(`[manage-user v${DEPLOY_VERSION}] Processing ${req.method} request, correlation_id=${correlationId}, trace_id=${tracingContext.traceId}`);

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
  // ENVIRONMENT VALIDATION - FAIL FAST
  // ==========================================================================
  let env;
  try {
    env = validateEdgeFunctionEnv('manage-user');
  } catch (error) {
    return createEnvErrorResponse('manage-user', DEPLOY_VERSION, error.message, corsHeaders);
  }

  // Require service role / secret key (APP_SECRET_KEY preferred over the
  // auto-injected SUPABASE_SERVICE_ROLE_KEY; see _shared/api-key-resolution.ts)
  if (!env.APP_SECRET_KEY && !env.SUPABASE_SERVICE_ROLE_KEY) {
    return createEnvErrorResponse('manage-user', DEPLOY_VERSION, 'APP_SECRET_KEY or SUPABASE_SERVICE_ROLE_KEY is required', corsHeaders);
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

    const jwt = authHeader.replace('Bearer ', '');
    const jwtParts = jwt.split('.');

    if (jwtParts.length !== 3) {
      return new Response(
        JSON.stringify({ error: 'Invalid JWT token format' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    let jwtPayload: JWTPayload;
    try {
      jwtPayload = JSON.parse(atob(jwtParts[1]));
    } catch (_e) {
      return new Response(
        JSON.stringify({ error: 'Failed to decode JWT token' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const supabaseUser = createClient(env.SUPABASE_URL, resolveAnonKey(req, env), {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: { user }, error: authError } = await supabaseUser.auth.getUser();
    if (authError || !user) {
      return new Response(
        JSON.stringify({ error: 'Invalid or expired token' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (jwtPayload.access_blocked) {
      console.log(`[manage-user ${DEPLOY_VERSION}] Access blocked for user ${user.id}: ${jwtPayload.access_block_reason || 'organization_deactivated'}`);
      return new Response(
        JSON.stringify({ error: 'Access blocked: organization is deactivated' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const orgId = jwtPayload.org_id;
    const effectivePermissions = jwtPayload.effective_permissions;

    if (!orgId) {
      return new Response(
        JSON.stringify({ error: 'No organization context in token' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const bodyText = await req.text();
    const preCheckData = JSON.parse(bodyText) as ManageUserRequest;

    if (!hasPermission(effectivePermissions, 'user.update')) {
      console.log(`[manage-user v${DEPLOY_VERSION}] Permission denied: user ${user.id} lacks user.update`);
      return new Response(
        JSON.stringify({ error: 'Permission denied: user.update required' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`[manage-user v${DEPLOY_VERSION}] User ${user.id} authorized for org ${orgId}`);

    // ==========================================================================
    // REQUEST VALIDATION
    // ==========================================================================
    const requestData: ManageUserRequest = preCheckData;

    if (!requestData.operation) {
      return new Response(
        JSON.stringify({ error: 'Missing operation' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (!['deactivate', 'reactivate'].includes(requestData.operation)) {
      return new Response(
        JSON.stringify({ error: 'Invalid operation. Must be "deactivate" or "reactivate"' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (!requestData.userId) {
      return new Response(
        JSON.stringify({ error: 'Missing userId' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Prevent self-deactivation
    if (requestData.operation === 'deactivate' && requestData.userId === user.id) {
      return new Response(
        JSON.stringify({ error: 'Cannot deactivate yourself' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // ==========================================================================
    // ADMIN CLIENT (for RPC calls + LB1 auth.admin.updateUserById)
    // ==========================================================================
    const supabaseAdmin = createClient(env.SUPABASE_URL, resolveServiceRoleKey(env)!, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
      db: {
        schema: 'api',
      },
    });

    // Forward caller's JWT so the RPC's permission checks (`auth.uid()`,
    // `request.jwt.claims.org_id`, `has_permission`) authorize against the
    // caller, not the service role.
    //
    // For deactivate (post-pivot 2026-05-12), api.deactivate_user does:
    //   - access_blocked guard
    //   - has_permission('user.update') guard
    //   - tenancy guard via JWT org_id + users.current_organization_id lookup
    //   - idempotency (already-inactive, already-deleted)
    //   - emit user.deactivated + Pattern A v2 read-back (BOTH checks per Rule 13)
    //
    // For reactivate (legacy emit flow): retained as-is. The matching
    // Pattern A v2 retrofit for the reactivate path is the next card.

    // ==========================================================================
    // DEACTIVATE PATH — SQL RPC (Pattern A v2 lives in api.deactivate_user)
    // ==========================================================================
    let eventId: string | undefined;

    if (requestData.operation === 'deactivate') {
      console.log(`[manage-user v${DEPLOY_VERSION}] Calling api.deactivate_user RPC...`);

      // RPC must use caller's JWT for `auth.uid()` + `org_id` claim + permission
      // gate. Build a per-call client with the user's auth header instead of the
      // service-role client above.
      const supabaseRpcCaller = createClient(env.SUPABASE_URL, resolveAnonKey(req, env), {
        global: { headers: { Authorization: authHeader } },
        db: { schema: 'api' },
      });

      const { data: envelope, error: rpcError } = await supabaseRpcCaller.rpc('deactivate_user', {
        p_user_id: requestData.userId,
        p_reason: requestData.reason ?? null,
      });

      if (rpcError) {
        console.error(`[manage-user v${DEPLOY_VERSION}] deactivate_user RPC error:`, rpcError);
        return handleRpcError(rpcError, correlationId, corsHeaders, 'deactivate user');
      }

      // Pattern A v2 envelope: returns 200 + {success: false, error, eventId?}
      // for all handler-driven failures (idempotency, tenancy, projection
      // read-back miss, processing_error). Caller parses data.success, not HTTP
      // status — matches the SQL Pattern A v2 contract (adr-rpc-readback-pattern.md).
      const env_ = (envelope ?? {}) as {
        success?: boolean;
        error?: string;
        eventId?: string;
        userId?: string;
      };

      if (!env_.success) {
        console.warn(`[manage-user v${DEPLOY_VERSION}] deactivate_user envelope failure:`, env_.error);
        const errorResponse: ManageUserResponse = {
          success: false,
          error: env_.error ?? 'Failed to deactivate user',
          eventId: env_.eventId,
        };
        return new Response(JSON.stringify(errorResponse), {
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      eventId = env_.eventId;
      console.log(`[manage-user v${DEPLOY_VERSION}] deactivate_user OK, eventId=${eventId}`);
    } else {
      // ==========================================================================
      // REACTIVATE PATH — LEGACY EMIT FLOW (retrofit deferred to next card)
      // ==========================================================================
      const userDetails = await getUserDetails(supabaseAdmin, requestData.userId, orgId);

      if (!userDetails.exists) {
        return new Response(
          JSON.stringify({ error: 'User not found in this organization' }),
          { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      if (userDetails.isActive) {
        return new Response(
          JSON.stringify({ error: 'User is already active' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      const now = new Date().toISOString();
      const eventType = 'user.reactivated';
      const eventData: Record<string, unknown> = {
        user_id: requestData.userId,
        org_id: orgId,
        reactivated_at: now,
      };
      if (requestData.reason) {
        eventData.reason = requestData.reason;
      }

      console.log(`[manage-user v${DEPLOY_VERSION}] Emitting ${eventType} event...`);

      const { data: emittedEventId, error: eventError } = await supabaseAdmin
        .rpc('emit_domain_event', {
          p_stream_id: requestData.userId,
          p_stream_type: 'user',
          p_event_type: eventType,
          p_event_data: eventData,
          p_event_metadata: buildEventMetadata(tracingContext, eventType, req, {
            user_id: user.id,
            reason: requestData.reason || 'Manual reactivate',
          }),
        });

      if (eventError) {
        console.error(`[manage-user v${DEPLOY_VERSION}] Failed to emit event:`, eventError);
        return handleRpcError(eventError, correlationId, corsHeaders, 'reactivate user');
      }

      eventId = emittedEventId as string | undefined;
      console.log(`[manage-user v${DEPLOY_VERSION}] Event emitted: ${eventId}`);
    }

    // ==========================================================================
    // UPDATE SUPABASE AUTH BAN STATE (global login prevention) — LB1
    // The event handler updated projection state (is_active, deactivated_at /
    // reactivated_at). Banning at the auth tier is what actually prevents login.
    //
    // Supabase Auth contract:
    //   ban_duration: '876000h' (≈100 years) — effectively permanent until unbanned
    //   ban_duration: 'none'                  — clears any existing ban
    //
    // Historical bug (fixed 2026-04-29 same-day as discovery): the deactivate
    // branch previously called updateUserById with ban_duration: 'none',
    // which UNBANS rather than bans. Deactivated users could continue to log
    // in because Supabase Auth never received a real ban.
    // ==========================================================================

    if (requestData.operation === 'deactivate') {
      const { error: banError } = await supabaseAdmin.auth.admin.updateUserById(
        requestData.userId,
        { ban_duration: '876000h' } // Effectively permanent ban; cleared by reactivate.
      );

      if (banError) {
        console.warn(`[manage-user v${DEPLOY_VERSION}] Failed to ban auth user:`, banError);
        // Don't fail the request - projection update already succeeded via RPC.
        // The auth-tier ban is the actual login-prevention mechanism; without
        // it the user can still log in. Surface as a warning for ops visibility.
      }
    } else {
      const { error: unbanError } = await supabaseAdmin.auth.admin.updateUserById(
        requestData.userId,
        { ban_duration: 'none' } // Clear any existing ban (set by prior deactivate).
      );

      if (unbanError) {
        console.warn(`[manage-user v${DEPLOY_VERSION}] Failed to unban auth user:`, unbanError);
      }
    }

    // ==========================================================================
    // SUCCESS RESPONSE
    // ==========================================================================
    const response: ManageUserResponse = {
      success: true,
      userId: requestData.userId,
      operation: requestData.operation,
      eventId,
    };

    const completedSpan = endSpan(span, 'ok');
    console.log(`[manage-user v${DEPLOY_VERSION}] Completed in ${completedSpan.durationMs}ms, correlation_id=${correlationId}`);

    return new Response(
      JSON.stringify(response),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    const completedSpan = endSpan(span, 'error');
    console.error(`[manage-user v${DEPLOY_VERSION}] Unhandled error after ${completedSpan.durationMs}ms:`, error);
    return createInternalError(correlationId, corsHeaders, error.message);
  }
});
