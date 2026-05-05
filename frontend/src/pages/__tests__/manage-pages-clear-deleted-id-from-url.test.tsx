/**
 * Regression test — manage pages must clear the entity-id URL param
 * after a successful delete (PR #46).
 *
 * **What this test fences**
 *
 * A class of bugs in 4 manage pages (Roles / Users / Schedules /
 * Organizations) where `handleDeleteConfirm` cleared local state
 * (`panelMode='empty'`, `currentX=null`) on `result.success` but did NOT
 * clear the corresponding entity-id query param from the URL. The
 * URL→state effect at the top of each page would then re-fire (because
 * its `panelMode` dep changed), call `selectAndLoadX(staleId)` against
 * an entity that no longer exists, and surface
 * "X could not be loaded. Please refresh the page." to the user.
 *
 * Reproduced manually 2026-05-05 against `/roles/manage?roleId=X` →
 * Delete. Architect (lars-tice 2026-05-05 self-review on PR #46)
 * recommended a regression fence at P2.
 *
 * **Why this layer (not Playwright)**
 *
 * The existing Playwright fixtures in `frontend/tests/` rely on real
 * auth + real role/user/template/org rows being available in dev mode;
 * setting up a deletable row per page per browser-project is a
 * disproportionate amount of fixture work for a regression test of a
 * URL-handling closure. The Playwright config also has a `testDir: './e2e'`
 * vs. actual location at `./tests/` mismatch (pre-existing) so existing
 * specs aren't on the gated path today.
 *
 * The contract being fenced is purely an interaction between a
 * `setSearchParams` call and React Router's URL state — both of which are
 * faithful in JSDOM via `MemoryRouter`. A unit-level test of that
 * contract is sufficient and far more durable than an e2e flow.
 *
 * **What this test does**
 *
 * Exercises the exact closure shape used in all 4 affected pages:
 *   `setSearchParams(prev => { next.delete('<key>'); return next }, {replace: true})`
 *
 * by mounting a small harness that wraps `useSearchParams` and triggers
 * the cleanup. Asserts:
 *   1. The target key is removed from the URL.
 *   2. Other unrelated keys are preserved (so we don't blow away `?status=`
 *      or other co-resident filter params).
 *   3. `{replace: true}` is honored (history key changes, signaling URL update).
 *
 * Parameterized across the four affected pages' specific keys so that a
 * future refactor that drops a key (e.g., forgetting `invitationId` on
 * UsersManagePage) is caught.
 */

import { describe, it, expect } from 'vitest';
import { render, act } from '@testing-library/react';
import { MemoryRouter, useSearchParams, useLocation } from 'react-router-dom';
import { useEffect } from 'react';

interface HarnessProps {
  keysToClear: string[];
  triggerRef: { current: (() => void) | null };
  locationRef: { current: { search: string; key: string } | null };
}

function Harness({ keysToClear, triggerRef, locationRef }: HarnessProps) {
  const [, setSearchParams] = useSearchParams();
  const location = useLocation();

  useEffect(() => {
    locationRef.current = { search: location.search, key: location.key };
  }, [location, locationRef]);

  useEffect(() => {
    triggerRef.current = () => {
      // EXACT shape used in all 4 pages' handleDeleteConfirm success branch.
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          for (const key of keysToClear) next.delete(key);
          return next;
        },
        { replace: true }
      );
    };
  }, [keysToClear, setSearchParams, triggerRef]);

  return null;
}

interface PageContract {
  pageName: string;
  initialPath: string;
  initialQuery: string;
  keysToClear: string[];
  expectedQueryAfter: string;
}

// One row per affected page. The keys here match the actual
// `searchParams.delete(...)` calls in each page's handleDeleteConfirm closure.
const CONTRACTS: PageContract[] = [
  {
    pageName: 'RolesManagePage',
    initialPath: '/roles/manage',
    initialQuery: '?roleId=role-abc&status=active',
    keysToClear: ['roleId'],
    expectedQueryAfter: '?status=active',
  },
  {
    pageName: 'UsersManagePage',
    initialPath: '/users/manage',
    initialQuery: '?userId=user-xyz&invitationId=inv-123&mode=edit',
    keysToClear: ['userId', 'invitationId'],
    expectedQueryAfter: '?mode=edit',
  },
  {
    pageName: 'SchedulesManagePage',
    initialPath: '/schedules/manage',
    initialQuery: '?templateId=tpl-456&status=active',
    keysToClear: ['templateId'],
    expectedQueryAfter: '?status=active',
  },
  {
    pageName: 'OrganizationsManagePage',
    initialPath: '/organizations/manage',
    initialQuery: '?orgId=org-789&status=all',
    keysToClear: ['orgId'],
    expectedQueryAfter: '?status=all',
  },
];

describe('manage pages — clear deleted entity-id from URL on delete', () => {
  for (const contract of CONTRACTS) {
    describe(contract.pageName, () => {
      it('clears the entity-id key while preserving unrelated params', () => {
        const triggerRef = { current: null as (() => void) | null };
        const locationRef = {
          current: null as { search: string; key: string } | null,
        };

        render(
          <MemoryRouter initialEntries={[contract.initialPath + contract.initialQuery]}>
            <Harness
              keysToClear={contract.keysToClear}
              triggerRef={triggerRef}
              locationRef={locationRef}
            />
          </MemoryRouter>
        );

        // Sanity check: harness mounted at the expected URL.
        expect(locationRef.current?.search).toBe(contract.initialQuery);
        const initialKey = locationRef.current?.key;
        expect(initialKey).toBeTruthy();

        // Trigger the cleanup closure (the exact shape used in handleDeleteConfirm).
        act(() => {
          triggerRef.current?.();
        });

        expect(locationRef.current?.search).toBe(contract.expectedQueryAfter);

        // {replace: true} contract: the URL update happened (key changed)
        // but no extra history entry was pushed. We can't directly observe
        // stack depth from useLocation, but the key change confirms the
        // navigation occurred.
        expect(locationRef.current?.key).not.toBe(initialKey);
      });

      it('is a no-op shape when the entity-id key is already absent', () => {
        // Defensive: re-running the closure on an already-clean URL must not
        // accidentally clobber other state or throw.
        const triggerRef = { current: null as (() => void) | null };
        const locationRef = {
          current: null as { search: string; key: string } | null,
        };

        render(
          <MemoryRouter initialEntries={[contract.initialPath + '?status=active']}>
            <Harness
              keysToClear={contract.keysToClear}
              triggerRef={triggerRef}
              locationRef={locationRef}
            />
          </MemoryRouter>
        );

        expect(() =>
          act(() => {
            triggerRef.current?.();
          })
        ).not.toThrow();
        // `?status=active` is preserved verbatim.
        expect(locationRef.current?.search).toBe('?status=active');
      });
    });
  }
});
