import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright Config for Client Intake E2E Tests
 *
 * Runs against mock mode with provider_admin profile. The provider_admin
 * profile has client management permissions and org_type='provider',
 * which satisfies route guards for /clients and /clients/register.
 *
 * Uses port 3458 to avoid conflicts with other Playwright configs.
 */
export default defineConfig({
  testDir: './e2e',
  testMatch: '**/client-intake.spec.ts',

  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 1,

  reporter: [
    ['list'],
    ['html', { outputFolder: 'playwright-report-client-intake', open: 'never' }],
    ['json', { outputFile: 'test-results/client-intake-results.json' }],
  ],

  use: {
    baseURL: 'http://localhost:3458',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    viewport: { width: 1280, height: 800 },
  },

  projects: [
    {
      name: 'chromium-provider-admin',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1280, height: 800 },
      },
    },
  ],

  webServer: {
    command: 'VITE_FORCE_MOCK=true VITE_DEV_PROFILE=provider_admin npm run dev -- --port 3458',
    url: 'http://localhost:3458',
    reuseExistingServer: true,
    timeout: 60000,
  },

  timeout: 30000,
  expect: {
    timeout: 10000,
  },

  outputDir: 'test-results/client-intake',
});
