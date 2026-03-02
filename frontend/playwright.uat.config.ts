import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright UAT Configuration for Organization Manage Page
 *
 * Runs against the app with VITE_DEV_PROFILE=super_admin for most tests.
 * Uses port 3458 to avoid conflicts with regular Playwright test runner (3456).
 */
export default defineConfig({
  testDir: './e2e',
  testMatch: '**/organization-manage-page.spec.ts',

  fullyParallel: false, // UAT tests may depend on order within suites
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 1,

  reporter: [
    ['list'],
    ['html', { outputFolder: 'playwright-report-uat', open: 'never' }],
    ['json', { outputFile: 'test-results/uat-results.json' }],
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
      name: 'chromium-super-admin',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1280, height: 800 },
      },
    },
  ],

  webServer: {
    command: 'VITE_DEV_PROFILE=super_admin npm run dev -- --port 3458',
    url: 'http://localhost:3458',
    reuseExistingServer: true,
    timeout: 60000,
  },

  timeout: 30000,
  expect: {
    timeout: 10000,
  },

  outputDir: 'test-results/uat',
});
