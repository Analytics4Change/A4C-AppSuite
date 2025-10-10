import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright Configuration for A4C-FrontEnd Medication Entry Testing
 * 
 * This configuration supports comprehensive testing across multiple browsers
 * and devices for the medication entry application.
 */
export default defineConfig({
  testDir: './e2e',
  
  /* Run tests in files in parallel */
  fullyParallel: true,
  
  /* Fail the build on CI if you accidentally left test.only in the source code. */
  forbidOnly: !!process.env.CI,
  
  /* Retry on CI only */
  retries: process.env.CI ? 2 : 0,
  
  /* Opt out of parallel tests on CI. */
  workers: process.env.CI ? 1 : undefined,
  
  /* Reporter configuration */
  reporter: [
    ['html'],
    ['json', { outputFile: 'test-results/results.json' }],
    ['junit', { outputFile: 'test-results/results.xml' }]
  ],
  
  /* Shared settings for all projects */
  use: {
    /* Base URL to use in actions like `await page.goto('/')`. */
    baseURL: process.env.PLAYWRIGHT_TEST_BASE_URL || 'http://localhost:3456',
    
    /* Collect trace when retrying the failed test. */
    trace: 'on-first-retry',
    
    /* Take screenshot on failure */
    screenshot: 'only-on-failure',
    
    /* Record video on failure */
    video: 'retain-on-failure',
  },

  /* Configure projects for major browsers - Task 022 Cross-Browser Testing */
  projects: [
    // Desktop Browsers - Core Testing
    {
      name: 'chromium',
      use: { 
        ...devices['Desktop Chrome'],
        viewport: { width: 1280, height: 720 },
        // Enhanced for focus management testing
        launchOptions: {
          args: ['--disable-web-security', '--disable-features=VizDisplayCompositor']
        }
      },
    },

    {
      name: 'firefox',
      use: { 
        ...devices['Desktop Firefox'],
        viewport: { width: 1280, height: 720 },
        // Firefox-specific configurations for focus testing
        launchOptions: {
          firefoxUserPrefs: {
            'accessibility.tabfocus': 7, // Enable full keyboard navigation
            'browser.tabs.remote.autostart': false
          }
        }
      },
    },

    {
      name: 'webkit',
      use: { 
        ...devices['Desktop Safari'],
        viewport: { width: 1280, height: 720 },
        // Safari handles scrollbars natively - no configuration needed
      },
    },

    {
      name: 'edge',
      use: { 
        ...devices['Desktop Edge'],
        viewport: { width: 1280, height: 720 },
        channel: 'msedge',
        // Edge-specific configurations
        launchOptions: {
          args: ['--disable-web-security']
        }
      },
    },

    /* Mobile Testing - Focus Management on Touch Devices */
    {
      name: 'Mobile Chrome',
      use: { 
        ...devices['Pixel 5'],
        // Mobile-specific focus testing configurations
        hasTouch: true,
        isMobile: true
      },
    },
    {
      name: 'Mobile Safari',
      use: { 
        ...devices['iPhone 12'],
        hasTouch: true,
        isMobile: true
      },
    },

    /* Tablet Testing - Hybrid Input Methods */
    {
      name: 'Tablet Chrome',
      use: { 
        ...devices['iPad Pro'],
        hasTouch: true
      },
    }
  ],

  /* Run your local dev server before starting the tests */
  webServer: {
    command: 'npm run dev -- --port 3456',
    url: process.env.PLAYWRIGHT_TEST_BASE_URL || 'http://localhost:3456',
    reuseExistingServer: !process.env.CI,
    timeout: 30000,
  },

  /* Global timeout settings */
  timeout: 30000,
  expect: {
    timeout: 10000
  },

  /* Output directory for test artifacts */
  outputDir: 'test-results/',
});