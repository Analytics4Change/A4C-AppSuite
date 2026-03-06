/**
 * Organization Bootstrap Edge Function
 *
 * This Edge Function initiates the organization bootstrap workflow via the Backend API.
 * It validates authentication and permissions, then forwards the request to the
 * Backend API which connects to Temporal.
 *
 * Architecture:
 *   Frontend → Edge Function (auth validation) → Backend API → Temporal
 *
 * Note: Edge Functions cannot connect to Temporal directly because they run in
 * Deno Deploy (external to k8s cluster) and cannot reach k8s internal DNS.
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

// Deployment version tracking
const DEPLOY_VERSION = 'v7-access-blocked-guard';

// CORS headers for frontend requests
const corsHeaders = standardCorsHeaders;

/**
 * Contact information structure
 * Matches AsyncAPI contract: organization-bootstrap-events.yaml lines 76-119
 */
interface ContactInfo {
  firstName: string;
  lastName: string;
  email: string;
  title?: string;
  department?: string;
  type: string;
  label: string;
}

/**
 * Address information structure
 * Matches AsyncAPI contract: organization-bootstrap-events.yaml lines 120-162
 */
interface AddressInfo {
  street1: string;
  street2?: string;
  city: string;
  state: string;
  zipCode: string;
  type: string;
  label: string;
}

/**
 * Phone information structure
 * Matches AsyncAPI contract: organization-bootstrap-events.yaml lines 163-190
 */
interface PhoneInfo {
  number: string;
  extension?: string;
  type: string;
  label: string;
}

/**
 * Organization user invitation structure
 * Matches AsyncAPI contract: organization-bootstrap-events.yaml lines 181-209
 */
interface OrganizationUser {
  email: string;
  firstName: string;
  lastName: string;
  role: string;
}

/**
 * Organization bootstrap request payload
 * Matches AsyncAPI contract: organization-bootstrap-events.yaml lines 41-209
 * Matches frontend: frontend/src/types/organization.types.ts lines 127-167
 */
interface BootstrapRequest {
  subdomain?: string;
  orgData: {
    name: string;
    type: 'provider' | 'partner';
    parentOrgId?: string;
    contacts: ContactInfo[];
    addresses: AddressInfo[];
    phones: PhoneInfo[];
    partnerType?: 'var' | 'family' | 'court' | 'other';
    referringPartnerId?: string;
  };
  users: OrganizationUser[];
}

interface BootstrapResponse {
  workflowId: string;
  organizationId: string;
  status: 'initiated';
}

serve(async (req) => {
  // Extract tracing context from request headers (W3C traceparent + custom headers)
  const tracingContext = extractTracingContext(req);
  const correlationId = tracingContext.correlationId;
  const span = createSpan(tracingContext, 'organization-bootstrap');

  console.log(`[organization-bootstrap ${DEPLOY_VERSION}] Processing ${req.method} request, correlation_id=${correlationId}, trace_id=${tracingContext.traceId}`);

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
    env = validateEdgeFunctionEnv('organization-bootstrap');
  } catch (error) {
    return createEnvErrorResponse('organization-bootstrap', DEPLOY_VERSION, error.message, corsHeaders);
  }

  const { SUPABASE_URL: supabaseUrl, SUPABASE_ANON_KEY: supabaseAnonKey, BACKEND_API_URL: backendApiUrl } = env;
  console.log(`[organization-bootstrap ${DEPLOY_VERSION}] ✓ Environment validated, Backend API: ${backendApiUrl}`);

  try {

    // Verify authorization (JWT token)
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return createUnauthorizedError(correlationId, corsHeaders, 'Missing authorization header');
    }

    // Extract and decode JWT token to access custom claims
    // Custom claims are added to the JWT payload via database hook, NOT to user.app_metadata
    // See: infrastructure/supabase/sql/03-functions/authorization/003-supabase-auth-jwt-hook.sql
    const jwt = authHeader.replace('Bearer ', '');
    const jwtParts = jwt.split('.');

    if (jwtParts.length !== 3) {
      return createUnauthorizedError(correlationId, corsHeaders, 'Invalid JWT token format');
    }

    // Decode JWT payload (base64)
    let jwtPayload: JWTPayload;
    try {
      jwtPayload = JSON.parse(atob(jwtParts[1]));
    } catch (_e) {
      return createUnauthorizedError(correlationId, corsHeaders, 'Failed to decode JWT token');
    }

    // Create client with user's JWT for auth validation
    const supabaseClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: {
        headers: {
          Authorization: authHeader
        }
      }
    });

    const { data: { user }, error: authError } = await supabaseClient.auth.getUser();

    if (authError || !user) {
      return createUnauthorizedError(correlationId, corsHeaders, authError?.message || 'Authentication failed');
    }

    // Check if user's organization is deactivated (access blocked via JWT hook)
    if (jwtPayload.access_blocked) {
      console.log(`[organization-bootstrap ${DEPLOY_VERSION}] Access blocked for user ${user.id}: ${jwtPayload.access_block_reason || 'organization_deactivated'}`);
      return createErrorResponse({
        error: 'Access blocked: organization is deactivated',
        code: ErrorCodes.FORBIDDEN,
        status: 403,
        correlationId,
      }, corsHeaders);
    }

    // Extract custom claims from JWT payload (not from user.app_metadata!)
    // The JWT hook adds claims directly to the token payload, accessible here via jwtPayload
    const effectivePermissions = jwtPayload.effective_permissions;
    if (!hasPermission(effectivePermissions, 'organization.create_root')) {
      console.error('[organization-bootstrap] Permission denied:', {
        user_id: user.id,
        user_email: user.email,
        effective_permissions: effectivePermissions,
        required: 'organization.create_root'
      });

      return createErrorResponse({
        error: 'Forbidden: organization.create_root permission required to bootstrap organizations',
        code: ErrorCodes.FORBIDDEN,
        status: 403,
        correlationId,
        context: { required_permission: 'organization.create_root' },
      }, corsHeaders);
    }

    console.log('[organization-bootstrap] Permission check passed:', {
      user_id: user.id,
      user_email: user.email,
      permission: 'organization.create_root'
    });

    // Parse request body
    let requestData: BootstrapRequest;
    try {
      requestData = await req.json();
    } catch (parseError) {
      console.error(`[organization-bootstrap ${DEPLOY_VERSION}] Failed to parse request body:`, parseError);
      return createValidationError('Invalid request body: could not parse JSON', correlationId, corsHeaders);
    }

    // Validate required fields (AsyncAPI contract enforcement)
    if (!requestData.subdomain || !requestData.orgData || !requestData.users) {
      return createValidationError(
        'Invalid request payload: required fields: subdomain, orgData, users',
        correlationId,
        corsHeaders,
      );
    }

    console.log(`[organization-bootstrap ${DEPLOY_VERSION}] ✓ Request validated, forwarding to Backend API: ${backendApiUrl}`);

    // Forward request to Backend API
    // The Backend API handles:
    // - Event emission (organization.bootstrap.initiated)
    // - Temporal workflow creation
    // - ID generation
    const apiEndpoint = `${backendApiUrl}/api/v1/workflows/organization-bootstrap`;

    try {
      // Include tracing headers for downstream propagation
      const tracingHeaders = buildTracingHeaders(tracingContext);

      const apiResponse = await fetch(apiEndpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': authHeader,
          ...tracingHeaders,
        },
        body: JSON.stringify({
          subdomain: requestData.subdomain,
          orgData: requestData.orgData,
          users: requestData.users,
        }),
      });

      console.log(`[organization-bootstrap ${DEPLOY_VERSION}] Backend API responded with status: ${apiResponse.status}`);

      // Get response body
      const responseText = await apiResponse.text();
      let responseData;
      try {
        responseData = JSON.parse(responseText);
      } catch {
        responseData = { raw: responseText };
      }

      // Forward the response status and body from Backend API
      if (!apiResponse.ok) {
        console.error(`[organization-bootstrap ${DEPLOY_VERSION}] Backend API error:`, {
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

      // End span with success status
      const completedSpan = endSpan(span, 'ok');
      console.log(`[organization-bootstrap ${DEPLOY_VERSION}] ✓ Bootstrap initiated successfully in ${completedSpan.durationMs}ms:`, {
        workflowId: responseData.workflowId,
        organizationId: responseData.organizationId,
        user: user.email,
        correlation_id: correlationId,
      });

      // Return the Backend API response (includes workflowId, organizationId)
      return new Response(
        JSON.stringify(responseData),
        {
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );

    } catch (fetchError) {
      const completedSpan = endSpan(span, 'error');
      console.error(`[organization-bootstrap ${DEPLOY_VERSION}] Failed to call Backend API after ${completedSpan.durationMs}ms:`, fetchError);
      return createErrorResponse({
        error: `Failed to reach Backend API: ${fetchError.message}`,
        code: ErrorCodes.SERVICE_UNAVAILABLE,
        status: 502,
        correlationId,
      }, corsHeaders);
    }

  } catch (error) {
    // End span with error status
    const completedSpan = endSpan(span, 'error');
    console.error(`[organization-bootstrap ${DEPLOY_VERSION}] Unhandled error after ${completedSpan.durationMs}ms:`, error);
    return createInternalError(correlationId, corsHeaders, error.message);
  }
});
