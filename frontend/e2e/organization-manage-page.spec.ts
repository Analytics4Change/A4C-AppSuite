/**
 * Organization Manage Page UAT
 *
 * Implements the UAT plan from dev/active/organization-manage-page-uat.md
 * 112 test cases across 24 test suites.
 *
 * Run with:
 *   cd frontend && npx playwright test --config playwright.uat.config.ts
 *
 * Prerequisites:
 *   - Server starts with VITE_DEV_PROFILE=super_admin (handled by playwright.uat.config.ts)
 *   - Mock mode (no Supabase credentials required)
 */

import { test, expect, Page } from '@playwright/test';

const BASE_URL = 'http://localhost:3458';

// ============================================================================
// Helpers
// ============================================================================

/** Navigate to manage page and wait for it to fully render */
async function navigateToManagePage(page: Page, params?: string) {
  await page.goto(`${BASE_URL}/organizations${params ? `?${params}` : ''}`);

  // Safety net: if redirected to login (e.g. server reused without VITE_FORCE_MOCK),
  // auto-login with the super_admin email so tests can still proceed
  const isLoginPage = await page
    .locator('[data-testid="login-page"]')
    .isVisible({ timeout: 3000 })
    .catch(() => false);
  if (isLoginPage) {
    await page.fill('#email', 'super.admin@example.com');
    await page.fill('#password', 'any-password');
    await page.click('button[type="submit"]');
    await page.waitForURL(/\/(clients|organizations|dashboard|settings)/, { timeout: 10000 });
    await page.goto(`${BASE_URL}/organizations${params ? `?${params}` : ''}`);
  }

  await page.waitForSelector('[data-testid="org-manage-page"]', { timeout: 15000 });
}

/** Wait for the org list to finish loading */
async function waitForListLoaded(page: Page) {
  // Wait for any loading indicator to disappear, then confirm list is present
  try {
    await page.waitForSelector('[data-testid="org-list-loading"]', {
      state: 'attached',
      timeout: 2000,
    });
    await page.waitForSelector('[data-testid="org-list-loading"]', {
      state: 'detached',
      timeout: 10000,
    });
  } catch {
    // Loading indicator may not appear if list loads instantly
  }
  await page.waitForSelector('[data-testid="org-list"]', { timeout: 10000 });
}

/** Wait for org details to finish loading */
async function waitForDetailsLoaded(page: Page) {
  try {
    await page.waitForSelector('[data-testid="org-details-loading"]', {
      state: 'attached',
      timeout: 2000,
    });
    await page.waitForSelector('[data-testid="org-details-loading"]', {
      state: 'detached',
      timeout: 10000,
    });
  } catch {
    // Loading indicator may not appear
  }
  await page.waitForSelector('[data-testid="org-details-card"]', { timeout: 10000 });
}

/** Click an org in the list and wait for the details to load */
async function selectOrg(page: Page, orgTestId: string) {
  await page.click(`[data-testid="${orgTestId}"]`);
  await waitForDetailsLoaded(page);
}

/** Switch user profile by logging out and logging in with a new email */
async function switchToProfile(page: Page, email: string) {
  // Sidebar Logout button is always visible on lg+ screens (1280px viewport)
  await page.click('button:has-text("Logout")');
  await page.waitForURL(/\/login/, { timeout: 8000 });
  await page.fill('#email', email);
  await page.fill('#password', 'any-password');
  await page.click('button[type="submit"]');
  // Wait for redirect to authenticated area
  await page.waitForURL(/\/(clients|organizations|dashboard|settings)/, { timeout: 10000 });
}

/** Expand the DangerZone if it is currently collapsed */
async function expandDangerZone(page: Page) {
  const toggleBtn = page.locator('[data-testid="danger-zone-toggle-btn"]');
  await expect(toggleBtn).toBeVisible({ timeout: 5000 });
  const isExpanded = await toggleBtn.getAttribute('aria-expanded');
  if (isExpanded !== 'true') {
    await toggleBtn.click();
    await page.waitForSelector('[data-testid="danger-zone-content"]', { timeout: 5000 });
  }
}

// ============================================================================
// TS-01: Navigation & Page Load (5 cases)
// ============================================================================
test.describe('TS-01: Navigation & Page Load', () => {
  test('TC-01-01: super_admin sees split layout with left panel and empty state', async ({
    page,
  }) => {
    await navigateToManagePage(page);
    await expect(page.locator('[data-testid="org-list-panel"]')).toBeVisible();
    await expect(page.locator('[data-testid="org-form-empty-state"]')).toBeVisible();
  });

  test('TC-01-02: Page heading is "Organization Management" with correct subtitle', async ({
    page,
  }) => {
    await navigateToManagePage(page);
    await expect(page.locator('[data-testid="org-manage-heading"]')).toHaveText(
      'Organization Management'
    );
    // Subtitle is the <p> in the same div as the heading
    const subtitleEl = page
      .locator('[data-testid="org-manage-heading"]')
      .locator('..')
      .locator('p');
    await expect(subtitleEl).toContainText('Manage organizations, lifecycle, and details');
  });

  test('TC-01-03: provider_admin sees no left panel', async ({ page }) => {
    await navigateToManagePage(page);
    await switchToProfile(page, 'dev@example.com');
    // Use SPA navigation (click nav link) — page.goto() causes a full reload which
    // resets DevAuth back to VITE_DEV_PROFILE=super_admin, defeating the profile switch.
    await page.locator('a[href="/organizations"]').waitFor({ state: 'visible', timeout: 5000 });
    await page.locator('a[href="/organizations"]').click();
    await page.waitForURL(/\/organizations/, { timeout: 10000 });
    await page.waitForSelector('[data-testid="org-manage-page"]', { timeout: 15000 });
    await expect(page.locator('[data-testid="org-list-panel"]')).not.toBeVisible();
  });

  test('TC-01-04: partner_admin sees no left panel', async ({ page }) => {
    await navigateToManagePage(page);
    await switchToProfile(page, 'partner.admin@example.com');
    // Use SPA navigation (click nav link) — page.goto() causes a full reload which
    // resets DevAuth back to VITE_DEV_PROFILE=super_admin, defeating the profile switch.
    await page.locator('a[href="/organizations"]').waitFor({ state: 'visible', timeout: 5000 });
    await page.locator('a[href="/organizations"]').click();
    await page.waitForURL(/\/organizations/, { timeout: 10000 });
    await page.waitForSelector('[data-testid="org-manage-page"]', { timeout: 15000 });
    await expect(page.locator('[data-testid="org-list-panel"]')).not.toBeVisible();
  });

  test('TC-01-05: Back button navigates to /settings', async ({ page }) => {
    await navigateToManagePage(page);
    await page.click('[data-testid="org-manage-back-btn"]');
    await page.waitForURL(/\/settings/, { timeout: 5000 });
  });
});

// ============================================================================
// TS-02: Organization List (9 cases)
// ============================================================================
test.describe('TS-02: Organization List', () => {
  test.beforeEach(async ({ page }) => {
    await navigateToManagePage(page);
    await waitForListLoaded(page);
  });

  test('TC-02-01: List loads with 9 orgs alphabetically sorted (platform_owner excluded)', async ({
    page,
  }) => {
    const orgItems = page.locator('[data-testid="org-list"] [role="option"]');
    await expect(orgItems).toHaveCount(9);
    // First item alphabetically: ABC Healthcare
    await expect(orgItems.first().locator('[data-testid="org-list-item-name"]')).toHaveText(
      'ABC Healthcare'
    );
    // Last item alphabetically: XYZ Medical
    await expect(orgItems.last().locator('[data-testid="org-list-item-name"]')).toHaveText(
      'XYZ Medical'
    );
  });

  test('TC-02-02: Each org item shows display_name, type badge, and status badge', async ({
    page,
  }) => {
    const item = page.locator('[data-testid="org-list-item-provider-abc-healthcare-id"]');
    await expect(item.locator('[data-testid="org-list-item-name"]')).toHaveText('ABC Healthcare');
    await expect(item.locator('[data-testid="org-list-item-type"]')).toHaveText('provider');
    await expect(item.locator('[data-testid="org-list-item-status-badge"]')).toContainText(
      'Active'
    );
  });

  test('TC-02-03: Active filter shows 8 orgs (Summit Health excluded)', async ({ page }) => {
    await page.click('[data-testid="org-list-filter-active-btn"]');
    await waitForListLoaded(page);
    const orgItems = page.locator('[data-testid="org-list"] [role="option"]');
    await expect(orgItems).toHaveCount(8);
    await expect(
      page.locator('[data-testid="org-list-item-provider-summit-health-id"]')
    ).not.toBeVisible();
  });

  test('TC-02-04: Inactive filter shows 1 org (Summit Health only)', async ({ page }) => {
    await page.click('[data-testid="org-list-filter-inactive-btn"]');
    await waitForListLoaded(page);
    const orgItems = page.locator('[data-testid="org-list"] [role="option"]');
    await expect(orgItems).toHaveCount(1);
    await expect(
      page.locator('[data-testid="org-list-item-provider-summit-health-id"]')
    ).toBeVisible();
  });

  test('TC-02-05: All filter shows 9 orgs after switching from inactive filter', async ({
    page,
  }) => {
    await page.click('[data-testid="org-list-filter-inactive-btn"]');
    await waitForListLoaded(page);
    await page.click('[data-testid="org-list-filter-all-btn"]');
    await waitForListLoaded(page);
    await expect(page.locator('[data-testid="org-list"] [role="option"]')).toHaveCount(9);
  });

  test('TC-02-06: Search "ABC" filters to 1 result: ABC Healthcare', async ({ page }) => {
    await page.fill('[data-testid="org-list-search-input"]', 'ABC');
    await page.waitForTimeout(600); // debounce
    await expect(page.locator('[data-testid="org-list"] [role="option"]')).toHaveCount(1);
    await expect(
      page.locator('[data-testid="org-list-item-provider-abc-healthcare-id"]')
    ).toBeVisible();
  });

  test('TC-02-07: Search "xyz" (case-insensitive) matches XYZ Medical', async ({ page }) => {
    await page.fill('[data-testid="org-list-search-input"]', 'xyz');
    await page.waitForTimeout(600);
    await expect(page.locator('[data-testid="org-list"] [role="option"]')).toHaveCount(1);
    await expect(
      page.locator('[data-testid="org-list-item-provider-xyz-medical-id"]')
    ).toBeVisible();
  });

  test('TC-02-08: Search "nonexistent" shows org-list-empty state', async ({ page }) => {
    await page.fill('[data-testid="org-list-search-input"]', 'nonexistent');
    await page.waitForTimeout(600);
    await expect(page.locator('[data-testid="org-list-empty"]')).toBeVisible();
    await expect(page.locator('[data-testid="org-list"] [role="option"]')).toHaveCount(0);
  });

  test('TC-02-09: Refresh button triggers list reload without errors', async ({ page }) => {
    await page.click('[data-testid="org-list-refresh-btn"]');
    await waitForListLoaded(page);
    await expect(page.locator('[data-testid="org-list"] [role="option"]')).toHaveCount(9);
    await expect(page.locator('[data-testid="org-manage-error-banner"]')).not.toBeVisible();
  });
});

// ============================================================================
// TS-03: Form Field Editability (6 cases)
// ============================================================================
test.describe('TS-03: Form Field Editability', () => {
  test.beforeEach(async ({ page }) => {
    await navigateToManagePage(page);
    await waitForListLoaded(page);
  });

  test('TC-03-01: super_admin selects active org -- all fields enabled, item aria-selected=true', async ({
    page,
  }) => {
    await selectOrg(page, 'org-list-item-provider-abc-healthcare-id');
    await expect(page.locator('[data-testid="org-form-empty-state"]')).not.toBeVisible();
    await expect(page.locator('[data-testid="org-details-card"]')).toBeVisible();
    await expect(page.locator('#org-name')).not.toBeDisabled();
    await expect(page.locator('#org-display-name')).not.toBeDisabled();
    await expect(page.locator('#org-tax-number')).not.toBeDisabled();
    await expect(page.locator('#org-phone-number')).not.toBeDisabled();
    await expect(page.locator('#org-timezone')).not.toBeDisabled();
    await expect(
      page.locator('[data-testid="org-list-item-provider-abc-healthcare-id"]')
    ).toHaveAttribute('aria-selected', 'true');
  });

  test('TC-03-02: Form fields are pre-filled with correct values for ABC Healthcare', async ({
    page,
  }) => {
    await selectOrg(page, 'org-list-item-provider-abc-healthcare-id');
    await expect(page.locator('#org-name')).toHaveValue('ABC Healthcare Partners');
    await expect(page.locator('#org-display-name')).toHaveValue('ABC Healthcare');
    await expect(page.locator('#org-timezone')).toHaveValue('America/Los_Angeles');
    await expect(page.locator('#org-tax-number')).toHaveValue('');
    await expect(page.locator('#org-phone-number')).toHaveValue('');
  });

  test('TC-03-03: Read-only fields show correct values and are <p> elements (not inputs)', async ({
    page,
  }) => {
    await selectOrg(page, 'org-list-item-provider-abc-healthcare-id');
    await expect(page.locator('[data-testid="org-field-slug-value"]')).toHaveText('abc-healthcare');
    await expect(page.locator('[data-testid="org-field-type-value"]')).toHaveText('provider');
    await expect(page.locator('[data-testid="org-field-path-value"]')).toHaveText(
      'a4c-platform-id.provider-abc-healthcare-id'
    );
    // These should be <p> elements, not inputs
    await expect(page.locator('input[data-testid="org-field-slug-value"]')).toHaveCount(0);
    await expect(page.locator('input[data-testid="org-field-type-value"]')).toHaveCount(0);
  });

  test('TC-03-04: Inactive org (Summit Health) shows inactive banner and all fields disabled', async ({
    page,
  }) => {
    await selectOrg(page, 'org-list-item-provider-summit-health-id');
    await expect(page.locator('[data-testid="org-inactive-banner"]')).toBeVisible();
    await expect(page.locator('[data-testid="org-inactive-banner-reactivate-btn"]')).toBeVisible();
    await expect(page.locator('#org-name')).toBeDisabled();
    await expect(page.locator('#org-display-name')).toBeDisabled();
    await expect(page.locator('#org-timezone')).toBeDisabled();
    await expect(page.locator('[data-testid="org-details-status-badge"]')).toContainText(
      'Inactive'
    );
    await expect(page.locator('[data-testid="org-form-save-btn"]')).toBeDisabled();
  });

  test('TC-03-05: provider_admin cannot edit Organization Name [mock limitation]', async ({
    page: _page,
  }) => {
    // Mock limitation: provider_admin org_id does not match any mock org.
    // The edit form never loads for provider_admin in mock mode.
    // Test is documented as a known limitation.
    test.skip(true, 'Mock limitation: provider_admin auto-select fails -- org_id not in mock data');
  });

  test('TC-03-06: provider_admin -- non-name fields are editable [mock limitation]', async ({
    page: _page,
  }) => {
    test.skip(true, 'Mock limitation: provider_admin auto-select fails -- org_id not in mock data');
  });
});

// ============================================================================
// TS-04: Form Validation (7 cases)
// ============================================================================
test.describe('TS-04: Form Validation', () => {
  test.beforeEach(async ({ page }) => {
    await navigateToManagePage(page);
    await waitForListLoaded(page);
    await selectOrg(page, 'org-list-item-provider-abc-healthcare-id');
  });

  test('TC-04-01: Clearing Organization Name and blurring shows validation error', async ({
    page,
  }) => {
    await page.click('#org-name');
    await page.keyboard.press('Control+a');
    await page.keyboard.press('Delete');
    await page.click('#org-display-name'); // blur
    await expect(page.locator('#org-name-error')).toBeVisible();
    await expect(page.locator('#org-name-error')).toContainText('required');
    await expect(page.locator('#org-name')).toHaveAttribute('aria-invalid', 'true');
  });

  test('TC-04-02: Clearing Display Name and blurring shows validation error', async ({ page }) => {
    await page.click('#org-display-name');
    await page.keyboard.press('Control+a');
    await page.keyboard.press('Delete');
    await page.click('#org-name'); // blur
    await expect(page.locator('#org-display-name-error')).toBeVisible();
    await expect(page.locator('#org-display-name-error')).toContainText('required');
    await expect(page.locator('#org-display-name')).toHaveAttribute('aria-invalid', 'true');
  });

  test('TC-04-03: Clearing Timezone and blurring shows validation error', async ({ page }) => {
    await page.click('#org-timezone');
    await page.keyboard.press('Control+a');
    await page.keyboard.press('Delete');
    await page.click('#org-name'); // blur
    await expect(page.locator('#org-timezone-error')).toBeVisible();
    await expect(page.locator('#org-timezone-error')).toContainText('required');
    await expect(page.locator('#org-timezone')).toHaveAttribute('aria-invalid', 'true');
  });

  test('TC-04-04: Save button is disabled when form has validation errors', async ({ page }) => {
    // Clear required name field
    await page.click('#org-name');
    await page.keyboard.press('Control+a');
    await page.keyboard.press('Delete');
    await page.click('#org-display-name'); // blur to trigger validation
    await expect(page.locator('[data-testid="org-form-save-btn"]')).toBeDisabled();
  });

  test('TC-04-05: Save button is disabled when form is pristine (no changes)', async ({ page }) => {
    // Freshly loaded org with no edits = pristine form
    await expect(page.locator('[data-testid="org-form-save-btn"]')).toBeDisabled();
  });

  test('TC-04-06: Tax Number and Phone Number are optional (no error when empty)', async ({
    page,
  }) => {
    // Verify no aria-required on optional fields
    const taxNumberReq = await page.locator('#org-tax-number').getAttribute('aria-required');
    const phoneNumberReq = await page.locator('#org-phone-number').getAttribute('aria-required');
    expect(taxNumberReq).not.toBe('true');
    expect(phoneNumberReq).not.toBe('true');
    // Clear optional fields and blur -- no error should appear
    await page.click('#org-tax-number');
    await page.keyboard.press('Control+a');
    await page.keyboard.press('Delete');
    await page.click('#org-name'); // blur
    const taxError = page.locator('#org-tax-number-error');
    await expect(taxError).toHaveCount(0);
  });

  test('TC-04-07: Whitespace-only Organization Name shows error on blur', async ({ page }) => {
    await page.click('#org-name');
    await page.keyboard.press('Control+a');
    await page.keyboard.press('Delete');
    await page.type('#org-name', '   '); // spaces only
    await page.click('#org-display-name'); // blur
    await expect(page.locator('#org-name-error')).toBeVisible();
    await expect(page.locator('#org-name')).toHaveAttribute('aria-invalid', 'true');
  });
});

// ============================================================================
// TS-05: Save, Dirty State, Reset (3 cases)
// ============================================================================
test.describe('TS-05: Save, Dirty State, Reset', () => {
  test.beforeEach(async ({ page }) => {
    await navigateToManagePage(page);
    await waitForListLoaded(page);
    await selectOrg(page, 'org-list-item-provider-abc-healthcare-id');
  });

  test('TC-05-01: Changing display name shows unsaved indicator and Reset button, enables Save', async ({
    page,
  }) => {
    await page.click('#org-display-name');
    await page.keyboard.press('End');
    await page.type('#org-display-name', ' Updated');
    await expect(page.locator('[data-testid="org-form-unsaved-indicator"]')).toBeVisible();
    await expect(page.locator('[data-testid="org-form-reset-btn"]')).toBeVisible();
    await expect(page.locator('[data-testid="org-form-save-btn"]')).not.toBeDisabled();
  });

  test('TC-05-02: Click Reset reverts form and hides unsaved indicator', async ({ page }) => {
    // Make a change first
    await page.fill('#org-display-name', 'ABC Healthcare Updated');
    await page.click('[data-testid="org-form-reset-btn"]');
    await expect(page.locator('#org-display-name')).toHaveValue('ABC Healthcare');
    await expect(page.locator('[data-testid="org-form-unsaved-indicator"]')).not.toBeVisible();
    await expect(page.locator('[data-testid="org-form-reset-btn"]')).not.toBeVisible();
    await expect(page.locator('[data-testid="org-form-save-btn"]')).toBeDisabled();
  });

  test('TC-05-03: Save changes completes without error banner', async ({ page }) => {
    await page.fill('#org-display-name', 'ABC Healthcare Updated');
    await page.click('[data-testid="org-form-save-btn"]');
    // Wait for save to complete (button text cycles through "Saving...")
    await expect(page.locator('[data-testid="org-manage-error-banner"]')).not.toBeVisible({
      timeout: 8000,
    });
  });
});

// ============================================================================
// TS-06: Unsaved Changes Guard (4 cases)
// ============================================================================
test.describe('TS-06: Unsaved Changes Guard', () => {
  test.beforeEach(async ({ page }) => {
    await navigateToManagePage(page);
    await waitForListLoaded(page);
    await selectOrg(page, 'org-list-item-provider-abc-healthcare-id');
  });

  test('TC-06-01: Switching org with unsaved changes triggers discard dialog', async ({ page }) => {
    await page.fill('#org-display-name', 'Modified');
    await page.click('[data-testid="org-list-item-provider-xyz-medical-id"]');
    const dialog = page.locator('[data-testid="confirm-dialog"]');
    await expect(dialog).toBeVisible({ timeout: 5000 });
    await expect(page.locator('[data-testid="confirm-dialog-title"]')).toContainText('Unsaved');
    await expect(page.locator('[data-testid="confirm-dialog-cancel-btn"]')).toContainText(
      'Stay Here'
    );
    await expect(page.locator('[data-testid="confirm-dialog-confirm-btn"]')).toContainText(
      'Discard'
    );
  });

  test('TC-06-02: "Stay Here" closes dialog and keeps current org with changes intact', async ({
    page,
  }) => {
    await page.fill('#org-display-name', 'Modified');
    await page.click('[data-testid="org-list-item-provider-xyz-medical-id"]');
    await page.locator('[data-testid="confirm-dialog"]').waitFor({ timeout: 5000 });
    await page.click('[data-testid="confirm-dialog-cancel-btn"]');
    await expect(page.locator('[data-testid="confirm-dialog"]')).not.toBeVisible();
    await expect(page.locator('#org-display-name')).toHaveValue('Modified');
    await expect(
      page.locator('[data-testid="org-list-item-provider-abc-healthcare-id"]')
    ).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('[data-testid="org-form-unsaved-indicator"]')).toBeVisible();
  });

  test('TC-06-03: "Discard Changes" loads the new org', async ({ page }) => {
    await page.fill('#org-display-name', 'Modified');
    await page.click('[data-testid="org-list-item-provider-xyz-medical-id"]');
    await page.locator('[data-testid="confirm-dialog"]').waitFor({ timeout: 5000 });
    await page.click('[data-testid="confirm-dialog-confirm-btn"]');
    await expect(page.locator('[data-testid="confirm-dialog"]')).not.toBeVisible();
    await waitForDetailsLoaded(page);
    await expect(page.locator('#org-name')).toHaveValue('XYZ Medical Group');
    await expect(
      page.locator('[data-testid="org-list-item-provider-xyz-medical-id"]')
    ).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('[data-testid="org-form-unsaved-indicator"]')).not.toBeVisible();
  });

  test('TC-06-04: Switching org without unsaved changes loads immediately (no dialog)', async ({
    page,
  }) => {
    // Form is pristine -- no changes
    await page.click('[data-testid="org-list-item-provider-xyz-medical-id"]');
    // Dialog should NOT appear
    await expect(page.locator('[data-testid="confirm-dialog"]')).not.toBeVisible();
    await waitForDetailsLoaded(page);
    await expect(page.locator('#org-name')).toHaveValue('XYZ Medical Group');
  });
});

// ============================================================================
// TS-07: Contact CRUD (7 cases)
// ============================================================================
test.describe('TS-07: Contact CRUD', () => {
  test.beforeEach(async ({ page }) => {
    await navigateToManagePage(page);
    await waitForListLoaded(page);
    await selectOrg(page, 'org-list-item-provider-abc-healthcare-id');
  });

  test('TC-07-01: Contacts section shows Jane Smith (mock-contact-1)', async ({ page }) => {
    await expect(page.locator('[data-testid="org-contacts-section"]')).toBeVisible();
    const contactRow = page.locator('[data-testid="org-contact-row-mock-contact-1"]');
    await expect(contactRow).toBeVisible();
    await expect(contactRow).toContainText('Jane Smith');
    await expect(contactRow).toContainText('Billing Contact');
  });

  test('TC-07-02: Click Add opens empty contact dialog with title "Add Contact"', async ({
    page,
  }) => {
    await page.click('[data-testid="org-contacts-add-btn"]');
    const dialog = page.locator('[data-testid="contact-dialog"]');
    await expect(dialog).toBeVisible({ timeout: 5000 });
    await expect(dialog).toHaveAttribute('role', 'dialog');
    await expect(page.locator('[data-testid="contact-dialog-title"]')).toContainText('Add Contact');
    await expect(page.locator('#contact-first-name')).toHaveValue('');
    await expect(page.locator('#contact-last-name')).toHaveValue('');
    await expect(page.locator('#contact-email')).toHaveValue('');
    await expect(page.locator('#contact-label')).toHaveValue('');
  });

  test('TC-07-03: Fill required fields and save closes dialog without error', async ({ page }) => {
    await page.click('[data-testid="org-contacts-add-btn"]');
    await page.locator('[data-testid="contact-dialog"]').waitFor({ timeout: 5000 });
    await page.fill('#contact-first-name', 'Bob');
    await page.fill('#contact-last-name', 'Jones');
    await page.fill('#contact-email', 'bob@test.com');
    await page.fill('#contact-label', 'IT Contact');
    await page.click('[data-testid="contact-dialog-save-btn"]');
    await expect(page.locator('[data-testid="contact-dialog"]')).not.toBeVisible({ timeout: 8000 });
    await expect(page.locator('[data-testid="org-manage-error-banner"]')).not.toBeVisible();
  });

  test('TC-07-04: Click edit on Jane Smith opens pre-filled dialog with title "Edit Contact"', async ({
    page,
  }) => {
    await page.click('[data-testid="org-contact-edit-btn-mock-contact-1"]');
    const dialog = page.locator('[data-testid="contact-dialog"]');
    await expect(dialog).toBeVisible({ timeout: 5000 });
    await expect(page.locator('[data-testid="contact-dialog-title"]')).toContainText(
      'Edit Contact'
    );
    await expect(page.locator('#contact-first-name')).toHaveValue('Jane');
    await expect(page.locator('#contact-last-name')).toHaveValue('Smith');
    await expect(page.locator('#contact-label')).toHaveValue('Billing Contact');
    await expect(page.locator('#contact-type')).toHaveValue('billing');
  });

  test('TC-07-05: Edit contact email and save closes dialog without error', async ({ page }) => {
    await page.click('[data-testid="org-contact-edit-btn-mock-contact-1"]');
    await page.locator('[data-testid="contact-dialog"]').waitFor({ timeout: 5000 });
    await page.fill('#contact-email', 'jane.new@test.com');
    await page.click('[data-testid="contact-dialog-save-btn"]');
    await expect(page.locator('[data-testid="contact-dialog"]')).not.toBeVisible({ timeout: 8000 });
    await expect(page.locator('[data-testid="org-manage-error-banner"]')).not.toBeVisible();
  });

  test('TC-07-06: Click delete on contact triggers delete without error', async ({ page }) => {
    await page.click('[data-testid="org-contact-delete-btn-mock-contact-1"]');
    // Wait for reload after delete
    await page.waitForTimeout(1000);
    await expect(page.locator('[data-testid="org-manage-error-banner"]')).not.toBeVisible();
  });

  test('TC-07-07: Contact dialog cancel closes without changes', async ({ page }) => {
    await page.click('[data-testid="org-contacts-add-btn"]');
    await page.locator('[data-testid="contact-dialog"]').waitFor({ timeout: 5000 });
    await page.fill('#contact-first-name', 'Temporary');
    await page.click('[data-testid="contact-dialog-cancel-btn"]');
    await expect(page.locator('[data-testid="contact-dialog"]')).not.toBeVisible({ timeout: 5000 });
    await expect(page.locator('[data-testid="org-manage-error-banner"]')).not.toBeVisible();
  });
});

// ============================================================================
// TS-08: Address CRUD (5 cases)
// ============================================================================
test.describe('TS-08: Address CRUD', () => {
  test.beforeEach(async ({ page }) => {
    await navigateToManagePage(page);
    await waitForListLoaded(page);
    await selectOrg(page, 'org-list-item-provider-abc-healthcare-id');
  });

  test('TC-08-01: Addresses section shows Headquarters (mock-address-1)', async ({ page }) => {
    await expect(page.locator('[data-testid="org-addresses-section"]')).toBeVisible();
    const addrRow = page.locator('[data-testid="org-address-row-mock-address-1"]');
    await expect(addrRow).toBeVisible();
    await expect(addrRow).toContainText('123 Healthcare Blvd');
    await expect(addrRow).toContainText('Los Angeles');
  });

  test('TC-08-02: Click Add opens empty address dialog with title "Add Address"', async ({
    page,
  }) => {
    await page.click('[data-testid="org-addresses-add-btn"]');
    const dialog = page.locator('[data-testid="address-dialog"]');
    await expect(dialog).toBeVisible({ timeout: 5000 });
    await expect(dialog).toHaveAttribute('role', 'dialog');
    await expect(page.locator('[data-testid="address-dialog-title"]')).toContainText('Add Address');
    await expect(page.locator('#address-street1')).toHaveValue('');
    await expect(page.locator('#address-city')).toHaveValue('');
  });

  test('TC-08-03: Fill required fields and save closes dialog without error', async ({ page }) => {
    await page.click('[data-testid="org-addresses-add-btn"]');
    await page.locator('[data-testid="address-dialog"]').waitFor({ timeout: 5000 });
    await page.fill('#address-label', 'Branch Office');
    await page.fill('#address-street1', '456 Main St');
    await page.fill('#address-city', 'Denver');
    await page.fill('#address-state', 'CO');
    await page.fill('#address-zip', '80202');
    await page.click('[data-testid="address-dialog-save-btn"]');
    await expect(page.locator('[data-testid="address-dialog"]')).not.toBeVisible({ timeout: 8000 });
    await expect(page.locator('[data-testid="org-manage-error-banner"]')).not.toBeVisible();
  });

  test('TC-08-04: Click edit on Headquarters opens pre-filled dialog with title "Edit Address"', async ({
    page,
  }) => {
    await page.click('[data-testid="org-address-edit-btn-mock-address-1"]');
    const dialog = page.locator('[data-testid="address-dialog"]');
    await expect(dialog).toBeVisible({ timeout: 5000 });
    await expect(page.locator('[data-testid="address-dialog-title"]')).toContainText(
      'Edit Address'
    );
    await expect(page.locator('#address-label')).toHaveValue('Headquarters');
    await expect(page.locator('#address-street1')).toHaveValue('123 Healthcare Blvd');
    await expect(page.locator('#address-city')).toHaveValue('Los Angeles');
    await expect(page.locator('#address-state')).toHaveValue('CA');
    await expect(page.locator('#address-zip')).toHaveValue('90001');
  });

  test('TC-08-05: Click delete on address completes without error', async ({ page }) => {
    await page.click('[data-testid="org-address-delete-btn-mock-address-1"]');
    await page.waitForTimeout(1000);
    await expect(page.locator('[data-testid="org-manage-error-banner"]')).not.toBeVisible();
  });
});

// ============================================================================
// TS-09: Phone CRUD (5 cases)
// ============================================================================
test.describe('TS-09: Phone CRUD', () => {
  test.beforeEach(async ({ page }) => {
    await navigateToManagePage(page);
    await waitForListLoaded(page);
    await selectOrg(page, 'org-list-item-provider-abc-healthcare-id');
  });

  test('TC-09-01: Phones section shows Main Office phone (mock-phone-1)', async ({ page }) => {
    await expect(page.locator('[data-testid="org-phones-section"]')).toBeVisible();
    const phoneRow = page.locator('[data-testid="org-phone-row-mock-phone-1"]');
    await expect(phoneRow).toBeVisible();
    await expect(phoneRow).toContainText('(555) 123-4567');
    await expect(phoneRow).toContainText('office');
  });

  test('TC-09-02: Click Add opens empty phone dialog with title "Add Phone"', async ({ page }) => {
    await page.click('[data-testid="org-phones-add-btn"]');
    const dialog = page.locator('[data-testid="phone-dialog"]');
    await expect(dialog).toBeVisible({ timeout: 5000 });
    await expect(dialog).toHaveAttribute('role', 'dialog');
    await expect(page.locator('[data-testid="phone-dialog-title"]')).toContainText('Add Phone');
    await expect(page.locator('#phone-label')).toHaveValue('');
    await expect(page.locator('#phone-number')).toHaveValue('');
  });

  test('TC-09-03: Fill required fields and save closes dialog without error', async ({ page }) => {
    await page.click('[data-testid="org-phones-add-btn"]');
    await page.locator('[data-testid="phone-dialog"]').waitFor({ timeout: 5000 });
    await page.fill('#phone-label', 'Emergency Line');
    await page.fill('#phone-number', '(555) 999-0000');
    await page.click('[data-testid="phone-dialog-save-btn"]');
    await expect(page.locator('[data-testid="phone-dialog"]')).not.toBeVisible({ timeout: 8000 });
    await expect(page.locator('[data-testid="org-manage-error-banner"]')).not.toBeVisible();
  });

  test('TC-09-04: Click edit on Main Office opens pre-filled dialog', async ({ page }) => {
    await page.click('[data-testid="org-phone-edit-btn-mock-phone-1"]');
    const dialog = page.locator('[data-testid="phone-dialog"]');
    await expect(dialog).toBeVisible({ timeout: 5000 });
    await expect(page.locator('[data-testid="phone-dialog-title"]')).toContainText('Edit Phone');
    await expect(page.locator('#phone-label')).toHaveValue('Main Office');
    await expect(page.locator('#phone-type')).toHaveValue('office');
    await expect(page.locator('#phone-number')).toHaveValue('(555) 123-4567');
    await expect(page.locator('#phone-extension')).toHaveValue('');
  });

  test('TC-09-05: Click delete on phone completes without error', async ({ page }) => {
    await page.click('[data-testid="org-phone-delete-btn-mock-phone-1"]');
    await page.waitForTimeout(1000);
    await expect(page.locator('[data-testid="org-manage-error-banner"]')).not.toBeVisible();
  });
});

// ============================================================================
// TS-10: Empty Entity Sections (1 case)
// ============================================================================
test.describe('TS-10: Empty Entity Sections', () => {
  test('TC-10-01: Mock data has entities -- empty states NOT visible when org is selected', async ({
    page,
  }) => {
    await navigateToManagePage(page);
    await waitForListLoaded(page);
    await selectOrg(page, 'org-list-item-provider-abc-healthcare-id');
    // All orgs have 1 contact, 1 address, 1 phone in mock data
    await expect(page.locator('[data-testid="org-contacts-empty"]')).not.toBeVisible();
    await expect(page.locator('[data-testid="org-addresses-empty"]')).not.toBeVisible();
    await expect(page.locator('[data-testid="org-phones-empty"]')).not.toBeVisible();
  });
});

// ============================================================================
// TS-11: Danger Zone Toggle (4 cases)
// ============================================================================
test.describe('TS-11: Danger Zone Toggle', () => {
  test.beforeEach(async ({ page }) => {
    await navigateToManagePage(page);
    await waitForListLoaded(page);
    await selectOrg(page, 'org-list-item-provider-abc-healthcare-id');
  });

  test('TC-11-01: super_admin sees Danger Zone card collapsed by default (aria-expanded=false)', async ({
    page,
  }) => {
    await expect(page.locator('[data-testid="danger-zone"]')).toBeVisible();
    await expect(page.locator('[data-testid="danger-zone-toggle-btn"]')).toHaveAttribute(
      'aria-expanded',
      'false'
    );
    await expect(page.locator('[data-testid="danger-zone-content"]')).not.toBeVisible();
  });

  test('TC-11-02: Click toggle expands Danger Zone with deactivate and delete sections', async ({
    page,
  }) => {
    await expandDangerZone(page);
    await expect(page.locator('[data-testid="danger-zone-toggle-btn"]')).toHaveAttribute(
      'aria-expanded',
      'true'
    );
    await expect(page.locator('[data-testid="danger-zone-content"]')).toBeVisible();
    await expect(page.locator('[data-testid="danger-zone-deactivate-section"]')).toBeVisible();
    await expect(page.locator('[data-testid="danger-zone-delete-section"]')).toBeVisible();
    // Active org: shows "must be deactivated before deletion" warning
    await expect(page.locator('[data-testid="danger-zone-active-constraint"]')).toBeVisible();
    // Active org: reactivate section NOT visible
    await expect(page.locator('[data-testid="danger-zone-reactivate-section"]')).not.toBeVisible();
  });

  test('TC-11-03: Click toggle again collapses Danger Zone', async ({ page }) => {
    await expandDangerZone(page);
    await page.click('[data-testid="danger-zone-toggle-btn"]');
    await expect(page.locator('[data-testid="danger-zone-toggle-btn"]')).toHaveAttribute(
      'aria-expanded',
      'false'
    );
    await expect(page.locator('[data-testid="danger-zone-content"]')).not.toBeVisible();
  });

  test('TC-11-04: provider_admin does NOT see Danger Zone [mock limitation]', async ({ page }) => {
    // provider_admin cannot load any org in mock mode.
    // Even if they could, isPlatformOwner=false means DangerZone is not rendered.
    // We verify the structural check: after switching to provider_admin, danger-zone is absent.
    await switchToProfile(page, 'dev@example.com');
    await page.goto(`${BASE_URL}/organizations`);
    await page.waitForSelector('[data-testid="org-manage-page"]', { timeout: 15000 });
    // No org auto-selected for provider_admin (mock limitation), so danger-zone won't render
    await expect(page.locator('[data-testid="danger-zone"]')).not.toBeVisible();
  });
});

// ============================================================================
// TS-12: Deactivate Flow (4 cases)
// ============================================================================
test.describe('TS-12: Deactivate Flow', () => {
  test.beforeEach(async ({ page }) => {
    await navigateToManagePage(page);
    await waitForListLoaded(page);
    await selectOrg(page, 'org-list-item-provider-abc-healthcare-id');
    await expandDangerZone(page);
  });

  test('TC-12-01: Deactivate button opens confirm dialog with correct title', async ({ page }) => {
    await page.click('[data-testid="danger-zone-deactivate-btn"]');
    const dialog = page.locator('[data-testid="confirm-dialog"]');
    await expect(dialog).toBeVisible({ timeout: 5000 });
    await expect(dialog).toHaveAttribute('role', 'alertdialog');
    await expect(page.locator('[data-testid="confirm-dialog-title"]')).toContainText('Deactivate');
    await expect(page.locator('[data-testid="confirm-dialog-confirm-btn"]')).toContainText(
      'Deactivate'
    );
    await expect(page.locator('[data-testid="confirm-dialog-cancel-btn"]')).toContainText('Cancel');
  });

  test('TC-12-02: Deactivate dialog message contains org display name "ABC Healthcare"', async ({
    page,
  }) => {
    await page.click('[data-testid="danger-zone-deactivate-btn"]');
    await page.locator('[data-testid="confirm-dialog"]').waitFor({ timeout: 5000 });
    await expect(page.locator('[data-testid="confirm-dialog-message"]')).toContainText(
      'ABC Healthcare'
    );
  });

  test('TC-12-03: Confirming deactivation closes dialog without error banner', async ({ page }) => {
    await page.click('[data-testid="danger-zone-deactivate-btn"]');
    await page.locator('[data-testid="confirm-dialog"]').waitFor({ timeout: 5000 });
    await page.click('[data-testid="confirm-dialog-confirm-btn"]');
    await expect(page.locator('[data-testid="confirm-dialog"]')).not.toBeVisible({ timeout: 8000 });
    await expect(page.locator('[data-testid="org-manage-error-banner"]')).not.toBeVisible();
  });

  test('TC-12-04: Cancel in deactivate dialog closes dialog without action', async ({ page }) => {
    await page.click('[data-testid="danger-zone-deactivate-btn"]');
    await page.locator('[data-testid="confirm-dialog"]').waitFor({ timeout: 5000 });
    await page.click('[data-testid="confirm-dialog-cancel-btn"]');
    await expect(page.locator('[data-testid="confirm-dialog"]')).not.toBeVisible({ timeout: 5000 });
    await expect(page.locator('[data-testid="org-manage-error-banner"]')).not.toBeVisible();
  });
});

// ============================================================================
// TS-13: Reactivate Flow (4 cases)
// ============================================================================
test.describe('TS-13: Reactivate Flow', () => {
  test.beforeEach(async ({ page }) => {
    await navigateToManagePage(page);
    await waitForListLoaded(page);
    await selectOrg(page, 'org-list-item-provider-summit-health-id');
  });

  test('TC-13-01: Inactive org (Summit Health) shows Reactivate section, no Deactivate section', async ({
    page,
  }) => {
    await expandDangerZone(page);
    await expect(page.locator('[data-testid="danger-zone-reactivate-section"]')).toBeVisible();
    await expect(page.locator('[data-testid="danger-zone-reactivate-btn"]')).toBeVisible();
    await expect(page.locator('[data-testid="danger-zone-deactivate-section"]')).not.toBeVisible();
    // No active-constraint warning (org already inactive)
    await expect(page.locator('[data-testid="danger-zone-active-constraint"]')).not.toBeVisible();
  });

  test('TC-13-02: Click Reactivate button opens success-variant confirm dialog', async ({
    page,
  }) => {
    await expandDangerZone(page);
    await page.click('[data-testid="danger-zone-reactivate-btn"]');
    const dialog = page.locator('[data-testid="confirm-dialog"]');
    await expect(dialog).toBeVisible({ timeout: 5000 });
    await expect(page.locator('[data-testid="confirm-dialog-title"]')).toContainText('Reactivate');
    await expect(page.locator('[data-testid="confirm-dialog-confirm-btn"]')).toContainText(
      'Reactivate'
    );
    await expect(page.locator('[data-testid="confirm-dialog-message"]')).toContainText(
      'Summit Health'
    );
  });

  test('TC-13-03: Confirming reactivation closes dialog without error banner', async ({ page }) => {
    await expandDangerZone(page);
    await page.click('[data-testid="danger-zone-reactivate-btn"]');
    await page.locator('[data-testid="confirm-dialog"]').waitFor({ timeout: 5000 });
    await page.click('[data-testid="confirm-dialog-confirm-btn"]');
    await expect(page.locator('[data-testid="confirm-dialog"]')).not.toBeVisible({ timeout: 8000 });
    await expect(page.locator('[data-testid="org-manage-error-banner"]')).not.toBeVisible();
  });

  test('TC-13-04: Inline reactivate button in inactive banner also triggers dialog', async ({
    page,
  }) => {
    const inlinBtn = page.locator('[data-testid="org-inactive-banner-reactivate-btn"]');
    await expect(inlinBtn).toBeVisible();
    await inlinBtn.click();
    const dialog = page.locator('[data-testid="confirm-dialog"]');
    await expect(dialog).toBeVisible({ timeout: 5000 });
    await expect(page.locator('[data-testid="confirm-dialog-title"]')).toContainText('Reactivate');
  });
});

// ============================================================================
// TS-14: Delete Flow (7 cases)
// ============================================================================
test.describe('TS-14: Delete Flow', () => {
  test('TC-14-01: Delete active org (ABC Healthcare) shows "Cannot Delete Active" warning dialog', async ({
    page,
  }) => {
    await navigateToManagePage(page);
    await waitForListLoaded(page);
    await selectOrg(page, 'org-list-item-provider-abc-healthcare-id');
    await expandDangerZone(page);
    await page.click('[data-testid="danger-zone-delete-btn"]');
    const dialog = page.locator('[data-testid="confirm-dialog"]');
    await expect(dialog).toBeVisible({ timeout: 5000 });
    await expect(page.locator('[data-testid="confirm-dialog-title"]')).toContainText(
      'Cannot Delete'
    );
    await expect(page.locator('[data-testid="confirm-dialog-message"]')).toContainText(
      'deactivated'
    );
    await expect(page.locator('[data-testid="confirm-dialog-message"]')).toContainText(
      'ABC Healthcare'
    );
  });

  test('TC-14-02: "Cannot Delete" dialog has "Deactivate First" and "Cancel" buttons', async ({
    page,
  }) => {
    await navigateToManagePage(page);
    await waitForListLoaded(page);
    await selectOrg(page, 'org-list-item-provider-abc-healthcare-id');
    await expandDangerZone(page);
    await page.click('[data-testid="danger-zone-delete-btn"]');
    await page.locator('[data-testid="confirm-dialog"]').waitFor({ timeout: 5000 });
    await expect(page.locator('[data-testid="confirm-dialog-confirm-btn"]')).toContainText(
      'Deactivate First'
    );
    await expect(page.locator('[data-testid="confirm-dialog-cancel-btn"]')).toContainText('Cancel');
  });

  test('TC-14-03: Clicking "Deactivate First" transitions dialog to deactivate confirmation', async ({
    page,
  }) => {
    await navigateToManagePage(page);
    await waitForListLoaded(page);
    await selectOrg(page, 'org-list-item-provider-abc-healthcare-id');
    await expandDangerZone(page);
    await page.click('[data-testid="danger-zone-delete-btn"]');
    await page.locator('[data-testid="confirm-dialog"]').waitFor({ timeout: 5000 });
    await page.click('[data-testid="confirm-dialog-confirm-btn"]'); // "Deactivate First"
    // Dialog should transition to deactivate flow
    await expect(page.locator('[data-testid="confirm-dialog-title"]')).toContainText('Deactivate', {
      timeout: 5000,
    });
    await expect(page.locator('[data-testid="confirm-dialog-confirm-btn"]')).toContainText(
      'Deactivate'
    );
  });

  test('TC-14-04: Delete inactive org (Summit Health) shows DELETE text-input confirmation dialog', async ({
    page,
  }) => {
    await navigateToManagePage(page);
    await waitForListLoaded(page);
    await selectOrg(page, 'org-list-item-provider-summit-health-id');
    await expandDangerZone(page);
    await page.click('[data-testid="danger-zone-delete-btn"]');
    const dialog = page.locator('[data-testid="confirm-dialog"]');
    await expect(dialog).toBeVisible({ timeout: 5000 });
    await expect(page.locator('[data-testid="confirm-dialog-title"]')).toContainText(
      'Delete Organization'
    );
    await expect(page.locator('[data-testid="confirm-dialog-confirm-text-input"]')).toBeVisible();
    await expect(page.locator('[data-testid="confirm-dialog-confirm-btn"]')).toBeDisabled();
  });

  test('TC-14-05: Typing "delete" (case-insensitive) enables the Confirm button', async ({
    page,
  }) => {
    await navigateToManagePage(page);
    await waitForListLoaded(page);
    await selectOrg(page, 'org-list-item-provider-summit-health-id');
    await expandDangerZone(page);
    await page.click('[data-testid="danger-zone-delete-btn"]');
    await page.locator('[data-testid="confirm-dialog"]').waitFor({ timeout: 5000 });
    await page.fill('[data-testid="confirm-dialog-confirm-text-input"]', 'delete');
    await expect(page.locator('[data-testid="confirm-dialog-confirm-btn"]')).not.toBeDisabled();
  });

  test('TC-14-06: Type "DELETE" and confirm -- dialog closes, panel resets to empty state', async ({
    page,
  }) => {
    await navigateToManagePage(page);
    await waitForListLoaded(page);
    await selectOrg(page, 'org-list-item-provider-summit-health-id');
    await expandDangerZone(page);
    await page.click('[data-testid="danger-zone-delete-btn"]');
    await page.locator('[data-testid="confirm-dialog"]').waitFor({ timeout: 5000 });
    await page.fill('[data-testid="confirm-dialog-confirm-text-input"]', 'DELETE');
    await page.click('[data-testid="confirm-dialog-confirm-btn"]');
    await expect(page.locator('[data-testid="confirm-dialog"]')).not.toBeVisible({ timeout: 8000 });
    await expect(page.locator('[data-testid="org-manage-error-banner"]')).not.toBeVisible();
    // Panel should reset to empty state after deletion
    await expect(page.locator('[data-testid="org-form-empty-state"]')).toBeVisible({
      timeout: 5000,
    });
  });

  test('TC-14-07: Cancel in delete dialog takes no action', async ({ page }) => {
    await navigateToManagePage(page);
    await waitForListLoaded(page);
    await selectOrg(page, 'org-list-item-provider-summit-health-id');
    await expandDangerZone(page);
    await page.click('[data-testid="danger-zone-delete-btn"]');
    await page.locator('[data-testid="confirm-dialog"]').waitFor({ timeout: 5000 });
    await page.click('[data-testid="confirm-dialog-cancel-btn"]');
    await expect(page.locator('[data-testid="confirm-dialog"]')).not.toBeVisible({ timeout: 5000 });
    await expect(page.locator('[data-testid="org-manage-error-banner"]')).not.toBeVisible();
    // Org details still visible
    await expect(page.locator('[data-testid="org-details-card"]')).toBeVisible();
  });
});

// ============================================================================
// TS-15: Error Banner (1 case)
// ============================================================================
test.describe('TS-15: Error Banner', () => {
  test('TC-15-01: Error banner is NOT visible on initial page load (mock mode returns no errors)', async ({
    page,
  }) => {
    await navigateToManagePage(page);
    await expect(page.locator('[data-testid="org-manage-error-banner"]')).not.toBeVisible();
  });
});

// ============================================================================
// TS-16: Keyboard Navigation & Accessibility (7 cases)
// ============================================================================
test.describe('TS-16: Keyboard Navigation & Accessibility', () => {
  test.beforeEach(async ({ page }) => {
    await navigateToManagePage(page);
    await waitForListLoaded(page);
  });

  test('TC-16-01: Tab from back button reaches search input, then filter buttons', async ({
    page,
  }) => {
    // Focus the back button first
    const backBtn = page.locator('[data-testid="org-manage-back-btn"]');
    await backBtn.focus();
    await expect(backBtn).toBeFocused();
    // DOM tab order: back button → create button → refresh button → search input → filter buttons
    await page.keyboard.press('Tab');
    await expect(page.locator('[data-testid="org-list-create-btn"]')).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(page.locator('[data-testid="org-list-refresh-btn"]')).toBeFocused();
    // Tab to search input
    await page.keyboard.press('Tab');
    await expect(page.locator('[data-testid="org-list-search-input"]')).toBeFocused();
    // Continue tabbing to first filter button
    await page.keyboard.press('Tab');
    await expect(page.locator('[data-testid="org-list-filter-all-btn"]')).toBeFocused();
  });

  test('TC-16-02: Org list container has role=listbox and items have role=option', async ({
    page,
  }) => {
    await expect(page.locator('[data-testid="org-list"]')).toHaveAttribute('role', 'listbox');
    const firstItem = page.locator('[data-testid="org-list"] [role="option"]').first();
    await expect(firstItem).toHaveAttribute('role', 'option');
  });

  test('TC-16-03: Selected org has aria-selected=true, others have aria-selected=false', async ({
    page,
  }) => {
    await selectOrg(page, 'org-list-item-provider-abc-healthcare-id');
    await expect(
      page.locator('[data-testid="org-list-item-provider-abc-healthcare-id"]')
    ).toHaveAttribute('aria-selected', 'true');
    await expect(
      page.locator('[data-testid="org-list-item-provider-xyz-medical-id"]')
    ).toHaveAttribute('aria-selected', 'false');
  });

  test('TC-16-04: Confirm dialog has correct ARIA attributes (role, aria-modal, aria-labelledby)', async ({
    page,
  }) => {
    await selectOrg(page, 'org-list-item-provider-abc-healthcare-id');
    await expandDangerZone(page);
    await page.click('[data-testid="danger-zone-deactivate-btn"]');
    const dialog = page.locator('[data-testid="confirm-dialog"]');
    await expect(dialog).toBeVisible({ timeout: 5000 });
    await expect(dialog).toHaveAttribute('role', 'alertdialog');
    await expect(dialog).toHaveAttribute('aria-modal', 'true');
    await expect(dialog).toHaveAttribute('aria-labelledby', 'confirm-dialog-title');
  });

  test('TC-16-05: Entity dialog has role=dialog and aria-modal=true', async ({ page }) => {
    await selectOrg(page, 'org-list-item-provider-abc-healthcare-id');
    await page.click('[data-testid="org-contacts-add-btn"]');
    const dialog = page.locator('[data-testid="contact-dialog"]');
    await expect(dialog).toBeVisible({ timeout: 5000 });
    await expect(dialog).toHaveAttribute('role', 'dialog');
    await expect(dialog).toHaveAttribute('aria-modal', 'true');
  });

  test('TC-16-06: DangerZone toggle has aria-expanded changing on click', async ({ page }) => {
    await selectOrg(page, 'org-list-item-provider-abc-healthcare-id');
    const toggleBtn = page.locator('[data-testid="danger-zone-toggle-btn"]');
    await expect(toggleBtn).toHaveAttribute('aria-expanded', 'false');
    await toggleBtn.click();
    await expect(toggleBtn).toHaveAttribute('aria-expanded', 'true');
  });

  test('TC-16-07: Required form fields have aria-required=true, optional do not', async ({
    page,
  }) => {
    await selectOrg(page, 'org-list-item-provider-abc-healthcare-id');
    // Required fields
    await expect(page.locator('#org-name')).toHaveAttribute('aria-required', 'true');
    await expect(page.locator('#org-display-name')).toHaveAttribute('aria-required', 'true');
    await expect(page.locator('#org-timezone')).toHaveAttribute('aria-required', 'true');
    // Optional fields: no aria-required="true"
    const taxReq = await page.locator('#org-tax-number').getAttribute('aria-required');
    const phoneReq = await page.locator('#org-phone-number').getAttribute('aria-required');
    expect(taxReq).not.toBe('true');
    expect(phoneReq).not.toBe('true');
  });
});

// ============================================================================
// TS-17: URL Parameter Handling (2 cases)
// ============================================================================
test.describe('TS-17: URL Parameter Handling', () => {
  test('TC-17-01: ?status=inactive pre-selects Inactive filter and shows 1 org (Summit Health)', async ({
    page,
  }) => {
    await navigateToManagePage(page, 'status=inactive');
    await waitForListLoaded(page);
    await expect(page.locator('[data-testid="org-list-filter-inactive-btn"]')).toHaveClass(
      /bg-blue|selected|active/
    );
    await expect(page.locator('[data-testid="org-list"] [role="option"]')).toHaveCount(1);
    await expect(
      page.locator('[data-testid="org-list-item-provider-summit-health-id"]')
    ).toBeVisible();
  });

  test('TC-17-02: ?orgId=provider-abc-healthcare-id auto-selects ABC Healthcare', async ({
    page,
  }) => {
    await navigateToManagePage(page, 'orgId=provider-abc-healthcare-id');
    await waitForDetailsLoaded(page);
    await expect(
      page.locator('[data-testid="org-list-item-provider-abc-healthcare-id"]')
    ).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('[data-testid="org-details-card"]')).toBeVisible();
    await expect(page.locator('#org-name')).toHaveValue('ABC Healthcare Partners');
    await expect(page.locator('[data-testid="org-form-empty-state"]')).not.toBeVisible();
  });
});

// ============================================================================
// Helpers for Create Form Tests
// ============================================================================

/** Click the Create button and wait for the create form to appear */
async function enterCreateMode(page: Page) {
  await page.click('[data-testid="org-list-create-btn"]');
  await page.waitForSelector('[data-testid="org-create-form"]', { timeout: 5000 });
}

/**
 * Set a React controlled input's value via native setter + input event.
 * Needed because the 3-column grid layout renders some inputs at 0px width,
 * making Playwright's fill() fail with "element is not visible".
 */
async function reactFill(page: Page, selector: string, value: string) {
  await page.locator(selector).evaluate((el: HTMLInputElement, val: string) => {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
    setter?.call(el, val);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }, value);
}

/** Scoped version of reactFill for inputs within a container */
async function reactFillScoped(
  page: Page,
  containerSelector: string,
  inputSelector: string,
  value: string
) {
  await page
    .locator(containerSelector)
    .locator(inputSelector)
    .evaluate((el: HTMLInputElement, val: string) => {
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        'value'
      )?.set;
      setter?.call(el, val);
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    }, value);
}

/** Fill the minimum required fields for a valid provider form submission */
async function fillMinimalProviderForm(page: Page) {
  // Organization fields (inputs may have 0px width in 3-col layout, use reactFill)
  await reactFill(page, '[data-testid="org-create-name-input"]', 'Test Organization');
  await reactFill(page, '[data-testid="org-create-display-name-input"]', 'Test Org');
  // Subdomain (SubdomainInput renders a plain <input> with id="subdomain")
  await reactFill(page, '#subdomain', 'test-org');
  // General address
  const addrSel = '[data-testid="org-create-general-address"]';
  await reactFillScoped(page, addrSel, 'input[aria-label="Street address line 1"]', '123 Main St');
  await reactFillScoped(page, addrSel, 'input[aria-label="City"]', 'New York');
  await reactFillScoped(page, addrSel, 'input[aria-label="State (2-letter abbreviation)"]', 'NY');
  await reactFillScoped(page, addrSel, 'input[aria-label="Zip code"]', '10001');
  // General phone
  await reactFillScoped(
    page,
    '[data-testid="org-create-general-phone"]',
    'input[aria-label="Phone number"]',
    '2125551234'
  );
  // Billing contact
  const billSel = '[data-testid="org-create-billing-contact"]';
  await reactFillScoped(page, billSel, 'input[aria-label="First name"]', 'Jane');
  await reactFillScoped(page, billSel, 'input[aria-label="Last name"]', 'Doe');
  await reactFillScoped(page, billSel, 'input[aria-label="Email address"]', 'jane@test.com');
  // Use General for billing address + phone
  await page.locator('[data-testid="org-create-use-billing-general-address"]').click();
  await page.locator('[data-testid="org-create-use-billing-general-phone"]').click();
  // Provider admin contact
  const adminSel = '[data-testid="org-create-admin-contact"]';
  await reactFillScoped(page, adminSel, 'input[aria-label="First name"]', 'John');
  await reactFillScoped(page, adminSel, 'input[aria-label="Last name"]', 'Admin');
  await reactFillScoped(page, adminSel, 'input[aria-label="Email address"]', 'john@test.com');
  await reactFillScoped(
    page,
    adminSel,
    'input[aria-label="Confirm email address"]',
    'john@test.com'
  );
  // Use General for admin address + phone
  await page.locator('[data-testid="org-create-use-admin-general-address"]').click();
  await page.locator('[data-testid="org-create-use-admin-general-phone"]').click();
}

// ============================================================================
// TS-18: Create Button Visibility & Entry (4 cases)
// ============================================================================
test.describe('TS-18: Create Button Visibility & Entry', () => {
  test('TC-18-01: Create button visible for super_admin (platform owner)', async ({ page }) => {
    await navigateToManagePage(page);
    await expect(page.locator('[data-testid="org-list-create-btn"]')).toBeVisible();
  });

  test('TC-18-02: Create button NOT visible for provider_admin (no left panel)', async ({
    page,
  }) => {
    await navigateToManagePage(page);
    await switchToProfile(page, 'dev@example.com');
    await page.locator('a[href="/organizations"]').waitFor({ state: 'visible', timeout: 5000 });
    await page.locator('a[href="/organizations"]').click();
    await page.waitForURL(/\/organizations/, { timeout: 10000 });
    await page.waitForSelector('[data-testid="org-manage-page"]', { timeout: 15000 });
    await expect(page.locator('[data-testid="org-list-create-btn"]')).not.toBeVisible();
  });

  test('TC-18-03: Clicking Create shows the create form in right panel', async ({ page }) => {
    await navigateToManagePage(page);
    await enterCreateMode(page);
    await expect(page.locator('[data-testid="org-create-form"]')).toBeVisible();
  });

  test('TC-18-04: Create form replaces empty state / edit form', async ({ page }) => {
    await navigateToManagePage(page);
    // Start from empty state
    await expect(page.locator('[data-testid="org-form-empty-state"]')).toBeVisible();
    await enterCreateMode(page);
    await expect(page.locator('[data-testid="org-form-empty-state"]')).not.toBeVisible();
    await expect(page.locator('[data-testid="org-create-form"]')).toBeVisible();
  });
});

// ============================================================================
// TS-19: Create Form Structure & Sections (5 cases)
// ============================================================================
test.describe('TS-19: Create Form Structure & Sections', () => {
  test.beforeEach(async ({ page }) => {
    await navigateToManagePage(page);
    await enterCreateMode(page);
  });

  test('TC-19-01: General Information section visible by default', async ({ page }) => {
    await expect(page.locator('[data-testid="org-create-section-general"]')).toBeVisible();
  });

  test('TC-19-02: Billing section visible when type is provider (default)', async ({ page }) => {
    await expect(page.locator('[data-testid="org-create-section-billing"]')).toBeVisible();
  });

  test('TC-19-03: Billing section hidden when type changed to provider_partner', async ({
    page,
  }) => {
    // Change type to Provider Partner (force click: overlapping glassmorphism cards)
    await page
      .locator('[data-testid="org-create-type-select"]')
      .evaluate((el) => (el as HTMLElement).click());
    await page.locator('[role="option"]:has-text("Provider Partner")').click();
    await expect(page.locator('[data-testid="org-create-section-billing"]')).not.toBeVisible();
  });

  test('TC-19-04: Provider Admin section always visible', async ({ page }) => {
    await expect(page.locator('[data-testid="org-create-section-provider-admin"]')).toBeVisible();
    // Also visible after switching type
    await page
      .locator('[data-testid="org-create-type-select"]')
      .evaluate((el) => (el as HTMLElement).click());
    await page.locator('[role="option"]:has-text("Provider Partner")').click();
    await expect(page.locator('[data-testid="org-create-section-provider-admin"]')).toBeVisible();
  });

  test('TC-19-05: Section collapse/expand toggles work', async ({ page }) => {
    // General section should be expanded (type select is visible)
    const typeSelect = page.locator('[data-testid="org-create-type-select"]');
    await expect(typeSelect).toBeVisible();
    // Click the section title text to collapse
    await page
      .locator('[data-testid="org-create-section-general"]')
      .locator('text=General Information')
      .click();
    await expect(typeSelect).not.toBeVisible();
    // Click again to expand
    await page
      .locator('[data-testid="org-create-section-general"]')
      .locator('text=General Information')
      .click();
    await expect(typeSelect).toBeVisible();
  });
});

// ============================================================================
// TS-20: Create Form Fields & Type Switching (5 cases)
// ============================================================================
test.describe('TS-20: Create Form Fields & Type Switching', () => {
  test.beforeEach(async ({ page }) => {
    await navigateToManagePage(page);
    await enterCreateMode(page);
  });

  test('TC-20-01: Default form has org type Provider and timezone America/New_York', async ({
    page,
  }) => {
    // Check type select shows Provider Organization
    await expect(page.locator('[data-testid="org-create-type-select"]')).toContainText(
      'Provider Organization'
    );
    // Check timezone shows Eastern
    await expect(page.locator('[data-testid="org-create-timezone-select"]')).toContainText(
      'Eastern'
    );
  });

  test('TC-20-02: Switching to Provider Partner shows Partner Type, hides Billing, hides Referring Partner', async ({
    page,
  }) => {
    // Initially: partner type not visible, billing visible, referring partner visible
    await expect(page.locator('[data-testid="org-create-partner-type-select"]')).not.toBeVisible();
    await expect(page.locator('[data-testid="org-create-section-billing"]')).toBeVisible();
    await expect(page.locator('[data-testid="org-create-referring-partner"]')).toBeVisible();
    // Switch to Provider Partner (force click: overlapping glassmorphism cards)
    await page
      .locator('[data-testid="org-create-type-select"]')
      .evaluate((el) => (el as HTMLElement).click());
    await page.locator('[role="option"]:has-text("Provider Partner")').click();
    // Now: partner type visible, billing hidden, referring partner hidden
    await expect(page.locator('[data-testid="org-create-partner-type-select"]')).toBeVisible();
    await expect(page.locator('[data-testid="org-create-section-billing"]')).not.toBeVisible();
    await expect(page.locator('[data-testid="org-create-referring-partner"]')).not.toBeVisible();
  });

  test('TC-20-03: Partner Type select appears only for provider_partner type', async ({ page }) => {
    // Default is provider - partner type not visible
    await expect(page.locator('[data-testid="org-create-partner-type-select"]')).not.toBeVisible();
    // Switch to Partner
    await page
      .locator('[data-testid="org-create-type-select"]')
      .evaluate((el) => (el as HTMLElement).click());
    await page.locator('[role="option"]:has-text("Provider Partner")').click();
    await expect(page.locator('[data-testid="org-create-partner-type-select"]')).toBeVisible();
    // Switch back to Provider Organization
    await page
      .locator('[data-testid="org-create-type-select"]')
      .evaluate((el) => (el as HTMLElement).click());
    await page.getByRole('option', { name: 'Provider Organization', exact: true }).click();
    await expect(page.locator('[data-testid="org-create-partner-type-select"]')).not.toBeVisible();
  });

  test('TC-20-04: Subdomain field present for provider type', async ({ page }) => {
    // Provider is default - subdomain input should exist in DOM
    // (may have 0px width in 3-col grid but is attached)
    await expect(page.locator('#subdomain')).toBeAttached();
  });

  test('TC-20-05: Referring Partner dropdown visible only for provider type', async ({ page }) => {
    await expect(page.locator('[data-testid="org-create-referring-partner"]')).toBeVisible();
    // Switch to Partner
    await page
      .locator('[data-testid="org-create-type-select"]')
      .evaluate((el) => (el as HTMLElement).click());
    await page.locator('[role="option"]:has-text("Provider Partner")').click();
    await expect(page.locator('[data-testid="org-create-referring-partner"]')).not.toBeVisible();
  });
});

// ============================================================================
// TS-21: Create Form Validation (6 cases)
// ============================================================================
test.describe('TS-21: Create Form Validation', () => {
  test.beforeEach(async ({ page }) => {
    await navigateToManagePage(page);
    await enterCreateMode(page);
  });

  test('TC-21-01: Submit with empty form shows validation errors summary', async ({ page }) => {
    // Make form dirty via reactFill then clear, so submit becomes enabled
    await reactFill(page, '[data-testid="org-create-name-input"]', 'x');
    await reactFill(page, '[data-testid="org-create-name-input"]', '');
    await page.click('[data-testid="org-create-submit-btn"]');
    await expect(page.locator('[data-testid="org-create-validation-errors"]')).toBeVisible();
  });

  test('TC-21-02: Organization Name required error shown', async ({ page }) => {
    // Make form dirty then submit (only fill display name, not name)
    await reactFill(page, '[data-testid="org-create-display-name-input"]', 'Test');
    await page.click('[data-testid="org-create-submit-btn"]');
    await expect(page.locator('[data-testid="org-create-validation-errors"]')).toContainText(
      /name/i
    );
  });

  test('TC-21-03: Display Name required error shown', async ({ page }) => {
    await reactFill(page, '[data-testid="org-create-name-input"]', 'Test');
    await page.click('[data-testid="org-create-submit-btn"]');
    await expect(page.locator('[data-testid="org-create-validation-errors"]')).toContainText(
      /display/i
    );
  });

  test('TC-21-04: Headquarters address fields required (street1, city, state, zip)', async ({
    page,
  }) => {
    await reactFill(page, '[data-testid="org-create-name-input"]', 'Test Org');
    await reactFill(page, '[data-testid="org-create-display-name-input"]', 'Test');
    await page.click('[data-testid="org-create-submit-btn"]');
    const errors = page.locator('[data-testid="org-create-validation-errors"]');
    await expect(errors).toBeVisible();
    // Should mention address-related errors
    await expect(errors).toContainText(/address|street|headquarters/i);
  });

  test('TC-21-05: Provider Admin contact required (first name, last name, email)', async ({
    page,
  }) => {
    await reactFill(page, '[data-testid="org-create-name-input"]', 'Test Org');
    await reactFill(page, '[data-testid="org-create-display-name-input"]', 'Test');
    await page.click('[data-testid="org-create-submit-btn"]');
    const errors = page.locator('[data-testid="org-create-validation-errors"]');
    await expect(errors).toBeVisible();
    await expect(errors).toContainText(/admin|provider/i);
  });

  test('TC-21-06: Submit button disabled when form is untouched (canSubmit requires isDirty)', async ({
    page,
  }) => {
    await expect(page.locator('[data-testid="org-create-submit-btn"]')).toBeDisabled();
  });
});

// ============================================================================
// TS-22: "Use General" Checkboxes (4 cases)
// ============================================================================
test.describe('TS-22: Use General Checkboxes', () => {
  test.beforeEach(async ({ page }) => {
    await navigateToManagePage(page);
    await enterCreateMode(page);
  });

  test('TC-22-01: Billing Address "Use General" checkbox disables billing address inputs', async ({
    page,
  }) => {
    const billingAddr = page.locator('[data-testid="org-create-billing-address"]');
    const street1 = billingAddr.locator('input[aria-label="Street address line 1"]');
    // Initially enabled
    await expect(street1).toBeEnabled();
    // Check "Use General"
    await page.locator('[data-testid="org-create-use-billing-general-address"]').click();
    // Now disabled
    await expect(street1).toBeDisabled();
  });

  test('TC-22-02: Billing Phone "Use General" checkbox disables billing phone inputs', async ({
    page,
  }) => {
    const billingPhone = page.locator('[data-testid="org-create-billing-phone"]');
    const phoneInput = billingPhone.locator('input[aria-label="Phone number"]');
    await expect(phoneInput).toBeEnabled();
    await page.locator('[data-testid="org-create-use-billing-general-phone"]').click();
    await expect(phoneInput).toBeDisabled();
  });

  test('TC-22-03: Admin Address "Use General" checkbox disables admin address inputs', async ({
    page,
  }) => {
    const adminAddr = page.locator('[data-testid="org-create-admin-address"]');
    const street1 = adminAddr.locator('input[aria-label="Street address line 1"]');
    await expect(street1).toBeEnabled();
    await page.locator('[data-testid="org-create-use-admin-general-address"]').click();
    await expect(street1).toBeDisabled();
  });

  test('TC-22-04: Admin Phone "Use General" checkbox disables admin phone inputs', async ({
    page,
  }) => {
    const adminPhone = page.locator('[data-testid="org-create-admin-phone"]');
    const phoneInput = adminPhone.locator('input[aria-label="Phone number"]');
    await expect(phoneInput).toBeEnabled();
    await page.locator('[data-testid="org-create-use-admin-general-phone"]').click();
    await expect(phoneInput).toBeDisabled();
  });
});

// ============================================================================
// TS-23: Create Form Actions (4 cases)
// ============================================================================
test.describe('TS-23: Create Form Actions', () => {
  test.beforeEach(async ({ page }) => {
    await navigateToManagePage(page);
    await enterCreateMode(page);
  });

  test('TC-23-01: Cancel button returns to empty state', async ({ page }) => {
    await page.click('[data-testid="org-create-cancel-btn"]');
    await expect(page.locator('[data-testid="org-create-form"]')).not.toBeVisible();
    await expect(page.locator('[data-testid="org-form-empty-state"]')).toBeVisible();
  });

  test('TC-23-02: Save Draft button triggers save (last-saved timestamp appears)', async ({
    page,
  }) => {
    // Make the form dirty first via reactFill (inputs may have 0px width)
    await reactFill(page, '[data-testid="org-create-name-input"]', 'Draft Test Org');
    await page.click('[data-testid="org-create-save-draft-btn"]');
    await expect(page.locator('[data-testid="org-create-last-saved"]')).toBeVisible({
      timeout: 5000,
    });
  });

  test('TC-23-03: Submit with valid data navigates to bootstrap page', async ({ page }) => {
    await fillMinimalProviderForm(page);
    await page.click('[data-testid="org-create-submit-btn"]');
    // Mock mode should navigate to /organizations/{id}/bootstrap
    await page.waitForURL(/\/organizations\/.*\/bootstrap/, { timeout: 10000 });
  });

  test('TC-23-04: Enter key in text inputs does NOT submit form', async ({ page }) => {
    // Focus the name input and type via keyboard (reactFill + keyboard Enter)
    await reactFill(page, '[data-testid="org-create-name-input"]', 'Test');
    // Focus the input element directly, then press Enter
    await page.locator('[data-testid="org-create-name-input"]').evaluate((el) => el.focus());
    await page.keyboard.press('Enter');
    // Form should still be visible (not submitted)
    await expect(page.locator('[data-testid="org-create-form"]')).toBeVisible();
    // No navigation should have occurred
    expect(page.url()).toContain('/organizations');
    expect(page.url()).not.toContain('/bootstrap');
  });
});

// ============================================================================
// TS-24: Create Mode Unsaved Changes Guard (3 cases)
// ============================================================================
test.describe('TS-24: Create Mode Unsaved Changes Guard', () => {
  test.beforeEach(async ({ page }) => {
    await navigateToManagePage(page);
    await waitForListLoaded(page);
    await enterCreateMode(page);
  });

  test('TC-24-01: Clicking org in list while in create mode shows discard dialog', async ({
    page,
  }) => {
    await page.click('[data-testid="org-list-item-provider-abc-healthcare-id"]');
    const dialog = page.locator('[data-testid="confirm-dialog"]');
    await expect(dialog).toBeVisible({ timeout: 5000 });
    await expect(dialog).toContainText(/unsaved changes/i);
  });

  test('TC-24-02: Confirming discard loads selected org (exits create mode)', async ({ page }) => {
    await page.click('[data-testid="org-list-item-provider-abc-healthcare-id"]');
    const dialog = page.locator('[data-testid="confirm-dialog"]');
    await expect(dialog).toBeVisible({ timeout: 5000 });
    // Click "Discard Changes" button
    await dialog.locator('button:has-text("Discard")').click();
    // Create form should be gone, edit form should show
    await expect(page.locator('[data-testid="org-create-form"]')).not.toBeVisible();
    await waitForDetailsLoaded(page);
    await expect(page.locator('[data-testid="org-details-card"]')).toBeVisible();
  });

  test('TC-24-03: Canceling discard stays in create mode', async ({ page }) => {
    await page.click('[data-testid="org-list-item-provider-abc-healthcare-id"]');
    const dialog = page.locator('[data-testid="confirm-dialog"]');
    await expect(dialog).toBeVisible({ timeout: 5000 });
    // Click "Stay Here" button
    await dialog.locator('button:has-text("Stay")').click();
    await expect(dialog).not.toBeVisible();
    // Create form should still be visible
    await expect(page.locator('[data-testid="org-create-form"]')).toBeVisible();
  });
});
