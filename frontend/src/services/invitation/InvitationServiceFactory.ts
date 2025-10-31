/**
 * Invitation Service Factory
 *
 * Factory pattern for creating invitation service instances based on application configuration.
 * Reads appConfig.userCreation.useMock to determine which implementation to instantiate.
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
 * Configuration Profiles:
 * - full-mock: Uses MockInvitationService (localStorage simulation)
 * - mock-auth-real-api: Uses SupabaseInvitationService (real user creation)
 * - integration: Uses SupabaseInvitationService
 * - production: Uses SupabaseInvitationService
 */

import { appConfig } from '@/config/app.config';
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
   * Create invitation service based on application configuration
   *
   * Returns singleton instances to ensure consistent state across the application.
   *
   * @returns IInvitationService implementation (Mock or Supabase)
   */
  static create(): IInvitationService {
    if (appConfig.userCreation.useMock) {
      log.info('Using MockInvitationService (development mode)');

      if (!this.mockInstance) {
        this.mockInstance = new MockInvitationService();
      }

      return this.mockInstance;
    }

    log.info('Using SupabaseInvitationService (production mode)');

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
   * Get current configuration profile
   */
  static getCurrentProfile(): string {
    return appConfig.profile;
  }

  /**
   * Check if using mock implementation
   */
  static isMock(): boolean {
    return appConfig.userCreation.useMock;
  }
}
