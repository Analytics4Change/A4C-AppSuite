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
import {
  generateCorrelationId,
  handleRpcError,
  createValidationError,
  createNotFoundError,
  createUnauthorizedError,
  createInternalError,
  createCorsPreflightResponse,
  standardCorsHeaders,
} from '../_shared/error-response.ts';

// Deployment version tracking
const DEPLOY_VERSION = 'v24';

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
  // Generate correlation ID for request tracing
  const correlationId = generateCorrelationId();
  console.log(`[workflow-status ${DEPLOY_VERSION}] Processing ${req.method} request, correlation_id=${correlationId}`);

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

    // Map database status to workflow stages
    const stages: WorkflowStage[] = [
      {
        name: 'Initialize Organization',
        status: getStageStatus(status.current_stage, 'temporal_workflow_started'),
      },
      {
        name: 'Create Organization Record',
        status: getStageStatus(status.current_stage, 'organization_creation'),
      },
      {
        name: 'Create Contacts',
        status: getStageStatus(status.current_stage, 'contact_creation'),
      },
      {
        name: 'Create Addresses',
        status: getStageStatus(status.current_stage, 'address_creation'),
      },
      {
        name: 'Create Phones',
        status: getStageStatus(status.current_stage, 'phone_creation'),
      },
      {
        name: 'Create Program',
        status: getStageStatus(status.current_stage, 'program_creation'),
      },
      {
        name: 'Configure DNS',
        status: getStageStatus(status.current_stage, 'dns_provisioning'),
      },
      {
        name: 'Verify DNS',
        status: getStageStatus(status.current_stage, 'dns_verification'),
      },
      {
        name: 'Assign Admin Role',
        status: getStageStatus(status.current_stage, 'role_assignment'),
      },
      {
        name: 'Send Invitations',
        status: getStageStatus(status.current_stage, 'invitation_email'),
      },
      {
        name: 'Complete Bootstrap',
        status: getStageStatus(status.current_stage, 'completed'),
      },
    ];

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

/**
 * Determine stage status based on current workflow stage
 */
function getStageStatus(currentStage: string, stageName: string): 'pending' | 'in_progress' | 'completed' | 'failed' {
  const stageOrder = [
    'temporal_workflow_started',
    'organization_creation',
    'contact_creation',
    'address_creation',
    'phone_creation',
    'program_creation',
    'dns_provisioning',
    'dns_verification',
    'role_assignment',
    'invitation_email',
    'completed',
  ];

  const currentIndex = stageOrder.indexOf(currentStage);
  const stageIndex = stageOrder.indexOf(stageName);

  if (currentIndex < 0) {
    return 'pending'; // Unknown stage
  }

  if (stageIndex < currentIndex) {
    return 'completed';
  } else if (stageIndex === currentIndex) {
    // Special case: 'completed' is a terminal stage, not an in-progress stage
    // When we're AT the completed stage, the workflow IS completed
    if (stageName === 'completed') {
      return 'completed';
    }
    return 'in_progress';
  } else {
    return 'pending';
  }
}
