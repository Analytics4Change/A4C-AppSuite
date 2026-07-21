import { test, expect, Page } from '@playwright/test';

/**
 * Command-feedback accessibility gate (F4) — plain Playwright, no axe dependency.
 *
 * Proves the two load-bearing invariants of the command-feedback standard
 * (documentation/frontend/patterns/command-feedback.md) on the *live* rendered
 * UsersManagePage when a command fails:
 *   - INV-2 — no focusable element under any `aria-hidden` subtree (WCAG 4.1.2 /
 *     axe `aria-hidden-focus`). This is the exact defect the non-Sonner echo pivot
 *     eliminates by construction; this test is the integrated proof.
 *   - INV-1 — exactly one assertive live region (`role="alert"`) announces a
 *     failure; the visual echo is `aria-hidden` and never a live region.
 *
 * These assertions cover the *machine* half of the F4 gate. A manual NVDA/VoiceOver
 * pass (confirming a single spoken announcement) is still required per the DoD.
 *
 * ── Gated so CI stays green ───────────────────────────────────────────────────
 * Skipped by default (needs the app up + a reachable backend/mock). To run:
 *   1. npm run dev                              (default http://localhost:5173)
 *   2. RUN_A11Y_GATE=1 npx playwright test command-feedback-a11y --project=chromium
 *      (override the URL with PLAYWRIGHT_TEST_BASE_URL if your dev server differs)
 *
 * Selectors follow the app's visible labels + stable data-testids; tune here if
 * the UI copy changes.
 */

const APP_URL = process.env.PLAYWRIGHT_TEST_BASE_URL || 'http://localhost:5173';

// Any element that would be in the tab order / focusable if it were visible.
const FOCUSABLE_UNDER_HIDDEN =
  '[aria-hidden="true"] a[href], ' +
  '[aria-hidden="true"] button, ' +
  '[aria-hidden="true"] input, ' +
  '[aria-hidden="true"] select, ' +
  '[aria-hidden="true"] textarea, ' +
  '[aria-hidden="true"] [contenteditable="true"], ' +
  '[aria-hidden="true"] [tabindex]:not([tabindex="-1"])';

/** INV-2: nothing focusable may live under an aria-hidden subtree. */
async function expectNoAriaHiddenFocus(page: Page) {
  const count = await page.locator(FOCUSABLE_UNDER_HIDDEN).count();
  expect(count, 'a focusable element is inside an aria-hidden subtree (WCAG 4.1.2)').toBe(0);
}

/** INV-1: exactly one assertive live region announces the failure. */
async function expectSingleAlertRegion(page: Page) {
  await expect(
    page.getByRole('alert'),
    'exactly one role="alert" region should announce a command failure'
  ).toHaveCount(1);
}

/** No raw handler internals should be visible anywhere (display-layer sanitization). */
async function expectNoRawLeak(page: Page) {
  await expect(page.getByText(/Event processing failed:/i)).toHaveCount(0);
  await expect(page.getByText(/ERRCODE|constraint "/i)).toHaveCount(0);
}

async function loginMockAndOpenUsers(page: Page) {
  await page.goto(APP_URL);
  const email = page.locator('input[type="email"]');
  if (await email.isVisible({ timeout: 3000 }).catch(() => false)) {
    await email.fill('admin@a4c.com');
    await page.fill('input[type="password"]', 'password');
    await page.click('button[type="submit"]');
  }
  // Land on the Users management page.
  await page.goto(`${APP_URL}/users/manage`);
  await expect(page.getByRole('button', { name: 'Invite New User' })).toBeVisible({
    timeout: 15000,
  });
}

test.describe('command-feedback a11y gate (F4)', () => {
  // CI-safe: only runs when explicitly opted in against a live app.
  test.skip(
    !process.env.RUN_A11Y_GATE,
    'F4 running-app gate — set RUN_A11Y_GATE=1 with the dev server up'
  );

  test('invite failure: sanitized single-announcement banner, no aria-hidden-focus', async ({
    page,
  }) => {
    // Force the invite-user Edge Function to fail with a handler-internal message,
    // so we exercise both the failure banner AND the display-layer sanitizer.
    await page.route('**/functions/v1/invite-user', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: false,
          error:
            'Event processing failed: duplicate key value violates unique constraint "users_email_key"',
        }),
      })
    );

    await loginMockAndOpenUsers(page);

    await page.getByRole('button', { name: 'Invite New User' }).click();
    await page.getByLabel('Email Address').fill('a11y-gate@example.com');
    await page.getByLabel('First Name').fill('A11y');
    await page.getByLabel('Last Name').fill('Gate');
    await page.getByRole('checkbox', { name: /Aspen Med Viewer/i }).check();
    await page.getByRole('button', { name: /Send Invitation/i }).click();

    // Failure banner mounts as the shared command-feedback banner, showing the
    // operation-specific fallback (the raw handler prefix is masked). Assert via
    // testid — the echo now carries the same text, so getByText would be ambiguous.
    const banner = page.getByTestId('invite-submission-error');
    await expect(banner).toBeVisible();
    await expect(banner).toContainText('Failed to send invitation');

    // Form-blocking failure moves focus to the banner (useEffect, not setTimeout).
    await expect(banner).toBeFocused();

    // The aria-hidden echo fires on the form path too (scroll-independence) and
    // never announces / never focuses.
    const echo = page.getByTestId('command-feedback-toast-error');
    await expect(echo).toBeVisible();
    await expect(echo).toHaveAttribute('aria-hidden', 'true');

    await expectSingleAlertRegion(page); // the banner announces; the echo does not
    await expectNoAriaHiddenFocus(page);
    await expectNoRawLeak(page); // the constraint name / prefix must be masked
  });

  test('invite failure: dismiss restores focus to the submit trigger', async ({ page }) => {
    // Same forced invite failure — here we assert the *focus-restoration* half of
    // the standard: focus moved to the banner on failure, and dismissing it must
    // return focus to the control that triggered the submit (not drop to <body>).
    await page.route('**/functions/v1/invite-user', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: false, error: 'Forced failure for a11y gate' }),
      })
    );

    await loginMockAndOpenUsers(page);

    await page.getByRole('button', { name: 'Invite New User' }).click();
    await page.getByLabel('Email Address').fill('a11y-restore@example.com');
    await page.getByLabel('First Name').fill('A11y');
    await page.getByLabel('Last Name').fill('Restore');
    await page.getByRole('checkbox', { name: /Aspen Med Viewer/i }).check();
    const submit = page.getByRole('button', { name: /Send Invitation/i });
    await submit.click();

    // Focus moved to the banner on failure.
    const banner = page.getByTestId('invite-submission-error');
    await expect(banner).toBeVisible();
    await expect(banner).toBeFocused();

    // Dismiss → focus returns to the submit trigger, never <body>.
    await page.getByTestId('command-feedback-banner-dismiss').click();
    await expect(banner).toBeHidden();
    await expect(submit).toBeFocused();
  });

  test('role-violation submit: rich banner takes focus, dismiss restores it', async ({ page }) => {
    // Force api.modify_user_roles (PostgREST RPC — not an Edge Function) to return
    // a VALIDATION_FAILED envelope with per-role violations. That funnels through
    // formViewModel.submit onto the page VM's lastRoleViolations, so the rich
    // UsersErrorBanner (not the plain form banner) is the form-blocking surface.
    await page.route('**/rest/v1/rpc/modify_user_roles', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: false,
          error: 'VALIDATION_FAILED',
          violations: [
            {
              role_id: '00000000-0000-0000-0000-000000000001',
              error_code: 'ROLE_CONFLICT',
              message: 'Cannot assign conflicting role',
            },
          ],
        }),
      })
    );

    await loginMockAndOpenUsers(page);

    const firstUser = page.locator('[data-testid="user-card"]').first();
    if (!(await firstUser.isVisible({ timeout: 5000 }).catch(() => false))) {
      test.skip(true, 'No user rows available to edit — seed a user to run this leg.');
      return;
    }
    await firstUser.click();

    // Edit mode. Toggle a role so the submit performs a role modification (either
    // add or remove is a change), then save.
    const save = page.getByRole('button', { name: /Save Changes/i });
    await expect(save).toBeVisible();
    await page.getByRole('checkbox', { name: /Aspen Med Viewer/i }).click();
    await save.click();

    // The rich banner is the form-blocking surface and receives focus (it is
    // focusable: forwardRef + tabIndex={-1}), showing the role-violation detail.
    const richBanner = page.getByTestId('users-error-banner');
    await expect(richBanner).toBeVisible();
    await expect(page.getByTestId('role-modification-violation')).toBeVisible();
    await expect(richBanner).toBeFocused();

    // Exactly one assertive region; the form banner must be suppressed (INV-1).
    await expectSingleAlertRegion(page);
    await expectNoAriaHiddenFocus(page);

    // Dismiss → focus returns to the submit trigger (Save Changes), never <body>.
    await page.getByTestId('users-error-banner-dismiss').click();
    await expect(richBanner).toBeHidden();
    await expect(save).toBeFocused();
  });

  test('deactivate failure: aria-hidden echo present, no aria-hidden-focus', async ({ page }) => {
    await page.route('**/functions/v1/manage-user', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: false, error: 'Forced failure for a11y gate' }),
      })
    );

    await loginMockAndOpenUsers(page);

    const firstUser = page.locator('[data-testid="user-card"]').first();
    if (!(await firstUser.isVisible({ timeout: 5000 }).catch(() => false))) {
      test.skip(true, 'No user rows available to deactivate — seed a user to run this leg.');
      return;
    }
    await firstUser.click();

    // Danger zone → Deactivate → confirm. (Text selectors; tune if copy changes.)
    await page
      .getByRole('button', { name: /Deactivate/i })
      .first()
      .click();
    await page
      .getByRole('button', { name: /^(Deactivate|Confirm)/i })
      .last()
      .click();

    // The aria-hidden echo mounts and is, itself, not focusable and not a live region.
    const echo = page.getByTestId('command-feedback-toast-error');
    await expect(echo).toBeVisible();
    await expect(echo).toHaveAttribute('aria-hidden', 'true');
    await expect(echo).not.toHaveAttribute('role', 'alert');

    await expectSingleAlertRegion(page); // the banner announces; the echo does not
    await expectNoAriaHiddenFocus(page); // the pivot's core guarantee
  });
});
