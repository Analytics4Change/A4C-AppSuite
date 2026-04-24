# Fix Missing User Lifecycle Handlers — Tasks

## Current Status

**Phase**: FILED — ready for Phase 0 audit
**Status**: 🔴 CRITICAL (production data-integrity issue)
**Priority**: **HIGH** — blocks 3 downstream extraction cards
**Last Updated**: 2026-04-24
**Branch**: TBD
**Surfaced by**: `dev/archived/edge-function-vs-sql-rpc-adr/` PR #33 audit

## Pre-activation Checklist

- [ ] Live-DB audit run (Phase 0) — confirms handlers missing AND measures backfill scope
- [ ] Decision: execute as-described OR downgrade to hygiene-only if handlers exist in prod

## Phase 0 — Live-DB Audit 🟡 NOT STARTED

- [ ] Query `pg_proc` for handler existence
- [ ] Count failed `user.deactivated`/`reactivated`/`deleted` events with `processing_error IS NOT NULL`
- [ ] Sample top 20 error messages by recency
- [ ] Document findings inline in `plan.md` Phase 0 section

**Decision gate**: If handlers exist in production → downgrade card to "hygiene-only, update reference files to match prod, no migration needed."

## Phase 1 — Schema Trace 🟡 NOT STARTED

- [ ] Confirm `users` table columns — what lifecycle fields exist?
- [ ] Resolve Q1/Q2/Q3 in plan.md

## Phase 2 — Migration 🟡 NOT STARTED

- [ ] `supabase migration new add_missing_user_lifecycle_handlers`
- [ ] Define `handle_user_deactivated`
- [ ] Define `handle_user_reactivated`
- [ ] Define `handle_user_deleted`
- [ ] Apply via `supabase db push --linked`
- [ ] Verify via post-apply `pg_proc` query

## Phase 3 — Handler Reference Files 🟡 NOT STARTED

- [ ] Create `handlers/user/handle_user_deactivated.sql`
- [ ] Create `handlers/user/handle_user_reactivated.sql`
- [ ] Create `handlers/user/handle_user_deleted.sql`

## Phase 4 — Backfill Retry 🟡 NOT STARTED

- [ ] Execute retry loop over all failed events of these types
- [ ] Monitor post-retry for NEW processing errors (signals handler logic bugs)

## Phase 5 — Verification 🟡 NOT STARTED

- [ ] Handlers exist via `pg_proc` query
- [ ] Manual dev-project test: deactivate → reactivate → delete round-trip; confirm projection moves + no new failed events
- [ ] No regressions in dependent projections

## Phase 6 — PR + Merge 🟡 NOT STARTED

- [ ] Commit + push on branch
- [ ] Open PR
- [ ] Post-merge: archive this card → `dev/archived/fix-missing-user-lifecycle-handlers/`
- [ ] Post-merge: unblock dependent extraction cards (`manage-user-delete-to-sql-rpc/`, `manage-user-reactivate-to-sql-rpc/`, future deactivate retrofit card) — update their Prerequisites sections
