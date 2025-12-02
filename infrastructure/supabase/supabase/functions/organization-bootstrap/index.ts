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

// Deployment version tracking
const DEPLOY_VERSION = 'v2';

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
  console.log(`[organization-bootstrap ${DEPLOY_VERSION}] Processing ${req.method} request`);

  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  // Validate required environment variables
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY');

  // Backend API URL - this is the k8s service that connects to Temporal
  // Default to production URL, can be overridden for testing
  const backendApiUrl = Deno.env.get('BACKEND_API_URL') || 'https://api-a4c.firstovertheline.com';

  if (!supabaseUrl || !supabaseAnonKey) {
    console.error(`[organization-bootstrap ${DEPLOY_VERSION}] Missing required environment variables:`, {
      has_supabase_url: !!supabaseUrl,
      has_anon_key: !!supabaseAnonKey,
      version: DEPLOY_VERSION
    });
    return new Response(
      JSON.stringify({
        error: 'Server configuration error',
        details: 'Missing required environment variables',
        version: DEPLOY_VERSION
      }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    );
  }

  console.log(`[organization-bootstrap ${DEPLOY_VERSION}] ✓ Environment validated, Backend API: ${backendApiUrl}`);

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
    let requestData: BootstrapRequest;
    try {
      requestData = await req.json();
    } catch (parseError) {
      console.error(`[organization-bootstrap ${DEPLOY_VERSION}] Failed to parse request body:`, parseError);
      return new Response(
        JSON.stringify({
          error: 'Invalid request body',
          details: 'Could not parse JSON',
          version: DEPLOY_VERSION
        }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

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
          },
          version: DEPLOY_VERSION
        }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
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
      const apiResponse = await fetch(apiEndpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': authHeader,
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
        return new Response(
          JSON.stringify({
            error: 'Backend API error',
            details: responseData.error || responseData.message || 'Unknown error',
            backendStatus: apiResponse.status,
            version: DEPLOY_VERSION
          }),
          {
            status: apiResponse.status,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          }
        );
      }

      console.log(`[organization-bootstrap ${DEPLOY_VERSION}] ✓ Bootstrap initiated successfully:`, {
        workflowId: responseData.workflowId,
        organizationId: responseData.organizationId,
        user: user.email,
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
      console.error(`[organization-bootstrap ${DEPLOY_VERSION}] Failed to call Backend API:`, fetchError);
      return new Response(
        JSON.stringify({
          error: 'Failed to reach Backend API',
          details: fetchError.message,
          endpoint: apiEndpoint,
          version: DEPLOY_VERSION
        }),
        { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

  } catch (error) {
    console.error(`[organization-bootstrap ${DEPLOY_VERSION}] Unhandled error:`, error);
    return new Response(
      JSON.stringify({
        error: 'Internal server error',
        details: error.message,
        version: DEPLOY_VERSION
      }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
