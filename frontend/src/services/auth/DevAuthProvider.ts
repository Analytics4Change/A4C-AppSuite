/**
 * Development Authentication Provider
 *
 * Mock authentication provider for local development that bypasses real
 * authentication for fast iteration. Returns hardcoded test user sessions
 * with complete JWT claims structure.
 *
 * Features:
 * - Instant "authentication" (no network calls)
 * - Configurable test user profiles
 * - Complete JWT claims for RLS testing
 * - Support for multiple test users
 * - Environment variable overrides
 *
 * Usage:
 *   Set VITE_AUTH_PROVIDER=mock in .env to use this provider
 *
 * See .plans/supabase-auth-integration/frontend-auth-architecture.md
 */

import { IAuthProvider } from './IAuthProvider';
import {
  Session,
  User,
  LoginCredentials,
  OAuthProvider,
  OAuthOptions,
  PermissionCheckResult,
} from '@/types/auth.types';
import {
  DevAuthConfig,
  createMockSession,
  getDevAuthConfig,
  DEV_USER_PROFILES,
} from '@/config/dev-auth.config';
import { Logger } from '@/utils/logger';

const log = Logger.getLogger('api');

/**
 * Mock authentication provider for development
 */
export class DevAuthProvider implements IAuthProvider {
  private config: DevAuthConfig;
  private currentSession: Session | null = null;
  private initialized: boolean = false;

  constructor(config?: DevAuthConfig) {
    this.config = config || getDevAuthConfig();

    if (this.config.debug) {
      log.info('DevAuthProvider initialized with config:', {
        profile: this.config.profile.name,
        role: this.config.profile.role,
        permissions: this.config.profile.permissions.length,
      });
    }
  }

  /**
   * Initialize the provider
   * Auto-login if configured
   */
  async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }

    log.info('🔧 DevAuthProvider: Initializing mock authentication');

    if (this.config.autoLogin) {
      // Auto-login with default profile
      this.currentSession = createMockSession(this.config.profile);
      log.info('✅ DevAuthProvider: Auto-logged in as', this.config.profile.email);
    }

    this.initialized = true;
  }

  /**
   * Check if provider is initialized
   */
  isInitialized(): boolean {
    return this.initialized;
  }

  /**
   * Mock login - instantly returns session for test user
   */
  async login(credentials: LoginCredentials): Promise<Session> {
    log.info('🔧 DevAuthProvider: Mock login for', credentials.email);

    // Simulate login delay if configured
    if (this.config.loginDelay && this.config.loginDelay > 0) {
      await new Promise((resolve) => setTimeout(resolve, this.config.loginDelay));
    }

    // Check if email matches a specific test profile
    const matchingProfile = Object.values(DEV_USER_PROFILES).find(
      (profile) => profile.email === credentials.email
    );

    const profile = matchingProfile || this.config.profile;
    this.currentSession = createMockSession(profile);

    log.info('✅ DevAuthProvider: Login successful', {
      user: profile.email,
      role: profile.role,
    });

    return this.currentSession;
  }

  /**
   * Mock OAuth login - instantly returns session
   * In real OAuth, this would initiate a redirect
   */
  async loginWithOAuth(provider: OAuthProvider, options?: OAuthOptions): Promise<Session> {
    log.info('🔧 DevAuthProvider: Mock OAuth login with', provider);

    // Simulate login delay if configured
    if (this.config.loginDelay && this.config.loginDelay > 0) {
      await new Promise((resolve) => setTimeout(resolve, this.config.loginDelay));
    }

    this.currentSession = createMockSession(this.config.profile);

    log.info('✅ DevAuthProvider: OAuth login successful');

    return this.currentSession;
  }

  /**
   * Mock logout - clears current session
   */
  async logout(): Promise<void> {
    log.info('🔧 DevAuthProvider: Mock logout');
    this.currentSession = null;
    log.info('✅ DevAuthProvider: Logged out successfully');
  }

  /**
   * Get current session
   */
  async getSession(): Promise<Session | null> {
    return this.currentSession;
  }

  /**
   * Get current user
   */
  async getUser(): Promise<User | null> {
    return this.currentSession?.user || null;
  }

  /**
   * Mock session refresh - returns current session with updated expiration
   */
  async refreshSession(): Promise<Session> {
    if (!this.currentSession) {
      throw new Error('No active session to refresh');
    }

    log.info('🔧 DevAuthProvider: Mock session refresh');

    // Update expiration times
    const now = Math.floor(Date.now() / 1000);
    const expiresIn = 3600;

    this.currentSession = {
      ...this.currentSession,
      expires_in: expiresIn,
      expires_at: now + expiresIn,
      claims: {
        ...this.currentSession.claims,
        iat: now,
        exp: now + expiresIn,
      },
    };

    log.info('✅ DevAuthProvider: Session refreshed');

    return this.currentSession;
  }

  /**
   * Check if user has a specific permission
   */
  async hasPermission(permission: string): Promise<PermissionCheckResult> {
    if (!this.currentSession) {
      return {
        hasPermission: false,
        reason: 'No active session',
      };
    }

    const hasPermission = this.currentSession.claims.permissions.includes(permission);

    if (this.config.debug) {
      log.debug('DevAuthProvider: Permission check', {
        permission,
        hasPermission,
        userPermissions: this.currentSession.claims.permissions,
      });
    }

    return {
      hasPermission,
      reason: hasPermission ? undefined : `Permission '${permission}' not granted`,
    };
  }

  /**
   * Check if user has a specific role
   */
  async hasRole(role: string): Promise<boolean> {
    if (!this.currentSession) {
      return false;
    }

    const hasRole = this.currentSession.claims.user_role === role;

    if (this.config.debug) {
      log.debug('DevAuthProvider: Role check', {
        requestedRole: role,
        userRole: this.currentSession.claims.user_role,
        hasRole,
      });
    }

    return hasRole;
  }

  /**
   * Mock organization switching
   * In real implementation, this would update database and trigger JWT refresh
   */
  async switchOrganization(orgId: string): Promise<Session> {
    if (!this.currentSession) {
      throw new Error('No active session');
    }

    log.info('🔧 DevAuthProvider: Mock organization switch to', orgId);

    // Update the session with new org context
    // In a real scenario, this would fetch new permissions for the org
    this.currentSession = {
      ...this.currentSession,
      claims: {
        ...this.currentSession.claims,
        org_id: orgId,
        // In mock mode, keep same permissions
        // In real mode, permissions would be fetched from database
      },
    };

    log.info('✅ DevAuthProvider: Organization switched');

    return this.currentSession;
  }

  /**
   * Mock OAuth callback handler
   * In mock mode, this just returns current session
   */
  async handleOAuthCallback(callbackUrl: string): Promise<Session> {
    log.info('🔧 DevAuthProvider: Mock OAuth callback', { callbackUrl });

    if (!this.currentSession) {
      // Create new session if none exists
      this.currentSession = createMockSession(this.config.profile);
    }

    return this.currentSession;
  }
}
