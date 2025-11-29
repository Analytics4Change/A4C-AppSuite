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
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    // Initialize Supabase client with service role
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Verify authorization (JWT token)
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: 'Missing authorization header' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const { data: { user }, error: authError } = await supabase.auth.getUser(
      authHeader.replace('Bearer ', '')
    );

    if (authError || !user) {
      return new Response(
        JSON.stringify({ error: 'Unauthorized' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Get workflow ID from request body
    const { workflowId } = await req.json();

    if (!workflowId) {
      return new Response(
        JSON.stringify({ error: 'Missing workflowId parameter' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Query bootstrap status using the existing PostgreSQL function
    const { data: statusData, error: statusError } = await supabase
      .rpc('get_bootstrap_status', { p_bootstrap_id: workflowId });

    if (statusError) {
      console.error('Failed to get bootstrap status:', statusError);
      return new Response(
        JSON.stringify({ error: 'Failed to get workflow status', details: statusError.message }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (!statusData || statusData.length === 0) {
      return new Response(
        JSON.stringify({ error: 'Workflow not found', workflowId }),
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
    console.error('Workflow status edge function error:', error);
    return new Response(
      JSON.stringify({ error: 'Internal server error', details: error.message }),
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
