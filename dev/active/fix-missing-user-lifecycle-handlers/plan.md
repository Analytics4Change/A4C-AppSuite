# Fix Missing User Lifecycle Handlers — Plan

> **Execution status**: see `tasks.md` (phases 0–5 complete, PR pending).
> **Scope update (2026-04-24)**: expanded to include 5 api.* RPC orphan filters + 2 Edge Function guards after RED verdict on pre-work orphan-read audit — see `context.md` "Incidental Findings" §2.

## Executive Summary

Create the 3 missing handlers (`handle_user_deactivated`, `handle_user_reactivated`, `handle_user_deleted`) that are referenced by `process_user_event`'s CASE branches but have never been defined by any migration. Ship handler reference files. Add orphan-read filters to 5 api.* RPCs + 2 Edge Function paths so that consumer queries exclude rows for soft-deleted users. Unblocks 3 downstream extraction cards.

## Scope

See `context.md`. In scope: 1 migration with 3 handler definitions + 5 api.* function patches + 3 reference files + 2 Edge Function patches. Backfill NOT needed (Phase 0 confirmed zero failed events to retry). Out of scope: any extraction work, router changes, adding `deactivated_at` column to `public.users`, tombstoning dependent projections, `auth.users` unban on reactivate.

## Phases

| Phase | Description | Deliverable |
|-------|------------|-------------|
| 0 | Live-DB audit (confirm handlers missing in prod; measure backfill scope) | Documented finding in this plan |
| 1 | Confirm base-table schema for `users` (or `users_projection`) — what columns need to move on each event? | Schema trace in this plan |
| 2 | Migration: `CREATE OR REPLACE FUNCTION` for all 3 handlers | `<timestamp>_add_missing_user_lifecycle_handlers.sql` |
| 3 | Handler reference files | 3 `.sql` files at `infrastructure/supabase/handlers/user/` |
| 4 | Backfill retry for failed events | Script/SQL recipe applied post-migration |
| 5 | Verification | Manual test via dev project (emit each event type; confirm projection moves) |
| 6 | PR + merge | Single PR |

## Phase 0 — Live-DB audit (first work of this card)

Run the queries in `context.md` against dev Supabase via `mcp__supabase__execute_sql`:

1. **Handler existence check** — `pg_proc` query. If handlers exist in production:
   - Compare their definitions to what we're about to create — possibly the production handlers are buggy or intended
   - Update reference files to match production + close this card as a hygiene fix (no migration needed)
2. **Failed event volume** — count by event_type
3. **Failed event samples** — top 20 by recency

Record findings in this plan before Phase 2.

## Phase 1 — Schema trace

Confirm base-table schema:
- Does `users` table have `deactivated_at`, `reactivated_at`, `deleted_at`, `is_active`? If not — which columns DO exist for lifecycle state?
- Is there a separate `users_projection` or is `users` the projection directly? (Baseline shows `users` as the base table; no `users_projection` table exists per handler file names like `handlers/user/handle_user_profile_updated.sql` operating on `users`)

Use:
```sql
SELECT column_name, data_type, is_nullable
  FROM information_schema.columns
 WHERE table_schema = 'public' AND table_name = 'users'
 ORDER BY ordinal_position;
```

## Phase 2 — Migration body (template, to be fleshed out after Phase 0/1)

```sql
-- ============================================================================
-- Migration: Add missing user lifecycle handlers
-- ============================================================================
-- Handlers `handle_user_deactivated`, `handle_user_reactivated`, and
-- `handle_user_deleted` are referenced in process_user_event()'s CASE branches
-- (restored by migration 20260217211231) but were never defined. Every event
-- of these types has set processing_error on domain_events silently since
-- Feb 2026.
--
-- This migration creates the 3 handlers. Backfill of failed events is a
-- follow-up step (see plan.md Phase 4).
-- ============================================================================

CREATE OR REPLACE FUNCTION public.handle_user_deactivated(p_event record)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $$
BEGIN
    UPDATE public.users
       SET deactivated_at = (p_event.event_data->>'deactivated_at')::timestamptz,
           is_active = false,
           updated_at = p_event.created_at
     WHERE id = p_event.stream_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'User % not found for user.deactivated event', p_event.stream_id
            USING ERRCODE = 'P0002';
    END IF;
END;
$$;

-- Similar shape for handle_user_reactivated (clears deactivated_at, sets reactivated_at + is_active=true)
-- Similar shape for handle_user_deleted (soft-delete: sets deleted_at; does NOT clear other fields)
```

Open questions requiring Phase 1 confirmation:
- **Q1** — Is there an `is_active` boolean column, or is activity inferred from `deactivated_at IS NULL`?
- **Q2** — Does `handle_user_deleted` cascade to `user_roles_projection`, `user_phones`, etc.? Or is cascade handled by FK ON DELETE rules?
- **Q3** — Should the handler raise or silently succeed on "user already in target state" (double-deactivate)? Idempotency consideration.

## Phase 3 — Handler reference files

Three `.sql` files created from the final migration definitions:
- `infrastructure/supabase/handlers/user/handle_user_deactivated.sql`
- `infrastructure/supabase/handlers/user/handle_user_reactivated.sql`
- `infrastructure/supabase/handlers/user/handle_user_deleted.sql`

Each contains the `CREATE OR REPLACE FUNCTION` block verbatim. Matches Rule 7.1 pattern.

## Phase 4 — Backfill retry

After migration applies:

```sql
-- Retry each silently-failed event
SELECT api.retry_failed_event(id)
  FROM domain_events
 WHERE event_type IN ('user.deactivated','user.reactivated','user.deleted')
   AND processing_error IS NOT NULL
 ORDER BY created_at;
```

On success, `processing_error` is cleared and the handler runs. Monitor post-retry for new errors (indicates handler logic bugs vs the "missing handler" issue).

## Phase 5 — Verification

1. **Live handler existence**: `SELECT proname FROM pg_proc WHERE proname IN (...);` returns 3 rows.
2. **Manual event test** (dev project):
   - Call `manage-user` with `operation: 'deactivate'` on a test user
   - Query `domain_events` — new row, `processing_error IS NULL`
   - Query `users` — `deactivated_at` populated, `is_active = false`
   - Repeat for reactivate and delete
3. **No regressions** in dependent projections (e.g., `user_roles_projection` if delete cascades)

## Phase 6 — PR

```
git commit -m "fix(handlers): add missing user lifecycle handlers (deactivated/reactivated/deleted)"
git push origin <branch>
gh pr create --base main --title "fix(handlers): missing user lifecycle handlers + backfill" --body ...
```

## Risks

- **R1** — Handlers exist in production (added out-of-band). Phase 0 audit catches this and downgrades this card to hygiene-only.
- **R2** — Schema drift: `users` table columns don't match expectations. Phase 1 catches.
- **R3** — Backfill retry triggers a flood of downstream events (e.g., if deactivate cascades to invalidate sessions). Monitor after Phase 4.
- **R4** — Test users only exist in prod. If so, Phase 5 needs a create-fresh-test-user step first.
