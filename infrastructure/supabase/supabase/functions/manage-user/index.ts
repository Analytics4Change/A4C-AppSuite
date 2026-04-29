/**
 * Manage User Edge Function
 *
 * Handles user lifecycle operations: deactivate, reactivate, and role
 * modification. Two operations have been extracted to SQL RPCs per
 * adr-edge-function-vs-sql-rpc.md:
 * - `update_notification_preferences` → `api.update_user_notification_preferences`
 *   (migration 20260424194102_add_update_user_notification_preferences_rpc.sql)
 * - `delete` → `api.delete_user`
 *   (migration 20260427205333_extract_delete_user_rpc.sql)
 *
 * Operations:
 * - deactivate: Deactivate a user within the organization
 * - reactivate: Reactivate a deactivated user
 * - modify_roles: Add and/or remove roles for a user
 *
 * CQRS-compliant: Emits domain events:
 * - user.deactivated / user.reactivated
 * - user.role.assigned / user.role.revoked
 *
 * Permissions:
 * - user.update: deactivate/reactivate
 * - user.role_assign: modify_roles
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { validateEdgeFunctionEnv, createEnvErrorResponse } from '../_shared/env-schema.ts';
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
const DEPLOY_VERSION = 'v14-deactivate-ban-fix';

// CORS headers for frontend requests
const corsHeaders = standardCorsHeaders;

/**
 * Supported operations
 */
type Operation = 'deactivate' | 'reactivate' | 'modify_roles';

/**
 * Request format from frontend
 */
interface ManageUserRequest {
  operation: Operation;
  userId: string;
  reason?: string;
  // For modify_roles operation only
  roleIdsToAdd?: string[];
  roleIdsToRemove?: string[];
}

/**
 * Response format
 */
interface ManageUserResponse {
  success: boolean;
  userId?: string;
  operation?: Operation;
  error?: string;
}

/**
 * Get user details for validation
 */
async function getUserDetails(
  supabase: AnySchemaSupabaseClient,
  userId: string,
  orgId: string
): Promise<{ exists: boolean; isActive: boolean; email?: string }> {
  // Query user and their role in the org
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

  // Require service role key
  if (!env.SUPABASE_SERVICE_ROLE_KEY) {
    return createEnvErrorResponse('manage-user', DEPLOY_VERSION, 'SUPABASE_SERVICE_ROLE_KEY is required', corsHeaders);
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
    const supabaseUser = createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, {
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
      console.log(`[manage-user ${DEPLOY_VERSION}] Access blocked for user ${user.id}: ${jwtPayload.access_block_reason || 'organization_deactivated'}`);
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

    // Check permissions based on operation
    // Note: Permission check happens before parsing body, so we extract operation from request
    const bodyText = await req.text();
    const preCheckData = JSON.parse(bodyText) as ManageUserRequest;

    if (preCheckData.operation === 'modify_roles') {
      if (!hasPermission(effectivePermissions, 'user.role_assign')) {
        console.log(`[manage-user v${DEPLOY_VERSION}] Permission denied: user ${user.id} lacks user.role_assign`);
        return new Response(
          JSON.stringify({ error: 'Permission denied: user.role_assign required' }),
          { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
    } else {
      if (!hasPermission(effectivePermissions, 'user.update')) {
        console.log(`[manage-user v${DEPLOY_VERSION}] Permission denied: user ${user.id} lacks user.update`);
        return new Response(
          JSON.stringify({ error: 'Permission denied: user.update required' }),
          { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
    }

    console.log(`[manage-user v${DEPLOY_VERSION}] User ${user.id} authorized for org ${orgId}`);

    // ==========================================================================
    // REQUEST VALIDATION
    // ==========================================================================
    // Note: Body already parsed above for permission check
    const requestData: ManageUserRequest = preCheckData;

    if (!requestData.operation) {
      return new Response(
        JSON.stringify({ error: 'Missing operation' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (!['deactivate', 'reactivate', 'modify_roles'].includes(requestData.operation)) {
      return new Response(
        JSON.stringify({ error: 'Invalid operation. Must be "deactivate", "reactivate", or "modify_roles"' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (!requestData.userId) {
      return new Response(
        JSON.stringify({ error: 'Missing userId' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Validate modify_roles specific fields
    if (requestData.operation === 'modify_roles') {
      const hasRolesToAdd = requestData.roleIdsToAdd && requestData.roleIdsToAdd.length > 0;
      const hasRolesToRemove = requestData.roleIdsToRemove && requestData.roleIdsToRemove.length > 0;

      if (!hasRolesToAdd && !hasRolesToRemove) {
        return new Response(
          JSON.stringify({ error: 'At least one of roleIdsToAdd or roleIdsToRemove must be provided' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
    }

    // Prevent self-deactivation
    if (requestData.operation === 'deactivate' && requestData.userId === user.id) {
      return new Response(
        JSON.stringify({ error: 'Cannot deactivate yourself' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // ==========================================================================
    // VALIDATE USER EXISTS IN ORG
    // ==========================================================================
    const supabaseAdmin = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
      db: {
        schema: 'api',
      },
    });

    const userDetails = await getUserDetails(supabaseAdmin, requestData.userId, orgId);

    if (!userDetails.exists) {
      return new Response(
        JSON.stringify({ error: 'User not found in this organization' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Validate operation is appropriate for current state
    if (requestData.operation === 'deactivate' && !userDetails.isActive) {
      return new Response(
        JSON.stringify({ error: 'User is already deactivated' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (requestData.operation === 'reactivate' && userDetails.isActive) {
      return new Response(
        JSON.stringify({ error: 'User is already active' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Modify roles requires user to be active
    if (requestData.operation === 'modify_roles' && !userDetails.isActive) {
      return new Response(
        JSON.stringify({ error: 'Cannot modify roles for deactivated user' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }


    // ==========================================================================
    // HANDLE MODIFY_ROLES OPERATION (separate flow)
    // ==========================================================================
    if (requestData.operation === 'modify_roles') {
      const roleIdsToAdd = requestData.roleIdsToAdd || [];
      const roleIdsToRemove = requestData.roleIdsToRemove || [];
      const now = new Date().toISOString();
      const emittedEvents: string[] = [];

      console.log(`[manage-user v${DEPLOY_VERSION}] Processing modify_roles: add=${roleIdsToAdd.length}, remove=${roleIdsToRemove.length}`);

      // Validate roles being added using the existing validation RPC
      if (roleIdsToAdd.length > 0) {
        console.log(`[manage-user v${DEPLOY_VERSION}] Validating ${roleIdsToAdd.length} roles to add...`);
        const { error: validationError } = await supabaseAdmin
          .rpc('validate_role_assignment', {
            p_user_id: user.id,
            p_target_user_id: requestData.userId,
            p_role_ids: roleIdsToAdd,
          });

        if (validationError) {
          console.error(`[manage-user v${DEPLOY_VERSION}] Role validation failed:`, validationError);
          return handleRpcError(validationError, correlationId, corsHeaders, 'validate role assignment');
        }
      }

      // Emit user.role.revoked events for removed roles
      for (const roleId of roleIdsToRemove) {
        console.log(`[manage-user v${DEPLOY_VERSION}] Emitting user.role.revoked for role ${roleId}...`);
        const { data: eventId, error: eventError } = await supabaseAdmin
          .rpc('emit_domain_event', {
            p_stream_id: requestData.userId,
            p_stream_type: 'user',
            p_event_type: 'user.role.revoked',
            p_event_data: {
              user_id: requestData.userId,
              role_id: roleId,
              org_id: orgId,
              revoked_at: now,
            },
            p_event_metadata: buildEventMetadata(tracingContext, 'user.role.revoked', req, {
              user_id: user.id,
              reason: requestData.reason || 'Role removed via User Management',
            }),
          });

        if (eventError) {
          console.error(`[manage-user v${DEPLOY_VERSION}] Failed to emit user.role.revoked:`, eventError);
          return handleRpcError(eventError, correlationId, corsHeaders, 'revoke role');
        }
        emittedEvents.push(eventId as string);
      }

      // Emit user.role.assigned events for added roles
      for (const roleId of roleIdsToAdd) {
        console.log(`[manage-user v${DEPLOY_VERSION}] Emitting user.role.assigned for role ${roleId}...`);
        const { data: eventId, error: eventError } = await supabaseAdmin
          .rpc('emit_domain_event', {
            p_stream_id: requestData.userId,
            p_stream_type: 'user',
            p_event_type: 'user.role.assigned',
            p_event_data: {
              user_id: requestData.userId,
              role_id: roleId,
              org_id: orgId,
              assigned_at: now,
            },
            p_event_metadata: buildEventMetadata(tracingContext, 'user.role.assigned', req, {
              user_id: user.id,
              reason: requestData.reason || 'Role added via User Management',
            }),
          });

        if (eventError) {
          console.error(`[manage-user v${DEPLOY_VERSION}] Failed to emit user.role.assigned:`, eventError);
          return handleRpcError(eventError, correlationId, corsHeaders, 'assign role');
        }
        emittedEvents.push(eventId as string);
      }

      console.log(`[manage-user v${DEPLOY_VERSION}] Successfully emitted ${emittedEvents.length} role events`);

      // Success response for modify_roles
      const response: ManageUserResponse = {
        success: true,
        userId: requestData.userId,
        operation: 'modify_roles',
      };

      const completedSpan = endSpan(span, 'ok');
      console.log(`[manage-user v${DEPLOY_VERSION}] Completed in ${completedSpan.durationMs}ms, correlation_id=${correlationId}`);

      return new Response(
        JSON.stringify(response),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // ==========================================================================
    // EMIT DOMAIN EVENT (for deactivate/reactivate/delete operations)
    // ==========================================================================
    const now = new Date().toISOString();

    // Determine event type and timestamp field based on operation
    let eventType: string;
    let timestampField: string;
    switch (requestData.operation) {
      case 'deactivate':
        eventType = 'user.deactivated';
        timestampField = 'deactivated_at';
        break;
      case 'reactivate':
        eventType = 'user.reactivated';
        timestampField = 'reactivated_at';
        break;
    }

    console.log(`[manage-user v${DEPLOY_VERSION}] Emitting ${eventType} event...`);

    const eventData: Record<string, unknown> = {
      user_id: requestData.userId,
      org_id: orgId,
      [timestampField]: now,
    };

    if (requestData.reason) {
      eventData.reason = requestData.reason;
    }

    const { data: eventId, error: eventError } = await supabaseAdmin
      .rpc('emit_domain_event', {
        p_stream_id: requestData.userId,
        p_stream_type: 'user',
        p_event_type: eventType,
        p_event_data: eventData,
        p_event_metadata: buildEventMetadata(tracingContext, eventType, req, {
          user_id: user.id,
          reason: requestData.reason || `Manual ${requestData.operation}`,
        }),
      });

    if (eventError) {
      console.error(`[manage-user v${DEPLOY_VERSION}] Failed to emit event:`, eventError);
      return handleRpcError(eventError, correlationId, corsHeaders, `${requestData.operation} user`);
    }

    console.log(`[manage-user v${DEPLOY_VERSION}] Event emitted: ${eventId}`);

    // ==========================================================================
    // UPDATE SUPABASE AUTH BAN STATE (global login prevention)
    // The event processor handles projection updates (is_active, deactivated_at,
    // reactivated_at). Banning at the auth tier is what actually prevents login.
    //
    // Supabase Auth contract:
    //   ban_duration: '876000h' (≈100 years) — effectively permanent until unbanned
    //   ban_duration: 'none'                  — clears any existing ban
    //
    // Historical bug (fixed 2026-04-29 same-day as discovery): the deactivate
    // branch previously called updateUserById with ban_duration: 'none',
    // which UNBANS rather than bans. Deactivated users could continue to log
    // in because Supabase Auth never received a real ban. Surfaced during
    // smoke testing of manage-user-delete-rpc-and-scope-retrofit. Reactivate
    // also previously had no auth call — meaning even after this fix, banned
    // users would stay banned forever without the parallel unban here.
    // ==========================================================================

    if (requestData.operation === 'deactivate') {
      const { error: banError } = await supabaseAdmin.auth.admin.updateUserById(
        requestData.userId,
        { ban_duration: '876000h' } // Effectively permanent ban; cleared by reactivate.
      );

      if (banError) {
        console.warn(`[manage-user v${DEPLOY_VERSION}] Failed to ban auth user:`, banError);
        // Don't fail the request - event was emitted, projection will update.
        // But surface this as a warning since the auth-tier ban is the actual
        // login-prevention mechanism; without it the user can still log in.
      }
    } else if (requestData.operation === 'reactivate') {
      const { error: unbanError } = await supabaseAdmin.auth.admin.updateUserById(
        requestData.userId,
        { ban_duration: 'none' } // Clear any existing ban (set by prior deactivate).
      );

      if (unbanError) {
        console.warn(`[manage-user v${DEPLOY_VERSION}] Failed to unban auth user:`, unbanError);
        // Don't fail the request - event was emitted, projection will update.
        // But surface this as a warning since the user will remain unable to
        // log in until the ban is cleared.
      }
    }

    // ==========================================================================
    // SUCCESS RESPONSE
    // ==========================================================================
    const response: ManageUserResponse = {
      success: true,
      userId: requestData.userId,
      operation: requestData.operation,
    };

    // End span with success status
    const completedSpan = endSpan(span, 'ok');
    console.log(`[manage-user v${DEPLOY_VERSION}] Completed in ${completedSpan.durationMs}ms, correlation_id=${correlationId}`);

    return new Response(
      JSON.stringify(response),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    // End span with error status
    const completedSpan = endSpan(span, 'error');
    console.error(`[manage-user v${DEPLOY_VERSION}] Unhandled error after ${completedSpan.durationMs}ms:`, error);
    return createInternalError(correlationId, corsHeaders, error.message);
  }
});
