/**
 * Application Configuration System
 *
 * Controls dependency injection behavior across the entire application.
 * Single environment variable (VITE_DEV_PROFILE) determines which implementations
 * are used for auth, workflows, and user creation.
 */

export type DevProfile =
  | 'full-mock'           // All services mocked (default for development)
  | 'mock-auth-real-api'  // Mock auth, real Supabase/events/workflows
  | 'integration'         // All services use real implementations
  | 'production';         // Production mode

export interface AppConfig {
  profile: DevProfile;
  auth: {
    useMock: boolean;
    mockProfile?: 'super_admin' | 'provider_admin' | 'clinician' | 'viewer';
  };
  workflow: {
    useMock: boolean;
  };
  userCreation: {
    useMock: boolean;
  };
}

/**
 * Get configuration based on environment variable
 */
function getConfig(): AppConfig {
  const profile = (import.meta.env.VITE_DEV_PROFILE || 'full-mock') as DevProfile;

  const configs: Record<DevProfile, AppConfig> = {
    'full-mock': {
      profile: 'full-mock',
      auth: {
        useMock: true,
        mockProfile: (import.meta.env.VITE_MOCK_PROFILE || 'super_admin') as 'super_admin'
      },
      workflow: { useMock: true },
      userCreation: { useMock: true }
    },

    'mock-auth-real-api': {
      profile: 'mock-auth-real-api',
      auth: {
        useMock: true,
        mockProfile: (import.meta.env.VITE_MOCK_PROFILE || 'super_admin') as 'super_admin'
      },
      workflow: { useMock: false },
      userCreation: { useMock: false }
    },

    'integration': {
      profile: 'integration',
      auth: { useMock: false },
      workflow: { useMock: false },
      userCreation: { useMock: false }
    },

    'production': {
      profile: 'production',
      auth: { useMock: false },
      workflow: { useMock: false },
      userCreation: { useMock: false }
    }
  };

  return configs[profile];
}

/**
 * Global application configuration singleton
 *
 * Usage:
 * ```typescript
 * import { appConfig } from '@/config/app.config';
 *
 * if (appConfig.workflow.useMock) {
 *   return new MockWorkflowClient();
 * }
 * return new TemporalWorkflowClient();
 * ```
 */
export const appConfig = getConfig();
