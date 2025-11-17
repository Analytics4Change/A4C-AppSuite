/**
 * Mock Workflow Client Implementation
 *
 * Development-only workflow client that simulates Temporal workflow execution.
 * Uses localStorage to persist workflow state and simulate async operations.
 *
 * Features:
 * - Simulates workflow steps with realistic delays
 * - Persists workflow state to localStorage
 * - Provides instant feedback for development
 * - No external dependencies required
 *
 * Storage Keys:
 * - 'mock_workflows': Map<workflowId, WorkflowStatus>
 * - 'mock_workflow_counter': Auto-increment ID
 */

import type { IWorkflowClient } from './IWorkflowClient';
import type {
  OrganizationBootstrapParams,
  WorkflowStatus,
  OrganizationBootstrapResult
} from '@/types/organization.types';

/**
 * Storage keys for mock workflow persistence
 */
const STORAGE_KEYS = {
  WORKFLOWS: 'mock_workflows',
  COUNTER: 'mock_workflow_counter'
} as const;

/**
 * Workflow step definitions for simulation
 */
const WORKFLOW_STEPS = [
  'Creating organization record',
  'Configuring DNS subdomain',
  'Waiting for DNS propagation',
  'Creating admin user',
  'Sending invitation email',
  'Finalizing setup'
] as const;

/**
 * Mock workflow client for development mode
 *
 * Simulates Temporal workflow execution using localStorage.
 * NO database writes - all operations are event-based.
 */
export class MockWorkflowClient implements IWorkflowClient {
  /**
   * Start organization bootstrap workflow
   *
   * Simulates workflow execution with the following steps:
   * 1. Generate workflow ID
   * 2. Initialize workflow status
   * 3. Simulate async step execution
   * 4. Update progress in localStorage
   *
   * @param params - Organization bootstrap parameters
   * @returns Workflow ID for status tracking
   */
  async startBootstrapWorkflow(
    params: OrganizationBootstrapParams
  ): Promise<string> {
    // Generate unique workflow ID
    const workflowId = this.generateWorkflowId();

    // Initialize workflow status
    const initialStatus: WorkflowStatus = {
      workflowId,
      status: 'running',
      progress: WORKFLOW_STEPS.map((step) => ({
        step,
        completed: false
      }))
    };

    // Persist initial status
    this.saveWorkflowStatus(workflowId, initialStatus);

    // Simulate async workflow execution
    this.simulateWorkflowExecution(workflowId, params);

    return workflowId;
  }

  /**
   * Get current workflow status
   *
   * @param workflowId - Workflow identifier
   * @returns Current workflow status with progress
   * @throws Error if workflow not found
   */
  async getWorkflowStatus(workflowId: string): Promise<WorkflowStatus> {
    const workflows = this.loadWorkflows();
    const status = workflows.get(workflowId);

    if (!status) {
      throw new Error(`Workflow not found: ${workflowId}`);
    }

    return status;
  }

  /**
   * Cancel running workflow
   *
   * @param workflowId - Workflow identifier to cancel
   * @returns True if cancellation successful
   */
  async cancelWorkflow(workflowId: string): Promise<boolean> {
    const workflows = this.loadWorkflows();
    const status = workflows.get(workflowId);

    if (!status) {
      throw new Error(`Workflow not found: ${workflowId}`);
    }

    if (status.status !== 'running') {
      return false; // Already completed or failed
    }

    // Update status to cancelled
    status.status = 'cancelled';
    this.saveWorkflowStatus(workflowId, status);

    return true;
  }

  /**
   * Generate unique workflow ID
   */
  private generateWorkflowId(): string {
    const counter = this.getNextCounter();
    return `mock-workflow-${Date.now()}-${counter}`;
  }

  /**
   * Get and increment workflow counter
   */
  private getNextCounter(): number {
    const current = parseInt(
      localStorage.getItem(STORAGE_KEYS.COUNTER) || '0',
      10
    );
    const next = current + 1;
    localStorage.setItem(STORAGE_KEYS.COUNTER, next.toString());
    return next;
  }

  /**
   * Load all workflows from localStorage
   */
  private loadWorkflows(): Map<string, WorkflowStatus> {
    const json = localStorage.getItem(STORAGE_KEYS.WORKFLOWS);
    if (!json) {
      return new Map();
    }

    try {
      const data = JSON.parse(json);
      return new Map(Object.entries(data));
    } catch {
      return new Map();
    }
  }

  /**
   * Save workflow status to localStorage
   */
  private saveWorkflowStatus(
    workflowId: string,
    status: WorkflowStatus
  ): void {
    const workflows = this.loadWorkflows();
    workflows.set(workflowId, status);

    const obj = Object.fromEntries(workflows);
    localStorage.setItem(STORAGE_KEYS.WORKFLOWS, JSON.stringify(obj));
  }

  /**
   * Simulate workflow execution with realistic delays
   *
   * Executes steps sequentially with delays to simulate real workflow behavior.
   * Updates localStorage after each step for realistic polling experience.
   *
   * @param workflowId - Workflow identifier
   * @param params - Bootstrap parameters
   */
  private async simulateWorkflowExecution(
    workflowId: string,
    params: OrganizationBootstrapParams
  ): Promise<void> {
    // Execute steps with delays
    for (let i = 0; i < WORKFLOW_STEPS.length; i++) {
      // Wait 1-2 seconds per step for realistic simulation
      await this.delay(1000 + Math.random() * 1000);

      // Check if workflow was cancelled
      const currentStatus = await this.getWorkflowStatus(workflowId);
      if (currentStatus.status === 'cancelled') {
        return;
      }

      // Mark step as completed
      currentStatus.progress[i].completed = true;

      // Update status
      if (i === WORKFLOW_STEPS.length - 1) {
        // Final step - mark as completed
        currentStatus.status = 'completed';
        currentStatus.result = this.generateMockResult(params);
      }

      this.saveWorkflowStatus(workflowId, currentStatus);
    }
  }

  /**
   * Generate mock workflow result that echoes back actual input data
   *
   * Returns realistic-looking data based on user input instead of synthetic values.
   * This provides better development UX by showing data that matches what was entered.
   *
   * Enhanced for Part B: Uses new contacts array structure.
   */
  private generateMockResult(
    params: OrganizationBootstrapParams
  ): OrganizationBootstrapResult {
    // Generate org ID from organization name (slugified + timestamp for uniqueness)
    const orgSlug = params.orgData.name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
    const orgId = `org-${orgSlug}-${Date.now()}`;

    // Build domain from actual subdomain (if provided)
    const domain = params.subdomain ? `${params.subdomain}.a4c.app` : 'a4c.app';
    const dnsConfigured = Boolean(params.subdomain);

    // Provider admin is always the last contact in the array
    // (Providers: billing + providerAdmin, Partners: providerAdmin only)
    const providerAdminContact = params.contacts[params.contacts.length - 1];

    return {
      orgId,
      organizationName: params.orgData.name,
      subdomain: params.subdomain,
      domain,
      dnsConfigured,
      adminUser: {
        email: providerAdminContact.email,
        firstName: providerAdminContact.firstName,
        lastName: providerAdminContact.lastName,
        role: 'provider_admin'
      },
      invitationsSent: params.contacts.length, // One invitation per contact
      createdAt: new Date().toISOString()
    };
  }

  /**
   * Delay utility for simulating async operations
   */
  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
