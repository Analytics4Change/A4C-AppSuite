/**
 * Authentication Context
 *
 * Provides authentication state and operations to the entire application.
 * Uses dependency injection with IAuthProvider interface to support
 * multiple authentication backends (mock, Supabase, etc.).
 *
 * The actual provider implementation is determined by VITE_APP_MODE
 * environment variable and created by AuthProviderFactory.
 *
 * Usage:
 *   const { isAuthenticated, user, login, logout } = useAuth();
 *
 * See .plans/supabase-auth-integration/frontend-auth-architecture.md
 */

import React, { createContext, useState, useContext, ReactNode, useEffect } from 'react';
import { IAuthProvider } from '@/services/auth/IAuthProvider';
import { getAuthProvider, logAuthConfig } from '@/services/auth/AuthProviderFactory';
import { getDeploymentConfig } from '@/config/deployment.config';
import {
  User,
  Session,
  AuthState,
  LoginCredentials,
  OAuthProvider,
  OAuthOptions,
  UserRole,
} from '@/types/auth.types';
import { Logger } from '@/utils/logger';

const log = Logger.getLogger('main');

/**
 * Authentication context interface
 * Exposed to all components via useAuth() hook
 */
interface AuthContextType {
  /** Current authentication state */
  isAuthenticated: boolean;
  user: User | null;
  session: Session | null;
  loading: boolean;
  error: Error | null;

  /** Authentication operations */
  login: (credentials: LoginCredentials) => Promise<void>;
  loginWithOAuth: (provider: OAuthProvider, options?: OAuthOptions) => Promise<void>;
  handleOAuthCallback: (callbackUrl: string) => Promise<void>;
  logout: () => Promise<void>;
  refreshSession: () => Promise<void>;

  /** Permission and role checks */
  hasPermission: (permission: string) => Promise<boolean>;
  hasRole: (role: UserRole) => boolean;

  /** Organization management */
  switchOrganization: (orgId: string) => Promise<void>;

  /** Provider information */
  providerType: 'mock' | 'supabase';
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

/**
 * useAuth hook
 * Provides access to authentication context in any component
 */
// eslint-disable-next-line react-refresh/only-export-components -- Hook exported with provider is standard context pattern
export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};

interface AuthProviderProps {
  children: ReactNode;
  /** Optional: Inject custom auth provider (useful for testing) */
  authProvider?: IAuthProvider;
}

/**
 * AuthProvider component
 * Wraps the application and provides authentication context
 */
export const AuthProvider: React.FC<AuthProviderProps> = ({ children, authProvider: injectedProvider }) => {
  // Get auth provider (injected or from factory)
  const authProvider = injectedProvider || getAuthProvider();

  // Authentication state
  const [authState, setAuthState] = useState<AuthState>({
    isAuthenticated: false,
    user: null,
    session: null,
    loading: true,
    error: null,
  });

  // Initialize auth provider on mount
  useEffect(() => {
    const initializeAuth = async () => {
      try {
        log.info('AuthProvider: Initializing authentication');
        logAuthConfig();

        // Initialize the provider
        await authProvider.initialize();

        // Check for existing session
        const session = await authProvider.getSession();

        if (session) {
          log.info('AuthProvider: Existing session found', {
            user: session.user.email,
            role: session.claims.user_role,
          });

          setAuthState({
            isAuthenticated: true,
            user: session.user,
            session,
            loading: false,
            error: null,
          });
        } else {
          log.info('AuthProvider: No existing session');
          setAuthState({
            isAuthenticated: false,
            user: null,
            session: null,
            loading: false,
            error: null,
          });
        }
      } catch (error) {
        log.error('AuthProvider: Initialization failed', error);
        setAuthState({
          isAuthenticated: false,
          user: null,
          session: null,
          loading: false,
          error: error as Error,
        });
      }
    };

    initializeAuth();
  }, [authProvider]);

  /**
   * Login with email and password
   */
  const login = async (credentials: LoginCredentials): Promise<void> => {
    try {
      setAuthState((prev) => ({ ...prev, loading: true, error: null }));

      log.info('AuthProvider: Login attempt', { email: credentials.email });
      const session = await authProvider.login(credentials);

      setAuthState({
        isAuthenticated: true,
        user: session.user,
        session,
        loading: false,
        error: null,
      });

      log.info('AuthProvider: Login successful', {
        user: session.user.email,
        role: session.claims.user_role,
      });
    } catch (error) {
      log.error('AuthProvider: Login failed', error);
      setAuthState((prev) => ({
        ...prev,
        loading: false,
        error: error as Error,
      }));
      throw error;
    }
  };

  /**
   * Login with OAuth provider
   */
  const loginWithOAuth = async (provider: OAuthProvider, options?: OAuthOptions): Promise<void> => {
    try {
      setAuthState((prev) => ({ ...prev, loading: true, error: null }));

      log.info('AuthProvider: OAuth login attempt', { provider });
      const result = await authProvider.loginWithOAuth(provider, options);

      // If result is a session, update state
      // If void, OAuth redirect has been initiated
      if (result) {
        setAuthState({
          isAuthenticated: true,
          user: result.user,
          session: result,
          loading: false,
          error: null,
        });

        log.info('AuthProvider: OAuth login successful', {
          user: result.user.email,
          role: result.claims.user_role,
        });
      } else {
        // OAuth redirect initiated, keep loading state
        log.info('AuthProvider: OAuth redirect initiated');
      }
    } catch (error) {
      log.error('AuthProvider: OAuth login failed', error);
      setAuthState((prev) => ({
        ...prev,
        loading: false,
        error: error as Error,
      }));
      throw error;
    }
  };

  /**
   * Handle OAuth callback
   * Called by AuthCallback page after OAuth redirect
   */
  const handleOAuthCallback = async (callbackUrl: string): Promise<void> => {
    try {
      setAuthState((prev) => ({ ...prev, loading: true, error: null }));

      log.info('AuthProvider: Processing OAuth callback');
      const session = await authProvider.handleOAuthCallback(callbackUrl);

      setAuthState({
        isAuthenticated: true,
        user: session.user,
        session,
        loading: false,
        error: null,
      });

      log.info('AuthProvider: OAuth callback processed successfully', {
        user: session.user.email,
        role: session.claims.user_role,
      });
    } catch (error) {
      log.error('AuthProvider: OAuth callback processing failed', error);
      setAuthState((prev) => ({
        ...prev,
        loading: false,
        error: error as Error,
      }));
      throw error;
    }
  };

  /**
   * Logout current user
   */
  const logout = async (): Promise<void> => {
    try {
      setAuthState((prev) => ({ ...prev, loading: true }));

      log.info('AuthProvider: Logout');
      await authProvider.logout();

      setAuthState({
        isAuthenticated: false,
        user: null,
        session: null,
        loading: false,
        error: null,
      });

      log.info('AuthProvider: Logout successful');
    } catch (error) {
      log.error('AuthProvider: Logout failed', error);
      setAuthState((prev) => ({
        ...prev,
        loading: false,
        error: error as Error,
      }));
      throw error;
    }
  };

  /**
   * Refresh current session
   */
  const refreshSession = async (): Promise<void> => {
    try {
      log.info('AuthProvider: Refreshing session');
      const session = await authProvider.refreshSession();

      setAuthState((prev) => ({
        ...prev,
        session,
        user: session.user,
      }));

      log.info('AuthProvider: Session refreshed');
    } catch (error) {
      log.error('AuthProvider: Session refresh failed', error);
      // If refresh fails, logout user
      await logout();
      throw error;
    }
  };

  /**
   * Check if user has a specific permission
   */
  const hasPermission = async (permission: string): Promise<boolean> => {
    const result = await authProvider.hasPermission(permission);
    return result.hasPermission;
  };

  /**
   * Check if user has a specific role
   */
  const hasRole = (role: UserRole): boolean => {
    return authState.session?.claims.user_role === role;
  };

  /**
   * Switch user's active organization
   */
  const switchOrganization = async (orgId: string): Promise<void> => {
    try {
      setAuthState((prev) => ({ ...prev, loading: true }));

      log.info('AuthProvider: Switching organization', { orgId });
      const session = await authProvider.switchOrganization(orgId);

      setAuthState((prev) => ({
        ...prev,
        session,
        user: session.user,
        loading: false,
      }));

      log.info('AuthProvider: Organization switched', {
        orgId: session.claims.org_id,
        orgName: session.claims.scope_path,
      });
    } catch (error) {
      log.error('AuthProvider: Organization switch failed', error);
      setAuthState((prev) => ({
        ...prev,
        loading: false,
        error: error as Error,
      }));
      throw error;
    }
  };

  // Context value
  const contextValue: AuthContextType = {
    isAuthenticated: authState.isAuthenticated,
    user: authState.user,
    session: authState.session,
    loading: authState.loading,
    error: authState.error,
    login,
    loginWithOAuth,
    handleOAuthCallback,
    logout,
    refreshSession,
    hasPermission,
    hasRole,
    switchOrganization,
    providerType: getDeploymentConfig().authProvider,
  };

  return <AuthContext.Provider value={contextValue}>{children}</AuthContext.Provider>;
};
