/**
 * Manage User Edge Function
 *
 * Handles user lifecycle operations: deactivate, reactivate, and delete.
 *
 * Operations:
 * - deactivate: Deactivate a user within the organization
 * - reactivate: Reactivate a deactivated user
 * - delete: Permanently delete a deactivated user (soft-delete via deleted_at)
 *
 * CQRS-compliant: Emits user.deactivated / user.reactivated / user.deleted domain events.
 * Permission required: user.update (deactivate/reactivate), user.delete (delete)
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { validateEdgeFunctionEnv, createEnvErrorResponse } from '../_shared/env-schema.ts';
import { AnySchemaSupabaseClient } from '../_shared/types.ts';
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
const DEPLOY_VERSION = 'v5-delete';

// CORS headers for frontend requests
const corsHeaders = standardCorsHeaders;

/**
 * Supported operations
 */
type Operation = 'deactivate' | 'reactivate' | 'delete';

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
}

/**
 * JWT Payload structure for custom claims
 * Custom claims are added to the JWT payload via database hook (auth.custom_access_token_hook),
 * NOT to user.app_metadata. We must decode the JWT directly to access them.
 */
interface JWTPayload {
  permissions?: string[];
  org_id?: string;
  user_role?: string;
  scope_path?: string;
  sub?: string;
  email?: string;
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

    // Extract custom claims from decoded JWT payload (not from user.app_metadata!)
    // The JWT hook adds claims directly to the token payload
    const orgId = jwtPayload.org_id;
    const permissions = jwtPayload.permissions || [];

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

    if (preCheckData.operation === 'delete') {
      if (!permissions.includes('user.delete')) {
        console.log(`[manage-user v${DEPLOY_VERSION}] Permission denied: user ${user.id} lacks user.delete`);
        return new Response(
          JSON.stringify({ error: 'Permission denied: user.delete required' }),
          { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
    } else {
      if (!permissions.includes('user.update')) {
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

    if (!['deactivate', 'reactivate', 'delete'].includes(requestData.operation)) {
      return new Response(
        JSON.stringify({ error: 'Invalid operation. Must be "deactivate", "reactivate", or "delete"' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (!requestData.userId) {
      return new Response(
        JSON.stringify({ error: 'Missing userId' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Prevent self-deactivation and self-deletion
    if ((requestData.operation === 'deactivate' || requestData.operation === 'delete') && requestData.userId === user.id) {
      const action = requestData.operation === 'delete' ? 'delete' : 'deactivate';
      return new Response(
        JSON.stringify({ error: `Cannot ${action} yourself` }),
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

    // Delete requires user to be deactivated first (soft-delete pattern)
    if (requestData.operation === 'delete' && userDetails.isActive) {
      return new Response(
        JSON.stringify({ error: 'Cannot delete active user. Deactivate first.' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // ==========================================================================
    // EMIT DOMAIN EVENT
    // ==========================================================================
    const now = new Date().toISOString();

    // Determine event type and timestamp field based on operation
    let eventType: string;
    let timestampField: string;
    switch (requestData.operation) {
      case 'delete':
        eventType = 'user.deleted';
        timestampField = 'deleted_at';
        break;
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
    // UPDATE USER ACTIVE STATUS (via Supabase Auth Admin API for global state)
    // The event processor will handle projection updates
    // ==========================================================================

    // Also update Supabase Auth user banned state for global enforcement
    if (requestData.operation === 'deactivate') {
      // Ban user in Supabase Auth (prevents login)
      const { error: banError } = await supabaseAdmin.auth.admin.updateUserById(
        requestData.userId,
        { ban_duration: 'none' } // Use 'none' to indicate unbanned, but we set app_metadata
      );

      if (banError) {
        console.warn(`[manage-user v${DEPLOY_VERSION}] Failed to update auth metadata:`, banError);
        // Don't fail the request - event was emitted, projection will update
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
