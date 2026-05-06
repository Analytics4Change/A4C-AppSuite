# Permission-gating audit: manage-page action buttons across all 5 manage pages

**Status**: seed (not yet planned)
**Priority**: Medium (UX + defense-in-depth gap; symmetric to PR #49's RolesManagePage fix)
**Origin**: PR #49 follow-up note — RolesManagePage's "Manage User Assignments" button was the surfaced instance; sibling pages likely have parallel gaps

## Problem

PR #49 (2026-05-06) gated the **Manage User Assignments** button on `user.role_assign` because it was rendering unconditionally for any user with `role.view` (the only page-entry gate). South Valley Admin users could click into a guaranteed `42501` from `api.list_users_for_role_management`. The fix mirrored `SettingsPage`'s permission-gating pattern.

The audit done during PR #49 found **zero** permission gating on `RolesManagePage` — only `formViewModel.isSubmitting` and `!currentRole.isActive` state-gates. The same audit was NOT done for the other four manage pages. They almost certainly have parallel gaps:

| Page | Likely action buttons | Likely required permissions |
|---|---|---|
| `RolesManagePage.tsx` | Edit Role (already gated by selection); Save Changes; Delete Role; Deactivate/Reactivate; Duplicate | `role.update`, `role.delete` |
| `UsersManagePage.tsx` | Save Changes; Deactivate/Reactivate; Delete User; Manage Roles; Resend Invitation; Revoke Invitation | `user.update`, `user.deactivate`, `user.delete`, `user.role_assign`, `invitation.resend`, `invitation.revoke` |
| `SchedulesManagePage.tsx` | Save; Delete Template; Activate/Deactivate | `schedule.update`, `schedule.delete` |
| `OrganizationsManagePage.tsx` | Save; Deactivate; Delete | `organization.update`, `organization.deactivate`, `organization.delete` |
| `OrganizationUnitsManagePage.tsx` | Create OU; Edit; Delete; Move | `organization.create_ou`, `organization.update_ou`, `organization.delete_ou` |

(Permission names above are best-effort guesses from `permissions_projection` naming convention — verify against actual baseline_v4 seeds.)

Currently a user landing on any of these pages with the page-entry permission (e.g., `role.view`, `user.view`) sees ALL action buttons regardless of whether they have the per-action permission. Click → guaranteed `42501` from the corresponding RPC.

## Why this matters

- **Defense in depth**: backend gates are load-bearing; frontend gates are UX. A frontend that surfaces only what the user can do is the project convention (codified by SettingsPage; now also RolesManagePage).
- **HIPAA / compliance**: the failure surface for unauthorized affordances should be empty by design.
- **UAT noise reduction**: PR #49 surfaced via a real user hitting a button they shouldn't have seen. The same will happen page-by-page until each is audited.

## Scope

For each of the 5 manage pages, audit every action button (every `<Button onClick={...}>`) and:
1. Identify the RPC each button ultimately calls (trace through viewmodel + service layer).
2. Identify the RPC's first executable permission gate (`RAISE EXCEPTION 'Missing permission: ...'` or equivalent).
3. If the button isn't already conditionally rendered/disabled on that permission, gate it via `useAuth().hasPermission(name)` mirroring the RolesManagePage fix in PR #49.
4. Add a `data-testid` for each gated affordance (regression-test surface).
5. Extend the regression test at `frontend/src/pages/__tests__/roles-manage-page-permission-gates.test.tsx` (or sibling files per page) — the GatedAffordance harness pattern is already established and parameterizable.

## Suggested execution sequence

Per-page in this order (highest blast radius first):

1. **UsersManagePage** — most action surface (invitations, roles, deactivate, delete). Likely largest gap.
2. **OrganizationsManagePage** — high-stakes (org-level mutations).
3. **OrganizationUnitsManagePage** — scope-aware permissions; will likely require `targetPath` ltree-path threading.
4. **SchedulesManagePage** — narrower surface.
5. **RolesManagePage remaining buttons** — Save Changes, Delete Role, Deactivate/Reactivate, Duplicate (the user-assignments button is done).

Each page's audit should be its own PR (~5 small PRs total). Bundle is too risky — different review surfaces, different test fixtures.

## Out of scope

- Tighter scope-aware UI gates (separate seed: `roles-manage-scope-aware-ui-gate-seed.md`). Apply that pattern alongside this audit when a page's permissions have ltree scopes.
- Backend RPC changes. These are frontend-only; backend is already correct.
- Page-entry permission gates (those exist; just the per-affordance gates are missing).

## Files involved (read-only, audit phase)

- `frontend/src/pages/users/UsersManagePage.tsx`
- `frontend/src/pages/schedules/SchedulesManagePage.tsx`
- `frontend/src/pages/organizations/OrganizationsManagePage.tsx`
- `frontend/src/pages/organization-units/OrganizationUnitsManagePage.tsx` (verify path)
- `frontend/src/pages/roles/RolesManagePage.tsx` (still has un-gated buttons after PR #49)

## Trigger to start

Either of:
- A new "user clicked button → 42501" UAT report on any manage page (the symptom that surfaced PR #49).
- Bandwidth opens for a defensive sweep.

## Reference pattern

`frontend/src/pages/__tests__/roles-manage-page-permission-gates.test.tsx` — `GatedAffordance` harness component in the test file is reusable; parameterize across affordances.
`frontend/src/pages/roles/RolesManagePage.tsx` — exact code shape to mirror.
`frontend/src/pages/settings/SettingsPage.tsx:31-44` — original codification of the pattern.
