/**
 * Organization Unit CRUD E2E Tests
 *
 * Tests the organizational unit management flow with mock mode.
 * Verifies UI interactions for create, update, and deactivate operations.
 *
 * Test Modes:
 * - Mock mode (default): Tests UI flow without real database
 * - Integration mode: Tests actual event emission (requires RUN_INTEGRATION_TESTS=true)
 *
 * @see OrganizationUnitsManagePage.tsx
 * @see OrganizationTree.tsx
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
  await page.waitForURL(/\/(clients|organization-units|dashboard)/, { timeout: 10000 });
}

/**
 * Helper to navigate to OU management page
 */
async function navigateToOUManage(page: Page) {
  await page.goto(BASE_URL);
  await waitForAuthAndNavigation(page);

  // Try to click Org Units in navigation, or navigate directly
  try {
    // Try multiple selector patterns
    const orgUnitsLink = page.getByRole('link', { name: /org units/i })
      .or(page.getByRole('button', { name: /org units/i }))
      .or(page.locator('a[href*="organization-units"]'));

    if (await orgUnitsLink.first().isVisible({ timeout: 2000 })) {
      await orgUnitsLink.first().click();
      await page.waitForURL(/\/organization-units/, { timeout: 5000 });
    } else {
      // Direct navigation if menu item not found
      await page.goto(`${BASE_URL}/organization-units/manage`);
    }
  } catch {
    // Fallback to direct navigation
    await page.goto(`${BASE_URL}/organization-units/manage`);
  }
}

// ============================================================================
// MOCK MODE TESTS - UI Flow Verification
// ============================================================================
test.describe('OU CRUD - Mock Mode (UI Flow)', () => {

  test('should display OU tree with root organization', async ({ page }) => {
    await navigateToOUManage(page);

    // Verify tree is visible
    const tree = page.locator('[data-testid="ou-tree"]');
    await expect(tree).toBeVisible({ timeout: 5000 });

    // Verify at least one node exists (root organization)
    const nodes = page.locator('[data-testid="ou-tree-node"]');
    await expect(nodes.first()).toBeVisible();
  });

  test('should show root organization badge', async ({ page }) => {
    await navigateToOUManage(page);

    // Find root organization node
    const rootNode = page.locator('[data-testid="ou-tree-node"][data-root="true"]');
    await expect(rootNode).toBeVisible();

    // Should have Root badge
    await expect(rootNode.locator('text=Root')).toBeVisible();
  });

  test('should select OU node on click', async ({ page }) => {
    await navigateToOUManage(page);

    // Click first non-root node (if exists) or root node
    // Must click on the inner div (which has the click handler), not the li element
    const nodes = page.locator('[data-testid="ou-tree-node"]');
    const firstNode = nodes.first();
    const clickableArea = firstNode.locator('> div').first();
    await clickableArea.click();

    // Verify selection via aria-selected
    await expect(firstNode).toHaveAttribute('aria-selected', 'true');
  });

  test('should expand/collapse OU with children', async ({ page }) => {
    await navigateToOUManage(page);

    // Find a node with children (has expand button)
    const nodeWithChildren = page.locator('[data-testid="ou-tree-node"][aria-expanded]').first();

    if (await nodeWithChildren.count() > 0) {
      // Get initial expansion state
      const isInitiallyExpanded = await nodeWithChildren.getAttribute('aria-expanded') === 'true';

      // Click expand/collapse button
      const toggleButton = nodeWithChildren.locator('button[aria-label="Expand"], button[aria-label="Collapse"]');
      await toggleButton.click();

      // Verify state changed
      const expectedState = isInitiallyExpanded ? 'false' : 'true';
      await expect(nodeWithChildren).toHaveAttribute('aria-expanded', expectedState);
    } else {
      // Skip if no expandable nodes
      test.skip();
    }
  });

  test('should navigate to create OU page', async ({ page }) => {
    // Navigate directly to manage page (not overview page)
    await page.goto(`${BASE_URL}/organization-units/manage`);
    await waitForAuthAndNavigation(page);

    // Wait for the tree to load
    await page.waitForSelector('[data-testid="ou-tree"]', { timeout: 5000 });

    // Click Create New Unit button
    const createButton = page.getByRole('button', { name: /create new unit/i });
    await createButton.click();

    // Should navigate to create page
    await page.waitForURL(/\/organization-units\/create/);
  });

  test('should create new OU under parent', async ({ page }) => {
    // Navigate directly to create page
    await page.goto(`${BASE_URL}/organization-units/create`);
    await waitForAuthAndNavigation(page);

    // Wait for form to be ready
    await page.waitForSelector('form', { timeout: 5000 });

    // Fill form fields - ids are "unit-name" and "display-name"
    const nameInput = page.locator('#unit-name');
    const displayNameInput = page.locator('#display-name');

    await nameInput.fill('Test Campus E2E');
    await displayNameInput.fill('Test Campus E2E Display');

    // Submit form - button text is "Create Unit"
    const submitButton = page.getByRole('button', { name: /create unit/i });
    await submitButton.click();

    // Should redirect to manage page (possibly with expandParent param)
    await page.waitForURL(/\/organization-units\/manage/, { timeout: 10000 });
  });

  test('should show Edit button when OU is selected', async ({ page }) => {
    // Navigate directly to manage page
    await page.goto(`${BASE_URL}/organization-units/manage`);
    await waitForAuthAndNavigation(page);

    // Wait for the tree to load
    await page.waitForSelector('[data-testid="ou-tree"]', { timeout: 5000 });

    // Select a non-root node if possible
    // Must click on the inner div (which has the click handler), not the li element
    const nonRootNode = page.locator('[data-testid="ou-tree-node"]:not([data-root="true"])').first();
    const targetNode = await nonRootNode.count() > 0 ? nonRootNode : page.locator('[data-testid="ou-tree-node"]').first();
    const clickableArea = targetNode.locator('> div').first();
    await clickableArea.click();

    // Edit button should be visible (button text is "Edit Selected Unit")
    const editButton = page.getByRole('button', { name: /edit selected unit/i });
    await expect(editButton).toBeVisible();
  });

  test('should show Deactivate button for non-root OU', async ({ page }) => {
    await navigateToOUManage(page);

    // Select a non-root node
    // Must click on the inner div (which has the click handler), not the li element
    const nonRootNode = page.locator('[data-testid="ou-tree-node"]:not([data-root="true"])').first();

    if (await nonRootNode.count() > 0) {
      const clickableArea = nonRootNode.locator('> div').first();
      await clickableArea.click();

      // Deactivate button should be visible
      const deactivateButton = page.locator('button:has-text("Deactivate")');
      await expect(deactivateButton).toBeVisible();
    } else {
      // Only root node exists - Deactivate should be disabled or not shown
      test.skip();
    }
  });

  test('should display OU names alphabetically sorted', async ({ page }) => {
    await navigateToOUManage(page);

    // Expand all nodes to see full hierarchy
    const expandButtons = page.locator('button[aria-label="Expand"]');
    const count = await expandButtons.count();
    for (let i = 0; i < count; i++) {
      await expandButtons.nth(i).click();
      await page.waitForTimeout(100);
    }

    // Get all OU names at root level (excluding root org)
    const ouNames = await page.locator('[data-testid="ou-tree-node"]:not([data-root="true"]) > div [data-testid="ou-name"]').allTextContents();

    if (ouNames.length > 1) {
      // Split into active and inactive (inactive have different styling, check data-inactive)
      const activeNames: string[] = [];
      const inactiveNames: string[] = [];

      const nodes = page.locator('[data-testid="ou-tree-node"]:not([data-root="true"])');
      for (let i = 0; i < await nodes.count(); i++) {
        const node = nodes.nth(i);
        const name = await node.locator('[data-testid="ou-name"]').first().textContent();
        const isInactive = await node.getAttribute('data-inactive') === 'true';
        if (name) {
          if (isInactive) {
            inactiveNames.push(name);
          } else {
            activeNames.push(name);
          }
        }
      }

      // Verify active OUs are alphabetically sorted
      const sortedActive = [...activeNames].sort((a, b) => a.localeCompare(b));
      expect(activeNames).toEqual(sortedActive);

      // Verify inactive OUs are alphabetically sorted
      const sortedInactive = [...inactiveNames].sort((a, b) => a.localeCompare(b));
      expect(inactiveNames).toEqual(sortedInactive);
    }
  });

  test('should have proper keyboard navigation', async ({ page }) => {
    await navigateToOUManage(page);

    // First, click to select a node (keyboard nav requires a node to be focused)
    const nodes = page.locator('[data-testid="ou-tree-node"]');
    const firstNode = nodes.first();
    const clickableArea = firstNode.locator('> div').first();
    await clickableArea.click();

    // First node should be selected and focused
    await expect(firstNode).toHaveAttribute('aria-selected', 'true');

    // Press Down arrow to move to next node (if exists)
    const nodeCount = await nodes.count();
    if (nodeCount > 1) {
      await page.keyboard.press('ArrowDown');
      // Second node should now be selected
      const secondNode = nodes.nth(1);
      await expect(secondNode).toHaveAttribute('aria-selected', 'true');

      // Press Up to go back to first node
      await page.keyboard.press('ArrowUp');
      await expect(firstNode).toHaveAttribute('aria-selected', 'true');
    }
  });
});

// ============================================================================
// INTEGRATION MODE TESTS - Event Emission Verification
// ============================================================================
test.describe('OU CRUD - Integration Mode (Event Verification)', () => {

  // Skip all tests in this describe block unless RUN_INTEGRATION_TESTS is set
  test.beforeEach(async () => {
    if (!process.env.RUN_INTEGRATION_TESTS) {
      test.skip();
    }
  });

  test('should emit organization.created event on OU creation', async ({ page }) => {
    const testOuName = `Test OU ${Date.now()}`;

    // Navigate to create page
    await page.goto(`${BASE_URL}/organization-units/create`);
    await waitForAuthAndNavigation(page);

    // Fill and submit form
    await page.fill('input[name="name"]', testOuName);
    await page.fill('input[name="displayName"]', testOuName);
    await page.click('button:has-text("Create")');

    // Wait for redirect
    await page.waitForURL(/\/organization-units\/manage/);

    // Verify event in database via Supabase REST API
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_ANON_KEY;

    if (supabaseUrl && supabaseKey) {
      const response = await page.request.get(
        `${supabaseUrl}/rest/v1/domain_events?event_type=eq.organization.created&order=created_at.desc&limit=1`,
        {
          headers: {
            'apikey': supabaseKey,
            'Authorization': `Bearer ${supabaseKey}`
          }
        }
      );

      const events = await response.json();
      expect(events.length).toBeGreaterThan(0);
      expect(events[0].event_data.name).toBe(testOuName);
    }
  });

  test('should emit organization.updated event on OU update', async ({ page }) => {
    // This test requires an existing OU to update
    // Implementation depends on having test fixtures or creating an OU first
    test.skip();
  });

  test('should emit organization.deactivated event on OU deactivation', async ({ page }) => {
    // This test requires an existing OU to deactivate
    // Implementation depends on having test fixtures or creating an OU first
    test.skip();
  });

  test('should update organizations_projection after event', async ({ page }) => {
    // This test verifies the projection table is updated after event processing
    // Implementation depends on having Supabase access
    test.skip();
  });
});
