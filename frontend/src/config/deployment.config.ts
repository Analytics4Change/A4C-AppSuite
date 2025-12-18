/**
 * Deployment Mode Configuration
 *
 * Centralized mapping from deployment mode to service implementations.
 * Single source of truth for all mock vs production decisions.
 *
 * Valid Modes:
 * - mock: All services mocked (fast local dev, offline capable)
 * - integration-auth: Mock auth but real workflows/invitations (for workflow testing)
 * - production: All services real (integration testing, production)
 *
 * Invalid Combinations Prevented:
 * - Mock auth + Real organization service (Edge Functions reject mock JWT)
 * - Real auth + Mock organization service (Data inconsistency)
 */
import { Logger } from '@/utils/logger';

const log = Logger.getLogger('config');

export type AppMode = 'mock' | 'integration-auth' | 'production';

export interface DeploymentConfig {
  authProvider: 'mock' | 'supabase';
  useMockOrganization: boolean;
  useMockOrganizationUnit: boolean;
  useMockWorkflow: boolean;
  useMockInvitation: boolean;
}

const DEPLOYMENT_CONFIGS: Record<AppMode, DeploymentConfig> = {
  mock: {
    authProvider: 'mock',
    useMockOrganization: true,
    useMockOrganizationUnit: true,
    useMockWorkflow: true,
    useMockInvitation: true,
  },
  'integration-auth': {
    authProvider: 'mock',
    useMockOrganization: true,
    useMockOrganizationUnit: true,
    useMockWorkflow: false,
    useMockInvitation: false,
  },
  production: {
    authProvider: 'supabase',
    useMockOrganization: false,
    useMockOrganizationUnit: false,
    useMockWorkflow: false,
    useMockInvitation: false,
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
      `Invalid VITE_APP_MODE: "${mode}". Must be 'mock', 'integration-auth', or 'production'.`
    );
  }

  log.info('Deployment mode configured', { mode, config });

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
