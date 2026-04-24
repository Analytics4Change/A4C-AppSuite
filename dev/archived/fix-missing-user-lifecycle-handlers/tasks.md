# Fix Missing User Lifecycle Handlers — Tasks

## Current Status

**Phase**: ✅ COMPLETE — PR #35 merged to main
**Status**: CLOSED
**Priority**: (was HIGH, CRITICAL) — blocks resolved
**Last Updated**: 2026-04-24
**Branch**: `fix/missing-user-lifecycle-handlers` (merged)
**Merge commits**: `b3c1bd4b` (main fix) + `32d196f6` (settings) + `8eae916f` (5th orphan-read site added post-review)
**Surfaced by**: `dev/archived/edge-function-vs-sql-rpc-adr/` PR #33 audit
**Scope expansion**: During pre-work verification a RED orphan-read audit finding expanded scope from "handlers only" to "handlers + 5 api.* RPC orphan filters + 2 Edge Function orphan guards" in one cohesive PR.

## Pre-activation Checklist

- [x] Live-DB audit run (Phase 0) — handlers confirmed absent in dev; ZERO failed events to backfill
- [x] Decision: execute as-described (no hygiene-only downgrade needed)

## Phase 0 — Live-DB Audit ✅ COMPLETE (2026-04-24)

- [x] Queried `pg_proc` — all three handlers confirmed absent
- [x] Counted failed `user.deactivated`/`reactivated`/`deleted` events with `processing_error IS NOT NULL` — **zero rows**
- [x] No error samples to investigate (no failed events ever emitted)
- [x] Confirmed `public.users` schema matches baseline: `is_active boolean`, `deleted_at timestamptz`, `updated_at`. No `deactivated_at`/`reactivated_at` columns
- [x] Confirmed the 4 target api.* RPCs exist with expected signatures

**Outcome**: Ship the full fix (handlers + orphan filters). No backfill needed.

## Phase 1-2 — Migration (Handlers + Orphan Filters) ✅ COMPLETE

Single migration: `20260424182345_add_missing_user_lifecycle_handlers_and_orphan_filters.sql`

- [x] `handle_user_deactivated` — sets `is_active = false`
- [x] `handle_user_reactivated` — sets `is_active = true`
- [x] `handle_user_deleted` — sets `deleted_at = COALESCE(...)` + `is_active = false`; replay-safe via COALESCE
- [x] Patched `api.get_user_addresses` — added EXISTS filter on `public.users.deleted_at IS NULL`
- [x] Patched `api.get_user_phones` — added early-return empty array for deleted users
- [x] Patched `api.get_user_notification_preferences` — added early-return "all-disabled" shape
- [x] Patched `api.list_user_client_assignments` — converted LEFT JOIN to INNER JOIN with deleted_at filter in ON
- [x] Patched `api.get_schedule_template` — added `deleted_at IS NULL` to the users join in the assigned_users sub-select (added post-review, 5th site surfaced by architectural review)
- [x] `RAISE EXCEPTION ... USING ERRCODE = 'P0002'` — no PII interpolation; forward-compatible with parked `rpc-error-pii-sanitization` card

## Phase 3 — Edge Function Patches ✅ COMPLETE

- [x] `manage-user/index.ts:502` — added `public.users.deleted_at` guard before notification-preference read-back (Pattern A v2 step 2a)
- [x] `accept-invitation/index.ts:321` — added two-query check: deleted user is treated as NEW user (full onboarding flow), so logically-orphaned `user_roles_projection` rows don't short-circuit the Sally-scenario detection

## Phase 4 — Handler Reference Files (Rule 7.1) ✅ COMPLETE

- [x] `infrastructure/supabase/handlers/user/handle_user_deactivated.sql`
- [x] `infrastructure/supabase/handlers/user/handle_user_reactivated.sql`
- [x] `infrastructure/supabase/handlers/user/handle_user_deleted.sql`

## Phase 5 — Apply + Backfill ✅ COMPLETE

- [x] `supabase db push --linked --dry-run` — confirmed single-migration push
- [x] `supabase db push --linked` — migration applied to dev
- [x] Post-apply verification: 3 handlers in `pg_proc`; first 4 api functions show `deleted_at IS NULL` in their bodies (5th patch for `api.get_schedule_template` added post-review, will apply on prod deploy via CI — dev may be briefly out of sync until re-push)
- [x] Backfill step skipped — Phase 0 confirmed zero failed events to retry
- [x] Non-deleted user probe: `list_user_client_assignments`, `get_user_phones`, `get_user_notification_preferences` all return normal data

**Abort-threshold step N/A** (no backfill performed).

## Phase 6 — Verification + Card Updates ✅ COMPLETE

- [x] Update this tasks.md + card context + card plan
- [x] End-to-end behavioral test on real users explicitly DEFERRED per Auto Mode safety rules — deactivate/delete round-trip on live user accounts would create audit events that cannot be cleanly undone. Will be exercised by `manage-user-delete-to-sql-rpc` and `manage-user-reactivate-to-sql-rpc` when those cards land.
- [x] Incidental findings logged to context.md
- [x] Update downstream card Prerequisites — handled via the downstream cards' own status updates now that the handlers exist on main

## Phase 7 — PR ✅ COMPLETE

- [x] Commit on branch `fix/missing-user-lifecycle-handlers`
- [x] Push + open PR #35
- [x] PR body notes the **reactivate limitation** (projection fix only, does NOT unban `auth.users` — that's tracked at `manage-user-reactivate-to-sql-rpc/context.md` O1)
- [x] PR body flags **incidental finding**: `schedule_user_assignments_projection`, `user_client_assignments_projection`, `user_schedule_policies_projection` lack FK `ON DELETE` clauses (separate follow-up)
- [x] Post-review: 5th orphan-read site (`api.get_schedule_template`) added via follow-up commit `8eae916f`
- [x] PR merged to main
- [x] Post-merge: archive card to `dev/archived/`
