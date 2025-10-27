/**
 * Authentication Provider Factory
 *
 * Factory function that creates the appropriate authentication provider
 * based on environment configuration. This is the single point of control
 * for switching between mock, integration, and production authentication modes.
 *
 * Configuration via VITE_AUTH_PROVIDER environment variable:
 * - "mock" - DevAuthProvider for fast local development
 * - "supabase" - SupabaseAuthProvider for integration testing and production
 *
 * Usage:
 *   const authProvider = createAuthProvider();
 *   await authProvider.initialize();
 *
 * See .plans/supabase-auth-integration/frontend-auth-architecture.md
 */

import { IAuthProvider } from './IAuthProvider';
import { DevAuthProvider } from './DevAuthProvider';
import { SupabaseAuthProvider } from './SupabaseAuthProvider';
import { getDevAuthConfig } from '@/config/dev-auth.config';
import { Logger } from '@/utils/logger';

const log = Logger.getLogger('api');

/**
 * Authentication provider types
 */
export type AuthProviderType = 'mock' | 'supabase';

/**
 * Get the configured authentication provider type
 */
export function getAuthProviderType(): AuthProviderType {
  const provider = import.meta.env.VITE_AUTH_PROVIDER as AuthProviderType;

  // Default to supabase in production, mock in development
  if (!provider) {
    return import.meta.env.PROD ? 'supabase' : 'mock';
  }

  return provider;
}

/**
 * Create and return the configured authentication provider
 *
 * @returns Initialized auth provider instance
 */
export function createAuthProvider(): IAuthProvider {
  const providerType = getAuthProviderType();

  switch (providerType) {
    case 'mock':
      log.info('🔧 Creating DevAuthProvider (mock authentication)');
      log.warn('⚠️  Using mock authentication - NOT for production!');
      return new DevAuthProvider(getDevAuthConfig());

    case 'supabase':
      log.info('🔐 Creating SupabaseAuthProvider (real authentication)');
      return new SupabaseAuthProvider({
        supabaseUrl: import.meta.env.VITE_SUPABASE_URL,
        supabaseAnonKey: import.meta.env.VITE_SUPABASE_ANON_KEY,
        debug: import.meta.env.DEV,
      });

    default:
      log.warn(`Unknown auth provider type: ${providerType}, defaulting to Supabase`);
      return new SupabaseAuthProvider({
        supabaseUrl: import.meta.env.VITE_SUPABASE_URL,
        supabaseAnonKey: import.meta.env.VITE_SUPABASE_ANON_KEY,
        debug: import.meta.env.DEV,
      });
  }
}

/**
 * Singleton auth provider instance
 * Ensures only one provider is created per application lifecycle
 */
let authProviderInstance: IAuthProvider | null = null;

/**
 * Get the singleton auth provider instance
 * Creates the provider on first call, returns cached instance on subsequent calls
 */
export function getAuthProvider(): IAuthProvider {
  if (!authProviderInstance) {
    authProviderInstance = createAuthProvider();
  }
  return authProviderInstance;
}

/**
 * Reset the auth provider instance (useful for testing)
 * CAUTION: Only use this in tests or when intentionally switching providers
 */
export function resetAuthProvider(): void {
  authProviderInstance = null;
}

/**
 * Check if mock authentication is active
 */
export function isMockAuth(): boolean {
  return getAuthProviderType() === 'mock';
}

/**
 * Get human-readable auth mode description
 */
export function getAuthModeDescription(): string {
  const providerType = getAuthProviderType();

  switch (providerType) {
    case 'mock':
      return 'Mock Authentication (Development Mode)';
    case 'supabase':
      return import.meta.env.PROD
        ? 'Supabase Authentication (Production)'
        : 'Supabase Authentication (Integration Testing)';
    default:
      return 'Unknown Authentication Mode';
  }
}

/**
 * Log current authentication configuration
 * Useful for debugging and ensuring correct provider is loaded
 */
export function logAuthConfig(): void {
  const mode = getAuthModeDescription();
  const provider = getAuthProviderType();

  log.info('='.repeat(60));
  log.info('Authentication Configuration');
  log.info('='.repeat(60));
  log.info(`Provider Type: ${provider}`);
  log.info(`Mode: ${mode}`);
  log.info(`Environment: ${import.meta.env.MODE}`);
  log.info(`Production: ${import.meta.env.PROD}`);

  if (provider === 'supabase') {
    log.info(`Supabase URL: ${import.meta.env.VITE_SUPABASE_URL}`);
    log.info(`Anon Key: ${import.meta.env.VITE_SUPABASE_ANON_KEY?.substring(0, 20)}...`);
  } else if (provider === 'mock') {
    const devConfig = getDevAuthConfig();
    log.info(`Mock Profile: ${devConfig.profile.name}`);
    log.info(`Mock Role: ${devConfig.profile.role}`);
    log.info(`Mock Org: ${devConfig.profile.org_name}`);
    log.info(`Auto-Login: ${devConfig.autoLogin}`);
  }

  log.info('='.repeat(60));
}
