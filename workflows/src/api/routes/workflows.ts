/**
 * Workflow API Routes
 *
 * Handles workflow triggering via Temporal
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { Client, Connection } from '@temporalio/client';
import { authMiddleware, requirePermission } from '../middleware/auth.js';
import type { ContactInfo, AddressInfo, PhoneInfo } from '@shared/types/index.js';
import { getWorkflowsEnv } from '@shared/config/env-schema.js';
import { getSupabaseClient } from '@shared/utils/supabase.js';

// Get validated environment (FRONTEND_URL derived from PLATFORM_BASE_DOMAIN if not set)
const env = getWorkflowsEnv();
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
  organizationId: string;
  status: 'initiated';
}

/**
 * Organization Bootstrap Workflow Endpoint
 *
 * POST /api/v1/workflows/organization-bootstrap
 *
 * Flow (P1 #6 - corrected order):
 * 1. Validate request
 * 2. Generate organizationId
 * 3. Check organizationId doesn't already exist (P0 #1)
 * 4. Start Temporal workflow FIRST
 * 5. Emit organization.bootstrap.initiated event (after Temporal succeeds)
 * 6. Return organizationId to frontend
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

  // Generate organization ID - this single ID is used everywhere:
  // - As the stream_id for all events
  // - As the Temporal workflow ID suffix
  // - As the ID returned to the frontend for status polling
  const organizationId = crypto.randomUUID();

  // Get Supabase admin client for validation and event emission
  const supabaseAdmin = getSupabaseClient();

  // P0 #1: Validate organizationId doesn't already exist
  // (UUID collision is astronomically unlikely but validates precondition)
  const { data: existingById, error: idCheckError } = await supabaseAdmin
    .from('organizations_projection')
    .select('id')
    .eq('id', organizationId)
    .maybeSingle();

  if (idCheckError) {
    request.log.error({ error: idCheckError }, 'Failed to check organization ID');
    return reply.code(500).send({
      error: 'Failed to validate organization ID',
      details: idCheckError.message
    });
  }

  if (existingById) {
    request.log.warn({ organizationId }, 'UUID collision detected - should regenerate');
    return reply.code(409).send({
      error: 'Organization ID collision - please retry',
      retry: true
    });
  }

  request.log.info({
    organization_id: organizationId,
    subdomain: requestData.subdomain,
    user_id: request.user!.id,
    user_email: request.user!.email
  }, 'Starting organization bootstrap workflow');

  // P1 #6: Start Temporal workflow FIRST (before event emission)
  // This prevents orphaned events if Temporal fails to start
  let temporalWorkflowId: string;
  try {
    const connection = await Connection.connect({ address: temporalAddress });
    const client = new Client({ connection, namespace: temporalNamespace });

    // Use organizationId as part of the Temporal workflow ID for easy correlation
    temporalWorkflowId = `org-bootstrap-${organizationId}`;

    await client.workflow.start('organizationBootstrapWorkflow', {
      taskQueue: 'bootstrap',
      workflowId: temporalWorkflowId,
      args: [{
        organizationId,  // Pass organizationId so activities emit events with correct stream_id
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
    // Temporal failed - no event emitted, safe for frontend to retry
    const errorMessage = temporalError instanceof Error ? temporalError.message : 'Unknown error';
    request.log.error({ error: temporalError }, 'Failed to start Temporal workflow');
    return reply.code(500).send({
      error: 'Failed to start workflow',
      details: errorMessage
    });
  }

  // P1 #6: Emit event AFTER Temporal workflow started successfully
  // If this fails, the workflow is already running and will emit its own events
  const { error: eventError } = await supabaseAdmin
    .schema('api')
    .rpc('emit_domain_event', {
      p_stream_id: organizationId,
      p_stream_type: 'organization',
      p_stream_version: 1,
      p_event_type: 'organization.bootstrap.initiated',
      p_event_data: {
        subdomain: requestData.subdomain,
        orgData: requestData.orgData,
        users: requestData.users,
        temporal_workflow_id: temporalWorkflowId  // Include for traceability
      },
      p_event_metadata: {
        user_id: request.user!.id,
        organization_id: organizationId,
        initiated_by: request.user!.email,
        initiated_via: 'backend_api'
      }
    });

  if (eventError) {
    // Workflow started but event failed - log warning but don't fail request
    // Workflow will emit its own events as it progresses
    request.log.warn({ error: eventError }, 'Failed to emit bootstrap.initiated event (workflow running)');
  } else {
    request.log.info({
      organization_id: organizationId
    }, 'Bootstrap event emitted successfully');
  }

  // Return response - only organizationId (used for status polling)
  const response: BootstrapResponse = {
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
