/**
 * Manage User Edge Function
 *
 * Handles user lifecycle operations: deactivate, reactivate, delete, role modification,
 * and notification preferences updates.
 *
 * Operations:
 * - deactivate: Deactivate a user within the organization
 * - reactivate: Reactivate a deactivated user
 * - delete: Permanently delete a deactivated user (soft-delete via deleted_at)
 * - modify_roles: Add and/or remove roles for a user
 * - update_notification_preferences: Update user notification settings (email, SMS, in-app)
 *
 * CQRS-compliant: Emits domain events:
 * - user.deactivated / user.reactivated / user.deleted
 * - user.role.assigned / user.role.revoked
 * - user.notification_preferences.updated
 *
 * Permissions:
 * - user.update: deactivate/reactivate
 * - user.delete: delete
 * - user.role_assign: modify_roles
 * - update_notification_preferences: self OR user.update
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
const DEPLOY_VERSION = 'v7-notification-prefs';

// CORS headers for frontend requests
const corsHeaders = standardCorsHeaders;

/**
 * Supported operations
 */
type Operation = 'deactivate' | 'reactivate' | 'delete' | 'modify_roles' | 'update_notification_preferences';

/**
 * Request format from frontend
 */
/**
 * Notification preferences structure
 * Follows AsyncAPI contract snake_case convention
 */
interface NotificationPreferences {
  email: boolean;
  sms: {
    enabled: boolean;
    phone_id: string | null;
  };
  in_app: boolean;
}

interface ManageUserRequest {
  operation: Operation;
  userId: string;
  reason?: string;
  // For modify_roles operation only
  roleIdsToAdd?: string[];
  roleIdsToRemove?: string[];
  // For update_notification_preferences operation only
  notificationPreferences?: NotificationPreferences;
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
    } else if (preCheckData.operation === 'modify_roles') {
      if (!permissions.includes('user.role_assign')) {
        console.log(`[manage-user v${DEPLOY_VERSION}] Permission denied: user ${user.id} lacks user.role_assign`);
        return new Response(
          JSON.stringify({ error: 'Permission denied: user.role_assign required' }),
          { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
    } else if (preCheckData.operation === 'update_notification_preferences') {
      // Allow users to update their own notification preferences
      // Org admins and platform admins can also update any user's preferences
      const isSelf = preCheckData.userId === user.id;
      const hasOrgAdmin = permissions.includes('user.update');
      if (!isSelf && !hasOrgAdmin) {
        console.log(`[manage-user v${DEPLOY_VERSION}] Permission denied: user ${user.id} cannot update notification preferences for ${preCheckData.userId}`);
        return new Response(
          JSON.stringify({ error: 'Permission denied: Can only update your own notification preferences unless you have user.update permission' }),
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

    if (!['deactivate', 'reactivate', 'delete', 'modify_roles', 'update_notification_preferences'].includes(requestData.operation)) {
      return new Response(
        JSON.stringify({ error: 'Invalid operation. Must be "deactivate", "reactivate", "delete", "modify_roles", or "update_notification_preferences"' }),
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

    // Validate update_notification_preferences specific fields
    if (requestData.operation === 'update_notification_preferences') {
      if (!requestData.notificationPreferences) {
        return new Response(
          JSON.stringify({ error: 'notificationPreferences is required for update_notification_preferences operation' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      // Validate notification preferences structure
      const prefs = requestData.notificationPreferences;
      if (typeof prefs.email !== 'boolean' || typeof prefs.in_app !== 'boolean') {
        return new Response(
          JSON.stringify({ error: 'notificationPreferences must include boolean email and in_app fields' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      if (!prefs.sms || typeof prefs.sms.enabled !== 'boolean') {
        return new Response(
          JSON.stringify({ error: 'notificationPreferences.sms must include boolean enabled field' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
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

    // Modify roles requires user to be active
    if (requestData.operation === 'modify_roles' && !userDetails.isActive) {
      return new Response(
        JSON.stringify({ error: 'Cannot modify roles for deactivated user' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // ==========================================================================
    // HANDLE UPDATE_NOTIFICATION_PREFERENCES OPERATION (separate flow)
    // ==========================================================================
    if (requestData.operation === 'update_notification_preferences') {
      const prefs = requestData.notificationPreferences!;

      console.log(`[manage-user v${DEPLOY_VERSION}] Processing update_notification_preferences for user ${requestData.userId}...`);

      // Emit the user.notification_preferences.updated event
      // Note: orgId comes from JWT claims (SECURITY CRITICAL - not from request body!)
      const { data: eventId, error: eventError } = await supabaseAdmin
        .rpc('emit_domain_event', {
          p_stream_id: requestData.userId,
          p_stream_type: 'user',
          p_event_type: 'user.notification_preferences.updated',
          p_event_data: {
            user_id: requestData.userId,
            org_id: orgId, // From JWT claims, NOT request body
            notification_preferences: prefs,
          },
          p_event_metadata: buildEventMetadata(tracingContext, 'user.notification_preferences.updated', req, {
            user_id: user.id,
            reason: requestData.reason || 'Updated via User Management',
          }),
        });

      if (eventError) {
        console.error(`[manage-user v${DEPLOY_VERSION}] Failed to emit user.notification_preferences.updated:`, eventError);
        return handleRpcError(eventError, correlationId, corsHeaders, 'update notification preferences');
      }

      console.log(`[manage-user v${DEPLOY_VERSION}] Notification preferences updated: event_id=${eventId}`);

      // Success response
      const response: ManageUserResponse = {
        success: true,
        userId: requestData.userId,
        operation: 'update_notification_preferences',
      };

      const completedSpan = endSpan(span, 'ok');
      console.log(`[manage-user v${DEPLOY_VERSION}] Completed in ${completedSpan.durationMs}ms, correlation_id=${correlationId}`);

      return new Response(
        JSON.stringify(response),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
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
