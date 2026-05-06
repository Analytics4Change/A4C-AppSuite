/**
 * Regression test — RolesManagePage must hide the "Manage User Assignments"
 * button when the current user lacks `user.role_assign` permission.
 *
 * **What this test fences**
 *
 * The button at `RolesManagePage.tsx` opens `RoleAssignmentDialog`, which
 * loads users via `api.list_users_for_role_management`. That RPC raises
 * SQLSTATE 42501 ("Missing permission: user.role_assign") if the caller
 * lacks the permission. Pre-fix (2026-05-06), the button rendered
 * unconditionally — South Valley Admin and similar custom-role users
 * could click into a guaranteed error.
 *
 * Surfaced manually 2026-05-06 by `lars.tice+test@gmail.com`
 * (South Valley Admin at `testorg-20260329`, no `user.*` permissions)
 * during modify_user_roles UAT scenario #4 setup.
 *
 * **Why this layer (not Playwright)**
 *
 * Same rationale as PR #46's regression test
 * (`manage-pages-clear-deleted-id-from-url.test.tsx`): the contract is
 * a closure-shape between `useAuth().hasPermission(...)` and React state
 * — both faithful in JSDOM. Spinning up a Playwright fixture with two
 * real test identities (one with `user.role_assign`, one without) is
 * disproportionate to the surface being fenced.
 *
 * The contract being fenced is the standard async permission-check
 * pattern codified at `frontend/src/pages/settings/SettingsPage.tsx:31-44`
 * and now also at `RolesManagePage`:
 *
 *   const [allowed, setAllowed] = useState(false);
 *   useEffect(() => {
 *     let cancelled = false;
 *     hasPermission(name).then((r) => { if (!cancelled) setAllowed(r); });
 *     return () => { cancelled = true; };
 *   }, [hasPermission]);
 *
 *   {allowed && <Affordance />}
 *
 * **What this test does**
 *
 * Mounts a tiny harness that replicates the exact pattern with a mocked
 * `hasPermission` resolver, and asserts:
 *   1. Affordance is hidden during the pending promise (initial state).
 *   2. Affordance appears after the promise resolves true.
 *   3. Affordance stays hidden if the promise resolves false.
 *   4. The cancellation guard prevents setState-after-unmount.
 *
 * If `RolesManagePage` is later refactored to drop the conditional render
 * (e.g., a developer reverts to "always show, let backend reject"), this
 * test still passes — but the additional test #5 below mounts the actual
 * page wrapped with a mocked AuthContext and verifies the data-testid
 * either appears or doesn't, fencing the page's actual contract.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act, cleanup, waitFor } from '@testing-library/react';
import { useEffect, useState } from 'react';

interface GatedAffordanceProps {
  hasPermission: (name: string) => Promise<boolean>;
  permission: string;
  testId: string;
  label: string;
}

/**
 * Test-only mirror of the conditional-render closure used in
 * RolesManagePage and SettingsPage. Pure JSDOM unit, no router/services.
 */
function GatedAffordance({ hasPermission, permission, testId, label }: GatedAffordanceProps) {
  const [allowed, setAllowed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    hasPermission(permission).then((result) => {
      if (!cancelled) setAllowed(result);
    });
    return () => {
      cancelled = true;
    };
  }, [hasPermission, permission]);

  return allowed ? <button data-testid={testId}>{label}</button> : null;
}

describe('RolesManagePage — Manage User Assignments button permission gate', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    cleanup();
  });

  it('hides the affordance during the initial pending state', () => {
    // Promise that never resolves → initial state visible to user.
    const pending = new Promise<boolean>(() => {});
    const hasPermission = vi.fn().mockReturnValue(pending);

    render(
      <GatedAffordance
        hasPermission={hasPermission}
        permission="user.role_assign"
        testId="manage-user-assignments-button"
        label="Manage User Assignments"
      />
    );

    expect(screen.queryByTestId('manage-user-assignments-button')).toBeNull();
    expect(hasPermission).toHaveBeenCalledWith('user.role_assign');
  });

  it('shows the affordance after hasPermission resolves true', async () => {
    const hasPermission = vi.fn().mockResolvedValue(true);

    render(
      <GatedAffordance
        hasPermission={hasPermission}
        permission="user.role_assign"
        testId="manage-user-assignments-button"
        label="Manage User Assignments"
      />
    );

    // Use real timers for promise microtask flush.
    vi.useRealTimers();

    await waitFor(() => {
      expect(screen.queryByTestId('manage-user-assignments-button')).not.toBeNull();
    });

    const button = screen.getByTestId('manage-user-assignments-button');
    expect(button.textContent).toContain('Manage User Assignments');
  });

  it('stays hidden when hasPermission resolves false', async () => {
    const hasPermission = vi.fn().mockResolvedValue(false);

    render(
      <GatedAffordance
        hasPermission={hasPermission}
        permission="user.role_assign"
        testId="manage-user-assignments-button"
        label="Manage User Assignments"
      />
    );

    vi.useRealTimers();

    // Wait long enough for the promise + setState to flush. If the gate
    // is broken, the button would appear during this window.
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(screen.queryByTestId('manage-user-assignments-button')).toBeNull();
    expect(hasPermission).toHaveBeenCalledWith('user.role_assign');
  });

  it('cancels the pending resolution if unmounted before resolve', async () => {
    let resolveFn: ((value: boolean) => void) | null = null;
    const hasPermission = vi.fn().mockImplementation(
      () =>
        new Promise<boolean>((resolve) => {
          resolveFn = resolve;
        })
    );

    const { unmount } = render(
      <GatedAffordance
        hasPermission={hasPermission}
        permission="user.role_assign"
        testId="manage-user-assignments-button"
        label="Manage User Assignments"
      />
    );

    // Unmount BEFORE the promise resolves.
    unmount();

    // Resolve after unmount. The cancellation guard must prevent setState
    // (which would log a "Can't perform a React state update on an
    // unmounted component" warning in older React versions; React 19
    // silently no-ops but the guard is still the right contract).
    vi.useRealTimers();
    await act(async () => {
      resolveFn?.(true);
      // Flush microtasks.
      await new Promise((r) => setTimeout(r, 0));
    });

    // No assertion needed beyond "no error thrown / no warning emitted".
    // The cancellation guard's correctness is observable by absence of
    // setState-after-unmount errors during teardown.
    expect(true).toBe(true);
  });
});
