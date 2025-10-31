/**
 * Deployment Mode Configuration
 *
 * Centralized mapping from deployment mode to service implementations.
 * Eliminates functional dependency between auth provider and organization service.
 *
 * Valid Modes:
 * - mock: All services mocked (fast local dev, offline capable)
 * - production: All services real (integration testing, production)
 *
 * Invalid Combinations Prevented:
 * - Mock auth + Real organization service (Edge Functions reject mock JWT)
 * - Real auth + Mock organization service (Data inconsistency)
 */

export type AppMode = 'mock' | 'production';

export interface DeploymentConfig {
  authProvider: 'mock' | 'supabase';
  useMockOrganization: boolean;
}

const DEPLOYMENT_CONFIGS: Record<AppMode, DeploymentConfig> = {
  mock: {
    authProvider: 'mock',
    useMockOrganization: true,
  },
  production: {
    authProvider: 'supabase',
    useMockOrganization: false,
  }
};

/**
 * Get deployment configuration based on VITE_APP_MODE
 *
 * Defaults to 'mock' in development, 'production' in production builds
 *
 * @throws Error if VITE_APP_MODE is invalid
 */
export function getDeploymentConfig(): DeploymentConfig {
  const mode = (import.meta.env.VITE_APP_MODE as AppMode) ||
               (import.meta.env.PROD ? 'production' : 'mock');

  const config = DEPLOYMENT_CONFIGS[mode];

  if (!config) {
    throw new Error(
      `Invalid VITE_APP_MODE: "${mode}". Must be 'mock' or 'production'.`
    );
  }

  console.log(`[Deployment] Mode: ${mode}`, config);

  return config;
}

/**
 * Get the current application mode
 *
 * @returns Current deployment mode
 */
export function getAppMode(): AppMode {
  return (import.meta.env.VITE_APP_MODE as AppMode) ||
         (import.meta.env.PROD ? 'production' : 'mock');
}
