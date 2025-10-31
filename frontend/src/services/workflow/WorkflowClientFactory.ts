/**
 * Workflow Client Factory
 *
 * Factory pattern for creating workflow client instances based on application configuration.
 * Reads appConfig.workflow.useMock to determine which implementation to instantiate.
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
 * Configuration Profiles:
 * - full-mock: Uses MockWorkflowClient (localStorage simulation)
 * - mock-auth-real-api: Uses TemporalWorkflowClient (real workflows)
 * - integration: Uses TemporalWorkflowClient
 * - production: Uses TemporalWorkflowClient
 */

import { appConfig } from '@/config/app.config';
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
   * Create workflow client based on application configuration
   *
   * Returns singleton instances to ensure consistent state across the application.
   *
   * @returns IWorkflowClient implementation (Mock or Temporal)
   */
  static create(): IWorkflowClient {
    if (appConfig.workflow.useMock) {
      log.info('Using MockWorkflowClient (development mode)');

      if (!this.mockInstance) {
        this.mockInstance = new MockWorkflowClient();
      }

      return this.mockInstance;
    }

    log.info('Using TemporalWorkflowClient (production mode)');

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
   * Get current configuration profile
   */
  static getCurrentProfile(): string {
    return appConfig.profile;
  }

  /**
   * Check if using mock implementation
   */
  static isMock(): boolean {
    return appConfig.workflow.useMock;
  }
}
