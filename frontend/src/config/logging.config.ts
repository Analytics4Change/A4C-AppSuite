import type { LogConfig } from '@/utils/logger';

/**
 * Logging configuration for different environments
 *
 * Categories:
 * - main: Application startup and lifecycle
 * - mobx: MobX state management and reactivity
 * - navigation: Keyboard navigation and focus management
 * - api: API calls and service layer
 * - validation: Form validation and error handling
 * - performance: Performance monitoring and optimization
 * - component: Component lifecycle and rendering
 * - hook: Custom React hooks
 * - viewmodel: ViewModel operations
 * - ui: UI interactions and events
 * - test: Test-specific logging
 * - auth: Authentication and authorization
 * - invitation: Organization invitations
 * - organization: Organization management
 * - mock: Mock service layer
 * - config: Configuration and environment
 * - diagnostics: Debug tool controls
 */

const developmentConfig: LogConfig = {
  enabled: true,
  level: 'debug',
  categories: {
    // Core functionality - verbose in development
    'main': 'info',
    'mobx': 'debug',
    'navigation': 'debug',
    'component': 'debug',
    'hook': 'info',
    'viewmodel': 'debug',
    'ui': 'info',

    // Services and data
    'api': 'info',
    'validation': 'warn',

    // Authentication and authorization
    'auth': 'debug',
    'invitation': 'debug',
    'organization': 'debug',

    // Development utilities
    'mock': 'debug',
    'config': 'info',
    'diagnostics': 'debug',

    // Performance and monitoring
    'performance': 'info',

    // Default for uncategorized
    'default': 'info'
  },
  output: 'console',
  includeTimestamp: true,
  includeLocation: true
};

const productionConfig: LogConfig = {
  enabled: true, // Enabled for warn+error visibility in production
  level: 'warn', // Only warn and error levels in production
  categories: {
    // Critical categories for production debugging
    'auth': 'warn',
    'organization': 'warn',
    'invitation': 'warn',
    'api': 'warn',
    'config': 'warn',
    'default': 'warn'
  },
  output: 'console',
  includeTimestamp: true,
  includeLocation: false // Reduced overhead in production
};

const testConfig: LogConfig = {
  enabled: false, // Silent during tests unless explicitly enabled
  level: 'error',
  categories: {
    'test': 'debug' // Only test category is enabled
  },
  output: 'memory',
  includeTimestamp: false,
  includeLocation: false,
  maxBufferSize: 100
};

/**
 * Get logging configuration based on environment
 */
export function getLoggingConfig(): LogConfig {
  // Check for environment variable overrides
  const envLogLevel = import.meta.env.VITE_LOG_LEVEL;
  const envLogCategories = import.meta.env.VITE_LOG_CATEGORIES;
  const debugLogsEnabled = import.meta.env.VITE_DEBUG_LOGS === 'true';

  // Determine base configuration
  let config: LogConfig;

  if (import.meta.env.MODE === 'test') {
    config = testConfig;
  } else if (import.meta.env.PROD && !debugLogsEnabled) {
    // Production mode: warn+error logging enabled by default
    config = productionConfig;
  } else if (import.meta.env.PROD && debugLogsEnabled) {
    // Production mode with debug logging enabled (VITE_DEBUG_LOGS=true)
    config = {
      enabled: true,
      level: 'info',
      categories: {
        'main': 'info',
        'viewmodel': 'info',
        'api': 'info',
        'validation': 'warn',
        'auth': 'info',
        'organization': 'info',
        'invitation': 'info',
        'config': 'info',
        'default': 'info'
      },
      output: 'console',
      includeTimestamp: true,
      includeLocation: false
    };
  } else {
    config = developmentConfig;
  }

  // Apply environment variable overrides in development
  if (import.meta.env.DEV) {
    if (envLogLevel) {
      config = {
        ...config,
        level: envLogLevel as any
      };
    }

    if (envLogCategories) {
      // Parse comma-separated categories
      const categories = envLogCategories.split(',').reduce((acc: any, cat: string) => {
        const [name, level] = cat.split(':');
        acc[name] = level || 'debug';
        return acc;
      }, {});

      config = {
        ...config,
        categories: {
          ...config.categories,
          ...categories
        }
      };
    }
  }

  return config;
}

/**
 * Preset configurations for common debugging scenarios
 */
export const LoggingPresets = {
  // Debug MobX reactivity issues
  mobxDebug: (): LogConfig => ({
    ...developmentConfig,
    categories: {
      'mobx': 'debug',
      'viewmodel': 'debug',
      'component': 'debug',
      'default': 'warn'
    }
  }),
  
  // Debug keyboard navigation
  navigationDebug: (): LogConfig => ({
    ...developmentConfig,
    categories: {
      'navigation': 'debug',
      'hook': 'debug',
      'ui': 'debug',
      'component': 'info',
      'default': 'warn'
    }
  }),
  
  // Performance profiling
  performanceProfile: (): LogConfig => ({
    ...developmentConfig,
    categories: {
      'performance': 'debug',
      'component': 'info',
      'viewmodel': 'info',
      'default': 'warn'
    }
  }),
  
  // Minimal logging
  minimal: (): LogConfig => ({
    ...developmentConfig,
    level: 'warn',
    categories: {
      'default': 'warn'
    }
  }),
  
  // Verbose - everything
  verbose: (): LogConfig => ({
    ...developmentConfig,
    level: 'debug',
    categories: Object.keys(developmentConfig.categories).reduce((acc, key) => {
      acc[key] = 'debug';
      return acc;
    }, {} as any)
  })
};

/**
 * Export individual configs for testing
 */
export { developmentConfig, productionConfig, testConfig };