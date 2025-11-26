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

// Deployment version tracking (injected by CI/CD)
const DEPLOY_VERSION = Deno.env.get('GIT_COMMIT_SHA')?.substring(0, 8) || 'dev-local';

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
  console.log(`[organization-bootstrap v${DEPLOY_VERSION}] Processing ${req.method} request`);

  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  // Validate required environment variables
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY');

  if (!supabaseUrl || !supabaseServiceKey || !supabaseAnonKey) {
    console.error('[organization-bootstrap] Missing required environment variables:', {
      has_supabase_url: !!supabaseUrl,
      has_service_role_key: !!supabaseServiceKey,
      has_anon_key: !!supabaseAnonKey
    });
    return new Response(
      JSON.stringify({
        error: 'Server configuration error',
        details: 'Missing required environment variables'
      }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    );
  }

  try {

    // Verify authorization (JWT token)
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
    interface JWTPayload {
      permissions?: string[];
      org_id?: string;
      user_role?: string;
      scope_path?: string;
      sub?: string;
      email?: string;
    }

    let jwtPayload: JWTPayload;
    try {
      jwtPayload = JSON.parse(atob(jwtParts[1]));
    } catch (_e) {
      return new Response(
        JSON.stringify({ error: 'Failed to decode JWT token' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
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
      return new Response(
        JSON.stringify({ error: 'Unauthorized' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Extract custom claims from JWT payload (not from user.app_metadata!)
    // The JWT hook adds claims directly to the token payload, accessible here via jwtPayload
    const permissions = jwtPayload.permissions || [];
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

    // Create service role client for database operations (bypasses RLS)
    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

    // Emit organization.bootstrap.initiated event via API wrapper
    // Event data matches AsyncAPI contract exactly
    // Uses api.emit_domain_event() wrapper to avoid PostgREST schema restrictions
    const { data: _eventId, error: eventError } = await supabaseAdmin
      .schema('api')
      .rpc('emit_domain_event', {
        p_stream_id: organizationId,
        p_stream_type: 'organization',
        p_stream_version: 1,
        p_event_type: 'organization.bootstrap.initiated',
        p_event_data: {
          bootstrap_id: workflowId,
          subdomain: requestData.subdomain,
          orgData: requestData.orgData,
          users: requestData.users,
        },
        p_event_metadata: {
          user_id: user.id,
          organization_id: organizationId,
          initiated_by: user.email,
          initiated_via: 'edge_function',
        }
      });

    if (eventError) {
      console.error('Failed to emit bootstrap event:', eventError);
      return new Response(
        JSON.stringify({
          error: 'Failed to initiate bootstrap',
          details: eventError.message,
          version: DEPLOY_VERSION
        }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`Bootstrap event emitted successfully: event_id=${_eventId}, workflow_id=${workflowId}, org_id=${organizationId}`);

    // NOTE: Temporal workflow is triggered by PostgreSQL NOTIFY listener
    // Event listener watches domain_events table and starts workflow automatically
    // See: documentation/infrastructure/reference/events/organization-bootstrap-workflow-started.md

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
