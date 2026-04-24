/**
 * Users Manage Page — notification-preferences save UAT
 *
 * Regression guard for the Sonner toast on successful save. The inline save
 * handler previously persisted silently; the toast is added in PR #37 and
 * this test verifies the end-to-end UX in mock mode so the regression
 * guard is automated (not just a developer ritual).
 *
 * Run with:
 *   cd frontend && npx playwright test --config playwright.users-uat.config.ts
 *
 * Prerequisites:
 *   - webServer launches with VITE_FORCE_MOCK=true + VITE_DEV_PROFILE=super_admin
 *     (handled by playwright.users-uat.config.ts) on port 3459.
 */

import { test, expect, Page } from '@playwright/test';

const BASE_URL = 'http://localhost:3459';

async function navigateToUsersManagePage(page: Page) {
  await page.goto(`${BASE_URL}/users/manage`);

  // Safety net: if redirected to login, auto-login with super_admin
  const isLoginPage = await page
    .locator('[data-testid="login-page"]')
    .isVisible({ timeout: 3000 })
    .catch(() => false);
  if (isLoginPage) {
    await page.fill('#email', 'super.admin@example.com');
    await page.fill('#password', 'any-password');
    await page.click('button[type="submit"]');
    await page.waitForURL(/\/(clients|organizations|users|dashboard|settings)/, { timeout: 10000 });
    await page.goto(`${BASE_URL}/users/manage`);
  }

  await expect(page.getByRole('heading', { name: 'User Management' })).toBeVisible({
    timeout: 15000,
  });
}

test.describe('Users Manage Page — notification preferences', () => {
  test('shows Sonner toast on successful save', async ({ page }) => {
    await navigateToUsersManagePage(page);

    // Filter to Active users — invitations don't have a notification-prefs
    // section; `currentItem.isInvitation` short-circuits the save handler.
    await page.getByRole('button', { name: /^Active$/ }).click();

    // Pick the first active-user row card in the list.
    const firstUser = page.locator('[class*="cursor-pointer"]').filter({ hasText: /@/ }).first();
    await expect(firstUser).toBeVisible({ timeout: 10000 });
    await firstUser.click();

    // Scroll the details pane until the Notification Preferences section
    // shows (it lives below the Roles section).
    const prefsHeading = page.getByRole('heading', { name: 'Notification Preferences' });
    await prefsHeading.scrollIntoViewIfNeeded();
    await expect(prefsHeading).toBeVisible({ timeout: 10000 });

    // Toggle email to force a state change so Save Preferences is enabled.
    // The form uses a Radix Checkbox (role="checkbox"), not a Switch.
    const emailToggle = page.getByRole('checkbox', { name: /email notifications/i }).first();
    await expect(emailToggle).toBeVisible();
    await emailToggle.click();

    // Click Save Preferences — the form's save button
    const saveButton = page.getByRole('button', { name: 'Save Preferences' });
    await expect(saveButton).toBeEnabled();
    await saveButton.click();

    // Assert Sonner success toast is rendered. Sonner uses role=status + the
    // configured message text (@/App.tsx:65 mounts <Toaster richColors
    // position="top-right" />).
    const toast = page.getByText('Notification preferences updated', { exact: true });
    await expect(toast).toBeVisible({ timeout: 5000 });
  });
});
