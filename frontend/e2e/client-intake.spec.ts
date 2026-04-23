/**
 * Client Intake E2E Tests
 *
 * Tests the Client List page (/clients), Client Intake form (/clients/register),
 * and Client Detail view (/clients/:id) in mock mode.
 *
 * Run with:
 *   cd frontend && npx playwright test --config playwright.client-intake.config.ts
 *
 * Prerequisites:
 *   - Uses playwright.client-intake.config.ts (VITE_FORCE_MOCK=true, VITE_DEV_PROFILE=provider_admin)
 *   - Mock data: Marcus Johnson (active), Sofia (Sofi) Ramirez (active), Jayden (Jay) Williams (discharged)
 *   - Mock client IDs are stable UUIDs defined in MockClientService seed data
 */

import { test, expect, Page } from '@playwright/test';

const BASE_URL = 'http://localhost:3458';

// Stable mock client IDs from MockClientService seed data
const MOCK_CLIENT_IDS = {
  marcus: 'c0000000-0000-0000-0000-000000000001',
  sofia: 'c0000000-0000-0000-0000-000000000002',
  jayden: 'c0000000-0000-0000-0000-000000000003',
} as const;

// ============================================================================
// Helpers
// ============================================================================

/** Authenticate via mock mode login page if not already authenticated */
async function ensureAuthenticated(page: Page) {
  await page.goto(BASE_URL);

  const isLoginPage = await page
    .locator('[data-testid="login-page"]')
    .isVisible({ timeout: 5000 })
    .catch(() => false);

  if (isLoginPage) {
    await page.fill('#email', 'dev@example.com');
    await page.fill('#password', 'any-password');
    await page.click('button[type="submit"]');
    await page.waitForURL(/\/(clients|organizations|dashboard|settings)/, { timeout: 10000 });
  }
}

/** Navigate to /clients and wait for the client grid to be present */
async function navigateToClientList(page: Page) {
  await ensureAuthenticated(page);
  await page.goto(`${BASE_URL}/clients`);
  // Wait for loading to finish — either a client card or the empty state appears
  await page.waitForSelector('[data-testid="client-grid"], [data-testid="client-list-empty"]', {
    timeout: 15000,
  });
}

/** Navigate to the intake form */
async function navigateToIntakeForm(page: Page) {
  await ensureAuthenticated(page);
  await page.goto(`${BASE_URL}/clients/register`);
  await page.waitForSelector('[data-testid="client-intake-page"]', { timeout: 15000 });
}

/** Navigate to a specific client's detail page */
async function navigateToClientDetail(page: Page, clientId: string) {
  await ensureAuthenticated(page);
  await page.goto(`${BASE_URL}/clients/${clientId}`);
  // Wait for the layout to finish loading — either the header or an error state
  await page.waitForSelector(
    '[data-testid="back-to-clients-btn"], [data-testid="client-detail-loading"]',
    { timeout: 15000 }
  );
  // If still loading, wait for it to resolve
  await page.waitForSelector('[data-testid="back-to-clients-btn"]', { timeout: 15000 });
}

// ============================================================================
// Client List Page
// ============================================================================

test.describe('Client List Page', () => {
  test('page loads with heading and register button', async ({ page }) => {
    await navigateToClientList(page);

    await expect(page.getByRole('heading', { name: 'Clients' })).toBeVisible();
    await expect(page.locator('[data-testid="register-client-btn"]')).toBeVisible();
  });

  test('shows three mock clients from seed data', async ({ page }) => {
    await navigateToClientList(page);

    const grid = page.locator('[data-testid="client-grid"]');
    await expect(grid).toBeVisible();

    // All three seed clients must appear
    await expect(page.getByText('Marcus Johnson')).toBeVisible();
    // Sofia has preferred_name 'Sofi' — displayed as "Sofi (Sofia) Ramirez"
    await expect(page.getByText(/Sofi \(Sofia\) Ramirez/)).toBeVisible();
    // Jayden has preferred_name 'Jay' — displayed as "Jay (Jayden) Williams"
    await expect(page.getByText(/Jay \(Jayden\) Williams/)).toBeVisible();
  });

  test('client cards show status badges', async ({ page }) => {
    await navigateToClientList(page);

    const badges = page.locator('[data-testid="client-status-badge"]');
    await expect(badges).toHaveCount(3);

    // Two active clients, one discharged
    const badgeTexts = await badges.allTextContents();
    const activeCount = badgeTexts.filter((t) => t === 'Active').length;
    const dischargedCount = badgeTexts.filter((t) => t === 'Discharged').length;
    expect(activeCount).toBe(2);
    expect(dischargedCount).toBe(1);
  });

  test('status tabs are rendered with correct labels', async ({ page }) => {
    await navigateToClientList(page);

    await expect(page.locator('[data-testid="status-tab-all"]')).toBeVisible();
    await expect(page.locator('[data-testid="status-tab-active"]')).toBeVisible();
    await expect(page.locator('[data-testid="status-tab-discharged"]')).toBeVisible();
    await expect(page.locator('[data-testid="status-tab-inactive"]')).toBeVisible();
  });

  test('"All" tab is selected by default', async ({ page }) => {
    await navigateToClientList(page);

    const allTab = page.locator('[data-testid="status-tab-all"]');
    await expect(allTab).toHaveAttribute('aria-selected', 'true');
  });

  test('Active tab filters to only active clients', async ({ page }) => {
    await navigateToClientList(page);

    await page.click('[data-testid="status-tab-active"]');
    await page.waitForTimeout(400); // debounce + mock delay

    const grid = page.locator('[data-testid="client-grid"]');
    await expect(grid).toBeVisible();

    // Only the 2 active clients
    await expect(page.getByText('Marcus Johnson')).toBeVisible();
    await expect(page.getByText(/Sofi \(Sofia\) Ramirez/)).toBeVisible();
    // Jayden is discharged — should not appear
    await expect(page.getByText(/Jay \(Jayden\) Williams/)).not.toBeVisible();
  });

  test('Discharged tab filters to only discharged clients', async ({ page }) => {
    await navigateToClientList(page);

    await page.click('[data-testid="status-tab-discharged"]');
    await page.waitForTimeout(400);

    await expect(page.getByText(/Jay \(Jayden\) Williams/)).toBeVisible();
    await expect(page.getByText('Marcus Johnson')).not.toBeVisible();
    await expect(page.getByText(/Sofi \(Sofia\) Ramirez/)).not.toBeVisible();
  });

  test('search input filters clients by name', async ({ page }) => {
    await navigateToClientList(page);

    const searchInput = page.locator('[data-testid="client-search-input"]');
    await expect(searchInput).toBeVisible();

    await searchInput.fill('Marcus');
    await page.waitForTimeout(500); // debounce delay

    await expect(page.getByText('Marcus Johnson')).toBeVisible();
    await expect(page.getByText(/Sofi \(Sofia\) Ramirez/)).not.toBeVisible();
    await expect(page.getByText(/Jay \(Jayden\) Williams/)).not.toBeVisible();
  });

  test('search with no match shows empty state', async ({ page }) => {
    await navigateToClientList(page);

    await page.locator('[data-testid="client-search-input"]').fill('zzznomatch');
    await page.waitForTimeout(500);

    await expect(page.locator('[data-testid="client-list-empty"]')).toBeVisible();
    await expect(page.getByText('No clients found')).toBeVisible();
  });

  test('"Register New Client" button navigates to intake form', async ({ page }) => {
    await navigateToClientList(page);

    await page.click('[data-testid="register-client-btn"]');
    await page.waitForURL(/\/clients\/register/, { timeout: 5000 });

    await expect(page.locator('[data-testid="client-intake-page"]')).toBeVisible();
  });

  test('clicking a client card navigates to client detail', async ({ page }) => {
    await navigateToClientList(page);

    await page.click(`[data-testid="client-card-${MOCK_CLIENT_IDS.marcus}"]`);
    await page.waitForURL(new RegExp(`/clients/${MOCK_CLIENT_IDS.marcus}`), { timeout: 5000 });

    await expect(page.getByRole('heading', { name: 'Marcus Johnson' })).toBeVisible();
  });
});

// ============================================================================
// Client Intake Page
// ============================================================================

test.describe('Client Intake Page', () => {
  test('page loads with heading and progress bar', async ({ page }) => {
    await navigateToIntakeForm(page);

    await expect(page.getByRole('heading', { name: 'Register New Client' })).toBeVisible();
    await expect(page.locator('[data-testid="intake-progress"]')).toBeVisible();
    await expect(page.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '0');
  });

  test('sidebar navigation is visible with all 10 sections', async ({ page }) => {
    await navigateToIntakeForm(page);

    const sidebar = page.locator('[data-testid="intake-sidebar"]');
    await expect(sidebar).toBeVisible();

    // Verify all 10 section nav buttons by their data-testid
    const expectedSections = [
      'demographics',
      'contact_info',
      'guardian',
      'referral',
      'admission',
      'insurance',
      'clinical',
      'medical',
      'legal',
      'education',
    ];

    for (const section of expectedSections) {
      await expect(page.locator(`[data-testid="intake-nav-${section}"]`)).toBeVisible();
    }
  });

  test('Demographics section is active by default', async ({ page }) => {
    await navigateToIntakeForm(page);

    const demographicsNav = page.locator('[data-testid="intake-nav-demographics"]');
    await expect(demographicsNav).toHaveAttribute('aria-current', 'step');

    // Demographics section content is rendered
    await expect(page.locator('[data-testid="intake-section-demographics"]')).toBeVisible();
  });

  test('Demographics section renders form fields', async ({ page }) => {
    await navigateToIntakeForm(page);

    // The section content area should be visible
    await expect(page.locator('[data-testid="intake-section-content"]')).toBeVisible();

    // The "Demographics" heading inside the section
    await expect(
      page.locator('[data-testid="intake-section-demographics"]').getByText('Demographics')
    ).toBeVisible();

    // Key form inputs that are always enabled in demographics
    // Text inputs for name fields
    await expect(page.getByLabel(/First Name/i)).toBeVisible();
    await expect(page.getByLabel(/Last Name/i)).toBeVisible();
    await expect(page.getByLabel(/Date of Birth/i)).toBeVisible();
  });

  test('clicking sidebar section navigates to that section', async ({ page }) => {
    await navigateToIntakeForm(page);

    // Click on "Admission" section
    await page.click('[data-testid="intake-nav-admission"]');

    // Admission should now be the active section
    await expect(page.locator('[data-testid="intake-nav-admission"]')).toHaveAttribute(
      'aria-current',
      'step'
    );
    // Demographics should no longer be active
    await expect(page.locator('[data-testid="intake-nav-demographics"]')).not.toHaveAttribute(
      'aria-current',
      'step'
    );
  });

  test('Previous button is disabled on first section', async ({ page }) => {
    await navigateToIntakeForm(page);

    const prevBtn = page.locator('[data-testid="intake-prev-button"]');
    await expect(prevBtn).toBeVisible();
    await expect(prevBtn).toBeDisabled();
  });

  test('Next button advances to next section', async ({ page }) => {
    await navigateToIntakeForm(page);

    // Start on Demographics (index 0)
    await expect(page.locator('[data-testid="intake-nav-demographics"]')).toHaveAttribute(
      'aria-current',
      'step'
    );

    await page.click('[data-testid="intake-next-button"]');

    // Should now be on Contact Info (index 1)
    await expect(page.locator('[data-testid="intake-nav-contact_info"]')).toHaveAttribute(
      'aria-current',
      'step'
    );
  });

  test('Previous button navigates back after advancing', async ({ page }) => {
    await navigateToIntakeForm(page);

    // Advance to Contact Info
    await page.click('[data-testid="intake-next-button"]');
    await expect(page.locator('[data-testid="intake-nav-contact_info"]')).toHaveAttribute(
      'aria-current',
      'step'
    );

    // Go back to Demographics
    await page.click('[data-testid="intake-prev-button"]');
    await expect(page.locator('[data-testid="intake-nav-demographics"]')).toHaveAttribute(
      'aria-current',
      'step'
    );
  });

  test('Submit button appears on last section (Education)', async ({ page }) => {
    await navigateToIntakeForm(page);

    // Click directly to the last section via sidebar
    await page.click('[data-testid="intake-nav-education"]');

    // Next button should not be visible; Submit button should appear
    await expect(page.locator('[data-testid="intake-next-button"]')).not.toBeVisible();
    await expect(page.locator('[data-testid="intake-submit-button"]')).toBeVisible();
  });

  test('Next button is not shown on last section', async ({ page }) => {
    await navigateToIntakeForm(page);

    await page.click('[data-testid="intake-nav-education"]');

    await expect(page.locator('[data-testid="intake-next-button"]')).not.toBeVisible();
  });

  test('footer navigation row is always visible', async ({ page }) => {
    await navigateToIntakeForm(page);

    await expect(page.locator('[data-testid="intake-footer"]')).toBeVisible();
  });

  test('back button navigates to client list', async ({ page }) => {
    await navigateToIntakeForm(page);

    await page.click('[data-testid="intake-back-button"]');
    await page.waitForURL(/\/clients$/, { timeout: 5000 });
  });

  test('section content area updates when navigating', async ({ page }) => {
    await navigateToIntakeForm(page);

    const sectionContent = page.locator('[data-testid="intake-section-content"]');

    // Check demographics section is visible initially
    await expect(page.locator('[data-testid="intake-section-demographics"]')).toBeVisible();

    // Navigate to Referral section
    await page.click('[data-testid="intake-nav-referral"]');

    // Demographics sub-testid should no longer be present (different component renders)
    await expect(page.locator('[data-testid="intake-section-demographics"]')).not.toBeVisible();

    // The section content wrapper should still be there
    await expect(sectionContent).toBeVisible();
  });
});

// ============================================================================
// Client Detail Page
// ============================================================================

test.describe('Client Detail Page', () => {
  test('displays client name in header for Marcus Johnson', async ({ page }) => {
    await navigateToClientDetail(page, MOCK_CLIENT_IDS.marcus);

    await expect(page.getByRole('heading', { name: 'Marcus Johnson' })).toBeVisible();
  });

  test('displays preferred name format for Sofia Ramirez', async ({ page }) => {
    await navigateToClientDetail(page, MOCK_CLIENT_IDS.sofia);

    // Sofia has preferred_name 'Sofi' → "Sofi (Sofia) Ramirez"
    await expect(page.getByRole('heading', { name: /Sofi \(Sofia\) Ramirez/ })).toBeVisible();
  });

  test('shows green Active status badge for active client', async ({ page }) => {
    await navigateToClientDetail(page, MOCK_CLIENT_IDS.marcus);

    const badge = page.locator('[data-testid="client-status-badge"]');
    await expect(badge).toBeVisible();
    await expect(badge).toHaveText('Active');
  });

  test('shows amber Discharged status badge for discharged client', async ({ page }) => {
    await navigateToClientDetail(page, MOCK_CLIENT_IDS.jayden);

    const badge = page.locator('[data-testid="client-status-badge"]');
    await expect(badge).toBeVisible();
    await expect(badge).toHaveText('Discharged');
  });

  test('detail page tab bar shows Overview, Medications, History, Documents', async ({ page }) => {
    await navigateToClientDetail(page, MOCK_CLIENT_IDS.marcus);

    await expect(page.locator('[data-testid="client-detail-tab-overview"]')).toBeVisible();
    await expect(page.locator('[data-testid="client-detail-tab-medications"]')).toBeVisible();
    await expect(page.locator('[data-testid="client-detail-tab-history"]')).toBeVisible();
    await expect(page.locator('[data-testid="client-detail-tab-documents"]')).toBeVisible();
  });

  test('Overview page renders Demographics section', async ({ page }) => {
    await navigateToClientDetail(page, MOCK_CLIENT_IDS.marcus);

    await expect(page.locator('[data-testid="client-overview"]')).toBeVisible();
    await expect(page.locator('[data-testid="section-demographics"]')).toBeVisible();
  });

  test('Overview page renders Contact Information section', async ({ page }) => {
    await navigateToClientDetail(page, MOCK_CLIENT_IDS.marcus);

    await expect(page.locator('[data-testid="section-contact"]')).toBeVisible();
  });

  test('Overview page renders multiple record sections', async ({ page }) => {
    await navigateToClientDetail(page, MOCK_CLIENT_IDS.marcus);

    const expectedSections = [
      'section-demographics',
      'section-contact',
      'section-guardian',
      'section-referral',
      'section-admission',
      'section-insurance',
      'section-clinical',
      'section-medical',
      'section-legal',
      'section-education',
    ];

    for (const sectionId of expectedSections) {
      await expect(page.locator(`[data-testid="${sectionId}"]`)).toBeVisible();
    }
  });

  test('Discharge button is visible for active client', async ({ page }) => {
    await navigateToClientDetail(page, MOCK_CLIENT_IDS.marcus);

    await expect(page.locator('[data-testid="discharge-client-btn"]')).toBeVisible();
  });

  test('Discharge button is NOT visible for discharged client', async ({ page }) => {
    await navigateToClientDetail(page, MOCK_CLIENT_IDS.jayden);

    await expect(page.locator('[data-testid="discharge-client-btn"]')).not.toBeVisible();
  });

  test('discharged client shows discharged banner on Overview', async ({ page }) => {
    await navigateToClientDetail(page, MOCK_CLIENT_IDS.jayden);

    await expect(page.locator('[data-testid="client-discharged-banner"]')).toBeVisible();
    await expect(page.getByText(/discharged on/i)).toBeVisible();
  });

  test('discharged client shows Discharge section on Overview', async ({ page }) => {
    await navigateToClientDetail(page, MOCK_CLIENT_IDS.jayden);

    await expect(page.locator('[data-testid="section-discharge"]')).toBeVisible();
  });

  test('Discharge dialog opens with required fields when button clicked', async ({ page }) => {
    await navigateToClientDetail(page, MOCK_CLIENT_IDS.marcus);

    await page.click('[data-testid="discharge-client-btn"]');

    const dialog = page.locator('[data-testid="discharge-dialog"]');
    await expect(dialog).toBeVisible();

    // Required fields must be present
    await expect(page.locator('[data-testid="discharge-date-input"]')).toBeVisible();
    await expect(page.locator('[data-testid="discharge-outcome-select"]')).toBeVisible();
    await expect(page.locator('[data-testid="discharge-reason-select"]')).toBeVisible();

    // Optional placement field
    await expect(page.locator('[data-testid="discharge-placement-select"]')).toBeVisible();
  });

  test('Discharge dialog Confirm button is disabled until all required fields filled', async ({
    page,
  }) => {
    await navigateToClientDetail(page, MOCK_CLIENT_IDS.marcus);

    await page.click('[data-testid="discharge-client-btn"]');

    // Confirm should be disabled initially (outcome and reason are empty)
    const confirmBtn = page.locator('[data-testid="discharge-confirm-btn"]');
    await expect(confirmBtn).toBeDisabled();
  });

  test('Discharge dialog Cancel button closes the dialog', async ({ page }) => {
    await navigateToClientDetail(page, MOCK_CLIENT_IDS.marcus);

    await page.click('[data-testid="discharge-client-btn"]');
    await expect(page.locator('[data-testid="discharge-dialog"]')).toBeVisible();

    await page.click('[data-testid="discharge-cancel-btn"]');
    await expect(page.locator('[data-testid="discharge-dialog"]')).not.toBeVisible();
  });

  test('Discharge confirm button becomes enabled when all required fields filled', async ({
    page,
  }) => {
    await navigateToClientDetail(page, MOCK_CLIENT_IDS.sofia);

    await page.click('[data-testid="discharge-client-btn"]');

    // Fill all three required fields
    // Date is auto-populated; select outcome and reason
    await page.selectOption('[data-testid="discharge-outcome-select"]', 'successful');
    await page.selectOption('[data-testid="discharge-reason-select"]', 'graduated_program');

    const confirmBtn = page.locator('[data-testid="discharge-confirm-btn"]');
    await expect(confirmBtn).toBeEnabled();
  });

  test('back button returns to client list', async ({ page }) => {
    await navigateToClientDetail(page, MOCK_CLIENT_IDS.marcus);

    await page.click('[data-testid="back-to-clients-btn"]');
    await page.waitForURL(/\/clients$/, { timeout: 5000 });
  });

  test('navigating from client list to detail works end-to-end', async ({ page }) => {
    await navigateToClientList(page);

    // Click Marcus's card
    await page.click(`[data-testid="client-card-${MOCK_CLIENT_IDS.marcus}"]`);
    await page.waitForURL(new RegExp(`/clients/${MOCK_CLIENT_IDS.marcus}`), { timeout: 5000 });

    // Verify we landed on his detail page
    await expect(page.getByRole('heading', { name: 'Marcus Johnson' })).toBeVisible();
    await expect(page.locator('[data-testid="client-overview"]')).toBeVisible();
  });
});

// ============================================================================
// Client Registration — Form Fill + Submit
// ============================================================================

test.describe('Client Registration — Happy Path', () => {
  test('fill required fields across sections and submit successfully', async ({ page }) => {
    await navigateToIntakeForm(page);

    // Demographics: first_name, last_name, date_of_birth, gender (required)
    await page.fill('[data-testid="intake-field-first_name"]', 'Jane');
    await page.fill('[data-testid="intake-field-last_name"]', 'Doe');
    await page.fill('[data-testid="intake-field-date_of_birth"]', '2012-03-15');
    await page.selectOption('[data-testid="intake-field-gender"]', 'female');

    // Navigate to Admission section — admission_date is required
    await page.click('[data-testid="intake-nav-admission"]');
    await expect(page.locator('[data-testid="intake-section-admission"]')).toBeVisible();
    await page.fill('[data-testid="intake-field-admission_date"]', '2026-04-01');

    // Navigate to Medical section — allergies and medical_conditions are required (jsonb)
    await page.click('[data-testid="intake-nav-medical"]');
    await expect(page.locator('[data-testid="intake-section-medical"]')).toBeVisible();
    await page.fill('[data-testid="intake-field-allergies"]', 'NKA');
    await page.fill('[data-testid="intake-field-medical_conditions"]', 'None');

    // Navigate to last section (Education) — submit button should appear
    await page.click('[data-testid="intake-nav-education"]');
    await expect(page.locator('[data-testid="intake-submit-button"]')).toBeVisible();

    // Submit should be enabled (all 7 required fields filled)
    await expect(page.locator('[data-testid="intake-submit-button"]')).toBeEnabled();

    // Click submit
    await page.click('[data-testid="intake-submit-button"]');

    // Should redirect to client detail page
    await page.waitForURL(/\/clients\/[a-f0-9-]+$/, { timeout: 10000 });
  });

  test('submit button is disabled without required fields', async ({ page }) => {
    await navigateToIntakeForm(page);

    // Navigate directly to last section without filling anything
    await page.click('[data-testid="intake-nav-education"]');

    const submitBtn = page.locator('[data-testid="intake-submit-button"]');
    await expect(submitBtn).toBeVisible();
    await expect(submitBtn).toBeDisabled();
  });

  test('filling only demographics is not enough to enable submit', async ({ page }) => {
    await navigateToIntakeForm(page);

    // Fill demographics but skip admission_date
    await page.fill('[data-testid="intake-field-first_name"]', 'Jane');
    await page.fill('[data-testid="intake-field-last_name"]', 'Doe');
    await page.fill('[data-testid="intake-field-date_of_birth"]', '2012-03-15');
    await page.selectOption('[data-testid="intake-field-gender"]', 'female');

    // Go to last section
    await page.click('[data-testid="intake-nav-education"]');

    // Submit should still be disabled (missing admission_date)
    await expect(page.locator('[data-testid="intake-submit-button"]')).toBeDisabled();
  });

  test('form data persists across section navigation', async ({ page }) => {
    await navigateToIntakeForm(page);

    // Fill demographics
    await page.fill('[data-testid="intake-field-first_name"]', 'TestPersist');
    await page.fill('[data-testid="intake-field-last_name"]', 'User');

    // Navigate away to Referral
    await page.click('[data-testid="intake-nav-referral"]');
    await expect(page.locator('[data-testid="intake-section-demographics"]')).not.toBeVisible();

    // Navigate back to Demographics
    await page.click('[data-testid="intake-nav-demographics"]');

    // Values should still be there
    await expect(page.locator('[data-testid="intake-field-first_name"]')).toHaveValue(
      'TestPersist'
    );
    await expect(page.locator('[data-testid="intake-field-last_name"]')).toHaveValue('User');
  });
});

// ============================================================================
// Client Registration — Sub-Entity Collections
// ============================================================================

test.describe('Client Registration — Sub-Entity Collections', () => {
  test('add a phone number', async ({ page }) => {
    await navigateToIntakeForm(page);

    await page.click('[data-testid="intake-nav-contact_info"]');
    await expect(page.locator('[data-testid="intake-section-contact_info"]')).toBeVisible();

    // Add phone
    await page.click('[data-testid="add-phone-btn"]');
    await expect(page.locator('[data-testid="phone-number-0"]')).toBeVisible();

    await page.fill('[data-testid="phone-number-0"]', '555-123-4567');
    await page.selectOption('[data-testid="phone-type-0"]', 'mobile');

    // Verify the value persists
    await expect(page.locator('[data-testid="phone-number-0"]')).toHaveValue('555-123-4567');
  });

  test('add an email address', async ({ page }) => {
    await navigateToIntakeForm(page);

    await page.click('[data-testid="intake-nav-contact_info"]');

    await page.click('[data-testid="add-email-btn"]');
    await expect(page.locator('[data-testid="email-address-0"]')).toBeVisible();

    await page.fill('[data-testid="email-address-0"]', 'jane@example.com');
    await page.selectOption('[data-testid="email-type-0"]', 'personal');

    await expect(page.locator('[data-testid="email-address-0"]')).toHaveValue('jane@example.com');
  });

  test('add an address', async ({ page }) => {
    await navigateToIntakeForm(page);

    await page.click('[data-testid="intake-nav-contact_info"]');

    await page.click('[data-testid="add-address-btn"]');
    await expect(page.locator('[data-testid="address-street1-0"]')).toBeVisible();

    await page.fill('[data-testid="address-street1-0"]', '123 Main St');
    await page.fill('[data-testid="address-city-0"]', 'Springfield');
    await page.fill('[data-testid="address-state-0"]', 'IL');
    await page.fill('[data-testid="address-zip-0"]', '62704');

    await expect(page.locator('[data-testid="address-city-0"]')).toHaveValue('Springfield');
  });

  test('sub-entities persist across section navigation', async ({ page }) => {
    await navigateToIntakeForm(page);

    // Add a phone on Contact Info
    await page.click('[data-testid="intake-nav-contact_info"]');
    await page.click('[data-testid="add-phone-btn"]');
    await page.fill('[data-testid="phone-number-0"]', '555-999-0000');

    // Navigate away to Admission
    await page.click('[data-testid="intake-nav-admission"]');
    await expect(page.locator('[data-testid="intake-section-contact_info"]')).not.toBeVisible();

    // Navigate back to Contact Info
    await page.click('[data-testid="intake-nav-contact_info"]');

    // Phone should still be there
    await expect(page.locator('[data-testid="phone-number-0"]')).toHaveValue('555-999-0000');
  });

  test('remove a sub-entity', async ({ page }) => {
    await navigateToIntakeForm(page);

    await page.click('[data-testid="intake-nav-contact_info"]');

    // Add two phones
    await page.click('[data-testid="add-phone-btn"]');
    await page.fill('[data-testid="phone-number-0"]', '555-111-1111');
    await page.click('[data-testid="add-phone-btn"]');
    await page.fill('[data-testid="phone-number-1"]', '555-222-2222');

    // Verify two exist
    await expect(page.locator('[data-testid="phone-number-0"]')).toBeVisible();
    await expect(page.locator('[data-testid="phone-number-1"]')).toBeVisible();

    // Remove the first one
    await page.click('[data-testid="remove-phone-0"]');

    // Only one phone should remain
    await expect(page.locator('[data-testid="phone-number-0"]')).toBeVisible();
    await expect(page.locator('[data-testid="phone-number-1"]')).not.toBeVisible();

    // The remaining phone should have the second phone's number
    await expect(page.locator('[data-testid="phone-number-0"]')).toHaveValue('555-222-2222');
  });
});

// ============================================================================
// Client Registration — Full Submit with Sub-Entities
// ============================================================================

test.describe('Client Registration — Full Submit with Sub-Entities', () => {
  test('register client with phone, email, and address', async ({ page }) => {
    await navigateToIntakeForm(page);

    // Demographics
    await page.fill('[data-testid="intake-field-first_name"]', 'Integration');
    await page.fill('[data-testid="intake-field-last_name"]', 'Test');
    await page.fill('[data-testid="intake-field-date_of_birth"]', '2011-01-01');
    await page.selectOption('[data-testid="intake-field-gender"]', 'male');

    // Contact Info — add phone
    await page.click('[data-testid="intake-nav-contact_info"]');
    await page.click('[data-testid="add-phone-btn"]');
    await page.fill('[data-testid="phone-number-0"]', '555-987-6543');

    // Contact Info — add email
    await page.click('[data-testid="add-email-btn"]');
    await page.fill('[data-testid="email-address-0"]', 'integration@test.com');

    // Admission
    await page.click('[data-testid="intake-nav-admission"]');
    await page.fill('[data-testid="intake-field-admission_date"]', '2026-04-10');

    // Medical — allergies and medical_conditions required (jsonb)
    await page.click('[data-testid="intake-nav-medical"]');
    await page.fill('[data-testid="intake-field-allergies"]', 'Penicillin');
    await page.fill('[data-testid="intake-field-medical_conditions"]', 'Asthma');

    // Navigate to last section and submit
    await page.click('[data-testid="intake-nav-education"]');
    await expect(page.locator('[data-testid="intake-submit-button"]')).toBeEnabled();

    await page.click('[data-testid="intake-submit-button"]');

    // Should redirect to client detail page
    await page.waitForURL(/\/clients\/[a-f0-9-]+$/, { timeout: 10000 });

    // Client detail should show the name
    await expect(page.getByRole('heading', { name: /Integration Test/ })).toBeVisible();
  });
});

// ============================================================================
// Client Registration — Validation Indicators
// ============================================================================

test.describe('Client Registration — Validation', () => {
  test('progress bar starts at 0% with no fields filled', async ({ page }) => {
    await navigateToIntakeForm(page);

    const progressBar = page.getByRole('progressbar');
    // Progress bar element exists but at 0% width (only demographics visited on load)
    await expect(progressBar).toHaveAttribute('aria-valuenow', /^(0|10)$/);
  });

  test('section nav shows validation state after visiting', async ({ page }) => {
    await navigateToIntakeForm(page);

    // Visit demographics without filling required fields, then leave
    await page.click('[data-testid="intake-nav-contact_info"]');

    // Demographics nav should indicate it was visited (aria-current should NOT be 'step' anymore)
    const demographicsNav = page.locator('[data-testid="intake-nav-demographics"]');
    await expect(demographicsNav).not.toHaveAttribute('aria-current', 'step');
  });
});

// ============================================================================
// Client Registration — Organizational Unit Placement (Phase 6 / PR 1)
// ============================================================================

test.describe('Client Registration — Organizational Unit Placement', () => {
  test('OU picker on Admission section is rendered with mock seed OUs', async ({ page }) => {
    await navigateToIntakeForm(page);

    await page.click('[data-testid="intake-nav-admission"]');
    await expect(page.locator('[data-testid="intake-section-admission"]')).toBeVisible();

    // Wrapper testid for the OU TreeSelectDropdown
    const wrapper = page.locator('[data-testid="admission-ou-select"]');
    await expect(wrapper).toBeVisible();

    // Open the dropdown — combobox role is on the trigger button
    const trigger = wrapper.getByRole('combobox');
    await expect(trigger).toBeEnabled();
    await trigger.click();

    // At least one tree node should be rendered from the mock seed
    const nodes = page.locator('[data-testid="ou-tree-node"]');
    expect(await nodes.count()).toBeGreaterThan(0);
  });

  test('OU picker excludes inactive units (Old Wing filtered out)', async ({ page }) => {
    await navigateToIntakeForm(page);
    await page.click('[data-testid="intake-nav-admission"]');

    const wrapper = page.locator('[data-testid="admission-ou-select"]');
    await wrapper.getByRole('combobox').click();

    // Intake VM loads with { status: 'active' } — Old Wing (isActive=false) must not appear
    const oldWing = page.locator('[data-testid="ou-tree-node"][data-inactive="true"]');
    await expect(oldWing).toHaveCount(0);
  });

  test('intake without all three required placement fields emits no placement event', async ({
    page,
  }) => {
    // Exercises the multi-field guard in ClientIntakeFormViewModel.submit():
    // change_client_placement is only emitted when placement_arrangement,
    // organization_unit_id, AND admission_date are all set. This test fills
    // only admission_date, leaving the other two unset — no placement event.
    await navigateToIntakeForm(page);

    // Minimal required fields across sections
    await page.fill('[data-testid="intake-field-first_name"]', 'NoOu');
    await page.fill('[data-testid="intake-field-last_name"]', 'Client');
    await page.fill('[data-testid="intake-field-date_of_birth"]', '2013-06-01');
    await page.selectOption('[data-testid="intake-field-gender"]', 'female');

    await page.click('[data-testid="intake-nav-admission"]');
    await page.fill('[data-testid="intake-field-admission_date"]', '2026-04-15');
    // placement_arrangement and OU both left empty.

    await page.click('[data-testid="intake-nav-medical"]');
    await page.fill('[data-testid="intake-field-allergies"]', 'NKA');
    await page.fill('[data-testid="intake-field-medical_conditions"]', 'None');

    await page.click('[data-testid="intake-nav-education"]');
    await expect(page.locator('[data-testid="intake-submit-button"]')).toBeEnabled();
    await page.click('[data-testid="intake-submit-button"]');

    // On detail page: placement history section must be hidden since placements=[]
    await page.waitForURL(/\/clients\/[a-f0-9-]+$/, { timeout: 10000 });
    await expect(page.locator('[data-testid="client-overview"]')).toBeVisible();
    await expect(page.locator('[data-testid="section-placements"]')).not.toBeVisible();
  });

  test('intake with placement_arrangement + admission_date but no OU emits no placement event', async ({
    page,
  }) => {
    // OU-specific isolation of the multi-field guard. Two of the three required
    // fields are set; only OU is omitted. Verifies the guard treats OU as
    // strictly required rather than defaulting it to null and emitting anyway.
    await navigateToIntakeForm(page);

    await page.fill('[data-testid="intake-field-first_name"]', 'NoOu');
    await page.fill('[data-testid="intake-field-last_name"]', 'PlacementOnly');
    await page.fill('[data-testid="intake-field-date_of_birth"]', '2013-06-01');
    await page.selectOption('[data-testid="intake-field-gender"]', 'female');

    await page.click('[data-testid="intake-nav-admission"]');
    await page.fill('[data-testid="intake-field-admission_date"]', '2026-04-15');
    await page.selectOption(
      '[data-testid="intake-field-placement_arrangement"]',
      'residential_treatment'
    );
    // Deliberately skip the OU picker — verifies the OU-required path in isolation.

    await page.click('[data-testid="intake-nav-medical"]');
    await page.fill('[data-testid="intake-field-allergies"]', 'NKA');
    await page.fill('[data-testid="intake-field-medical_conditions"]', 'None');

    await page.click('[data-testid="intake-nav-education"]');
    await expect(page.locator('[data-testid="intake-submit-button"]')).toBeEnabled();
    await page.click('[data-testid="intake-submit-button"]');

    await page.waitForURL(/\/clients\/[a-f0-9-]+$/, { timeout: 10000 });
    await expect(page.locator('[data-testid="client-overview"]')).toBeVisible();
    // OU is one of the three required intake fields → no placement section rendered.
    await expect(page.locator('[data-testid="section-placements"]')).not.toBeVisible();
  });

  test('registering a client with OU selection shows OU name on placement card', async ({
    page,
  }) => {
    await navigateToIntakeForm(page);

    await page.fill('[data-testid="intake-field-first_name"]', 'WithOu');
    await page.fill('[data-testid="intake-field-last_name"]', 'Client');
    await page.fill('[data-testid="intake-field-date_of_birth"]', '2011-02-02');
    await page.selectOption('[data-testid="intake-field-gender"]', 'male');

    await page.click('[data-testid="intake-nav-admission"]');
    await page.fill('[data-testid="intake-field-admission_date"]', '2026-04-20');
    // Placement arrangement is required for change_client_placement to fire
    await page.selectOption(
      '[data-testid="intake-field-placement_arrangement"]',
      'residential_treatment'
    );

    // Pick an OU — open dropdown, expand the root, then click Main Campus.
    // Tree starts with all nodes collapsed; direct children require explicit expansion.
    const wrapper = page.locator('[data-testid="admission-ou-select"]');
    await wrapper.getByRole('combobox').click();
    const rootNode = page.locator('[data-testid="ou-tree-node"][data-root="true"]').first();
    await expect(rootNode).toBeVisible();
    await rootNode.getByRole('button', { name: /expand/i }).click();
    const mainCampus = page.locator('[data-testid="ou-tree-node"][data-node-id="ou-main-campus"]');
    await expect(mainCampus).toBeVisible();
    await mainCampus.locator('[data-testid="ou-name"]').click();

    // Dropdown closes; trigger should now show the selection
    await expect(wrapper.getByRole('combobox')).not.toContainText('Select an organizational unit');

    await page.click('[data-testid="intake-nav-medical"]');
    await page.fill('[data-testid="intake-field-allergies"]', 'NKA');
    await page.fill('[data-testid="intake-field-medical_conditions"]', 'None');

    await page.click('[data-testid="intake-nav-education"]');
    await expect(page.locator('[data-testid="intake-submit-button"]')).toBeEnabled();
    await page.click('[data-testid="intake-submit-button"]');

    await page.waitForURL(/\/clients\/[a-f0-9-]+$/, { timeout: 10000 });

    // Placement section now renders because change_client_placement created a row
    const placementSection = page.locator('[data-testid="section-placements"]');
    await expect(placementSection).toBeVisible();

    // OU label row surfaces the resolved name from the mock OU directory
    const ouLabel = placementSection.locator('[data-testid="placement-ou-label"]').first();
    await expect(ouLabel).toBeVisible();
    await expect(ouLabel).toContainText(/Main Campus/i);
    // Active OU must NOT carry the "(inactive)" suffix
    await expect(ouLabel).not.toContainText(/\(inactive\)/i);
  });
});
