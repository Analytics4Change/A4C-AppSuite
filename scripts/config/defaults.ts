/**
 * Default configuration values for documentation scripts
 */

import { ScriptConfig, EnvironmentConfig } from './types.js';

/**
 * Base configuration with sensible defaults
 */
export const defaultConfig: ScriptConfig = {
  logging: {
    level: 'info',
    enableColors: true,
    enableTimestamps: true,
    format: 'structured'
  },
  
  performance: {
    concurrency: 4,
    timeoutMs: 30000,
    retryAttempts: 3,
    retryDelayMs: 1000
  },
  
  security: {
    allowedPaths: [
      'src/**',
      'docs/**',
      'scripts/**',
      '*.md',
      'package.json',
      'tsconfig*.json',
      'vite.config.ts'
    ],
    maxPathDepth: 10,
    enablePathValidation: true,
    sanitizeCommands: true
  },
  
  progress: {
    style: 'bar',
    showPercentage: true,
    showEta: true,
    refreshRate: 100
  },
  
  cache: {
    enabled: true,
    ttlMs: 300000, // 5 minutes
    maxSize: 1000,
    persistToDisk: false
  },
  
  validation: {
    enabled: true,
    strictMode: false,
    customRules: [],
    excludePatterns: [
      'node_modules/**',
      'dist/**',
      '.git/**',
      '*.log',
      '*.tmp'
    ]
  },
  
  documentation: {
    baseDir: './docs',
    outputDir: './docs/generated',
    templatesDir: './scripts/templates',
    includePatterns: [
      '**/*.md',
      '**/*.tsx',
      '**/*.ts',
      '**/*.json'
    ],
    excludePatterns: [
      'node_modules/**',
      'dist/**',
      '**/*.test.*',
      '**/*.spec.*'
    ],
    generateMetrics: true,
    validateLinks: true
  }
};

/**
 * Environment-specific configuration overrides
 */
export const environmentConfig: EnvironmentConfig = {
  development: {
    logging: {
      level: 'debug',
      enableColors: true,
      enableTimestamps: true,
      format: 'structured'
    },
    cache: {
      enabled: false,
      ttlMs: 0,
      maxSize: 0,
      persistToDisk: false
    },
    progress: {
      style: 'bar',
      showPercentage: true,
      showEta: true,
      refreshRate: 100
    }
  },
  
  test: {
    logging: {
      level: 'error',
      enableColors: false,
      enableTimestamps: false,
      format: 'simple'
    },
    performance: {
      concurrency: 1,
      timeoutMs: 5000,
      retryAttempts: 1,
      retryDelayMs: 100
    },
    progress: {
      style: 'none',
      showPercentage: false,
      showEta: false,
      refreshRate: 1000
    },
    cache: {
      enabled: false,
      ttlMs: 0,
      maxSize: 0,
      persistToDisk: false
    }
  },
  
  production: {
    logging: {
      level: 'warn',
      enableColors: false,
      enableTimestamps: true,
      format: 'json'
    },
    performance: {
      concurrency: 8,
      timeoutMs: 60000,
      retryAttempts: 3,
      retryDelayMs: 1000
    },
    cache: {
      enabled: true,
      persistToDisk: true,
      ttlMs: 300000,
      maxSize: 1000
    }
  },
  
  ci: {
    logging: {
      level: 'info',
      enableColors: false,
      enableTimestamps: true,
      format: 'structured'
    },
    performance: {
      concurrency: 2,
      timeoutMs: 120000,
      retryAttempts: 3,
      retryDelayMs: 1000
    },
    progress: {
      style: 'dots',
      showPercentage: true,
      showEta: false,
      refreshRate: 500
    },
    cache: {
      enabled: false,
      ttlMs: 0,
      maxSize: 0,
      persistToDisk: false
    }
  }
};