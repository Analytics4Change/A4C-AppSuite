/**
 * Workflow Configuration
 *
 * Centralized configuration for workflow behavior (retry timings, timeouts, etc.)
 *
 * Design Philosophy:
 * - Production defaults are safe and conservative
 * - Tests can override for fast execution
 * - Type-safe configuration (no env var parsing)
 * - Easy to extend with new configuration options
 */

export interface RetryConfig {
  dns: {
    baseDelayMs: number;    // Starting delay for exponential backoff
    maxDelayMs: number;     // Maximum delay cap for exponential backoff
    maxAttempts: number;    // How many retry attempts before giving up
  };
}

/**
 * Production defaults
 *
 * DNS retry delays: 10s, 20s, 40s, 80s, 160s, 300s, 300s
 * Total time: ~610 seconds (~10 minutes)
 */
const defaultConfig: RetryConfig = {
  dns: {
    baseDelayMs: 10000,     // 10 seconds
    maxDelayMs: 300000,     // 5 minutes
    maxAttempts: 7
  }
};

/**
 * Mutable config that can be overridden in tests
 *
 * Tests can call setConfig() to use fast retry timings
 */
export let workflowConfig: RetryConfig = { ...defaultConfig };

/**
 * Reset configuration to production defaults
 *
 * Useful for test cleanup in afterAll/afterEach hooks
 */
export function resetConfig(): void {
  workflowConfig = { ...defaultConfig };
}

/**
 * Override configuration (for tests)
 *
 * Example:
 * ```typescript
 * setConfig({
 *   dns: {
 *     baseDelayMs: 500,    // 0.5s
 *     maxDelayMs: 10000,   // 10s max
 *     maxAttempts: 7
 *   }
 * });
 * ```
 */
export function setConfig(config: Partial<RetryConfig>): void {
  if (config.dns) {
    workflowConfig.dns = { ...workflowConfig.dns, ...config.dns };
  }
}
