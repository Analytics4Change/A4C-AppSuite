# Tighter scope-aware UI gates for permission checks on manage pages

**Status**: seed (not yet planned)
**Priority**: Low (correctness-improving; current gate is functionally correct, just not scope-aware)
**Origin**: PR #49 follow-up note — RolesManagePage's `hasPermission('user.role_assign')` check ignores `targetPath`

## Problem

PR #49 (2026-05-06) gated the **Manage User Assignments** button on `hasPermission('user.role_assign')` without passing a `targetPath`. The check returns `true` if the user has the permission at *any* scope.

`useAuth().hasPermission(name, targetPath?)` (`AuthContext.tsx:373-376`) supports a second `targetPath` argument that uses ltree-containment semantics (`isPathContained` at `permission-utils.ts:27-34`). When `targetPath` is provided, the helper returns `true` only if the user holds the permission at a scope that contains the target path.

**Concrete edge case**: a user holds `user.role_assign` at `tenant-A.region-1` (org-unit-scoped) and is editing a role at `tenant-B`. The current PR #49 gate shows them the button (they have it *somewhere*); when they click, the backend RPC's tenancy guard correctly rejects with 42501. UX gap: the user thought they could.

This is a **correctness improvement, not a security hole**. The backend remains the load-bearing boundary. But for parity with the `has_effective_permission(perm, resource_path)` pattern used in scope-bearing backend RPCs (per `infrastructure/supabase/CLAUDE.md` § Critical Rules), the frontend gate should also pass scope.

## Why this matters

- **Onboarding correctness for sub-tenant admins**: once `dev/active/sub-tenant-admin-design/` materializes, OU-bounded user-identities will become real. Scope-blind gates will then mis-render affordances at OUs the user can't manage.
- **Pattern consistency**: the backend uses scope-aware checks for resources with ltree paths (OUs, role assignments). The frontend should mirror this where data is available.
- **Reduces "I see the button but can't use it" UX paper-cuts**.

## Scope

For each manage-page action button gated in PR #49 / the broader audit (see `manage-pages-permission-gating-audit-seed.md`):

1. Identify whether the resource being acted on has an ltree path (organization, OU, role assignment, etc.). Resources without ltree path (users-as-identities in current A4C model — see `infrastructure/supabase/CLAUDE.md` § Critical Rules) cannot use scope-aware gates; defer those.
2. If it does, derive the resource's path string. For `RolesManagePage`'s "Manage User Assignments" button, the role's organization path. For `OrganizationUnitsManagePage`, the OU's `path` column.
3. Pass that path as `targetPath` to `hasPermission(name, targetPath)`.
4. Update the regression test to cover both same-scope (allowed) and cross-scope (denied) cases.

## Trigger to start (preconditions)

This card is **gated by user-model evolution**. The user-identity model in A4C currently has no organizational location finer than tenant — see `dev/active/sub-tenant-admin-design/`. Until that lands, scope-aware gates for `user.*` permissions add no UX correctness (every authenticated user is at the tenant root scope). Other resources (OUs, roles) do have ltree paths today.

Two execution paths:

- **Now**: implement scope-aware gates only for resources with ltree paths (OUs, organizations, possibly roles via their `organization_id`). Skip user-targeted gates pending sub-tenant admin design.
- **Later**: implement all in one sweep after `sub-tenant-admin-design/` materializes.

## Out of scope

- The broader manage-page permission-gating audit (separate seed: `manage-pages-permission-gating-audit-seed.md`). This seed is the *refinement layer* — apply only after the basic gates from that audit are in place.
- Backend RPC changes. The backend is already scope-aware via `has_effective_permission()` per `infrastructure/supabase/CLAUDE.md`.

## Files involved

- `frontend/src/contexts/AuthContext.tsx:373-376` — `hasPermission(name, targetPath?)` signature
- `frontend/src/utils/permission-utils.ts:27-34` — `isPathContained` ltree-containment helper
- `frontend/src/pages/roles/RolesManagePage.tsx` — first place to apply scope-aware gate (post-PR-#49)
- `infrastructure/supabase/CLAUDE.md` § Critical Rules — backend's `has_effective_permission` vs `has_permission` decision rule (mirror in frontend)

## Reference

- ADR: `documentation/architecture/decisions/adr-edge-function-vs-sql-rpc.md` Rollout 2026-04-27 § course correction (scope-aware permission discussion in backend context)
- Backend pattern in `bulk_assign_role` (baseline_v4.sql:5498) and OU mutators (5940/6023) — scope-aware checks against the resource's path.
