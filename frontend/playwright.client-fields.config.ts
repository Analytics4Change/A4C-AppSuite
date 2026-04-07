import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright Config for Client Field Settings E2E Tests
 *
 * Runs against mock mode with provider_admin profile (has organization.update
 * permission and org_type='provider' — required by both the route guard and
 * the SettingsPage card visibility check).
 *
 * Uses port 3457 to avoid conflicts with other Playwright configs.
 */
export default defineConfig({
  testDir: './e2e',
  testMatch: '**/client-field-settings.spec.ts',

  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 1,

  reporter: [
    ['list'],
    ['html', { outputFolder: 'playwright-report-client-fields', open: 'never' }],
    ['json', { outputFile: 'test-results/client-fields-results.json' }],
  ],

  use: {
    baseURL: 'http://localhost:3457',
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
    command: 'VITE_FORCE_MOCK=true VITE_DEV_PROFILE=provider_admin npm run dev -- --port 3457',
    url: 'http://localhost:3457',
    reuseExistingServer: true,
    timeout: 60000,
  },

  timeout: 30000,
  expect: {
    timeout: 10000,
  },

  outputDir: 'test-results/client-fields',
});
