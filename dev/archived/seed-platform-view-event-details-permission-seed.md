# Seed `platform.view_event_details` permission into `platform_admin` role

**Status**: seed (not yet planned)
**Priority**: Medium (test-plan blocker; gates the failed-event detail dashboard for platform admins)
**Origin**: PR #48 architect-review Note #3 (software-architect-dbc, 2026-05-06)

## Problem

`platform.view_event_details` was created in migration `20260430002824` with `scope_type: 'global'`, zero implication chains in `seeds/003-permission-implications-seed.sql`, and is in NO role-permission template. Even after PR #48 lands and `api.get_failed_events_with_detail` works at the database layer, the in-body `IF NOT public.has_permission('platform.view_event_details') THEN RAISE EXCEPTION 'Access denied'` gate will reject every caller until someone manually grants the permission via direct event emission.

The PR #48 UAT plan documents this as a setup step ("ensure your test user has been granted `platform.view_event_details`"), but that's a workaround. The right fix is to seed the permission into the `platform_admin` role template so anyone holding that role gets it transitively.

## Why this matters

- Defense-in-depth gate that nobody can pass = vestigial code.
- Onboarding gap: a fresh platform admin holds `platform.admin` but cannot see failed-event detail without an extra manual step that is not documented anywhere outside the PR #48 UAT plan.
- Pattern consistency: every other platform-admin permission is held by the `platform_admin` role template by default.

## Two options

### Option A — Add to `platform_admin` role-permission template

Modify `infrastructure/supabase/supabase/seeds/002-role-templates-seed.sql` (or wherever `platform_admin` template permissions are seeded) to include `platform.view_event_details`. Re-emit the seed events for existing platform admins via a backfill migration.

**Pro**: minimal surface, matches existing pattern.
**Con**: requires backfill emission for already-bootstrapped platform admins.

### Option B — Add as implication of `platform.admin`

Add `platform.admin → platform.view_event_details` to `infrastructure/supabase/supabase/seeds/003-permission-implications-seed.sql`. `compute_effective_permissions` will then derive it on-the-fly during JWT custom-claim minting.

**Pro**: no backfill needed; takes effect on next token refresh for all platform admins.
**Con**: implications are typically used for permission hierarchies (e.g., `update_ou → view_ou`), not for "this admin role grants this leaf permission". May not be the intended use of implications.

Recommend Option A. Option B is cleaner operationally but conflates implications-as-hierarchy with implications-as-bundle. Option A keeps the role template self-documenting.

## Steps (Option A)

1. Read `002-role-templates-seed.sql` for the `platform_admin` template definition.
2. Add `platform.view_event_details` to the permission list.
3. Create migration: `supabase migration new seed_platform_view_event_details_into_platform_admin`. Migration emits a backfill event for each existing user holding `platform_admin`: `role.permission.granted` with `permission_id = <view_event_details>`, `role_id = <platform_admin role id>`, metadata `reason = 'Backfill: seed platform.view_event_details into platform_admin role (PR #48 follow-up)'`. The handler will project to `role_permissions_projection` idempotently.
4. UAT: log in as a platform admin, refresh the session (force JWT regen), navigate to the failed-event detail dashboard. Confirm the `42501` is gone.

## Out of scope

- Wiring the failed-event detail dashboard UI (separate concern; the RPC is currently anticipating a UI not yet built — see PR #48 framing).
- Audit emission for the detail RPC (separate seed: `add-failed-event-detail-viewed-audit-emission-seed.md`).

## Files involved

- `infrastructure/supabase/supabase/seeds/002-role-templates-seed.sql`
- `infrastructure/supabase/supabase/seeds/003-permission-implications-seed.sql` (Option B, not recommended)
- `infrastructure/supabase/supabase/migrations/20260430002824_strip_processing_error_detail_with_admin_rpc.sql:50` (`scope_type: 'global'` declaration)

## Trigger to start

Either of:
- A platform admin needs to use the failed-event detail dashboard (currently a test-plan blocker for PR #48 UAT).
- The failed-event detail dashboard UI gets prioritized.
