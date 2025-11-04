/**
 * Jest Test Setup
 *
 * Global test configuration and setup for all tests.
 * Runs before each test suite.
 */

// Set test environment variables
process.env.WORKFLOW_MODE = 'mock';
process.env.TEMPORAL_ADDRESS = 'localhost:7233';
process.env.TEMPORAL_NAMESPACE = 'default';
process.env.TEMPORAL_TASK_QUEUE = 'bootstrap';
process.env.SUPABASE_URL = 'https://test.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key';
process.env.TAG_DEV_ENTITIES = 'false'; // Don't tag entities in tests

// Suppress console output in tests (unless CI=true)
if (!process.env.CI) {
  global.console = {
    ...console,
    log: jest.fn(),
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn()
    // Keep error for debugging
  };
}
