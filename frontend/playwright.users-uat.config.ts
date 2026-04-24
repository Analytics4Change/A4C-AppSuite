import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright UAT Configuration for Users Manage Page
 *
 * Runs against the app with VITE_FORCE_MOCK=true + VITE_DEV_PROFILE=super_admin
 * on port 3459 (distinct from the main test runner at 3456 and the org UAT at 3458).
 */
export default defineConfig({
  testDir: './e2e',
  testMatch: '**/users-manage-page.spec.ts',

  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 1,

  reporter: [
    ['list'],
    ['html', { outputFolder: 'playwright-report-users-uat', open: 'never' }],
    ['json', { outputFile: 'test-results/users-uat-results.json' }],
  ],

  use: {
    baseURL: 'http://localhost:3459',
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
    command: 'VITE_FORCE_MOCK=true VITE_DEV_PROFILE=super_admin npm run dev -- --port 3459',
    url: 'http://localhost:3459',
    reuseExistingServer: true,
    timeout: 60000,
  },

  timeout: 30000,
  expect: {
    timeout: 10000,
  },

  outputDir: 'test-results/users-uat',
});
