/**
 * Temporal Workflow Client Implementation
 *
 * Production workflow client that communicates with Temporal via the Backend API.
 * This client does NOT directly interact with Temporal - all operations go through
 * the authenticated Backend API service running inside the k8s cluster.
 *
 * Architecture (2-hop):
 * Frontend → Backend API (k8s) → Temporal → Domain Events → PostgreSQL Triggers
 *
 * Backend API Endpoints:
 * - POST /api/v1/workflows/organization-bootstrap: Start bootstrap workflow
 *
 * Legacy Edge Functions (for operations not yet migrated):
 * - /workflow-status: Get workflow status
 * - /workflow-cancel: Cancel running workflow
 *
 * All operations are event-driven - NO direct database writes.
 */

import type { IWorkflowClient } from './IWorkflowClient';
import type {
  OrganizationBootstrapParams,
  WorkflowStatus
} from '@/types/organization.types';
import { supabaseService } from '@/services/auth/supabase.service';
import { getBackendApiUrl } from '@/lib/backend-api';
import { Logger } from '@/utils/logger';

const log = Logger.getLogger('workflow');

/**
 * Backend API endpoints for workflow operations
 */
const API_ENDPOINTS = {
  ORGANIZATION_BOOTSTRAP: '/api/v1/workflows/organization-bootstrap'
} as const;

/**
 * Legacy Edge Function endpoints (for operations not yet migrated to Backend API)
 */
const EDGE_FUNCTIONS = {
  GET_STATUS: 'workflow-status',
  CANCEL_WORKFLOW: 'workflow-cancel'
} as const;

/**
 * Production workflow client using Temporal via Backend API
 *
 * Event-Driven Architecture:
 * - NO direct database inserts/updates
 * - All state changes via domain events
 * - PostgreSQL triggers update CQRS projections
 *
 * The Backend API runs inside the k8s cluster and can access Temporal directly.
 * Edge Functions cannot reach Temporal (runs in Deno Deploy, external to cluster).
 */
export class TemporalWorkflowClient implements IWorkflowClient {
  /**
   * Start organization bootstrap workflow
   *
   * Flow:
   * 1. Get JWT token from current Supabase session
   * 2. Call Backend API with authenticated request
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
   * @returns Workflow ID for status tracking
   * @throws Error if Backend API call fails or user not authenticated
   */
  async startBootstrapWorkflow(
    params: OrganizationBootstrapParams
  ): Promise<string> {
    try {
      log.info('Starting organization bootstrap workflow', {
        subdomain: params.subdomain,
        orgType: params.orgData.type
      });

      // Get Backend API URL (validates based on deployment mode)
      const apiUrl = getBackendApiUrl();
      if (!apiUrl) {
        throw new Error(
          'Backend API not available in current mode. ' +
          'Workflow operations require production or integration-auth mode.'
        );
      }

      // Get current session for JWT token
      const client = supabaseService.getClient();
      const { data: { session }, error: sessionError } = await client.auth.getSession();

      if (sessionError) {
        log.error('Failed to get session', sessionError);
        throw new Error(`Authentication error: ${sessionError.message}`);
      }

      if (!session?.access_token) {
        throw new Error('Authentication required to start workflow');
      }

      // Call Backend API
      const response = await fetch(
        `${apiUrl}${API_ENDPOINTS.ORGANIZATION_BOOTSTRAP}`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${session.access_token}`
          },
          body: JSON.stringify(params)
        }
      );

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        const errorMessage = errorData.error || `HTTP ${response.status}: ${response.statusText}`;
        log.error('Backend API error', { status: response.status, error: errorData });
        throw new Error(`Failed to start workflow: ${errorMessage}`);
      }

      const data = await response.json();

      if (!data?.workflowId) {
        throw new Error('Invalid response from workflow service');
      }

      log.info('Bootstrap workflow started', {
        workflowId: data.workflowId,
        organizationId: data.organizationId
      });

      return data.workflowId;
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
      const { data, error } = await client.functions.invoke(
        EDGE_FUNCTIONS.GET_STATUS,
        {
          body: { workflowId }
        }
      );

      if (error) {
        log.error('Failed to fetch workflow status', error);
        throw new Error(`Failed to fetch status: ${error.message}`);
      }

      if (!data?.status) {
        throw new Error('Invalid workflow status response');
      }

      return data as WorkflowStatus;
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
      const { data, error } = await client.functions.invoke(
        EDGE_FUNCTIONS.CANCEL_WORKFLOW,
        {
          body: { workflowId }
        }
      );

      if (error) {
        log.error('Failed to cancel workflow', error);
        throw new Error(`Failed to cancel: ${error.message}`);
      }

      const success = data?.cancelled === true;
      log.info(
        success ? 'Workflow cancelled' : 'Workflow cancellation failed',
        { workflowId }
      );

      return success;
    } catch (error) {
      log.error('Error cancelling workflow', error);
      throw error;
    }
  }
}
