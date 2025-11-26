/**
 * Invitation Service Factory
 *
 * Factory pattern for creating invitation service instances based on deployment configuration.
 * Uses VITE_APP_MODE to determine which implementation to instantiate.
 *
 * Usage:
 * ```typescript
 * import { InvitationServiceFactory } from '@/services/invitation/InvitationServiceFactory';
 *
 * // In ViewModel constructor (dependency injection with default)
 * constructor(
 *   private invitationService: IInvitationService = InvitationServiceFactory.create()
 * ) {
 *   makeAutoObservable(this);
 * }
 * ```
 *
 * Deployment Modes (via VITE_APP_MODE):
 * - mock: Uses MockInvitationService (localStorage simulation)
 * - integration-auth: Uses SupabaseInvitationService (real user creation, mock auth)
 * - production: Uses SupabaseInvitationService (real user creation, real auth)
 */

import { getDeploymentConfig, getAppMode } from '@/config/deployment.config';
import type { IInvitationService } from './IInvitationService';
import { MockInvitationService } from './MockInvitationService';
import { SupabaseInvitationService } from './SupabaseInvitationService';
import { Logger } from '@/utils/logger';

const log = Logger.getLogger('invitation');

/**
 * Factory for creating invitation service instances
 *
 * Singleton pattern - maintains single instance per implementation type
 */
export class InvitationServiceFactory {
  private static mockInstance: MockInvitationService | null = null;
  private static supabaseInstance: SupabaseInvitationService | null = null;

  /**
   * Create invitation service based on deployment configuration
   *
   * Returns singleton instances to ensure consistent state across the application.
   *
   * @returns IInvitationService implementation (Mock or Supabase)
   */
  static create(): IInvitationService {
    const config = getDeploymentConfig();

    if (config.useMockInvitation) {
      log.info('[InvitationServiceFactory] Using MockInvitationService', {
        mode: getAppMode()
      });

      if (!this.mockInstance) {
        this.mockInstance = new MockInvitationService();
      }

      return this.mockInstance;
    }

    log.info('[InvitationServiceFactory] Using SupabaseInvitationService', {
      mode: getAppMode()
    });

    if (!this.supabaseInstance) {
      this.supabaseInstance = new SupabaseInvitationService();
    }

    return this.supabaseInstance;
  }

  /**
   * Reset singleton instances (useful for testing)
   */
  static reset(): void {
    this.mockInstance = null;
    this.supabaseInstance = null;
    log.debug('InvitationServiceFactory instances reset');
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
    return getDeploymentConfig().useMockInvitation;
  }
}
