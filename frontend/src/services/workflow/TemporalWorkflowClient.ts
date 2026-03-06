/**
 * Temporal Workflow Client Implementation
 *
 * Production workflow client that communicates with Temporal via Edge Functions.
 * All three operations route through Supabase Edge Functions, which handle
 * authentication, permission validation, and forwarding to the Backend API.
 *
 * Architecture (3-hop):
 * Frontend → Edge Function (auth + forwarding) → Backend API (k8s) → Temporal
 *
 * Edge Functions:
 * - organization-bootstrap: Start bootstrap workflow
 * - workflow-status: Get workflow status
 * - workflow-cancel: Cancel running workflow
 *
 * All operations are event-driven - NO direct database writes.
 */

import type { IWorkflowClient } from './IWorkflowClient';
import type { OrganizationBootstrapParams, WorkflowStatus } from '@/types/organization.types';
import { supabaseService } from '@/services/auth/supabase.service';
import { Logger } from '@/utils/logger';
import { extractEdgeFunctionError } from '@/utils/edge-function-errors';

const log = Logger.getLogger('workflow');

/**
 * Edge Function endpoints for workflow operations
 */
const EDGE_FUNCTIONS = {
  BOOTSTRAP: 'organization-bootstrap',
  GET_STATUS: 'workflow-status',
  CANCEL_WORKFLOW: 'workflow-cancel',
} as const;

/**
 * Production workflow client using Temporal via Edge Functions
 *
 * Event-Driven Architecture:
 * - NO direct database inserts/updates
 * - All state changes via domain events
 * - PostgreSQL triggers update CQRS projections
 *
 * Edge Functions run in Supabase (Deno Deploy) and forward to the Backend API,
 * which runs inside the k8s cluster and can access Temporal directly.
 */
export class TemporalWorkflowClient implements IWorkflowClient {
  /**
   * Start organization bootstrap workflow
   *
   * Flow:
   * 1. Call Edge Function (handles JWT validation + permission check)
   * 2. Edge Function forwards to Backend API
   * 3. Backend API starts Temporal workflow
   * 4. Workflow emits domain events
   * 5. PostgreSQL triggers update projections
   *
   * Events Emitted (by Temporal activities):
   * - OrganizationCreated
   * - ProgramCreated
   * - ContactCreated
   * - AddressCreated
   * - PhoneCreated
   * - UserInvited
   *
   * @param params - Organization bootstrap parameters
   * @returns Organization ID for status tracking
   * @throws Error if Edge Function call fails or user not authenticated
   */
  async startBootstrapWorkflow(params: OrganizationBootstrapParams): Promise<string> {
    try {
      log.info('Starting organization bootstrap workflow', {
        subdomain: params.subdomain,
        orgType: params.orgData.type,
      });

      const client = supabaseService.getClient();
      const { data, error } = await client.functions.invoke(EDGE_FUNCTIONS.BOOTSTRAP, {
        body: params,
      });

      if (error) {
        const extracted = await extractEdgeFunctionError(error, 'Start bootstrap workflow');
        const correlationRef = extracted.correlationId ? ` (Ref: ${extracted.correlationId})` : '';
        throw new Error(`Failed to start workflow: ${extracted.message}${correlationRef}`);
      }

      // API returns organizationId (unified ID system)
      if (!data?.organizationId) {
        throw new Error('Invalid response from workflow service');
      }

      log.info('Bootstrap workflow started', {
        organizationId: data.organizationId,
      });

      // Return organizationId - this is now the single ID used for everything:
      // - Status polling (stream_id in events)
      // - Temporal workflow ID suffix
      // - Route parameter
      return data.organizationId;
    } catch (error) {
      log.error('Error starting bootstrap workflow', error);
      throw error;
    }
  }

  /**
   * Get current workflow status
   *
   * Queries workflow execution state via Edge Function.
   * Edge Function calls Temporal API to get current status.
   *
   * @param workflowId - Workflow identifier
   * @returns Current workflow status with progress
   * @throws Error if workflow not found or API call fails
   */
  async getWorkflowStatus(workflowId: string): Promise<WorkflowStatus> {
    try {
      log.debug('Fetching workflow status', { workflowId });

      const client = supabaseService.getClient();
      const { data, error } = await client.functions.invoke(EDGE_FUNCTIONS.GET_STATUS, {
        body: { workflowId },
      });

      if (error) {
        const extracted = await extractEdgeFunctionError(error, 'Fetch workflow status');
        const correlationRef = extracted.correlationId ? ` (Ref: ${extracted.correlationId})` : '';
        throw new Error(`Failed to fetch status: ${extracted.message}${correlationRef}`);
      }

      if (!data?.status) {
        throw new Error('Invalid workflow status response');
      }

      // Transform Edge Function response to WorkflowStatus type
      // Edge Function returns: { stages: [...], status, workflowId, organizationId, domain, dnsConfigured, invitationsSent, ... }
      // Frontend expects: { progress: [...], status, workflowId, organizationId, result? }
      const transformedStatus: WorkflowStatus = {
        // Backwards compatibility: workflowId equals organizationId in unified ID system
        workflowId: data.workflowId || data.organizationId,
        // Primary ID in unified system
        organizationId: data.organizationId || data.workflowId,
        status: data.status === 'unknown' ? 'failed' : data.status,
        progress: (data.stages || []).map(
          (stage: { name: string; status: string; error?: string }) => ({
            step: stage.name,
            completed: stage.status === 'completed',
            error: stage.error,
          })
        ),
        // Workflow failure error message (from Edge Function's status.error_message)
        error: data.error || undefined,
        // Result populated with data from events (domain, dnsConfigured, invitationsSent)
        result: data.organizationId
          ? {
              orgId: data.organizationId,
              domain: data.domain || '',
              dnsConfigured: data.dnsConfigured ?? false,
              invitationsSent: data.invitationsSent ?? 0,
            }
          : undefined,
      };

      return transformedStatus;
    } catch (error) {
      log.error('Error fetching workflow status', error);
      throw error;
    }
  }

  /**
   * Cancel running workflow
   *
   * Sends cancellation request to Temporal via Edge Function.
   * Cancellation may not be immediate - workflow will complete
   * current activity before stopping.
   *
   * @param workflowId - Workflow identifier to cancel
   * @returns True if cancellation initiated
   * @throws Error if cancellation fails
   */
  async cancelWorkflow(workflowId: string): Promise<boolean> {
    try {
      log.info('Cancelling workflow', { workflowId });

      const client = supabaseService.getClient();
      const { data, error } = await client.functions.invoke(EDGE_FUNCTIONS.CANCEL_WORKFLOW, {
        body: { workflowId },
      });

      if (error) {
        const extracted = await extractEdgeFunctionError(error, 'Cancel workflow');
        const correlationRef = extracted.correlationId ? ` (Ref: ${extracted.correlationId})` : '';
        throw new Error(`Failed to cancel: ${extracted.message}${correlationRef}`);
      }

      const success = data?.cancelled === true;
      log.info(success ? 'Workflow cancelled' : 'Workflow cancellation failed', { workflowId });

      return success;
    } catch (error) {
      log.error('Error cancelling workflow', error);
      throw error;
    }
  }
}
