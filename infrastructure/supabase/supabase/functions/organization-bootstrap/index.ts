/**
 * Organization Bootstrap Edge Function
 *
 * This Edge Function initiates the organization bootstrap workflow via Temporal.
 * It's called by the frontend TemporalWorkflowClient to start the bootstrap process.
 *
 * CQRS-compliant: Emits domain events, delegates orchestration to Temporal
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// CORS headers for frontend requests
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

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

    // Extract JWT claims and verify permission
    const authToken = authHeader.replace('Bearer ', '');
    const { data: sessionData, error: sessionError } = await supabase.auth.getSession();

    if (sessionError) {
      console.error('[organization-bootstrap] Failed to get session:', sessionError);
      return new Response(
        JSON.stringify({ error: 'Failed to verify permissions' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Check for organization.create_root permission
    const permissions = sessionData.session?.app_metadata?.permissions || [];
    if (!permissions.includes('organization.create_root')) {
      console.error('[organization-bootstrap] Permission denied:', {
        user_id: user.id,
        user_email: user.email,
        permissions: permissions,
        required: 'organization.create_root'
      });

      return new Response(
        JSON.stringify({
          error: 'Forbidden: organization.create_root permission required to bootstrap organizations',
          required_permission: 'organization.create_root',
          user_permissions: permissions
        }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log('[organization-bootstrap] Permission check passed:', {
      user_id: user.id,
      user_email: user.email,
      permission: 'organization.create_root'
    });

    // Parse request body
    const requestData: BootstrapRequest = await req.json();

    // Validate required fields (AsyncAPI contract enforcement)
    if (!requestData.subdomain || !requestData.orgData || !requestData.users) {
      return new Response(
        JSON.stringify({
          error: 'Invalid request payload',
          details: 'Required fields: subdomain, orgData, users',
          received: {
            subdomain: !!requestData.subdomain,
            orgData: !!requestData.orgData,
            users: !!requestData.users
          }
        }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Generate IDs
    const workflowId = crypto.randomUUID();
    const organizationId = crypto.randomUUID();

    // Emit organization.bootstrap.initiated event
    // Event data matches AsyncAPI contract exactly
    const { error: eventError } = await supabase
      .from('domain_events')
      .insert({
        stream_id: organizationId,
        stream_type: 'organization',
        stream_version: 1,
        event_type: 'organization.bootstrap.initiated',
        event_data: {
          bootstrap_id: workflowId,
          subdomain: requestData.subdomain,
          orgData: requestData.orgData,
          users: requestData.users,
        },
        event_metadata: {
          user_id: user.id,
          organization_id: organizationId,
          initiated_by: user.email,
          initiated_via: 'edge_function',
        },
        created_at: new Date().toISOString(),
      });

    if (eventError) {
      console.error('Failed to emit bootstrap event:', eventError);
      return new Response(
        JSON.stringify({ error: 'Failed to initiate bootstrap', details: eventError.message }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // In production, this would invoke Temporal workflow via HTTP API
    // For now, we return the workflow ID for tracking
    const temporalAddress = Deno.env.get('TEMPORAL_ADDRESS') || 'temporal-frontend.temporal.svc.cluster.local:7233';

    // TODO: Invoke Temporal workflow via HTTP API
    // const temporalResponse = await fetch(`${temporalAddress}/api/v1/namespaces/default/workflows/${workflowId}`, {
    //   method: 'POST',
    //   headers: { 'Content-Type': 'application/json' },
    //   body: JSON.stringify({
    //     workflowId,
    //     workflowType: 'organizationBootstrap',
    //     taskQueue: 'bootstrap',
    //     input: requestData,
    //   }),
    // });

    console.log(`Bootstrap initiated: workflow_id=${workflowId}, org_id=${organizationId}, user=${user.email}`);

    // Return response
    const response: BootstrapResponse = {
      workflowId,
      organizationId,
      status: 'initiated',
    };

    return new Response(
      JSON.stringify(response),
      {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );

  } catch (error) {
    console.error('Bootstrap edge function error:', error);
    return new Response(
      JSON.stringify({ error: 'Internal server error', details: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
