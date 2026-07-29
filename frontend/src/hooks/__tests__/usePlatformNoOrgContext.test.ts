/**
 * usePlatformNoOrgContext — predicate contract.
 *
 * Fences the state gate that fronts the Edge Function 403
 * "No organization context in token": true ONLY for a platform administrator
 * with no active org (`org_type === 'platform_owner' && !org_id`), and
 * fail-closed (false) with no session. The `&& !org_id` conjunct must keep a
 * *real* a4c platform-owner org member (platform_owner WITH an org_id) ungated.
 *
 * Unit-level (mock `useAuth`) rather than a full UsersManagePage render — the
 * contract is a pure claims predicate, faithful in JSDOM; a page fixture would
 * be disproportionate (same rationale as roles-manage-page-permission-gates).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { usePlatformNoOrgContext } from '../usePlatformNoOrgContext';

const mockUseAuth = vi.fn();
vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => mockUseAuth(),
}));

function sessionWith(claims: Record<string, unknown> | null) {
  return claims === null ? null : { claims };
}

describe('usePlatformNoOrgContext', () => {
  beforeEach(() => vi.clearAllMocks());

  it('is TRUE for a platform admin with no active org (platform_owner + empty org_id)', () => {
    mockUseAuth.mockReturnValue({
      session: sessionWith({ org_type: 'platform_owner', org_id: '' }),
    });
    const { result } = renderHook(() => usePlatformNoOrgContext());
    expect(result.current).toBe(true);
  });

  it('is FALSE for a real a4c platform-owner org MEMBER (platform_owner WITH an org_id)', () => {
    mockUseAuth.mockReturnValue({
      session: sessionWith({ org_type: 'platform_owner', org_id: 'a4c-org-uuid' }),
    });
    const { result } = renderHook(() => usePlatformNoOrgContext());
    expect(result.current).toBe(false);
  });

  it('is FALSE for an ordinary provider-org user', () => {
    mockUseAuth.mockReturnValue({
      session: sessionWith({ org_type: 'provider', org_id: 'provider-org-uuid' }),
    });
    const { result } = renderHook(() => usePlatformNoOrgContext());
    expect(result.current).toBe(false);
  });

  it('is FALSE (fail-closed) when there is no session', () => {
    mockUseAuth.mockReturnValue({ session: null });
    const { result } = renderHook(() => usePlatformNoOrgContext());
    expect(result.current).toBe(false);
  });
});
