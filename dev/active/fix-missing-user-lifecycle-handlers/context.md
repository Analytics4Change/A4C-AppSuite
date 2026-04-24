# Fix Missing User Lifecycle Handlers — Context

**Feature**: Create the 3 user-lifecycle event handlers that are referenced by `process_user_event` but have never been defined by any migration in the repo
**Status**: 🔴 CRITICAL — Production data integrity issue
**Priority**: **HIGH** (blocks 3 downstream seed cards + silent production data corruption)
**Surfaced**: 2026-04-24 during PR #33 reactivate-classification audit
**Current branch**: TBD — start from `main`

## Problem Statement

Three handlers referenced in `process_user_event()`'s CASE branches have **never been created** by any migration in the repo:

| Handler | Referenced by | CASE branch location |
|---------|--------------|----------------------|
| `handle_user_deactivated` | `process_user_event` | `infrastructure/supabase/handlers/routers/process_user_event.sql:12` + 3 migrations |
| `handle_user_reactivated` | `process_user_event` | `infrastructure/supabase/handlers/routers/process_user_event.sql:14` + 3 migrations |
| `handle_user_deleted` | `process_user_event` | `infrastructure/supabase/handlers/routers/process_user_event.sql:15` + 3 migrations |

Evidence:
- `grep -rln "CREATE.*FUNCTION.*handle_user_deactivated" infrastructure/` returns empty
- `grep -rln "CREATE.*FUNCTION.*handle_user_reactivated" infrastructure/` returns empty
- `grep -rln "CREATE.*FUNCTION.*handle_user_deleted" infrastructure/` returns empty
- Baseline `20260212010625_baseline_v4.sql` mentions these handlers **only in a COMMENT docstring** (line 11550), not as `CREATE FUNCTION` statements
- No current migration defines them
- No handler reference file exists at `infrastructure/supabase/handlers/user/handle_user_{deactivated,reactivated,deleted}.sql`

## Historical trace

1. **Pre-Feb 2026** — CASE branches for `user.deactivated`/`reactivated`/`organization_switched` were in the router but handlers never existed
2. **2026-02-11** — Migration `20260211234604_cleanup_dead_dispatcher_branches_and_legacy_functions.sql` **removed** the CASE branches stating *"3 dead CASE lines in process_user_event() for handler functions that don't exist (handle_user_deactivated, handle_user_reactivated, handle_user_organization_switched)"*
3. **2026-02-17** — Migration `20260217211231_schedule_template_refactor.sql` (schedule feature) rewrote `process_user_event` and **restored** the CASE branches (line 518)
4. **2026-02-18** — Migration `20260218234005_restore_user_invited_route.sql` kept the restored branches
5. **2026-02-20** — Migration `20260220185837_fix_event_routing.sql` kept them again
6. **2026-04-24** — Surfaced during `dev/archived/edge-function-vs-sql-rpc-adr/` PR #33 review audit (originally looking only at the `reactivate` classification)

Net effect: the `user.deactivated`/`reactivated`/`deleted` event types have been silently failing since Feb 2026, because the router's CASE branches call handler functions that don't exist — `process_user_event` raises `undefined function` errors, which are caught by `process_domain_event`'s catch-all and stored in `processing_error`.

## Impact (if production matches the repo)

- **Deactivate**: `manage-user/index.ts:721` calls `auth.admin.updateUserById` with a ban, so the user IS banned in `auth.users`. But the `user.deactivated` event's projection update (e.g., setting `users.deactivated_at`, `users.is_active = false`) never runs. Projection state is stale — UI shows the user as active, but they can't log in.
- **Reactivate**: No `auth.admin` call happens (gated on `operation === 'deactivate'` at line 719). The `user.reactivated` event's projection update (clearing `deactivated_at`, setting `is_active = true`) never runs. The operation is completely silent — the user remains banned AND the projection is unchanged.
- **Delete**: No `auth.admin` call. The `user.deleted` event's projection update (e.g., `users.deleted_at = now()`) never runs. UI continues to show the user; Row Level Security continues to let them query; they can still log in.

Every such call creates a `domain_events` row with `processing_error` populated. The admin dashboard at `/admin/events` should show these.

## Dependency on downstream work

This card BLOCKS 3 seeded extraction cards (all created in PR #33):
- `dev/active/manage-user-delete-to-sql-rpc/` — SQL RPC form will emit `user.deleted` and expect the handler to update the projection
- `dev/active/manage-user-reactivate-to-sql-rpc/` — same
- Future `dev/active/manage-user-deactivate-pattern-a-v2-retrofit/` — retrofit will read back the projection which requires the handler to have updated it

## Scope

### In scope
- **Audit step first**: Query live dev Supabase to confirm whether the handlers exist in production (possibly added out-of-band via Supabase Studio). Sample queries:
  ```sql
  -- Do the handler functions exist?
  SELECT proname FROM pg_proc
    WHERE proname IN ('handle_user_deactivated','handle_user_reactivated','handle_user_deleted');

  -- What events have been silently failing?
  SELECT event_type, count(*), min(created_at), max(created_at)
    FROM domain_events
   WHERE event_type IN ('user.deactivated','user.reactivated','user.deleted')
     AND processing_error IS NOT NULL
   GROUP BY event_type
   ORDER BY 1;

  -- Sample the actual error messages
  SELECT event_type, processing_error, created_at
    FROM domain_events
   WHERE event_type IN ('user.deactivated','user.reactivated','user.deleted')
     AND processing_error IS NOT NULL
   ORDER BY created_at DESC
   LIMIT 20;
  ```
- **Migration**: `CREATE OR REPLACE FUNCTION` for all three handlers. Each should:
  - Accept `p_event record`
  - Use `p_event.stream_id` (NOT `aggregate_id`)
  - UPSERT into the `users` base table (projection) — NOT separate `users_projection` unless schema says otherwise
  - Set the appropriate timestamp field (`deactivated_at`, `reactivated_at` / `deactivated_at = NULL`, `deleted_at`)
  - Respect the Rule 6 `ON CONFLICT DO UPDATE` pattern for idempotency
- **Handler reference files**: Create `infrastructure/supabase/handlers/user/handle_user_{deactivated,reactivated,deleted}.sql` with the canonical definitions
- **Backfill**: For each `user.deactivated`/`reactivated`/`deleted` event currently in `domain_events` with `processing_error IS NOT NULL`, call `api.retry_failed_event(event_id)` after the migration lands. This re-fires the handler and clears `processing_error` on success

### Out of scope
- Extracting `manage-user` operations to SQL RPCs — covered by the 3 seed cards
- Reactivate `auth.admin` unban question — separately flagged in `manage-user-reactivate-to-sql-rpc/context.md` O1
- Router reference file refresh — will be touched incidentally (router body unchanged; only handler files added)

## Constraints

- Must use `supabase migration new` CLI (NOT manual file creation) per Rule 1
- Handlers must be idempotent via `ON CONFLICT` per Rule 6
- Handler reference files required per Rule 7.1
- Do NOT touch the `process_user_event` router itself — CASE branches already correct; just create the missing handlers
- Backfill retry must be a follow-up action after the migration applies, NOT part of the migration (retries modify rows that the migration creates handlers for — order matters)

## Reference Materials

- `infrastructure/supabase/handlers/routers/process_user_event.sql` — router CASE dispatching to the missing handlers
- `infrastructure/supabase/supabase/migrations.archived/2026-february-cleanup/20260211234604_cleanup_dead_dispatcher_branches_and_legacy_functions.sql` — the archived migration that documented the handlers as non-existent
- `infrastructure/supabase/supabase/migrations/20260217211231_schedule_template_refactor.sql:518` — restoration of the CASE branches
- `infrastructure/supabase/handlers/user/*.sql` — existing handler reference file patterns to mirror
- `documentation/architecture/decisions/adr-edge-function-vs-sql-rpc.md` — inventory cross-references to this card
- `dev/archived/edge-function-vs-sql-rpc-adr/` — PR #33 that surfaced this finding
