/**
 * Workflow API Routes
 *
 * Handles workflow triggering via Temporal
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { Client, Connection } from '@temporalio/client';
import { createClient } from '@supabase/supabase-js';
import { authMiddleware, requirePermission } from '../middleware/auth.js';
import type { ContactInfo, AddressInfo, PhoneInfo } from '@shared/types/index.js';
import { getWorkflowsEnv } from '@shared/config/env-schema.js';

// Get validated environment (FRONTEND_URL derived from PLATFORM_BASE_DOMAIN if not set)
const env = getWorkflowsEnv();
const supabaseUrl = env.SUPABASE_URL;
const supabaseServiceKey = env.SUPABASE_SERVICE_ROLE_KEY;
const temporalAddress = env.TEMPORAL_ADDRESS;
const temporalNamespace = env.TEMPORAL_NAMESPACE;
const frontendUrl = env.FRONTEND_URL;

/**
 * Organization user invitation structure (API-specific, role is string for flexibility)
 */
interface OrganizationUser {
  email: string;
  firstName: string;
  lastName: string;
  role: string;
}

/**
 * Organization bootstrap request payload
 */
interface BootstrapRequest {
  subdomain: string;
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

/**
 * Organization Bootstrap Workflow Endpoint
 *
 * POST /api/v1/workflows/organization-bootstrap
 */
async function bootstrapOrganizationHandler(
  request: FastifyRequest<{ Body: BootstrapRequest }>,
  reply: FastifyReply
): Promise<void> {
  const requestData = request.body;

  // Validate required fields
  if (!requestData.subdomain || !requestData.orgData || !requestData.users) {
    return reply.code(400).send({
      error: 'Invalid request payload',
      details: 'Required fields: subdomain, orgData, users',
      received: {
        subdomain: !!requestData.subdomain,
        orgData: !!requestData.orgData,
        users: !!requestData.users
      }
    });
  }

  // Generate IDs
  const workflowId = crypto.randomUUID();
  const organizationId = crypto.randomUUID();

  request.log.info({
    workflow_id: workflowId,
    organization_id: organizationId,
    subdomain: requestData.subdomain,
    user_id: request.user!.id,
    user_email: request.user!.email
  }, 'Starting organization bootstrap workflow');

  // Create Supabase admin client for event emission
  const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

  // Emit organization.bootstrap.initiated event
  const { error: eventError } = await supabaseAdmin
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
        users: requestData.users
      },
      p_event_metadata: {
        user_id: request.user!.id,
        organization_id: organizationId,
        initiated_by: request.user!.email,
        initiated_via: 'backend_api'
      }
    });

  if (eventError) {
    request.log.error({ error: eventError }, 'Failed to emit bootstrap event');
    return reply.code(500).send({
      error: 'Failed to initiate bootstrap',
      details: eventError.message
    });
  }

  request.log.info({
    workflow_id: workflowId,
    organization_id: organizationId
  }, 'Bootstrap event emitted successfully');

  // Start Temporal workflow
  try {
    const connection = await Connection.connect({ address: temporalAddress });
    const client = new Client({ connection, namespace: temporalNamespace });

    const temporalWorkflowId = `org-bootstrap-${requestData.subdomain}-${Date.now()}`;

    await client.workflow.start('organizationBootstrapWorkflow', {
      taskQueue: 'bootstrap',
      workflowId: temporalWorkflowId,
      args: [{
        subdomain: requestData.subdomain,
        orgData: requestData.orgData,
        users: requestData.users,
        frontendUrl  // Pass FRONTEND_URL from env to workflow
      }]
    });

    request.log.info({
      temporal_workflow_id: temporalWorkflowId,
      organization_id: organizationId,
      user_email: request.user!.email
    }, 'Temporal workflow started successfully');

    // Close connection
    await connection.close();

  } catch (temporalError) {
    const errorMessage = temporalError instanceof Error ? temporalError.message : 'Unknown error';
    request.log.error({ error: temporalError }, 'Failed to start Temporal workflow');
    return reply.code(500).send({
      error: 'Failed to start workflow',
      details: errorMessage
    });
  }

  // Return response
  const response: BootstrapResponse = {
    workflowId,
    organizationId,
    status: 'initiated'
  };

  void reply.code(200).send(response);
}

/**
 * Register workflow routes
 */
export function registerWorkflowRoutes(server: FastifyInstance): void {
  server.post<{ Body: BootstrapRequest }>(
    '/api/v1/workflows/organization-bootstrap',
    {
      preHandler: [authMiddleware, requirePermission('organization.create_root')]
    },
    bootstrapOrganizationHandler
  );
}
