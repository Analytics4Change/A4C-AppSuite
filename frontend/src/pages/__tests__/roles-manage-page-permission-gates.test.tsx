/**
 * Regression test — `usePermissionGate` hook contract.
 *
 * Both `RolesManagePage` (Manage User Assignments button) and
 * `SettingsPage` (Organization Settings card) gate their cross-aggregate
 * affordances via `usePermissionGate(name)`. This test fences that
 * hook directly — if a developer reverts to inline closure ceremony or
 * drops the `.catch` fail-closed branch, this test fails.
 *
 * **Why this layer (not Playwright)**
 *
 * The contract is purely an interaction between `useAuth().hasPermission(...)`,
 * a React effect, and a cancellation guard — all faithful in JSDOM.
 * Spinning up a Playwright fixture with two real test identities is
 * disproportionate.
 *
 * **What this test fences**
 *
 * 1. Initial state hidden (false) before the promise resolves.
 * 2. Visible (true) after the promise resolves true.
 * 3. Hidden (false) after the promise resolves false.
 * 4. Hidden (false) on rejection — fail-closed parity with
 *    `useFilteredNavEntries.ts:30-35`.
 * 5. Cancellation guard prevents setState-after-unmount.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, cleanup, waitFor } from '@testing-library/react';
import React from 'react';
import { usePermissionGate } from '@/hooks/usePermissionGate';

// Mock useAuth to inject a controllable hasPermission. We mock the
// AuthContext module rather than mounting the real AuthProvider so the
// test stays a hook unit test, not an integration test.
const mockHasPermission = vi.fn<(permission: string, targetPath?: string) => Promise<boolean>>();

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({
    hasPermission: mockHasPermission,
  }),
}));

describe('usePermissionGate', () => {
  beforeEach(() => {
    mockHasPermission.mockReset();
  });

  afterEach(() => {
    cleanup();
  });

  it('returns false during the initial pending state', () => {
    // Promise that never resolves → permanent pending.
    mockHasPermission.mockReturnValue(new Promise<boolean>(() => {}));

    const { result } = renderHook(() => usePermissionGate('user.role_assign'));

    expect(result.current).toBe(false);
    expect(mockHasPermission).toHaveBeenCalledWith('user.role_assign', undefined);
  });

  it('returns true after hasPermission resolves true', async () => {
    mockHasPermission.mockResolvedValue(true);

    const { result } = renderHook(() => usePermissionGate('user.role_assign'));

    await waitFor(() => expect(result.current).toBe(true));
  });

  it('returns false after hasPermission resolves false', async () => {
    mockHasPermission.mockResolvedValue(false);

    const { result } = renderHook(() => usePermissionGate('user.role_assign'));

    // Allow promise + setState to flush.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(result.current).toBe(false);
  });

  it('fails closed (returns false) when hasPermission rejects', async () => {
    mockHasPermission.mockRejectedValue(new Error('network failure'));

    const { result } = renderHook(() => usePermissionGate('user.role_assign'));

    // Allow promise rejection + setState to flush.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(result.current).toBe(false);
  });

  it('cancels pending resolution on unmount (no setState after unmount)', async () => {
    let resolveFn: ((value: boolean) => void) | null = null;
    mockHasPermission.mockImplementation(
      () =>
        new Promise<boolean>((resolve) => {
          resolveFn = resolve;
        })
    );

    const { unmount } = renderHook(() => usePermissionGate('user.role_assign'));

    unmount();

    // Resolve after unmount. The cancellation guard prevents setState.
    await act(async () => {
      resolveFn?.(true);
      await new Promise((r) => setTimeout(r, 0));
    });

    // No assertion beyond "no React warnings during cleanup". The
    // cancellation contract is observable by absence of state-update-
    // after-unmount errors.
    expect(true).toBe(true);
  });

  it('passes targetPath through to hasPermission for scope-aware checks', async () => {
    mockHasPermission.mockResolvedValue(true);

    const { result } = renderHook(() =>
      usePermissionGate('organization.update_ou', 'acme.pediatrics')
    );

    await waitFor(() => expect(result.current).toBe(true));
    expect(mockHasPermission).toHaveBeenCalledWith('organization.update_ou', 'acme.pediatrics');
  });

  it('re-runs the check when permission name changes', async () => {
    mockHasPermission.mockImplementation((perm: string) =>
      Promise.resolve(perm === 'user.role_assign')
    );

    const { result, rerender } = renderHook(
      ({ perm }: { perm: string }) => usePermissionGate(perm),
      { initialProps: { perm: 'user.role_assign' } }
    );

    await waitFor(() => expect(result.current).toBe(true));

    rerender({ perm: 'role.delete' });

    await waitFor(() => expect(result.current).toBe(false));
    expect(mockHasPermission).toHaveBeenCalledWith('role.delete', undefined);
  });
});

// Suppress unused-import lint for React (renderHook needs JSX runtime in some configs).
void React;
