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

// Deployment version tracking
const DEPLOY_VERSION = 'v21';

// CORS headers for frontend requests
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface WorkflowStatusResponse {
  workflowId: string;
  organizationId?: string;
  status: 'running' | 'completed' | 'failed' | 'cancelled' | 'unknown';
  currentStage: string;
  stages: WorkflowStage[];
  error?: string;
  completedAt?: string;
}

interface WorkflowStage {
  name: string;
  status: 'pending' | 'in_progress' | 'completed' | 'failed';
  completedAt?: string;
  error?: string;
}

serve(async (req) => {
  console.log(`[workflow-status ${DEPLOY_VERSION}] Processing ${req.method} request`);

  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
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
      return new Response(
        JSON.stringify({ error: 'Missing authorization header', version: DEPLOY_VERSION }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`[workflow-status ${DEPLOY_VERSION}] ✓ Authorization header present`);

    const { data: { user }, error: authError } = await supabase.auth.getUser(
      authHeader.replace('Bearer ', '')
    );

    if (authError || !user) {
      console.error(`[workflow-status ${DEPLOY_VERSION}] Auth error:`, authError);
      return new Response(
        JSON.stringify({ error: 'Unauthorized', details: authError?.message, version: DEPLOY_VERSION }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`[workflow-status ${DEPLOY_VERSION}] ✓ User authenticated: ${user.email}`);

    // Get workflow ID from request body
    let requestBody;
    try {
      requestBody = await req.json();
    } catch (parseError) {
      console.error(`[workflow-status ${DEPLOY_VERSION}] Failed to parse request body:`, parseError);
      return new Response(
        JSON.stringify({
          error: 'Invalid request body',
          details: 'Could not parse JSON',
          version: DEPLOY_VERSION,
          step: 'body_parse'
        }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const { workflowId } = requestBody;

    if (!workflowId) {
      return new Response(
        JSON.stringify({ error: 'Missing workflowId parameter', version: DEPLOY_VERSION }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`[workflow-status ${DEPLOY_VERSION}] ✓ workflowId: ${workflowId}`);

    // Query bootstrap status using the API wrapper function
    // Note: PostgREST only exposes 'api' schema, so we use the wrapper
    const { data: statusData, error: statusError } = await supabase
      .schema('api')
      .rpc('get_bootstrap_status', { p_bootstrap_id: workflowId });

    if (statusError) {
      console.error(`[workflow-status ${DEPLOY_VERSION}] RPC error:`, statusError);
      return new Response(
        JSON.stringify({
          error: 'Failed to get workflow status',
          details: statusError.message,
          version: DEPLOY_VERSION,
          step: 'rpc_call'
        }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`[workflow-status ${DEPLOY_VERSION}] ✓ RPC returned ${statusData?.length || 0} rows`);

    if (!statusData || statusData.length === 0) {
      return new Response(
        JSON.stringify({ error: 'Workflow not found', workflowId, version: DEPLOY_VERSION }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
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
        name: 'Create Admin Contact',
        status: getStageStatus(status.current_stage, 'contact_creation'),
      },
      {
        name: 'Create Billing Address',
        status: getStageStatus(status.current_stage, 'address_creation'),
      },
      {
        name: 'Create Billing Phone',
        status: getStageStatus(status.current_stage, 'phone_creation'),
      },
      {
        name: 'Create Program',
        status: getStageStatus(status.current_stage, 'program_creation'),
      },
      {
        name: 'Provision DNS (Subdomain)',
        status: getStageStatus(status.current_stage, 'dns_provisioning'),
      },
      {
        name: 'Assign Admin Role',
        status: getStageStatus(status.current_stage, 'role_assignment'),
      },
      {
        name: 'Send Invitation Email',
        status: getStageStatus(status.current_stage, 'invitation_email'),
      },
      {
        name: 'Complete Bootstrap',
        status: getStageStatus(status.current_stage, 'completed'),
      },
    ];

    // Build response
    const response: WorkflowStatusResponse = {
      workflowId,
      organizationId: status.organization_id,
      status: status.status,
      currentStage: status.current_stage,
      stages,
      error: status.error_message,
      completedAt: status.completed_at,
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
    return new Response(
      JSON.stringify({
        error: 'Internal server error',
        details: error.message,
        version: DEPLOY_VERSION,
        step: 'unhandled_exception'
      }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
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
    return 'in_progress';
  } else {
    return 'pending';
  }
}
