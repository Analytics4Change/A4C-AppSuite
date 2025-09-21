/**
 * Vitest configuration for scripts testing
 * Separate configuration for testing documentation scripts
 */

import { defineConfig } from 'vitest/config';
import { resolve } from 'path';

export default defineConfig({
  test: {
    // Test files location
    include: [
      'scripts/**/*.test.ts',
      'scripts/**/__tests__/**/*.ts'
    ],
    
    // Exclude certain files
    exclude: [
      'node_modules/**',
      'dist/**',
      '**/*.d.ts'
    ],
    
    // Environment setup
    environment: 'node',
    
    // Global test setup
    globals: true,
    
    // Coverage configuration
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: [
        'scripts/**/*.ts'
      ],
      exclude: [
        'scripts/**/*.test.ts',
        'scripts/**/__tests__/**',
        'scripts/**/*.d.ts',
        'scripts/cli/index.ts' // Main entry point
      ],
      thresholds: {
        global: {
          branches: 80,
          functions: 80,
          lines: 80,
          statements: 80
        }
      }
    },
    
    // Test timeout
    testTimeout: 10000,
    
    // Hook timeout
    hookTimeout: 10000,
    
    // Setup files
    setupFiles: ['./scripts/__tests__/setup.ts'],
    
    // Reporter configuration
    reporter: process.env.CI ? ['junit', 'json'] : ['verbose'],
    
    // Output files for CI
    outputFile: {
      junit: './test-results/scripts-junit.xml',
      json: './test-results/scripts-results.json'
    }
  },
  
  // Resolve configuration for imports
  resolve: {
    alias: {
      '@scripts': resolve(__dirname, './scripts'),
      '@tests': resolve(__dirname, './scripts/__tests__')
    }
  },
  
  // Define environment variables for tests
  define: {
    __TEST__: true
  }
});