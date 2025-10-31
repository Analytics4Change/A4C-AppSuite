/**
 * Temporal Workflow Client Implementation
 *
 * Production workflow client that communicates with Temporal via Supabase Edge Functions.
 * This client does NOT directly interact with Temporal - all operations go through
 * authenticated Edge Functions that emit domain events.
 *
 * Architecture:
 * Frontend → Supabase Edge Function → Temporal API → Domain Events → PostgreSQL Triggers
 *
 * Edge Functions:
 * - /organization-bootstrap: Start bootstrap workflow
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
import { Logger } from '@/utils/logger';

const log = Logger.getLogger('workflow');

/**
 * Supabase Edge Function endpoints for workflow operations
 */
const EDGE_FUNCTIONS = {
  START_BOOTSTRAP: 'organization-bootstrap',
  GET_STATUS: 'workflow-status',
  CANCEL_WORKFLOW: 'workflow-cancel'
} as const;

/**
 * Production workflow client using Temporal via Supabase Edge Functions
 *
 * Event-Driven Architecture:
 * - NO direct database inserts/updates
 * - All state changes via domain events
 * - PostgreSQL triggers update CQRS projections
 */
export class TemporalWorkflowClient implements IWorkflowClient {
  /**
   * Start organization bootstrap workflow
   *
   * Flow:
   * 1. Call Supabase Edge Function
   * 2. Edge Function starts Temporal workflow
   * 3. Workflow emits domain events
   * 4. PostgreSQL triggers update projections
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
   * @throws Error if Edge Function call fails
   */
  async startBootstrapWorkflow(
    params: OrganizationBootstrapParams
  ): Promise<string> {
    try {
      log.info('Starting organization bootstrap workflow', {
        subdomain: params.subdomain,
        orgType: params.orgData.type
      });

      const client = supabaseService.getClient();
      const { data, error } = await client.functions.invoke(
        EDGE_FUNCTIONS.START_BOOTSTRAP,
        {
          body: params
        }
      );

      if (error) {
        log.error('Failed to start bootstrap workflow', error);
        throw new Error(`Failed to start workflow: ${error.message}`);
      }

      if (!data?.workflowId) {
        throw new Error('Invalid response from workflow service');
      }

      log.info('Bootstrap workflow started', {
        workflowId: data.workflowId
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
