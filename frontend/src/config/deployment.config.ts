/**
 * Deployment Configuration with Smart Detection
 *
 * Automatically detects the runtime environment to determine service configuration.
 * Eliminates the need for manual VITE_APP_MODE configuration in most cases.
 *
 * Detection Logic:
 * - Supabase credentials present + not forcing mock → use real services
 * - Running on localhost → disable subdomain routing (subdomains don't work on localhost)
 * - Production build + not localhost → enable full subdomain routing
 *
 * Escape Hatch:
 * - VITE_FORCE_MOCK=true → Force mock mode even with credentials present
 */
import { Logger } from '@/utils/logger';

/**
 * Application mode type
 *
 * - 'mock': Using mock authentication and services
 * - 'real': Using real Supabase authentication and services
 */
export type AppMode = 'mock' | 'real';

const log = Logger.getLogger('config');

/**
 * Runtime environment detection results
 */
interface RuntimeEnvironment {
  hasSupabaseCredentials: boolean;
  isLocalhost: boolean;
  isProductionBuild: boolean;
  forceMock: boolean;
}

export interface DeploymentConfig {
  authProvider: 'mock' | 'supabase';
  useMockOrganization: boolean;
  useMockOrganizationUnit: boolean;
  useMockWorkflow: boolean;
  useMockInvitation: boolean;
  /** Whether to redirect users to org subdomains after login (requires real DNS) */
  enableSubdomainRouting: boolean;
}

/**
 * Check if running on localhost
 *
 * @returns true if hostname is localhost or 127.0.0.1
 */
export function isLocalhost(): boolean {
  if (typeof window === 'undefined') {
    return true; // SSR/Node context - assume localhost
  }
  const hostname = window.location.hostname;
  return hostname === 'localhost' || hostname === '127.0.0.1';
}

/**
 * Detect the runtime environment
 *
 * @returns Runtime environment detection results
 */
function detectEnvironment(): RuntimeEnvironment {
  return {
    hasSupabaseCredentials: !!import.meta.env.VITE_SUPABASE_URL,
    isLocalhost: isLocalhost(),
    isProductionBuild: import.meta.env.PROD === true,
    forceMock: import.meta.env.VITE_FORCE_MOCK === 'true',
  };
}

/**
 * Get deployment configuration based on smart environment detection
 *
 * Decision matrix:
 * - Credentials present + not forcing mock → real services
 * - Localhost → subdomain routing disabled
 * - Production build + not localhost → subdomain routing enabled
 *
 * @returns Deployment configuration
 */
export function getDeploymentConfig(): DeploymentConfig {
  const env = detectEnvironment();
  const useRealServices = env.hasSupabaseCredentials && !env.forceMock;

  // Only enable subdomain routing in production builds AND not on localhost
  // (subdomains like *.localhost don't resolve in browsers)
  const enableSubdomainRouting = env.isProductionBuild && !env.isLocalhost;

  const config: DeploymentConfig = {
    authProvider: useRealServices ? 'supabase' : 'mock',
    useMockOrganization: !useRealServices,
    useMockOrganizationUnit: !useRealServices,
    useMockWorkflow: !useRealServices,
    useMockInvitation: !useRealServices,
    enableSubdomainRouting,
  };

  log.info('Deployment config detected', {
    environment: env,
    config,
  });

  return config;
}

/**
 * Get a human-readable description of the current mode
 *
 * @returns 'mock' or 'real' based on detected environment
 */
export function getAppMode(): 'mock' | 'real' {
  const env = detectEnvironment();
  return (env.hasSupabaseCredentials && !env.forceMock) ? 'real' : 'mock';
}
