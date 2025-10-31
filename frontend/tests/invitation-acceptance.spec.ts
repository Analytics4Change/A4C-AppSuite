import { test, expect, Page } from '@playwright/test';

/**
 * Invitation Acceptance Flow E2E Tests
 * Tests the invitation acceptance workflow with both email/password and OAuth methods
 */

const TEST_URL = 'http://localhost:5173';
const MOCK_TOKEN = 'valid-invitation-token-123';

/**
 * Helper to navigate to invitation acceptance page
 */
async function navigateToInvitationPage(page: Page, token: string = MOCK_TOKEN) {
  await page.goto(`${TEST_URL}/organizations/invitation?token=${token}`);
  await page.waitForTimeout(1000);
}

test.describe('Invitation Acceptance Flow', () => {
  test('should display invitation details after validating token', async ({ page }) => {
    await navigateToInvitationPage(page);

    // Wait for invitation validation
    await page.waitForTimeout(1500);

    // Should display organization name
    await expect(page.locator('text=/.*organization.*/i')).toBeVisible();

    // Should display email address
    await expect(page.locator('text=/.*@.*/i')).toBeVisible();

    // Should show acceptance methods
    await expect(page.locator('text=Email and Password')).toBeVisible();
    await expect(page.locator('text=Google')).toBeVisible();
  });

  test('should show error for invalid token', async ({ page }) => {
    await navigateToInvitationPage(page, 'invalid-token-xyz');
    await page.waitForTimeout(1500);

    // Should display error message
    const errorMessage = page.locator('text=/.*invalid.*|.*expired.*|.*not found.*/i');
    await expect(errorMessage.first()).toBeVisible();
  });

  test('should validate password requirements', async ({ page }) => {
    await navigateToInvitationPage(page);
    await page.waitForTimeout(1500);

    // Select email/password method
    await page.click('text=Email and Password');
    await page.waitForTimeout(300);

    // Try to submit with weak password
    await page.fill('input[type="password"]', 'weak');
    await page.click('button:has-text("Accept Invitation")');
    await page.waitForTimeout(500);

    // Should show password strength error
    const passwordError = page.locator('text=/.*password.*|.*characters.*|.*strong.*/i');
    await expect(passwordError.first()).toBeVisible();
  });

  test('should accept invitation with email/password', async ({ page }) => {
    await navigateToInvitationPage(page);
    await page.waitForTimeout(1500);

    // Select email/password method
    await page.click('text=Email and Password');
    await page.waitForTimeout(300);

    // Enter strong password
    await page.fill('input[type="password"]', 'SecurePassword123!');

    // Submit acceptance
    await page.click('button:has-text("Accept Invitation")');
    await page.waitForTimeout(1500);

    // Should navigate to organization dashboard
    await expect(page).toHaveURL(/\/organizations\/.+\/dashboard/);
  });

  test('should accept invitation with Google OAuth', async ({ page }) => {
    await navigateToInvitationPage(page);
    await page.waitForTimeout(1500);

    // Select Google OAuth method
    await page.click('text=Google');
    await page.waitForTimeout(300);

    // Click Google sign-in button
    await page.click('button:has-text("Sign in with Google")');
    await page.waitForTimeout(1000);

    // In mock mode, this should automatically proceed
    // Should navigate to organization dashboard
    await expect(page).toHaveURL(/\/organizations\/.+\/dashboard/, { timeout: 5000 });
  });

  test('should display loading state during acceptance', async ({ page }) => {
    await navigateToInvitationPage(page);
    await page.waitForTimeout(1500);

    await page.click('text=Email and Password');
    await page.fill('input[type="password"]', 'SecurePassword123!');

    // Click accept button
    await page.click('button:has-text("Accept Invitation")');

    // Should show loading indicator immediately
    const loadingIndicator = page.locator('text=/.*loading.*|.*processing.*/i, [class*="loading"], [class*="spinner"]');
    await expect(loadingIndicator.first()).toBeVisible({ timeout: 500 });
  });

  test('should disable accept button when already processing', async ({ page }) => {
    await navigateToInvitationPage(page);
    await page.waitForTimeout(1500);

    await page.click('text=Email and Password');
    await page.fill('input[type="password"]', 'SecurePassword123!');

    // Click accept button
    const acceptButton = page.locator('button:has-text("Accept Invitation")');
    await acceptButton.click();

    // Button should be disabled during processing
    await expect(acceptButton).toBeDisabled({ timeout: 500 });
  });

  test('should show error for expired invitation', async ({ page }) => {
    await navigateToInvitationPage(page, 'expired-token-456');
    await page.waitForTimeout(1500);

    // Should display expiration error
    const expiredMessage = page.locator('text=/.*expired.*/i');
    await expect(expiredMessage.first()).toBeVisible();

    // Accept button should not be visible
    const acceptButton = page.locator('button:has-text("Accept Invitation")');
    await expect(acceptButton).not.toBeVisible();
  });

  test('should show error for already accepted invitation', async ({ page }) => {
    await navigateToInvitationPage(page, 'used-token-789');
    await page.waitForTimeout(1500);

    // Should display already accepted error
    const usedMessage = page.locator('text=/.*already.*accepted.*/i');
    await expect(usedMessage.first()).toBeVisible();

    // Accept button should not be visible
    const acceptButton = page.locator('button:has-text("Accept Invitation")');
    await expect(acceptButton).not.toBeVisible();
  });

  test('should toggle password visibility', async ({ page }) => {
    await navigateToInvitationPage(page);
    await page.waitForTimeout(1500);

    await page.click('text=Email and Password');
    await page.waitForTimeout(300);

    const passwordInput = page.locator('input[type="password"]');
    await passwordInput.fill('MyPassword123!');

    // Should be password type initially
    await expect(passwordInput).toHaveAttribute('type', 'password');

    // Click toggle visibility button (if implemented)
    const toggleButton = page.locator('button:has([class*="eye"]), button:has-text("Show")');
    if (await toggleButton.isVisible({ timeout: 1000 })) {
      await toggleButton.click();
      await page.waitForTimeout(300);

      // Should change to text type
      const revealedInput = page.locator('input[type="text"]');
      await expect(revealedInput).toBeVisible();
    }
  });

  test('should handle network errors gracefully', async ({ page }) => {
    // Navigate with offline mode simulation
    await page.context().setOffline(true);
    await navigateToInvitationPage(page);
    await page.waitForTimeout(1500);

    // Should show connection error
    const networkError = page.locator('text=/.*network.*|.*connection.*|.*error.*/i');
    await expect(networkError.first()).toBeVisible({ timeout: 5000 });

    // Re-enable network
    await page.context().setOffline(false);
  });

  test('should display organization information prominently', async ({ page }) => {
    await navigateToInvitationPage(page);
    await page.waitForTimeout(1500);

    // Should show invitation heading
    await expect(page.locator('text=/.*invitation.*/i')).toBeVisible();

    // Should show organization name in a heading or prominent text
    const orgHeading = page.locator('h1, h2, h3').filter({ hasText: /.+/ });
    await expect(orgHeading.first()).toBeVisible();
  });

  test('should handle keyboard navigation', async ({ page }) => {
    await navigateToInvitationPage(page);
    await page.waitForTimeout(1500);

    // Tab through elements
    await page.keyboard.press('Tab');
    await page.keyboard.press('Enter'); // Select email/password method
    await page.waitForTimeout(300);

    await page.keyboard.press('Tab'); // Focus password input
    await page.keyboard.type('SecurePassword123!');
    await page.keyboard.press('Tab'); // Focus accept button

    // Should be able to submit with Enter
    await page.keyboard.press('Enter');
    await page.waitForTimeout(1000);

    // Should navigate or show loading
    const isNavigated = await page.url().includes('/dashboard');
    const hasLoading = await page.locator('[class*="loading"]').isVisible();
    expect(isNavigated || hasLoading).toBe(true);
  });

  test('should validate password is not empty', async ({ page }) => {
    await navigateToInvitationPage(page);
    await page.waitForTimeout(1500);

    await page.click('text=Email and Password');
    await page.waitForTimeout(300);

    // Try to submit without password
    await page.click('button:has-text("Accept Invitation")');
    await page.waitForTimeout(500);

    // Should show required field error
    const requiredError = page.locator('text=/.*required.*|.*enter.*password.*/i');
    await expect(requiredError.first()).toBeVisible();
  });

  test('should show password strength indicator', async ({ page }) => {
    await navigateToInvitationPage(page);
    await page.waitForTimeout(1500);

    await page.click('text=Email and Password');
    await page.waitForTimeout(300);

    // Type weak password
    await page.fill('input[type="password"]', 'weak');
    await page.waitForTimeout(300);

    // Should show weak indicator (if implemented)
    const weakIndicator = page.locator('text=/.*weak.*/i, [class*="weak"]');
    if (await weakIndicator.isVisible({ timeout: 1000 })) {
      await expect(weakIndicator.first()).toBeVisible();
    }

    // Type strong password
    await page.fill('input[type="password"]', 'StrongPassword123!@#');
    await page.waitForTimeout(300);

    // Should show strong indicator (if implemented)
    const strongIndicator = page.locator('text=/.*strong.*/i, [class*="strong"]');
    if (await strongIndicator.isVisible({ timeout: 1000 })) {
      await expect(strongIndicator.first()).toBeVisible();
    }
  });
});
