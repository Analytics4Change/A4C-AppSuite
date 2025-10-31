/**
 * Workflow Client Interface
 *
 * Abstracts workflow orchestration operations to enable dependency injection.
 * Implementations:
 * - MockWorkflowClient: localStorage-based simulation for development
 * - TemporalWorkflowClient: Production implementation via Supabase Edge Functions
 *
 * Factory Selection:
 * WorkflowClientFactory reads appConfig.workflow.useMock to select implementation.
 */

import type {
  OrganizationBootstrapParams,
  WorkflowStatus
} from '@/types/organization.types';

/**
 * Workflow client interface for organization bootstrap operations
 */
export interface IWorkflowClient {
  /**
   * Start organization bootstrap workflow
   *
   * @param params - Organization bootstrap parameters
   * @returns Workflow ID for status tracking
   * @throws Error if workflow cannot be started
   *
   * Event Emission:
   * - Does NOT directly insert into database
   * - Emits domain events that PostgreSQL triggers process
   * - Events update CQRS projections asynchronously
   */
  startBootstrapWorkflow(params: OrganizationBootstrapParams): Promise<string>;

  /**
   * Get current workflow status
   *
   * @param workflowId - Workflow identifier from startBootstrapWorkflow
   * @returns Current workflow status with progress steps
   * @throws Error if workflow not found
   *
   * Status Values:
   * - 'running': Workflow in progress
   * - 'completed': Successfully finished
   * - 'failed': Encountered error
   * - 'cancelled': User cancelled
   */
  getWorkflowStatus(workflowId: string): Promise<WorkflowStatus>;

  /**
   * Cancel running workflow
   *
   * @param workflowId - Workflow identifier to cancel
   * @returns True if cancellation initiated
   * @throws Error if workflow cannot be cancelled
   *
   * Note: Cancellation may not be immediate for Temporal workflows
   */
  cancelWorkflow(workflowId: string): Promise<boolean>;
}
