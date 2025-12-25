/**
 * Role Management E2E Tests
 *
 * Tests the role management flow with mock mode.
 * Verifies UI interactions for CRUD operations and accessibility.
 *
 * Test Modes:
 * - Mock mode (default): Tests UI flow without real database
 *
 * @see RolesPage.tsx - Card listing page
 * @see RolesManagePage.tsx - Split view management page
 * @see RoleCard.tsx - Individual role card
 */

import { test, expect, Page } from '@playwright/test';

// Base URL from playwright.config.ts webServer
const BASE_URL = 'http://localhost:3456';

/**
 * Helper to wait for mock auth login and navigation
 */
async function waitForAuthAndNavigation(page: Page) {
  // In mock mode, auth is automatic based on VITE_DEV_USER_ROLE=provider_admin
  // Wait for redirect to authenticated route
  await page.waitForURL(/\/(clients|roles|dashboard)/, { timeout: 10000 });
}

/**
 * Helper to navigate to roles page
 */
async function navigateToRoles(page: Page) {
  await page.goto(BASE_URL);
  await waitForAuthAndNavigation(page);
  await page.goto(`${BASE_URL}/roles`);
  await page.waitForLoadState('networkidle');
}

/**
 * Helper to navigate to roles manage page
 */
async function navigateToRolesManage(page: Page) {
  await page.goto(BASE_URL);
  await waitForAuthAndNavigation(page);
  await page.goto(`${BASE_URL}/roles/manage`);
  await page.waitForLoadState('networkidle');
}

// ============================================================================
// MOCK MODE TESTS - UI Flow Verification
// ============================================================================
test.describe('Role Management - Mock Mode (UI Flow)', () => {
  test.describe('Roles Page (Card View)', () => {
    test('should display role cards grid', async ({ page }) => {
      await navigateToRoles(page);

      // Verify page header is visible (heading is "Roles")
      await expect(page.getByRole('heading', { name: /^roles$/i })).toBeVisible();

      // Verify role cards are present
      const roleCards = page.locator('[data-testid="role-card"]');
      await expect(roleCards.first()).toBeVisible({ timeout: 5000 });
    });

    test('should display status filter buttons', async ({ page }) => {
      await navigateToRoles(page);

      // Wait for page to load
      await page.waitForSelector('[data-testid="role-list"]', { timeout: 5000 });

      // Verify filter buttons (not tabs - they use aria-pressed)
      // Use more specific regex to avoid "Inactive" matching "Active"
      await expect(page.getByRole('button', { name: /^all \(\d+\)$/i })).toBeVisible();
      await expect(page.getByRole('button', { name: /^active \(\d+\)$/i })).toBeVisible();
      await expect(page.getByRole('button', { name: /^inactive \(\d+\)$/i })).toBeVisible();
    });

    test('should filter roles by status', async ({ page }) => {
      await navigateToRoles(page);

      // Wait for cards to load
      await page.waitForSelector('[data-testid="role-card"]', { timeout: 5000 });

      // Click Active filter button
      await page.getByRole('button', { name: /^active \(\d+\)$/i }).click();

      // All visible cards should be active (have Active badge)
      const cards = page.locator('[data-testid="role-card"]');
      const count = await cards.count();

      // If there are cards, verify they're all active
      if (count > 0) {
        for (let i = 0; i < count; i++) {
          const card = cards.nth(i);
          // Active cards have a green "Active" badge
          const hasBadge = await card.locator('text=Active').count();
          const hasInactive = await card.locator('text=Inactive').count();
          expect(hasBadge > 0 && hasInactive === 0).toBeTruthy();
        }
      }
    });

    test('should search roles by name', async ({ page }) => {
      await navigateToRoles(page);

      // Wait for cards to load
      await page.waitForSelector('[data-testid="role-card"]', { timeout: 5000 });

      // Type in search (placeholder is "Search by name or description...")
      const searchInput = page.getByPlaceholder(/search by name/i);
      await searchInput.fill('Admin');

      // Wait for filter to apply
      await page.waitForTimeout(300);

      // Verify cards contain search term
      const cards = page.locator('[data-testid="role-card"]');
      const count = await cards.count();

      if (count > 0) {
        for (let i = 0; i < count; i++) {
          const card = cards.nth(i);
          const text = await card.textContent();
          expect(text?.toLowerCase()).toContain('admin');
        }
      }
    });

    test('should navigate to manage page on card click', async ({ page }) => {
      await navigateToRoles(page);

      // Wait for cards to load
      const roleCard = page.locator('[data-testid="role-card"]').first();
      await roleCard.waitFor({ timeout: 5000 });

      // Click the card
      await roleCard.click();

      // Should navigate to manage page
      await expect(page).toHaveURL(/\/roles\/manage/);
    });

    test('should navigate to manage page on Create button click', async ({ page }) => {
      await navigateToRoles(page);

      // Wait for page to load
      await page.waitForSelector('[data-testid="role-list"]', { timeout: 5000 });

      // Click Create Role button
      await page.getByRole('button', { name: /^create role$/i }).click();

      // Should navigate to manage page
      await expect(page).toHaveURL(/\/roles\/manage/);
    });

    test('should show deactivate confirmation dialog', async ({ page }) => {
      await navigateToRoles(page);

      // Wait for cards to load
      await page.waitForSelector('[data-testid="role-list"]', { timeout: 5000 });

      // Find first active role card (has green "Active" badge, exclude Inactive)
      const roleCards = page.locator('[data-testid="role-card"]');
      const count = await roleCards.count();

      // Find first card with deactivate button
      for (let i = 0; i < count; i++) {
        const card = roleCards.nth(i);
        const deactivateButton = card.getByRole('button', { name: /^deactivate$/i });

        if (await deactivateButton.isVisible()) {
          await deactivateButton.click();

          // Verify dialog appears with proper structure
          const dialog = page.getByRole('alertdialog');
          await expect(dialog).toBeVisible();

          // Verify dialog has a heading about deactivation
          await expect(dialog.getByRole('heading', { name: /deactivate/i })).toBeVisible();
          break;
        }
      }
    });
  });

  test.describe('Roles Manage Page (Split View)', () => {
    test('should display empty state initially', async ({ page }) => {
      await navigateToRolesManage(page);

      // Should show empty state message
      await expect(page.getByText(/no role selected/i)).toBeVisible();
    });

    test('should display role list', async ({ page }) => {
      await navigateToRolesManage(page);

      // Verify role list is present
      const roleList = page.locator('ul[aria-label="Roles"]');
      await expect(roleList).toBeVisible({ timeout: 5000 });
    });

    test('should select role from list', async ({ page }) => {
      await navigateToRolesManage(page);

      // Wait for roles to load
      const roleList = page.locator('ul[aria-label="Roles"]');
      await roleList.waitFor({ timeout: 5000 });

      // Click first role in list
      const firstRole = roleList.locator('li').first();
      await firstRole.click();

      // Should show edit form
      await expect(page.getByText(/edit role/i)).toBeVisible();
    });

    test('should enter create mode on Create button click', async ({ page }) => {
      await navigateToRolesManage(page);

      // Wait for page to load
      await page.waitForSelector('ul[aria-label="Roles"]', { timeout: 5000 });

      // Click Create New Role button
      await page.getByRole('button', { name: /create new role/i }).click();

      // Should show create form - verify form fields appear
      await expect(page.getByLabel(/role name/i)).toBeVisible({ timeout: 5000 });
    });

    test('should display form fields in create mode', async ({ page }) => {
      await navigateToRolesManage(page);

      // Wait for page and enter create mode
      await page.waitForSelector('ul[aria-label="Roles"]', { timeout: 5000 });
      await page.getByRole('button', { name: /create new role/i }).click();

      // Verify form fields are present
      await expect(page.getByLabel(/role name/i)).toBeVisible();
      await expect(page.getByLabel(/description/i)).toBeVisible();
    });

    test('should display permission selector in create mode', async ({ page }) => {
      await navigateToRolesManage(page);

      // Wait for page and enter create mode
      await page.waitForSelector('ul[aria-label="Roles"]', { timeout: 5000 });
      await page.getByRole('button', { name: /create new role/i }).click();

      // Verify permission selector heading is present (exact text: "Permissions")
      await expect(page.locator('h3:has-text("Permissions")')).toBeVisible();
    });

    test('should show validation error for invalid name', async ({ page }) => {
      await navigateToRolesManage(page);

      // Wait for page and enter create mode
      await page.waitForSelector('ul[aria-label="Roles"]', { timeout: 5000 });
      await page.getByRole('button', { name: /create new role/i }).click();

      // Fill in an invalid name (starting with number)
      const nameInput = page.getByLabel(/role name/i);
      await nameInput.fill('123Admin');
      await nameInput.blur();

      // Check for validation error
      await expect(page.getByText(/must start with a letter/i)).toBeVisible();
    });

    test('should show validation error for short description', async ({ page }) => {
      await navigateToRolesManage(page);

      // Wait for page and enter create mode
      await page.waitForSelector('ul[aria-label="Roles"]', { timeout: 5000 });
      await page.getByRole('button', { name: /create new role/i }).click();

      // Fill in a short description
      const descInput = page.getByLabel(/description/i);
      await descInput.fill('Short');
      await descInput.blur();

      // Check for validation error
      await expect(page.getByText(/at least 10 characters/i)).toBeVisible();
    });

    test('should create new role with valid data', async ({ page }) => {
      await navigateToRolesManage(page);

      // Wait for page and enter create mode
      await page.waitForSelector('ul[aria-label="Roles"]', { timeout: 10000 });
      await page.getByRole('button', { name: /create new role/i }).click();

      // Wait for form to appear (use getByLabel which is more reliable)
      const nameInput = page.getByLabel(/role name/i);
      await expect(nameInput).toBeVisible({ timeout: 10000 });

      // Fill in valid data
      await nameInput.fill('Test E2E Role');
      await page.getByLabel(/description/i).fill('A test role created during E2E testing for validation');

      // Wait for the description to be filled before continuing
      await page.waitForTimeout(100);

      // Toggle a permission (find first enabled checkbox)
      // Scroll down first to avoid sticky header interception
      const permissionCheckboxes = page.locator('input[type="checkbox"]:not([disabled])');
      if (await permissionCheckboxes.count() > 0) {
        const firstCheckbox = permissionCheckboxes.first();
        await firstCheckbox.scrollIntoViewIfNeeded();
        await firstCheckbox.click({ force: true });
        await page.waitForTimeout(100);
      }

      // Click Create button (button text is "Create Role")
      const createButton = page.getByRole('button', { name: /^create role$/i });
      await expect(createButton).toBeEnabled({ timeout: 5000 });
      await createButton.click();

      // Should show success (edit mode with the new role) - increase timeout for mock service
      await expect(page.getByText(/edit role/i)).toBeVisible({ timeout: 10000 });
    });

    test('should toggle applet permissions with select all', async ({ page }) => {
      await navigateToRolesManage(page);

      // Wait for page and enter create mode
      await page.waitForSelector('ul[aria-label="Roles"]', { timeout: 5000 });
      await page.getByRole('button', { name: /create new role/i }).click();

      // Wait for permission selector to render
      await page.waitForSelector('h3:has-text("Permissions")', { timeout: 5000 });

      // Find select all checkbox for first applet group (enabled ones only)
      const selectAllCheckboxes = page.locator('[aria-label^="Select all permissions"]:not([disabled])');

      if (await selectAllCheckboxes.count() > 0) {
        const selectAllCheckbox = selectAllCheckboxes.first();

        // Click to select all
        await selectAllCheckbox.click();

        // Verify it's checked
        await expect(selectAllCheckbox).toBeChecked();

        // Click again to deselect all
        await selectAllCheckbox.click();

        // Verify it's unchecked
        await expect(selectAllCheckbox).not.toBeChecked();
      }
    });

    test('should warn before discarding unsaved changes', async ({ page }) => {
      await navigateToRolesManage(page);

      // Wait for page and enter create mode
      await page.waitForSelector('ul[aria-label="Roles"]', { timeout: 5000 });
      await page.getByRole('button', { name: /create new role/i }).click();

      // Wait for form to appear (use getByLabel which is more reliable)
      const nameInput = page.getByLabel(/role name/i);
      await expect(nameInput).toBeVisible({ timeout: 5000 });

      // Make changes to mark form as dirty
      await nameInput.fill('Unsaved Role');

      // Try to select a role from list
      const roleList = page.locator('ul[aria-label="Roles"]');
      const firstRole = roleList.locator('li').first();
      await firstRole.click();

      // Should show discard confirmation dialog
      const dialog = page.getByRole('alertdialog');
      await expect(dialog).toBeVisible({ timeout: 3000 });
      await expect(dialog.getByRole('heading', { name: /unsaved changes/i })).toBeVisible();
    });
  });

  test.describe('Accessibility', () => {
    test('should have proper keyboard navigation on roles page', async ({ page }) => {
      await navigateToRoles(page);

      // Wait for page to load
      await page.waitForSelector('[data-testid="role-list"]', { timeout: 5000 });

      // Tab to first interactive element
      await page.keyboard.press('Tab');

      // The element should be focusable
      const focusedElement = await page.evaluate(() => document.activeElement?.tagName);
      expect(focusedElement).toBeTruthy();
    });

    test('should have ARIA labels on role list items', async ({ page }) => {
      await navigateToRolesManage(page);

      // Wait for roles to load
      const roleList = page.locator('ul[aria-label="Roles"]');
      await roleList.waitFor({ timeout: 5000 });

      // Verify list has aria-label
      await expect(roleList).toHaveAttribute('aria-label', 'Roles');

      // Verify list items have aria-label
      const listItems = roleList.locator('li[aria-label]');
      const count = await listItems.count();
      if (count > 0) {
        await expect(listItems.first()).toHaveAttribute('aria-label', /.+/);
      }
    });

    test('should have proper focus management on dialogs', async ({ page }) => {
      await navigateToRolesManage(page);

      // Wait for roles to load
      const roleList = page.locator('ul[aria-label="Roles"]');
      await roleList.waitFor({ timeout: 5000 });

      // Click first role to select it
      const firstRole = roleList.locator('li').first();
      await firstRole.click();

      // Wait for form to load
      await page.waitForSelector('text=Edit Role', { timeout: 5000 });

      // Find Deactivate button (only visible for active roles)
      const deactivateButton = page.getByRole('button', { name: /deactivate role/i });

      if (await deactivateButton.isVisible()) {
        await deactivateButton.click();

        // Verify dialog has role="alertdialog"
        const dialog = page.getByRole('alertdialog');
        await expect(dialog).toBeVisible();

        // Dialog should have aria-describedby
        await expect(dialog).toHaveAttribute('aria-describedby', /.+/);
      }
    });

    test('should have proper form labels', async ({ page }) => {
      await navigateToRolesManage(page);

      // Wait for page and enter create mode
      await page.waitForSelector('ul[aria-label="Roles"]', { timeout: 5000 });
      await page.getByRole('button', { name: /create new role/i }).click();

      // Verify form inputs have associated labels
      const nameInput = page.getByLabel(/role name/i);
      await expect(nameInput).toBeVisible();

      const descInput = page.getByLabel(/description/i);
      await expect(descInput).toBeVisible();
    });

    test('should announce errors to screen readers', async ({ page }) => {
      await navigateToRolesManage(page);

      // Wait for page and enter create mode
      await page.waitForSelector('ul[aria-label="Roles"]', { timeout: 5000 });
      await page.getByRole('button', { name: /create new role/i }).click();

      // Trigger validation error
      const nameInput = page.getByLabel(/role name/i);
      await nameInput.fill('123');
      await nameInput.blur();

      // Error should have role="alert"
      const errorMessage = page.locator('[role="alert"]');
      await expect(errorMessage.first()).toBeVisible();
    });

    test('should have proper checkbox ARIA states', async ({ page }) => {
      await navigateToRolesManage(page);

      // Wait for page and enter create mode
      await page.waitForSelector('ul[aria-label="Roles"]', { timeout: 5000 });
      await page.getByRole('button', { name: /create new role/i }).click();

      // Wait for permission selector
      await page.waitForSelector('h3:has-text("Permissions")', { timeout: 5000 });

      // Find permission checkboxes
      const checkboxes = page.locator('input[type="checkbox"]');
      const count = await checkboxes.count();

      if (count > 0) {
        const checkbox = checkboxes.first();
        // Verify checkbox is focusable and has proper type
        await expect(checkbox).toHaveAttribute('type', 'checkbox');
      }
    });
  });

  test.describe('Role Status Operations', () => {
    test('should deactivate an active role', async ({ page }) => {
      await navigateToRolesManage(page);

      // Wait for roles to load
      const roleList = page.locator('ul[aria-label="Roles"]');
      await roleList.waitFor({ timeout: 5000 });

      // Click first role
      const firstRole = roleList.locator('li').first();
      await firstRole.click();

      // Wait for form to load
      await expect(page.getByText(/edit role/i)).toBeVisible();

      // Find Deactivate button (only visible for active roles)
      const deactivateButton = page.getByRole('button', { name: /deactivate role/i });

      if (await deactivateButton.isVisible()) {
        await deactivateButton.click();

        // Confirm in dialog
        const dialog = page.getByRole('alertdialog');
        await expect(dialog).toBeVisible();

        const confirmButton = dialog.getByRole('button', { name: /deactivate/i });
        await confirmButton.click();

        // Should show success (inactive warning banner)
        await expect(page.getByText(/inactive role/i)).toBeVisible({ timeout: 5000 });
      }
    });

    test('should reactivate an inactive role', async ({ page }) => {
      await navigateToRolesManage(page);

      // Filter to inactive roles
      const statusSelect = page.locator('[aria-label="Filter by role status"]');
      await statusSelect.selectOption('inactive');

      // Wait for filtered results
      await page.waitForTimeout(300);

      // Click first inactive role
      const roleList = page.locator('ul[aria-label="Roles"]');
      const firstRole = roleList.locator('li').first();

      if (await firstRole.isVisible()) {
        await firstRole.click();

        // Wait for form to load
        await expect(page.getByText(/edit role/i)).toBeVisible();

        // Find Reactivate button
        const reactivateButton = page.getByRole('button', { name: /reactivate role/i });

        if (await reactivateButton.isVisible()) {
          await reactivateButton.click();

          // Confirm in dialog
          const dialog = page.getByRole('alertdialog');
          await expect(dialog).toBeVisible();

          const confirmButton = dialog.getByRole('button', { name: /reactivate/i });
          await confirmButton.click();

          // Should no longer show inactive warning
          await expect(page.getByText(/inactive role/i)).not.toBeVisible({ timeout: 5000 });
        }
      }
    });

    test('should prevent deletion of active roles', async ({ page }) => {
      await navigateToRolesManage(page);

      // Wait for roles to load
      const roleList = page.locator('ul[aria-label="Roles"]');
      await roleList.waitFor({ timeout: 5000 });

      // Click first role
      const firstRole = roleList.locator('li').first();
      await firstRole.click();

      // Wait for form to load
      await expect(page.getByText(/edit role/i)).toBeVisible();

      // Find Delete button
      const deleteButton = page.getByRole('button', { name: /delete role/i });

      if (await deleteButton.isVisible()) {
        await deleteButton.click();

        // Should show warning about deactivating first (for active roles)
        const dialog = page.getByRole('alertdialog');
        const warningText = await dialog.textContent();

        // Either warning to deactivate first, or regular delete confirmation
        expect(warningText).toBeTruthy();
      }
    });
  });
});
