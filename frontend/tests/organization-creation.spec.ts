import { test, expect, Page } from '@playwright/test';

/**
 * Organization Creation Flow E2E Tests
 * Tests the complete organization creation workflow with mock mode
 */

const TEST_URL = 'http://localhost:5173';

/**
 * Helper to navigate to organization creation page
 */
async function navigateToOrganizationCreate(page: Page) {
  await page.goto(TEST_URL);
  await page.waitForTimeout(1000);

  // Login with mock auth (any credentials work)
  const emailInput = page.locator('input[type="email"]');
  if (await emailInput.isVisible({ timeout: 2000 })) {
    await emailInput.fill('admin@a4c.com');
    await page.fill('input[type="password"]', 'password');
    await page.click('button[type="submit"]');
    await page.waitForTimeout(1000);
  }

  // Navigate to Organizations page
  await page.click('text=Organizations', { timeout: 10000 });
  await page.waitForTimeout(500);

  // Click Create New Organization button
  await page.click('button:has-text("Create New Organization")');
  await page.waitForTimeout(500);
}

test.describe('Organization Creation Flow', () => {
  test('should display organization creation form', async ({ page }) => {
    await navigateToOrganizationCreate(page);

    // Verify all main sections are present
    await expect(page.locator('text=Basic Information')).toBeVisible();
    await expect(page.locator('text=Admin Contact')).toBeVisible();
    await expect(page.locator('text=Billing Address')).toBeVisible();
    await expect(page.locator('text=Billing Phone')).toBeVisible();
    await expect(page.locator('text=Initial Program')).toBeVisible();
  });

  test('should validate required fields', async ({ page }) => {
    await navigateToOrganizationCreate(page);

    // Try to submit without filling any fields
    await page.click('button:has-text("Create Organization")');
    await page.waitForTimeout(500);

    // Check for validation errors
    // Note: Actual error messages depend on implementation
    const errorElements = page.locator('[class*="error"]');
    await expect(errorElements.first()).toBeVisible();
  });

  test('should fill and submit complete organization form', async ({ page }) => {
    await navigateToOrganizationCreate(page);

    // Fill Basic Information
    await page.fill('input[name="organizationName"]', 'Hope Recovery Center');
    await page.fill('input[name="organizationSlug"]', 'hope-recovery');
    await page.selectOption('select[name="organizationType"]', 'provider');
    await page.fill('input[name="subdomain"]', 'hope');
    await page.selectOption('select[name="timezone"]', 'America/New_York');

    // Fill Admin Contact
    await page.fill('input[name="adminContact.firstName"]', 'Sarah');
    await page.fill('input[name="adminContact.lastName"]', 'Johnson');
    await page.fill('input[name="adminContact.email"]', 'sarah.johnson@hope.org');
    await page.fill('input[name="adminContact.title"]', 'Executive Director');

    // Fill Billing Address
    await page.fill('input[name="billingAddress.street1"]', '123 Recovery Lane');
    await page.fill('input[name="billingAddress.city"]', 'Portland');
    await page.selectOption('select[name="billingAddress.state"]', 'OR');
    await page.fill('input[name="billingAddress.zipCode"]', '97201');

    // Fill Billing Phone
    await page.fill('input[name="billingPhone.number"]', '(503) 555-0100');

    // Fill Initial Program
    await page.fill('input[name="program.name"]', 'Residential Treatment');
    await page.selectOption('select[name="program.type"]', 'residential');
    await page.fill('textarea[name="program.description"]', 'Comprehensive residential treatment program');
    await page.fill('input[name="program.capacity"]', '30');

    // Submit form
    await page.click('button:has-text("Create Organization")');
    await page.waitForTimeout(1000);

    // Should navigate to bootstrap status page
    await expect(page).toHaveURL(/\/organizations\/bootstrap\/.+/);
  });

  test('should display workflow progress on bootstrap status page', async ({ page }) => {
    await navigateToOrganizationCreate(page);

    // Fill minimum required fields
    await page.fill('input[name="organizationName"]', 'Quick Test Org');
    await page.fill('input[name="organizationSlug"]', 'quick-test');
    await page.selectOption('select[name="organizationType"]', 'provider');
    await page.fill('input[name="subdomain"]', 'quicktest');
    await page.selectOption('select[name="timezone"]', 'America/New_York');
    await page.fill('input[name="adminContact.firstName"]', 'Test');
    await page.fill('input[name="adminContact.lastName"]', 'User');
    await page.fill('input[name="adminContact.email"]', 'test@test.org');
    await page.fill('input[name="billingAddress.street1"]', '123 Test St');
    await page.fill('input[name="billingAddress.city"]', 'Portland');
    await page.selectOption('select[name="billingAddress.state"]', 'OR');
    await page.fill('input[name="billingAddress.zipCode"]', '97201');
    await page.fill('input[name="billingPhone.number"]', '(503) 555-0100');
    await page.fill('input[name="program.name"]', 'Test Program');
    await page.selectOption('select[name="program.type"]', 'outpatient');

    await page.click('button:has-text("Create Organization")');
    await page.waitForTimeout(1000);

    // Verify bootstrap status page
    await expect(page.locator('text=Organization Bootstrap Progress')).toBeVisible();
    await expect(page.locator('text=Workflow Status')).toBeVisible();

    // Check for stage indicators (in mock mode, these should be visible)
    const stages = page.locator('[class*="stage"]');
    await expect(stages.first()).toBeVisible();
  });

  test('should save draft when auto-save is triggered', async ({ page }) => {
    await navigateToOrganizationCreate(page);

    // Fill some fields
    await page.fill('input[name="organizationName"]', 'Draft Organization');
    await page.fill('input[name="organizationSlug"]', 'draft-org');
    await page.waitForTimeout(600); // Wait for debounced auto-save

    // Navigate away
    await page.click('text=Organizations');
    await page.waitForTimeout(500);

    // Check if draft appears in list
    // Note: This depends on OrganizationListPage showing drafts
    const draftCard = page.locator('text=Draft Organization');
    await expect(draftCard).toBeVisible({ timeout: 5000 });
  });

  test('should load draft when user returns', async ({ page }) => {
    await navigateToOrganizationCreate(page);

    // Fill and save draft
    await page.fill('input[name="organizationName"]', 'Load Draft Test');
    await page.fill('input[name="adminContact.firstName"]', 'John');
    await page.waitForTimeout(600);

    // Navigate away and back
    await page.click('text=Organizations');
    await page.waitForTimeout(500);

    // Click on the draft to load it
    await page.click('text=Load Draft Test');
    await page.waitForTimeout(500);

    // Verify fields are populated
    const nameInput = page.locator('input[name="organizationName"]');
    await expect(nameInput).toHaveValue('Load Draft Test');
    const firstNameInput = page.locator('input[name="adminContact.firstName"]');
    await expect(firstNameInput).toHaveValue('John');
  });

  test('should validate email format', async ({ page }) => {
    await navigateToOrganizationCreate(page);

    await page.fill('input[name="adminContact.email"]', 'invalid-email');
    await page.click('button:has-text("Create Organization")');
    await page.waitForTimeout(500);

    // Should show email validation error
    const emailError = page.locator('text=/.*email.*/i').filter({ hasText: /invalid|format/i });
    await expect(emailError.first()).toBeVisible();
  });

  test('should validate phone number format', async ({ page }) => {
    await navigateToOrganizationCreate(page);

    await page.fill('input[name="billingPhone.number"]', '123'); // Invalid format
    await page.click('button:has-text("Create Organization")');
    await page.waitForTimeout(500);

    // Should show phone validation error
    const phoneError = page.locator('text=/.*phone.*/i').filter({ hasText: /invalid|format/i });
    await expect(phoneError.first()).toBeVisible();
  });

  test('should validate zip code format', async ({ page }) => {
    await navigateToOrganizationCreate(page);

    await page.fill('input[name="billingAddress.zipCode"]', '123'); // Invalid format
    await page.click('button:has-text("Create Organization")');
    await page.waitForTimeout(500);

    // Should show zip code validation error
    const zipError = page.locator('text=/.*zip.*/i').filter({ hasText: /invalid|format/i });
    await expect(zipError.first()).toBeVisible();
  });

  test('should handle keyboard navigation through form', async ({ page }) => {
    await navigateToOrganizationCreate(page);

    // Tab through form fields
    await page.keyboard.press('Tab'); // Focus first input
    await page.keyboard.type('Test Org');
    await page.keyboard.press('Tab');
    await page.keyboard.type('test-org');
    await page.keyboard.press('Tab');

    // Verify focus advancement worked by checking filled values
    const nameInput = page.locator('input[name="organizationName"]');
    await expect(nameInput).toHaveValue('Test Org');
    const slugInput = page.locator('input[name="organizationSlug"]');
    await expect(slugInput).toHaveValue('test-org');
  });

  test('should display collapsible sections', async ({ page }) => {
    await navigateToOrganizationCreate(page);

    // Find a collapsible section header
    const adminContactHeader = page.locator('text=Admin Contact').first();
    await adminContactHeader.click();
    await page.waitForTimeout(300);

    // Section should collapse (implementation-dependent)
    // This is a placeholder - actual behavior depends on implementation
  });
});
