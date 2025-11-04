/**
 * Configuration Test Script
 *
 * Tests all configuration combinations to ensure they work correctly.
 * Validates that configuration validation works as expected.
 *
 * Usage:
 *   npm run test:config
 *
 * Tests:
 * 1. Valid configurations (should pass)
 * 2. Invalid configurations (should fail with clear errors)
 * 3. Provider overrides
 * 4. Credential validation
 */

import { validateConfiguration, getResolvedProviders } from '../shared/config';

interface TestCase {
  name: string;
  env: Record<string, string>;
  shouldPass: boolean;
  expectedError?: string;
}

const testCases: TestCase[] = [
  // ========================================
  // Valid Configurations
  // ========================================
  {
    name: 'Mock mode (minimal config)',
    env: {
      WORKFLOW_MODE: 'mock',
      TEMPORAL_ADDRESS: 'localhost:7233',
      TEMPORAL_NAMESPACE: 'default',
      TEMPORAL_TASK_QUEUE: 'bootstrap',
      SUPABASE_URL: 'https://test.supabase.co',
      SUPABASE_SERVICE_ROLE_KEY: 'test-key'
    },
    shouldPass: true
  },
  {
    name: 'Development mode (logging providers)',
    env: {
      WORKFLOW_MODE: 'development',
      TEMPORAL_ADDRESS: 'localhost:7233',
      TEMPORAL_NAMESPACE: 'default',
      TEMPORAL_TASK_QUEUE: 'bootstrap',
      SUPABASE_URL: 'https://test.supabase.co',
      SUPABASE_SERVICE_ROLE_KEY: 'test-key'
    },
    shouldPass: true
  },
  {
    name: 'Production mode (with all credentials)',
    env: {
      WORKFLOW_MODE: 'production',
      TEMPORAL_ADDRESS: 'localhost:7233',
      TEMPORAL_NAMESPACE: 'default',
      TEMPORAL_TASK_QUEUE: 'bootstrap',
      SUPABASE_URL: 'https://test.supabase.co',
      SUPABASE_SERVICE_ROLE_KEY: 'test-key',
      CLOUDFLARE_API_TOKEN: 'test-cloudflare-token',
      RESEND_API_KEY: 're_test_key'
    },
    shouldPass: true
  },
  {
    name: 'Development mode with Cloudflare override',
    env: {
      WORKFLOW_MODE: 'development',
      DNS_PROVIDER: 'cloudflare',
      TEMPORAL_ADDRESS: 'localhost:7233',
      TEMPORAL_NAMESPACE: 'default',
      TEMPORAL_TASK_QUEUE: 'bootstrap',
      SUPABASE_URL: 'https://test.supabase.co',
      SUPABASE_SERVICE_ROLE_KEY: 'test-key',
      CLOUDFLARE_API_TOKEN: 'test-cloudflare-token'
    },
    shouldPass: true
  },

  // ========================================
  // Invalid Configurations
  // ========================================
  {
    name: 'Missing TEMPORAL_ADDRESS',
    env: {
      WORKFLOW_MODE: 'mock',
      TEMPORAL_NAMESPACE: 'default',
      TEMPORAL_TASK_QUEUE: 'bootstrap',
      SUPABASE_URL: 'https://test.supabase.co',
      SUPABASE_SERVICE_ROLE_KEY: 'test-key'
    },
    shouldPass: false,
    expectedError: 'TEMPORAL_ADDRESS'
  },
  {
    name: 'Missing SUPABASE_URL',
    env: {
      WORKFLOW_MODE: 'mock',
      TEMPORAL_ADDRESS: 'localhost:7233',
      TEMPORAL_NAMESPACE: 'default',
      TEMPORAL_TASK_QUEUE: 'bootstrap',
      SUPABASE_SERVICE_ROLE_KEY: 'test-key'
    },
    shouldPass: false,
    expectedError: 'SUPABASE_URL'
  },
  {
    name: 'Invalid WORKFLOW_MODE',
    env: {
      WORKFLOW_MODE: 'invalid-mode',
      TEMPORAL_ADDRESS: 'localhost:7233',
      TEMPORAL_NAMESPACE: 'default',
      TEMPORAL_TASK_QUEUE: 'bootstrap',
      SUPABASE_URL: 'https://test.supabase.co',
      SUPABASE_SERVICE_ROLE_KEY: 'test-key'
    },
    shouldPass: false,
    expectedError: 'Invalid WORKFLOW_MODE'
  },
  {
    name: 'DNS_PROVIDER=cloudflare without token',
    env: {
      WORKFLOW_MODE: 'development',
      DNS_PROVIDER: 'cloudflare',
      TEMPORAL_ADDRESS: 'localhost:7233',
      TEMPORAL_NAMESPACE: 'default',
      TEMPORAL_TASK_QUEUE: 'bootstrap',
      SUPABASE_URL: 'https://test.supabase.co',
      SUPABASE_SERVICE_ROLE_KEY: 'test-key'
    },
    shouldPass: false,
    expectedError: 'CLOUDFLARE_API_TOKEN'
  },
  {
    name: 'EMAIL_PROVIDER=resend without API key',
    env: {
      WORKFLOW_MODE: 'development',
      EMAIL_PROVIDER: 'resend',
      TEMPORAL_ADDRESS: 'localhost:7233',
      TEMPORAL_NAMESPACE: 'default',
      TEMPORAL_TASK_QUEUE: 'bootstrap',
      SUPABASE_URL: 'https://test.supabase.co',
      SUPABASE_SERVICE_ROLE_KEY: 'test-key'
    },
    shouldPass: false,
    expectedError: 'RESEND_API_KEY'
  },
  {
    name: 'Production mode without Cloudflare token',
    env: {
      WORKFLOW_MODE: 'production',
      TEMPORAL_ADDRESS: 'localhost:7233',
      TEMPORAL_NAMESPACE: 'default',
      TEMPORAL_TASK_QUEUE: 'bootstrap',
      SUPABASE_URL: 'https://test.supabase.co',
      SUPABASE_SERVICE_ROLE_KEY: 'test-key',
      RESEND_API_KEY: 're_test_key'
    },
    shouldPass: false,
    expectedError: 'CLOUDFLARE_API_TOKEN'
  },
  {
    name: 'Production mode without Resend key (no SMTP either)',
    env: {
      WORKFLOW_MODE: 'production',
      TEMPORAL_ADDRESS: 'localhost:7233',
      TEMPORAL_NAMESPACE: 'default',
      TEMPORAL_TASK_QUEUE: 'bootstrap',
      SUPABASE_URL: 'https://test.supabase.co',
      SUPABASE_SERVICE_ROLE_KEY: 'test-key',
      CLOUDFLARE_API_TOKEN: 'test-token'
    },
    shouldPass: false,
    expectedError: 'email configuration'
  }
];

/**
 * Run a single test case
 */
function runTest(testCase: TestCase): boolean {
  // Save current env
  const savedEnv = { ...process.env };

  try {
    // Clear environment
    for (const key of Object.keys(process.env)) {
      if (key.startsWith('WORKFLOW_') || key.startsWith('TEMPORAL_') ||
          key.startsWith('SUPABASE_') || key.startsWith('DNS_') ||
          key.startsWith('EMAIL_') || key.startsWith('CLOUDFLARE_') ||
          key.startsWith('RESEND_') || key.startsWith('SMTP_')) {
        delete process.env[key];
      }
    }

    // Set test environment
    for (const [key, value] of Object.entries(testCase.env)) {
      process.env[key] = value;
    }

    // Run validation
    const result = validateConfiguration();

    // Check result
    if (testCase.shouldPass) {
      if (result.valid) {
        console.log(`  ✅ ${testCase.name}`);
        return true;
      } else {
        console.log(`  ❌ ${testCase.name}`);
        console.log(`     Expected: PASS`);
        console.log(`     Got: FAIL with errors:`);
        result.errors.forEach(err => console.log(`       • ${err}`));
        return false;
      }
    } else {
      if (!result.valid) {
        // Check if expected error is present
        const hasExpectedError = testCase.expectedError
          ? result.errors.some(err => err.includes(testCase.expectedError!))
          : true;

        if (hasExpectedError) {
          console.log(`  ✅ ${testCase.name}`);
          console.log(`     Correctly rejected: ${result.errors[0]}`);
          return true;
        } else {
          console.log(`  ❌ ${testCase.name}`);
          console.log(`     Expected error containing: ${testCase.expectedError}`);
          console.log(`     Got: ${result.errors[0]}`);
          return false;
        }
      } else {
        console.log(`  ❌ ${testCase.name}`);
        console.log(`     Expected: FAIL`);
        console.log(`     Got: PASS (should have been rejected)`);
        return false;
      }
    }
  } finally {
    // Restore environment
    for (const key of Object.keys(process.env)) {
      delete process.env[key];
    }
    Object.assign(process.env, savedEnv);
  }
}

/**
 * Test provider resolution
 */
function testProviderResolution(): boolean {
  console.log('\n📋 Provider Resolution Tests:\n');

  const resolutionTests = [
    {
      name: 'Mock mode → mock providers',
      env: { WORKFLOW_MODE: 'mock' },
      expected: { dns: 'mock', email: 'mock' }
    },
    {
      name: 'Development mode → logging providers',
      env: { WORKFLOW_MODE: 'development' },
      expected: { dns: 'logging', email: 'logging' }
    },
    {
      name: 'Production mode → real providers',
      env: { WORKFLOW_MODE: 'production' },
      expected: { dns: 'cloudflare', email: 'resend' }
    },
    {
      name: 'Override DNS provider',
      env: { WORKFLOW_MODE: 'development', DNS_PROVIDER: 'cloudflare' },
      expected: { dns: 'cloudflare', email: 'logging' }
    },
    {
      name: 'Override email provider',
      env: { WORKFLOW_MODE: 'development', EMAIL_PROVIDER: 'resend' },
      expected: { dns: 'logging', email: 'resend' }
    }
  ];

  let allPassed = true;

  for (const test of resolutionTests) {
    const savedEnv = { ...process.env };

    try {
      // Clear relevant environment variables first
      for (const key of Object.keys(process.env)) {
        if (key.startsWith('WORKFLOW_') || key.startsWith('DNS_') || key.startsWith('EMAIL_')) {
          delete process.env[key];
        }
      }

      // Set environment
      Object.assign(process.env, test.env);

      // Get resolved providers
      const resolved = getResolvedProviders();

      if (resolved.dnsProvider === test.expected.dns &&
          resolved.emailProvider === test.expected.email) {
        console.log(`  ✅ ${test.name}`);
        console.log(`     DNS: ${resolved.dnsProvider}, Email: ${resolved.emailProvider}`);
      } else {
        console.log(`  ❌ ${test.name}`);
        console.log(`     Expected: DNS=${test.expected.dns}, Email=${test.expected.email}`);
        console.log(`     Got: DNS=${resolved.dnsProvider}, Email=${resolved.emailProvider}`);
        allPassed = false;
      }
    } finally {
      Object.assign(process.env, savedEnv);
    }
  }

  return allPassed;
}

/**
 * Main function
 */
function main() {
  console.log('='.repeat(60));
  console.log('🧪 Configuration Test Suite');
  console.log('='.repeat(60));

  console.log('\n📋 Configuration Validation Tests:\n');

  let passed = 0;
  let failed = 0;

  for (const testCase of testCases) {
    if (runTest(testCase)) {
      passed++;
    } else {
      failed++;
    }
  }

  // Provider resolution tests
  const providerTestsPassed = testProviderResolution();
  if (!providerTestsPassed) {
    failed++;
  } else {
    passed++;
  }

  // Summary
  console.log('\n' + '='.repeat(60));
  console.log('Summary');
  console.log('='.repeat(60));
  console.log('');
  console.log(`✅ Passed: ${passed}`);
  console.log(`❌ Failed: ${failed}`);
  console.log('');

  if (failed === 0) {
    console.log('🎉 All configuration tests passed!\n');
    process.exit(0);
  } else {
    console.log('❌ Some tests failed. Please review the errors above.\n');
    process.exit(1);
  }
}

// Run if executed directly
if (require.main === module) {
  main();
}

export { runTest, testProviderResolution };
