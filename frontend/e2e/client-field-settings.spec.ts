/**
 * Client Field Settings E2E Tests
 *
 * Tests the Client Field Configuration page at /settings/client-fields.
 * Exercises tab navigation, field toggle/label interactions, save/reset workflow,
 * custom field CRUD, and category CRUD in mock mode.
 *
 * Run with:
 *   cd frontend && npx playwright test --config playwright.client-fields.config.ts
 *
 * Prerequisites:
 *   - Uses playwright.client-fields.config.ts (VITE_FORCE_MOCK=true, VITE_DEV_PROFILE=provider_admin)
 *   - provider_admin has organization.update permission + org_type='provider'
 */

import { test, expect, Page } from '@playwright/test';

const BASE_URL = 'http://localhost:3457';

// ============================================================================
// Helpers
// ============================================================================

/** Authenticate via mock mode login page */
async function ensureAuthenticated(page: Page) {
  await page.goto(BASE_URL);

  // Check if we land on login
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

/** Navigate to client field settings, handling mock auth login if needed */
async function navigateToFieldSettings(page: Page) {
  await ensureAuthenticated(page);
  await page.goto(`${BASE_URL}/settings/client-fields`);

  // Wait for the page to fully load (loading spinner gone, tab bar visible)
  await page.waitForSelector('[data-testid="client-field-tab-bar"]', { timeout: 15000 });
}

/** Navigate to settings hub */
async function navigateToSettings(page: Page) {
  await ensureAuthenticated(page);
  await page.goto(`${BASE_URL}/settings`);
  await page.waitForSelector('[data-testid="settings-client-fields-card"]', { timeout: 10000 });
}

// ============================================================================
// Navigation & Page Load
// ============================================================================
test.describe('Client Field Settings - Navigation', () => {
  test('should navigate from settings hub to client field settings', async ({ page }) => {
    await navigateToSettings(page);

    // Click the Client Field Configuration card
    await page.click('[data-testid="settings-client-fields-card"]');
    await page.waitForURL(/\/settings\/client-fields/, { timeout: 5000 });

    // Verify page loaded
    await expect(page.getByRole('heading', { name: 'Client Field Configuration' })).toBeVisible();
    await expect(page.locator('[data-testid="client-field-tab-bar"]')).toBeVisible();
  });

  test('should navigate back to settings via back button', async ({ page }) => {
    await navigateToFieldSettings(page);

    await page.click('[data-testid="back-to-settings-btn"]');
    await page.waitForURL(/\/settings$/, { timeout: 5000 });
  });

  test('should display page header and description', async ({ page }) => {
    await navigateToFieldSettings(page);

    await expect(page.getByRole('heading', { name: 'Client Field Configuration' })).toBeVisible();
    await expect(page.getByText('Configure which fields appear')).toBeVisible();
  });
});

// ============================================================================
// Tab Bar
// ============================================================================
test.describe('Client Field Settings - Tab Bar', () => {
  test('should display system category tabs plus custom fields and categories', async ({
    page,
  }) => {
    await navigateToFieldSettings(page);

    // Should have Demographics as first tab (default active)
    const demographicsTab = page.locator('[data-testid="tab-demographics"]');
    await expect(demographicsTab).toBeVisible();
    await expect(demographicsTab).toHaveAttribute('aria-selected', 'true');

    // Should have Custom Fields and Categories tabs
    await expect(page.locator('[data-testid="tab-custom_fields"]')).toBeVisible();
    await expect(page.locator('[data-testid="tab-categories"]')).toBeVisible();
  });

  test('should switch tabs on click', async ({ page }) => {
    await navigateToFieldSettings(page);

    // Click Referral tab
    await page.click('[data-testid="tab-referral"]');

    // Verify Referral tab is now active
    await expect(page.locator('[data-testid="tab-referral"]')).toHaveAttribute(
      'aria-selected',
      'true'
    );

    // Verify the tab panel is showing
    await expect(page.locator('[data-testid="tabpanel-referral"]')).toBeVisible();
  });

  test('should support keyboard navigation between tabs', async ({ page }) => {
    await navigateToFieldSettings(page);

    // Focus the active tab
    const demographicsTab = page.locator('[data-testid="tab-demographics"]');
    await demographicsTab.focus();

    // Press ArrowRight to move to next tab
    await page.keyboard.press('ArrowRight');

    // Next tab should now be focused and active
    const nextTab = page.locator('[role="tab"][aria-selected="true"]');
    await expect(nextTab).not.toHaveAttribute('data-tab', 'demographics');

    // Press Home to go back to first tab
    await page.keyboard.press('Home');
    await expect(page.locator('[data-testid="tab-demographics"]')).toHaveAttribute(
      'aria-selected',
      'true'
    );
  });

  test('should have proper WAI-ARIA tab attributes', async ({ page }) => {
    await navigateToFieldSettings(page);

    // Verify tablist role
    await expect(page.locator('[role="tablist"]')).toBeVisible();
    await expect(page.locator('[role="tablist"]')).toHaveAttribute(
      'aria-label',
      'Field configuration categories'
    );

    // Active tab should have tabIndex=0, others -1
    const activeTab = page.locator('[role="tab"][aria-selected="true"]');
    await expect(activeTab).toHaveAttribute('tabindex', '0');

    const inactiveTabs = page.locator('[role="tab"][aria-selected="false"]');
    const count = await inactiveTabs.count();
    expect(count).toBeGreaterThan(0);
    for (let i = 0; i < Math.min(count, 3); i++) {
      await expect(inactiveTabs.nth(i)).toHaveAttribute('tabindex', '-1');
    }

    // Tab panel should reference the tab
    const tabPanel = page.locator('[role="tabpanel"]');
    await expect(tabPanel).toBeVisible();
  });
});

// ============================================================================
// Field Definition Tab (system category fields)
// ============================================================================
test.describe('Client Field Settings - Field Definitions', () => {
  test('should display fields for the active category', async ({ page }) => {
    await navigateToFieldSettings(page);

    // Demographics tab is active by default — should show field rows
    const fieldRows = page.locator('[data-testid^="field-row-"]');
    await expect(fieldRows.first()).toBeVisible({ timeout: 5000 });

    const count = await fieldRows.count();
    expect(count).toBeGreaterThan(0);
  });

  test('should show locked indicator on mandatory fields', async ({ page }) => {
    await navigateToFieldSettings(page);

    // first_name is a locked field — should show Lock badge
    const firstNameRow = page.locator('[data-testid="field-row-first_name"]');
    await expect(firstNameRow).toBeVisible();
    await expect(firstNameRow.getByText('Locked')).toBeVisible();
  });

  test('locked fields should have disabled visibility toggle', async ({ page }) => {
    await navigateToFieldSettings(page);

    // The visibility switch for a locked field should be disabled
    const lockedSwitch = page.locator('[data-testid="field-visible-first_name"]');
    await expect(lockedSwitch).toBeVisible();
    await expect(lockedSwitch).toBeDisabled();
  });

  test('should toggle field visibility', async ({ page }) => {
    await navigateToFieldSettings(page);

    // Find a non-locked field by looking for one without the "Locked" badge
    // Try middle_name which is typically configurable
    const visibleSwitch = page.locator('[data-testid="field-visible-middle_name"]');

    if ((await visibleSwitch.count()) > 0) {
      // Get current state
      const wasChecked = await visibleSwitch.isChecked();

      // Click to toggle
      await visibleSwitch.click();

      // Verify state changed
      if (wasChecked) {
        await expect(visibleSwitch).not.toBeChecked();
      } else {
        await expect(visibleSwitch).toBeChecked();
      }

      // Save/reset panel should appear
      await expect(page.locator('[data-testid="save-changes-btn"]')).toBeVisible();
    }
  });

  test('should toggle field required flag', async ({ page }) => {
    await navigateToFieldSettings(page);

    // Find a visible, non-locked field and toggle its required switch
    // preferred_name is typically visible and non-locked
    const visibleSwitch = page.locator('[data-testid="field-visible-preferred_name"]');

    if ((await visibleSwitch.count()) > 0 && (await visibleSwitch.isChecked())) {
      const requiredSwitch = page.locator('[data-testid="field-required-preferred_name"]');
      if ((await requiredSwitch.count()) > 0) {
        await requiredSwitch.click();
        await expect(page.locator('[data-testid="save-changes-btn"]')).toBeVisible();
      }
    }
  });

  test('should show label input for visible non-locked fields', async ({ page }) => {
    await navigateToFieldSettings(page);

    // A visible, non-locked field should show the custom label input
    const labelInput = page.locator('[data-testid="field-label-middle_name"]');

    if ((await labelInput.count()) > 0) {
      await expect(labelInput).toBeVisible();

      // Type a custom label
      await labelInput.fill('Middle Initial');

      // Save panel should appear
      await expect(page.locator('[data-testid="save-changes-btn"]')).toBeVisible();
    }
  });
});

// ============================================================================
// Save / Reset Workflow
// ============================================================================
test.describe('Client Field Settings - Save & Reset', () => {
  test('should show save panel only when changes exist', async ({ page }) => {
    await navigateToFieldSettings(page);

    // No changes initially — save panel should not be visible
    await expect(page.locator('[data-testid="save-changes-btn"]')).not.toBeVisible();
    await expect(page.locator('[data-testid="reset-changes-btn"]')).not.toBeVisible();
  });

  test('should require reason before saving', async ({ page }) => {
    await navigateToFieldSettings(page);

    // Make a change to show the save panel
    const middleNameSwitch = page.locator('[data-testid="field-visible-middle_name"]');
    if ((await middleNameSwitch.count()) > 0) {
      await middleNameSwitch.click();

      // Save button should be visible but disabled (no reason)
      const saveBtn = page.locator('[data-testid="save-changes-btn"]');
      await expect(saveBtn).toBeVisible();
      await expect(saveBtn).toBeDisabled();

      // Enter a reason too short
      const reasonInput = page.locator('[data-testid="change-reason-input"]');
      await reasonInput.fill('short');
      await expect(saveBtn).toBeDisabled();

      // Enter valid reason
      await reasonInput.fill('Updating field visibility for testing purposes');
      await expect(saveBtn).toBeEnabled();
    }
  });

  test('should reset changes and hide save panel', async ({ page }) => {
    await navigateToFieldSettings(page);

    // Make a change
    const middleNameSwitch = page.locator('[data-testid="field-visible-middle_name"]');
    if ((await middleNameSwitch.count()) > 0) {
      const originalState = await middleNameSwitch.isChecked();
      await middleNameSwitch.click();

      // Click reset
      await page.click('[data-testid="reset-changes-btn"]');

      // Save panel should disappear
      await expect(page.locator('[data-testid="save-changes-btn"]')).not.toBeVisible();

      // Field should be back to original state
      if (originalState) {
        await expect(middleNameSwitch).toBeChecked();
      } else {
        await expect(middleNameSwitch).not.toBeChecked();
      }
    }
  });

  test('should save changes and show success message', async ({ page }) => {
    await navigateToFieldSettings(page);

    // Make a change
    const middleNameSwitch = page.locator('[data-testid="field-visible-middle_name"]');
    if ((await middleNameSwitch.count()) > 0) {
      await middleNameSwitch.click();

      // Enter reason and save
      await page.locator('[data-testid="change-reason-input"]').fill('E2E test save validation');
      await page.click('[data-testid="save-changes-btn"]');

      // Success message should appear
      await expect(page.locator('[data-testid="save-success-msg"]')).toBeVisible({
        timeout: 5000,
      });
    }
  });
});

// ============================================================================
// Custom Fields Tab
// ============================================================================
test.describe('Client Field Settings - Custom Fields', () => {
  test('should show empty state on custom fields tab', async ({ page }) => {
    await navigateToFieldSettings(page);

    await page.click('[data-testid="tab-custom_fields"]');
    await expect(page.locator('[data-testid="tabpanel-custom_fields"]')).toBeVisible();

    // Should have "Add Custom Field" button
    await expect(page.locator('[data-testid="add-custom-field-btn"]')).toBeVisible();
  });

  test('should open and close custom field create form', async ({ page }) => {
    await navigateToFieldSettings(page);
    await page.click('[data-testid="tab-custom_fields"]');

    // Open form
    await page.click('[data-testid="add-custom-field-btn"]');
    await expect(page.locator('[data-testid="cf-name-input"]')).toBeVisible();
    await expect(page.locator('[data-testid="cf-type-select"]')).toBeVisible();
    await expect(page.locator('[data-testid="cf-category-select"]')).toBeVisible();

    // Cancel
    await page.click('[data-testid="cf-cancel-btn"]');
    await expect(page.locator('[data-testid="cf-name-input"]')).not.toBeVisible();
  });

  test('should create a custom field', async ({ page }) => {
    await navigateToFieldSettings(page);
    await page.click('[data-testid="tab-custom_fields"]');

    // Open form
    await page.click('[data-testid="add-custom-field-btn"]');

    // Fill in field details
    await page.fill('[data-testid="cf-name-input"]', 'Allergist Name');
    await page.selectOption('[data-testid="cf-type-select"]', 'text');

    // Select the first available category
    const categorySelect = page.locator('[data-testid="cf-category-select"]');
    const options = categorySelect.locator('option');
    const optionCount = await options.count();
    if (optionCount > 1) {
      // Select the second option (first is "Select category...")
      const value = await options.nth(1).getAttribute('value');
      if (value) {
        await categorySelect.selectOption(value);
      }
    }

    // Create
    await page.click('[data-testid="cf-save-btn"]');

    // Form should close and new field should appear in the list
    await expect(page.locator('[data-testid="cf-name-input"]')).not.toBeVisible({ timeout: 5000 });
    await expect(page.locator('[data-testid="custom-field-custom_allergist_name"]')).toBeVisible();
  });

  test('should deactivate a custom field', async ({ page }) => {
    await navigateToFieldSettings(page);
    await page.click('[data-testid="tab-custom_fields"]');

    // Create a field first
    await page.click('[data-testid="add-custom-field-btn"]');
    await page.fill('[data-testid="cf-name-input"]', 'Temp Field');
    await page.selectOption('[data-testid="cf-type-select"]', 'text');
    const categorySelect = page.locator('[data-testid="cf-category-select"]');
    const options = categorySelect.locator('option');
    const optionCount = await options.count();
    if (optionCount > 1) {
      const value = await options.nth(1).getAttribute('value');
      if (value) await categorySelect.selectOption(value);
    }
    await page.click('[data-testid="cf-save-btn"]');
    await expect(page.locator('[data-testid="cf-name-input"]')).not.toBeVisible({ timeout: 5000 });

    // Now deactivate it
    const removeBtn = page.locator('[data-testid="cf-remove-custom_temp_field"]');
    if ((await removeBtn.count()) > 0) {
      await removeBtn.click();

      // Field should disappear from list
      await expect(page.locator('[data-testid="custom-field-custom_temp_field"]')).not.toBeVisible({
        timeout: 5000,
      });
    }
  });
});

// ============================================================================
// Categories Tab
// ============================================================================
test.describe('Client Field Settings - Categories', () => {
  test('should display system categories with lock icon', async ({ page }) => {
    await navigateToFieldSettings(page);
    await page.click('[data-testid="tab-categories"]');
    await expect(page.locator('[data-testid="tabpanel-categories"]')).toBeVisible();

    // Demographics should be present and marked as system
    const demographicsRow = page.locator('[data-testid="category-demographics"]');
    await expect(demographicsRow).toBeVisible();
    await expect(demographicsRow.getByText('System')).toBeVisible();

    // System categories should NOT have a remove button
    await expect(page.locator('[data-testid="cat-remove-demographics"]')).not.toBeVisible();
  });

  test('should open and close category create form', async ({ page }) => {
    await navigateToFieldSettings(page);
    await page.click('[data-testid="tab-categories"]');

    // Open form
    await page.click('[data-testid="add-category-btn"]');
    await expect(page.locator('[data-testid="cat-name-input"]')).toBeVisible();
    await expect(page.locator('[data-testid="cat-slug-input"]')).toBeVisible();

    // Cancel
    await page.click('[data-testid="cat-cancel-btn"]');
    await expect(page.locator('[data-testid="cat-name-input"]')).not.toBeVisible();
  });

  test('should auto-generate slug from name', async ({ page }) => {
    await navigateToFieldSettings(page);
    await page.click('[data-testid="tab-categories"]');

    await page.click('[data-testid="add-category-btn"]');
    await page.fill('[data-testid="cat-name-input"]', 'Behavioral Health');

    // Slug should be auto-generated
    await expect(page.locator('[data-testid="cat-slug-input"]')).toHaveValue('behavioral_health');
  });

  test('should create a custom category', async ({ page }) => {
    await navigateToFieldSettings(page);
    await page.click('[data-testid="tab-categories"]');

    await page.click('[data-testid="add-category-btn"]');
    await page.fill('[data-testid="cat-name-input"]', 'Behavioral');
    await page.click('[data-testid="cat-save-btn"]');

    // Form should close and new category should appear
    await expect(page.locator('[data-testid="cat-name-input"]')).not.toBeVisible({ timeout: 5000 });
    await expect(page.locator('[data-testid="category-behavioral"]')).toBeVisible();

    // Custom categories should have a remove button
    await expect(page.locator('[data-testid="cat-remove-behavioral"]')).toBeVisible();
  });

  test('should deactivate a custom category', async ({ page }) => {
    await navigateToFieldSettings(page);
    await page.click('[data-testid="tab-categories"]');

    // Create first
    await page.click('[data-testid="add-category-btn"]');
    await page.fill('[data-testid="cat-name-input"]', 'Temp Category');
    await page.click('[data-testid="cat-save-btn"]');
    await expect(page.locator('[data-testid="cat-name-input"]')).not.toBeVisible({ timeout: 5000 });

    // Deactivate
    const removeBtn = page.locator('[data-testid="cat-remove-temp_category"]');
    if ((await removeBtn.count()) > 0) {
      await removeBtn.click();
      await expect(page.locator('[data-testid="category-temp_category"]')).not.toBeVisible({
        timeout: 5000,
      });
    }
  });
});
