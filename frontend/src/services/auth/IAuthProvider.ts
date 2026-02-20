/**
 * Authentication Provider Interface
 *
 * This interface defines the contract for all authentication providers
 * in the application. It enables dependency injection and allows seamless
 * switching between mock authentication (for fast local development) and
 * real Supabase authentication (for integration testing and production).
 *
 * Implementations:
 * - DevAuthProvider: Mock authentication for local development
 * - SupabaseAuthProvider: Real Supabase Auth for integration testing and production
 *
 * See .plans/supabase-auth-integration/frontend-auth-architecture.md
 */

import {
  Session,
  User,
  LoginCredentials,
  OAuthProvider,
  OAuthOptions,
  PermissionCheckResult,
} from '@/types/auth.types';

/**
 * Core authentication provider interface
 *
 * All authentication providers must implement this interface to ensure
 * consistent behavior across mock, integration, and production modes.
 */
export interface IAuthProvider {
  /**
   * Authenticate user with email and password
   *
   * @param credentials - Email and password
   * @returns Promise resolving to authenticated session
   * @throws Error if authentication fails
   */
  login(credentials: LoginCredentials): Promise<Session>;

  /**
   * Authenticate user with OAuth provider
   *
   * @param provider - OAuth provider (google, github, etc.)
   * @param options - OAuth options (redirect URL, scopes, etc.)
   * @returns Promise resolving to authenticated session (or initiates redirect)
   * @throws Error if OAuth flow fails
   */
  loginWithOAuth(provider: OAuthProvider, options?: OAuthOptions): Promise<Session | void>;

  /**
   * Log out the current user
   *
   * Clears session data and revokes tokens.
   * @returns Promise resolving when logout is complete
   */
  logout(): Promise<void>;

  /**
   * Get the current authentication session
   *
   * Returns null if no active session exists.
   * @returns Promise resolving to current session or null
   */
  getSession(): Promise<Session | null>;

  /**
   * Get the current authenticated user
   *
   * Returns null if no user is authenticated.
   * @returns Promise resolving to current user or null
   */
  getUser(): Promise<User | null>;

  /**
   * Refresh the current session
   *
   * Obtains a new access token using the refresh token.
   * Updates the session with new token and expiration.
   *
   * @returns Promise resolving to refreshed session
   * @throws Error if refresh fails (user must re-login)
   */
  refreshSession(): Promise<Session>;

  /**
   * Send a password reset email
   *
   * @precondition None (public operation, no session required)
   * @postcondition If account exists, reset email sent; no error either way (security)
   * @param email - Email address to send reset link to
   * @throws Never throws for non-existent emails (prevents enumeration)
   */
  sendPasswordResetEmail(email: string): Promise<void>;

  /**
   * Update the current user's password
   *
   * @precondition Active recovery session (from PASSWORD_RECOVERY event)
   * @postcondition Password updated, session remains active (caller should logout)
   * @param newPassword - New password (min 6 chars)
   * @throws Error if no active session, password too short, or update fails
   */
  updatePassword(newPassword: string): Promise<void>;

  /**
   * Exchange a PKCE authorization code for a session
   *
   * @precondition Valid PKCE code from URL params (e.g., password reset or OAuth redirect)
   * @postcondition Session established with valid access/refresh tokens
   * @param code - The PKCE authorization code from URL query parameters
   * @returns Promise resolving to authenticated session
   * @throws Error if code is invalid, expired, or code_verifier cookie is missing
   */
  exchangeCodeForSession(code: string): Promise<Session>;

  /**
   * Check if the current user has a specific permission
   *
   * Permission strings follow the applet.action pattern:
   * - "medication.create"
   * - "client.view"
   * - "organization.manage"
   *
   * Checks effective_permissions for a matching entry. When targetPath
   * is provided, also verifies scope containment (ltree @> semantics).
   *
   * @param permission - Permission string to check
   * @param targetPath - Optional ltree path to check scope containment against
   * @returns Promise resolving to permission check result
   */
  hasPermission(permission: string, targetPath?: string): Promise<PermissionCheckResult>;

  /**
   * Cleanup provider resources (subscriptions, timers)
   *
   * Called when the auth context unmounts or provider changes.
   * Implementations should unsubscribe from Realtime channels,
   * clear timers, etc.
   */
  dispose(): void;

  /**
   * Switch the user's active organization context
   *
   * Updates the session to reflect the new organization, triggers JWT refresh
   * to include new org_id and effective_permissions claims.
   *
   * For users with multiple organization memberships, this changes which
   * organization's data they can access.
   *
   * @param orgId - Organization ID to switch to
   * @returns Promise resolving to updated session with new org context
   * @throws Error if user doesn't have access to the organization
   */
  switchOrganization(orgId: string): Promise<Session>;

  /**
   * Handle OAuth callback after redirect
   *
   * Processes the OAuth callback URL and exchanges code for session.
   * Should be called on the OAuth redirect page.
   *
   * @param callbackUrl - Full URL with OAuth code/state parameters
   * @returns Promise resolving to authenticated session
   * @throws Error if callback processing fails
   */
  handleOAuthCallback(callbackUrl: string): Promise<Session>;

  /**
   * Initialize the provider
   *
   * Performs any necessary setup (e.g., checking for existing session,
   * setting up listeners, etc.). Should be called once during app startup.
   *
   * @returns Promise resolving when initialization is complete
   */
  initialize(): Promise<void>;

  /**
   * Check if the provider is initialized and ready to use
   *
   * @returns Boolean indicating initialization status
   */
  isInitialized(): boolean;
}

/**
 * Authentication provider configuration
 *
 * Base configuration interface that all providers can extend
 * with their specific configuration needs.
 */
export interface AuthProviderConfig {
  /** Provider type identifier */
  type: 'mock' | 'supabase' | 'auth0' | 'okta';

  /** Optional custom configuration */
  [key: string]: any;
}
