/**
 * Workflow Status Edge Function
 *
 * This Edge Function queries workflow status from Temporal or database events.
 * It's called by the frontend OrganizationBootstrapStatusPage to poll for progress.
 *
 * Returns workflow execution status, current stage, and completion percentage.
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { validateEdgeFunctionEnv, createEnvErrorResponse } from '../_shared/env-schema.ts';
import { JWTPayload } from '../_shared/types.ts';
import {
  handleRpcError,
  createValidationError,
  createNotFoundError,
  createUnauthorizedError,
  createInternalError,
  createCorsPreflightResponse,
  standardCorsHeaders,
} from '../_shared/error-response.ts';
import { extractTracingContext } from '../_shared/tracing-context.ts';

// Deployment version tracking
const DEPLOY_VERSION = 'v27-dynamic-bootstrap-stages';

// CORS headers for frontend requests
const corsHeaders = standardCorsHeaders;

interface WorkflowStatusResponse {
  workflowId: string;
  organizationId?: string;
  status: 'running' | 'completed' | 'failed' | 'cancelled' | 'unknown';
  currentStage: string;
  stages: WorkflowStage[];
  error?: string;
  completedAt?: string;
  // Result data from events (P1 #4)
  domain?: string;
  dnsConfigured?: boolean;
  invitationsSent?: number;
}

interface WorkflowStage {
  name: string;
  status: 'pending' | 'in_progress' | 'completed' | 'failed';
  completedAt?: string;
  error?: string;
}

serve(async (req) => {
  // Extract tracing context from request headers (W3C traceparent + custom headers)
  const tracingContext = extractTracingContext(req);
  const correlationId = tracingContext.correlationId;
  console.log(`[workflow-status ${DEPLOY_VERSION}] Processing ${req.method} request, correlation_id=${correlationId}, trace_id=${tracingContext.traceId}`);

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
    env = validateEdgeFunctionEnv('workflow-status');
  } catch (error) {
    return createEnvErrorResponse('workflow-status', DEPLOY_VERSION, error.message, corsHeaders);
  }

  // This function requires service role key (not auto-set by Supabase)
  if (!env.SUPABASE_SERVICE_ROLE_KEY) {
    return createEnvErrorResponse('workflow-status', DEPLOY_VERSION, 'SUPABASE_SERVICE_ROLE_KEY is required', corsHeaders);
  }

  console.log(`[workflow-status ${DEPLOY_VERSION}] ✓ Environment variables validated`);

  try {
    // Initialize Supabase client with service role
    const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

    // Verify authorization (JWT token)
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return createUnauthorizedError(correlationId, corsHeaders, 'Missing authorization header');
    }

    console.log(`[workflow-status ${DEPLOY_VERSION}] ✓ Authorization header present`);

    const { data: { user }, error: authError } = await supabase.auth.getUser(
      authHeader.replace('Bearer ', '')
    );

    if (authError || !user) {
      console.error(`[workflow-status ${DEPLOY_VERSION}] Auth error:`, authError);
      return createUnauthorizedError(correlationId, corsHeaders, authError?.message || 'Unauthorized');
    }

    console.log(`[workflow-status ${DEPLOY_VERSION}] ✓ User authenticated: ${user.email}`);

    // Decode JWT payload to check access_blocked claim
    const token = authHeader.replace('Bearer ', '');
    const jwtParts = token.split('.');
    if (jwtParts.length === 3) {
      try {
        const jwtPayload: JWTPayload = JSON.parse(atob(jwtParts[1]));
        if (jwtPayload.access_blocked) {
          console.log(`[workflow-status ${DEPLOY_VERSION}] Access blocked for user ${user.id}: ${jwtPayload.access_block_reason || 'organization_deactivated'}`);
          return createUnauthorizedError(correlationId, corsHeaders, 'Access blocked: organization is deactivated');
        }
      } catch (_e) {
        // JWT decode failed — auth.getUser() already validated, proceed without claims check
        console.warn(`[workflow-status ${DEPLOY_VERSION}] Could not decode JWT payload for access_blocked check`);
      }
    }

    // Get workflow ID from request body
    let requestBody;
    try {
      requestBody = await req.json();
    } catch (parseError) {
      console.error(`[workflow-status ${DEPLOY_VERSION}] Failed to parse request body:`, parseError);
      return createValidationError('Invalid request body: Could not parse JSON', correlationId, corsHeaders);
    }

    const { workflowId } = requestBody;

    if (!workflowId) {
      return createValidationError('Missing workflowId parameter', correlationId, corsHeaders, 'workflowId');
    }

    console.log(`[workflow-status ${DEPLOY_VERSION}] ✓ workflowId: ${workflowId}`);

    // Query bootstrap status using the API wrapper function
    // Note: PostgREST only exposes 'api' schema, so we use the wrapper
    const { data: statusData, error: statusError } = await supabase
      .schema('api')
      .rpc('get_bootstrap_status', { p_bootstrap_id: workflowId });

    if (statusError) {
      console.error(`[workflow-status ${DEPLOY_VERSION}] RPC error:`, statusError);
      return handleRpcError(statusError, correlationId, corsHeaders, 'Get workflow status');
    }

    console.log(`[workflow-status ${DEPLOY_VERSION}] ✓ RPC returned ${statusData?.length || 0} rows`);

    if (!statusData || statusData.length === 0) {
      return createNotFoundError(`Workflow (id: ${workflowId})`, correlationId, corsHeaders);
    }

    const status = statusData[0];

    // Stages are built dynamically by the RPC from a CTE-based step manifest.
    // The workflow emits organization.bootstrap.step_completed events, and
    // the RPC reads them to build the stages array. No hardcoded list needed here.
    const stages: WorkflowStage[] = (status.stages || []).map(
      (stage: { name: string; key: string; status: string }) => ({
        name: stage.name,
        status: stage.status as WorkflowStage['status'],
      })
    );

    // Build response with result data from events (P1 #4)
    const response: WorkflowStatusResponse = {
      workflowId,
      organizationId: status.organization_id,
      status: status.status,
      currentStage: status.current_stage,
      stages,
      error: status.error_message,
      completedAt: status.completed_at,
      // Result data from events (populated by extended RPC)
      domain: status.domain || '',
      dnsConfigured: status.dns_configured ?? false,
      invitationsSent: status.invitations_sent ?? 0,
    };

    return new Response(
      JSON.stringify(response),
      {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );

  } catch (error) {
    console.error(`[workflow-status ${DEPLOY_VERSION}] Unhandled error:`, error);
    return createInternalError(correlationId, corsHeaders, error.message);
  }
});

