/**
 * Test setup file for scripts testing
 * Configures global test environment and utilities
 */

import { beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { configManager } from '../config/manager.js';
import { pluginRegistry } from '../plugins/registry.js';

/**
 * Global setup before all tests
 */
beforeAll(async () => {
  // Set test environment
  process.env.NODE_ENV = 'test';
  
  // Configure for testing
  configManager.override({
    logging: {
      level: 'error', // Suppress logs during tests
      enableColors: false,
      enableTimestamps: false,
      format: 'simple'
    },
    progress: {
      style: 'none' // Disable progress bars in tests
    },
    cache: {
      enabled: false // Disable caching in tests
    },
    performance: {
      concurrency: 1, // Run sequentially in tests
      timeoutMs: 5000 // Shorter timeout for tests
    }
  });
});

/**
 * Cleanup after all tests
 */
afterAll(async () => {
  // Reset environment
  delete process.env.NODE_ENV;
});

/**
 * Setup before each test
 */
beforeEach(async () => {
  // Reset plugin registry
  pluginRegistry.resetMetrics();
  
  // Clear any test-specific configuration overrides
  // (would need to implement reset functionality in ConfigManager)
});

/**
 * Cleanup after each test
 */
afterEach(async () => {
  // Cleanup any test artifacts
  // Reset state for next test
});

/**
 * Mock console methods to avoid noise in test output
 */
const originalConsole = {
  log: console.log,
  warn: console.warn,
  error: console.error,
  info: console.info,
  debug: console.debug
};

// Store original methods for potential restoration
globalThis.__originalConsole = originalConsole;

// Override console methods in test environment
if (process.env.NODE_ENV === 'test') {
  console.log = () => {};
  console.info = () => {};
  console.warn = () => {};
  console.debug = () => {};
  // Keep console.error for actual test failures
}

/**
 * Utility function to restore console for specific tests if needed
 */
export function restoreConsole(): void {
  Object.assign(console, originalConsole);
}

/**
 * Utility function to suppress console for specific tests
 */
export function suppressConsole(): void {
  console.log = () => {};
  console.info = () => {};
  console.warn = () => {};
  console.debug = () => {};
}

/**
 * Create a temporary directory for test files
 */
export async function createTempDir(): Promise<string> {
  const { mkdtemp, rm } = await import('fs/promises');
  const { join } = await import('path');
  const { tmpdir } = await import('os');
  
  const tempDir = await mkdtemp(join(tmpdir(), 'docs-scripts-test-'));
  
  // Register cleanup
  afterEach(async () => {
    try {
      await rm(tempDir, { recursive: true, force: true });
    } catch (error) {
      // Ignore cleanup errors
    }
  });
  
  return tempDir;
}

/**
 * Create a mock file system structure for testing
 */
export async function createMockFileSystem(structure: Record<string, string>, baseDir: string): Promise<void> {
  const { mkdir, writeFile } = await import('fs/promises');
  const { dirname, join } = await import('path');
  
  for (const [filePath, content] of Object.entries(structure)) {
    const fullPath = join(baseDir, filePath);
    const dir = dirname(fullPath);
    
    // Create directory structure
    await mkdir(dir, { recursive: true });
    
    // Write file
    await writeFile(fullPath, content, 'utf-8');
  }
}

/**
 * Create a mock plugin for testing
 */
export function createMockPlugin(name: string, overrides: any = {}) {
  return {
    name,
    version: '1.0.0',
    description: `Mock plugin: ${name}`,
    dependencies: [],
    async execute() {
      return {
        success: true,
        data: null,
        errors: [],
        warnings: [],
        metadata: {}
      };
    },
    ...overrides
  };
}

/**
 * Wait for a specified amount of time (useful for async testing)
 */
export function wait(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Capture console output for testing
 */
export function captureConsole() {
  const captured: { method: string; args: any[] }[] = [];
  
  const originalMethods = {
    log: console.log,
    warn: console.warn,
    error: console.error,
    info: console.info
  };
  
  // Override console methods to capture output
  console.log = (...args) => captured.push({ method: 'log', args });
  console.warn = (...args) => captured.push({ method: 'warn', args });
  console.error = (...args) => captured.push({ method: 'error', args });
  console.info = (...args) => captured.push({ method: 'info', args });
  
  return {
    captured,
    restore: () => Object.assign(console, originalMethods)
  };
}