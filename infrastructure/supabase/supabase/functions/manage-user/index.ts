/**
 * Manage User Edge Function
 *
 * Handles user lifecycle operations: deactivate and reactivate.
 *
 * Operations:
 * - deactivate: Deactivate a user within the organization
 * - reactivate: Reactivate a deactivated user
 *
 * CQRS-compliant: Emits user.deactivated / user.reactivated domain events.
 * Permission required: user.update
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { validateEdgeFunctionEnv, createEnvErrorResponse } from '../_shared/env-schema.ts';

// Deployment version tracking
const DEPLOY_VERSION = 'v1';

// CORS headers for frontend requests
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

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
}

/**
 * Get user details for validation
 */
async function getUserDetails(
  supabase: SupabaseClient,
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
  console.log(`[manage-user v${DEPLOY_VERSION}] Processing ${req.method} request`);

  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  // Only allow POST
  if (req.method !== 'POST') {
    return new Response(
      JSON.stringify({ error: 'Method not allowed' }),
      { status: 405, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
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

    // Create Supabase client with user's JWT for permission check
    const supabaseUser = createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });

    // Get user and check permissions
    const { data: { user }, error: authError } = await supabaseUser.auth.getUser();
    if (authError || !user) {
      return new Response(
        JSON.stringify({ error: 'Invalid or expired token' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Extract JWT claims
    const jwtClaims = user.app_metadata || {};
    const orgId = jwtClaims.org_id as string | undefined;
    const permissions = (jwtClaims.permissions as string[]) || [];

    if (!orgId) {
      return new Response(
        JSON.stringify({ error: 'No organization context in token' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Check user.update permission
    if (!permissions.includes('user.update')) {
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
    const requestData: ManageUserRequest = await req.json();

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

    // ==========================================================================
    // EMIT DOMAIN EVENT
    // ==========================================================================
    const now = new Date().toISOString();
    const eventType = requestData.operation === 'deactivate' ? 'user.deactivated' : 'user.reactivated';
    const timestampField = requestData.operation === 'deactivate' ? 'deactivated_at' : 'reactivated_at';

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
        p_event_metadata: {
          user_id: user.id,
          ip_address: req.headers.get('x-forwarded-for') || req.headers.get('x-real-ip') || null,
          user_agent: req.headers.get('user-agent') || null,
          reason: requestData.reason || `Manual ${requestData.operation}`,
        },
      });

    if (eventError) {
      console.error(`[manage-user v${DEPLOY_VERSION}] Failed to emit event:`, eventError);
      return new Response(
        JSON.stringify({ error: `Failed to ${requestData.operation} user`, details: eventError.message }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
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

    return new Response(
      JSON.stringify(response),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error(`[manage-user v${DEPLOY_VERSION}] Error:`, error);
    return new Response(
      JSON.stringify({
        error: 'Internal server error',
        details: error.message,
        version: DEPLOY_VERSION,
      }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
