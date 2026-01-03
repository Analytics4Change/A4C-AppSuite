/**
 * Supabase Authentication Provider
 *
 * Production-ready authentication provider using Supabase Auth.
 * Works identically in development and production environments,
 * connecting to different Supabase projects.
 *
 * Features:
 * - OAuth authentication (Google, GitHub, etc.)
 * - Email/password authentication
 * - JWT token management with custom claims
 * - Automatic token refresh
 * - Organization switching with JWT regeneration
 * - Session persistence
 *
 * Usage:
 *   Automatically selected when VITE_SUPABASE_URL is set
 *   (unless VITE_FORCE_MOCK=true overrides to mock mode)
 *
 * See documentation/architecture/authentication/frontend-auth-architecture.md
 */

import { SupabaseClient, Session as SupabaseSession } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';
import { IAuthProvider } from './IAuthProvider';
import {
  Session,
  User,
  LoginCredentials,
  OAuthProvider,
  OAuthOptions,
  PermissionCheckResult,
  JWTClaims,
} from '@/types/auth.types';
import { getEnv } from '@/config/env-validation';
import { Logger } from '@/utils/logger';

const log = Logger.getLogger('api');

/**
 * Supabase auth provider configuration
 */
export interface SupabaseAuthConfig {
  supabaseUrl: string;
  supabaseAnonKey: string;
  debug?: boolean;
}

/**
 * Supabase authentication provider
 */
export class SupabaseAuthProvider implements IAuthProvider {
  private client: SupabaseClient;
  private config: SupabaseAuthConfig;
  private initialized: boolean = false;
  private currentSession: Session | null = null;

  constructor(config?: SupabaseAuthConfig) {
    // Use config or fall back to validated environment variables
    if (config) {
      this.config = config;
    } else {
      const env = getEnv();
      // Non-null assertions: constructor will throw if these are undefined
      this.config = {
        supabaseUrl: env.VITE_SUPABASE_URL!,
        supabaseAnonKey: env.VITE_SUPABASE_ANON_KEY!,
        debug: import.meta.env.DEV,
      };
    }

    if (!this.config.supabaseUrl || !this.config.supabaseAnonKey) {
      throw new Error(
        'Supabase configuration missing. Check VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY environment variables.'
      );
    }

    // Use the singleton Supabase client to avoid multiple GoTrueClient instances
    // This prevents "Multiple GoTrueClient instances detected" warnings and
    // ensures OAuth callbacks are handled correctly by a single client instance
    this.client = supabase;

    if (this.config.debug) {
      log.info('SupabaseAuthProvider initialized (using singleton client)', {
        url: this.config.supabaseUrl,
      });
    }
  }

  /**
   * Initialize the provider and check for existing session
   */
  async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }

    log.info('🔐 SupabaseAuthProvider: Initializing');

    try {
      // Check for existing session
      const { data, error } = await this.client.auth.getSession();

      if (error) {
        log.error('SupabaseAuthProvider: Failed to get session', error);
      } else if (data.session) {
        this.currentSession = this.convertSupabaseSession(data.session);
        log.info('✅ SupabaseAuthProvider: Existing session restored', {
          user: this.currentSession.user.email,
        });
      }

      // Set up auth state change listener
      this.client.auth.onAuthStateChange((event, session) => {
        if (this.config.debug) {
          log.debug('Auth state changed:', event);
        }

        if (session) {
          this.currentSession = this.convertSupabaseSession(session);
        } else {
          this.currentSession = null;
        }
      });

      this.initialized = true;
      log.info('✅ SupabaseAuthProvider: Initialization complete');
    } catch (error) {
      log.error('SupabaseAuthProvider: Initialization failed', error);
      throw error;
    }
  }

  /**
   * Check if provider is initialized
   */
  isInitialized(): boolean {
    return this.initialized;
  }

  /**
   * Login with email and password
   */
  async login(credentials: LoginCredentials): Promise<Session> {
    log.info('🔐 SupabaseAuthProvider: Login with email', credentials.email);

    const { data, error } = await this.client.auth.signInWithPassword({
      email: credentials.email,
      password: credentials.password,
    });

    if (error) {
      log.error('SupabaseAuthProvider: Login failed', error);
      throw new Error(`Authentication failed: ${error.message}`);
    }

    if (!data.session) {
      throw new Error('Authentication failed: No session returned');
    }

    this.currentSession = this.convertSupabaseSession(data.session);

    log.info('✅ SupabaseAuthProvider: Login successful', {
      user: this.currentSession.user.email,
    });

    return this.currentSession;
  }

  /**
   * Login with OAuth provider
   * Initiates OAuth flow (may redirect browser)
   */
  async loginWithOAuth(provider: OAuthProvider, options?: OAuthOptions): Promise<Session | void> {
    log.info('🔐 SupabaseAuthProvider: OAuth login with', provider);

    const { error } = await this.client.auth.signInWithOAuth({
      provider,
      options: {
        redirectTo: options?.redirectTo || window.location.origin + '/auth/callback',
        scopes: options?.scopes,
        queryParams: options?.queryParams,
      },
    });

    if (error) {
      log.error('SupabaseAuthProvider: OAuth login failed', error);
      throw new Error(`OAuth authentication failed: ${error.message}`);
    }

    // OAuth flow initiates redirect, so we don't return a session here
    // The session will be available after redirect via handleOAuthCallback
    log.info('🔐 SupabaseAuthProvider: OAuth redirect initiated');
    return;
  }

  /**
   * Handle OAuth callback after redirect
   */
  async handleOAuthCallback(_callbackUrl: string): Promise<Session> {
    log.info('🔐 SupabaseAuthProvider: Handling OAuth callback');

    // Supabase client automatically processes the callback
    // Just get the current session
    const { data, error } = await this.client.auth.getSession();

    if (error) {
      log.error('SupabaseAuthProvider: OAuth callback failed', error);
      throw new Error(`OAuth callback failed: ${error.message}`);
    }

    if (!data.session) {
      throw new Error('OAuth callback failed: No session found');
    }

    this.currentSession = this.convertSupabaseSession(data.session);

    log.info('✅ SupabaseAuthProvider: OAuth callback successful', {
      user: this.currentSession.user.email,
    });

    return this.currentSession;
  }

  /**
   * Logout the current user
   */
  async logout(): Promise<void> {
    log.info('🔐 SupabaseAuthProvider: Logging out');

    const { error } = await this.client.auth.signOut();

    if (error) {
      log.error('SupabaseAuthProvider: Logout failed', error);
      throw new Error(`Logout failed: ${error.message}`);
    }

    this.currentSession = null;
    log.info('✅ SupabaseAuthProvider: Logged out successfully');
  }

  /**
   * Get current session
   */
  async getSession(): Promise<Session | null> {
    // Return cached session if available
    if (this.currentSession) {
      return this.currentSession;
    }

    // Otherwise, fetch from Supabase
    const { data, error } = await this.client.auth.getSession();

    if (error) {
      log.error('SupabaseAuthProvider: Failed to get session', error);
      return null;
    }

    if (data.session) {
      this.currentSession = this.convertSupabaseSession(data.session);
    }

    return this.currentSession;
  }

  /**
   * Get current user
   */
  async getUser(): Promise<User | null> {
    const session = await this.getSession();
    return session?.user || null;
  }

  /**
   * Refresh the current session
   */
  async refreshSession(): Promise<Session> {
    log.info('🔐 SupabaseAuthProvider: Refreshing session');

    const { data, error } = await this.client.auth.refreshSession();

    if (error) {
      log.error('SupabaseAuthProvider: Session refresh failed', error);
      throw new Error(`Session refresh failed: ${error.message}`);
    }

    if (!data.session) {
      throw new Error('Session refresh failed: No session returned');
    }

    this.currentSession = this.convertSupabaseSession(data.session);

    log.info('✅ SupabaseAuthProvider: Session refreshed');

    return this.currentSession;
  }

  /**
   * Check if user has a specific permission
   */
  async hasPermission(permission: string): Promise<PermissionCheckResult> {
    const session = await this.getSession();

    if (!session) {
      return {
        hasPermission: false,
        reason: 'No active session',
      };
    }

    const hasPermission = session.claims.permissions.includes(permission);

    if (this.config.debug) {
      log.debug('SupabaseAuthProvider: Permission check', {
        permission,
        hasPermission,
        userPermissions: session.claims.permissions,
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
    const session = await this.getSession();

    if (!session) {
      return false;
    }

    const hasRole = session.claims.user_role === role;

    if (this.config.debug) {
      log.debug('SupabaseAuthProvider: Role check', {
        requestedRole: role,
        userRole: session.claims.user_role,
        hasRole,
      });
    }

    return hasRole;
  }

  /**
   * Switch user's active organization
   * Updates user_roles_projection and triggers JWT refresh
   */
  async switchOrganization(orgId: string): Promise<Session> {
    log.info('🔐 SupabaseAuthProvider: Switching organization to', orgId);

    if (!this.currentSession) {
      throw new Error('No active session');
    }

    // Call the Supabase function to update active organization
    // This should update user_roles_projection.is_active
    const { error } = await this.client.rpc('switch_active_organization', {
      new_org_id: orgId,
    });

    if (error) {
      log.error('SupabaseAuthProvider: Organization switch failed', error);
      throw new Error(`Failed to switch organization: ${error.message}`);
    }

    // Refresh session to get new JWT with updated org_id and permissions
    const refreshedSession = await this.refreshSession();

    log.info('✅ SupabaseAuthProvider: Organization switched', {
      newOrgId: refreshedSession.claims.org_id,
    });

    return refreshedSession;
  }

  /**
   * Convert Supabase session to our Session type with decoded JWT claims
   */
  private convertSupabaseSession(supabaseSession: SupabaseSession): Session {
    // Decode JWT to extract custom claims
    const claims = this.decodeJWT(supabaseSession.access_token);

    // Convert Supabase user to our User type
    const user: User = {
      id: supabaseSession.user.id,
      email: supabaseSession.user.email || '',
      name: supabaseSession.user.user_metadata?.name || supabaseSession.user.email,
      picture:
        supabaseSession.user.user_metadata?.picture ||
        supabaseSession.user.user_metadata?.avatar_url,
      provider: (supabaseSession.user.app_metadata?.provider as any) || 'email',
      user_metadata: supabaseSession.user.user_metadata,
      email_confirmed_at: supabaseSession.user.email_confirmed_at,
      created_at: supabaseSession.user.created_at,
    };

    return {
      access_token: supabaseSession.access_token,
      refresh_token: supabaseSession.refresh_token,
      token_type: 'Bearer',
      expires_in: supabaseSession.expires_in,
      expires_at: supabaseSession.expires_at,
      user,
      claims,
    };
  }

  /**
   * Decode JWT token to extract claims
   */
  private decodeJWT(token: string): JWTClaims {
    try {
      const payload = token.split('.')[1];
      const decoded = JSON.parse(globalThis.atob(payload));

      return {
        sub: decoded.sub,
        email: decoded.email,
        email_verified: decoded.email_verified,
        aal: decoded.aal,
        session_id: decoded.session_id,
        org_id: decoded.org_id || '',
        org_type: decoded.org_type || 'provider',
        user_role: decoded.user_role || 'viewer',
        permissions: decoded.permissions || [],
        scope_path: decoded.scope_path || '',
        iat: decoded.iat,
        exp: decoded.exp,
      };
    } catch (error) {
      log.error('Failed to decode JWT', error);
      throw new Error('Invalid JWT token');
    }
  }
}
