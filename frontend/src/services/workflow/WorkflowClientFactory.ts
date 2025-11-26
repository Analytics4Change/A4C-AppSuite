/**
 * Workflow Client Factory
 *
 * Factory pattern for creating workflow client instances based on deployment configuration.
 * Uses VITE_APP_MODE to determine which implementation to instantiate.
 *
 * Usage:
 * ```typescript
 * import { WorkflowClientFactory } from '@/services/workflow/WorkflowClientFactory';
 *
 * // In ViewModel constructor (dependency injection with default)
 * constructor(
 *   private workflowClient: IWorkflowClient = WorkflowClientFactory.create()
 * ) {
 *   makeAutoObservable(this);
 * }
 * ```
 *
 * Deployment Modes (via VITE_APP_MODE):
 * - mock: Uses MockWorkflowClient (localStorage simulation)
 * - integration-auth: Uses TemporalWorkflowClient (real workflows, mock auth)
 * - production: Uses TemporalWorkflowClient (real workflows, real auth)
 */

import { getDeploymentConfig, getAppMode } from '@/config/deployment.config';
import type { IWorkflowClient } from './IWorkflowClient';
import { MockWorkflowClient } from './MockWorkflowClient';
import { TemporalWorkflowClient } from './TemporalWorkflowClient';
import { Logger } from '@/utils/logger';

const log = Logger.getLogger('workflow');

/**
 * Factory for creating workflow client instances
 *
 * Singleton pattern - maintains single instance per implementation type
 */
export class WorkflowClientFactory {
  private static mockInstance: MockWorkflowClient | null = null;
  private static temporalInstance: TemporalWorkflowClient | null = null;

  /**
   * Create workflow client based on deployment configuration
   *
   * Returns singleton instances to ensure consistent state across the application.
   *
   * @returns IWorkflowClient implementation (Mock or Temporal)
   */
  static create(): IWorkflowClient {
    const config = getDeploymentConfig();

    if (config.useMockWorkflow) {
      log.info('[WorkflowClientFactory] Using MockWorkflowClient', {
        mode: getAppMode()
      });

      if (!this.mockInstance) {
        this.mockInstance = new MockWorkflowClient();
      }

      return this.mockInstance;
    }

    log.info('[WorkflowClientFactory] Using TemporalWorkflowClient', {
      mode: getAppMode()
    });

    if (!this.temporalInstance) {
      this.temporalInstance = new TemporalWorkflowClient();
    }

    return this.temporalInstance;
  }

  /**
   * Reset singleton instances (useful for testing)
   */
  static reset(): void {
    this.mockInstance = null;
    this.temporalInstance = null;
    log.debug('WorkflowClientFactory instances reset');
  }

  /**
   * Get current deployment mode
   */
  static getCurrentMode(): string {
    return getAppMode();
  }

  /**
   * Check if using mock implementation
   */
  static isMock(): boolean {
    return getDeploymentConfig().useMockWorkflow;
  }
}
