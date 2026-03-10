/**
 * Organization Delete Edge Function
 *
 * Triggers the organization deletion workflow via the Backend API.
 * Validates authentication and organization.delete permission, then forwards
 * the request to the Backend API which starts the Temporal deletion workflow.
 *
 * Architecture:
 *   Frontend → Edge Function (auth validation) → Backend API → Temporal
 *
 * The organization is already soft-deleted via RPC before this is called.
 * This function triggers async cleanup (DNS removal, user banning, invitation revocation).
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { validateEdgeFunctionEnv, createEnvErrorResponse } from '../_shared/env-schema.ts';
import { JWTPayload, hasPermission } from '../_shared/types.ts';
import {
  createInternalError,
  createCorsPreflightResponse,
  createUnauthorizedError,
  createValidationError,
  createErrorResponse,
  ErrorCodes,
  standardCorsHeaders,
} from '../_shared/error-response.ts';
import {
  extractTracingContext,
  createSpan,
  endSpan,
  buildTracingHeaders,
} from '../_shared/tracing-context.ts';

const DEPLOY_VERSION = 'v1-initial';
const corsHeaders = standardCorsHeaders;

interface DeleteRequest {
  organizationId: string;
  reason: string;
}

serve(async (req) => {
  const tracingContext = extractTracingContext(req);
  const correlationId = tracingContext.correlationId;
  const span = createSpan(tracingContext, 'organization-delete');

  console.log(`[organization-delete ${DEPLOY_VERSION}] Processing ${req.method} request, correlation_id=${correlationId}, trace_id=${tracingContext.traceId}`);

  if (req.method === 'OPTIONS') {
    return createCorsPreflightResponse(corsHeaders);
  }

  // Environment validation
  let env;
  try {
    env = validateEdgeFunctionEnv('organization-delete');
  } catch (error) {
    return createEnvErrorResponse('organization-delete', DEPLOY_VERSION, error.message, corsHeaders);
  }

  const { SUPABASE_URL: supabaseUrl, SUPABASE_ANON_KEY: supabaseAnonKey, BACKEND_API_URL: backendApiUrl } = env;
  console.log(`[organization-delete ${DEPLOY_VERSION}] ✓ Environment validated, Backend API: ${backendApiUrl}`);

  try {
    // Verify authorization
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return createUnauthorizedError(correlationId, corsHeaders, 'Missing authorization header');
    }

    // Decode JWT for permission check
    const jwt = authHeader.replace('Bearer ', '');
    const jwtParts = jwt.split('.');

    if (jwtParts.length !== 3) {
      return createUnauthorizedError(correlationId, corsHeaders, 'Invalid JWT token format');
    }

    let jwtPayload: JWTPayload;
    try {
      jwtPayload = JSON.parse(atob(jwtParts[1]));
    } catch (_e) {
      return createUnauthorizedError(correlationId, corsHeaders, 'Failed to decode JWT token');
    }

    // Validate user via Supabase Auth
    const supabaseClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: { user }, error: authError } = await supabaseClient.auth.getUser();

    if (authError || !user) {
      return createUnauthorizedError(correlationId, corsHeaders, authError?.message || 'Authentication failed');
    }

    // Check access_blocked
    if (jwtPayload.access_blocked) {
      console.log(`[organization-delete ${DEPLOY_VERSION}] Access blocked for user ${user.id}: ${jwtPayload.access_block_reason || 'organization_deactivated'}`);
      return createErrorResponse({
        error: 'Access blocked: organization is deactivated',
        code: ErrorCodes.FORBIDDEN,
        status: 403,
        correlationId,
      }, corsHeaders);
    }

    // Check organization.delete permission
    const effectivePermissions = jwtPayload.effective_permissions;
    if (!hasPermission(effectivePermissions, 'organization.delete')) {
      console.error('[organization-delete] Permission denied:', {
        user_id: user.id,
        user_email: user.email,
        effective_permissions: effectivePermissions,
        required: 'organization.delete',
      });

      return createErrorResponse({
        error: 'Forbidden: organization.delete permission required',
        code: ErrorCodes.FORBIDDEN,
        status: 403,
        correlationId,
        context: { required_permission: 'organization.delete' },
      }, corsHeaders);
    }

    console.log('[organization-delete] Permission check passed:', {
      user_id: user.id,
      user_email: user.email,
      permission: 'organization.delete',
    });

    // Parse request body
    let requestData: DeleteRequest;
    try {
      requestData = await req.json();
    } catch (parseError) {
      console.error(`[organization-delete ${DEPLOY_VERSION}] Failed to parse request body:`, parseError);
      return createValidationError('Invalid request body: could not parse JSON', correlationId, corsHeaders);
    }

    // Validate required fields
    if (!requestData.organizationId || !requestData.reason) {
      return createValidationError(
        'Invalid request payload: required fields: organizationId, reason',
        correlationId,
        corsHeaders,
      );
    }

    console.log(`[organization-delete ${DEPLOY_VERSION}] ✓ Request validated, forwarding to Backend API`);

    // Forward to Backend API
    const apiEndpoint = `${backendApiUrl}/api/v1/organizations/${requestData.organizationId}`;

    try {
      const tracingHeaders = buildTracingHeaders(tracingContext);

      const apiResponse = await fetch(apiEndpoint, {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': authHeader,
          ...tracingHeaders,
        },
        body: JSON.stringify({ reason: requestData.reason }),
      });

      console.log(`[organization-delete ${DEPLOY_VERSION}] Backend API responded with status: ${apiResponse.status}`);

      const responseText = await apiResponse.text();
      let responseData;
      try {
        responseData = JSON.parse(responseText);
      } catch {
        responseData = { raw: responseText };
      }

      if (!apiResponse.ok) {
        console.error(`[organization-delete ${DEPLOY_VERSION}] Backend API error:`, {
          status: apiResponse.status,
          response: responseData,
        });
        return createErrorResponse({
          error: responseData.error || responseData.message || 'Unknown backend error',
          code: 'BACKEND_ERROR',
          status: apiResponse.status,
          details: JSON.stringify(responseData),
          correlationId,
        }, corsHeaders);
      }

      const completedSpan = endSpan(span, 'ok');
      console.log(`[organization-delete ${DEPLOY_VERSION}] ✓ Deletion workflow initiated in ${completedSpan.durationMs}ms:`, {
        organizationId: responseData.organizationId,
        workflowId: responseData.workflowId,
        user: user.email,
        correlation_id: correlationId,
      });

      return new Response(
        JSON.stringify(responseData),
        {
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        },
      );
    } catch (fetchError) {
      const completedSpan = endSpan(span, 'error');
      console.error(`[organization-delete ${DEPLOY_VERSION}] Failed to call Backend API after ${completedSpan.durationMs}ms:`, fetchError);
      return createErrorResponse({
        error: `Failed to reach Backend API: ${fetchError.message}`,
        code: ErrorCodes.SERVICE_UNAVAILABLE,
        status: 502,
        correlationId,
      }, corsHeaders);
    }
  } catch (error) {
    const completedSpan = endSpan(span, 'error');
    console.error(`[organization-delete ${DEPLOY_VERSION}] Unhandled error after ${completedSpan.durationMs}ms:`, error);
    return createInternalError(correlationId, corsHeaders, error.message);
  }
});
