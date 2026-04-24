# manage-user → SQL RPC (update_notification_preferences) — Tasks

## Current Status

**Phase**: SEEDED — awaiting activation after `edge-function-vs-sql-rpc-adr` PR merges
**Status**: 🟢 ACTIVE (scaffold only, no work started)
**Last Updated**: 2026-04-24
**Branch**: TBD (start from `main` after ADR PR merges)
**Priority**: **High** — first extraction target per ADR inventory

## Pre-activation Checklist

- [ ] `adr-edge-function-vs-sql-rpc.md` PR merged to main
- [ ] No blocking concurrent work on `manage-user` Edge Function
- [ ] Confirmed zero non-frontend callers (grep `workflows/`, admin scripts, smoke tests)

## Phase 0 — Signature + Port Design 🟡 NOT STARTED

- [ ] Confirm `user_notification_preferences_projection` schema (columns, PK)
- [ ] Enumerate v11 permission checks and map to PL/pgSQL
- [ ] Finalize RPC name (`api.update_user_notification_preferences`?)
- [ ] Decide response shape — match current TypeScript or switch to snake_case

## Phase 1 — Migration 🟡 NOT STARTED

- [ ] `supabase migration new extract_user_notification_preferences_rpc`
- [ ] Implement Pattern A v2 body per plan.md template
- [ ] Apply via `supabase db push --linked`
- [ ] Verify via post-apply dump

## Phase 2 — Frontend Cutover 🟡 NOT STARTED

- [ ] `SupabaseUserCommandService.updateNotificationPreferences` → `rpc()`
- [ ] `MockUserCommandService.updateNotificationPreferences` → mirror envelope
- [ ] Update/replace `SupabaseUserCommandService.mapping.test.ts` tests that targeted the Edge Function path

## Phase 3 — Edge Function Cleanup 🟡 NOT STARTED

- [ ] Remove `update_notification_preferences` case from `manage-user/index.ts`
- [ ] Bump DEPLOY_VERSION to `v12-post-notification-prefs-extraction` (or similar)
- [ ] Deploy via `supabase functions deploy manage-user`
- [ ] Update `documentation/infrastructure/reference/edge-functions/manage-user.md` to reflect the smaller operation surface

## Phase 4 — Verification 🟡 NOT STARTED

- [ ] Manual dev-project test: update prefs via frontend, confirm round-trip
- [ ] Manual dev-project test: force handler failure, confirm `{success: false, error: 'Event processing failed: ...'}` surfaces correctly
- [ ] `npm run test` in `frontend/` passes
- [ ] Architect spot-review (optional)

## Phase 5 — PR + Merge 🟡 NOT STARTED

- [ ] Commit on extraction branch
- [ ] Open PR referencing ADR + this dev-doc
- [ ] Post-merge: archive `dev/active/manage-user-to-sql-rpc/` → `dev/archived/`
- [ ] Post-merge: append to ADR Rollout history ("2026-XX-XX — update_notification_preferences extracted; inventory row 12 moves `candidate` → `extracted`")
- [ ] Post-merge: `MEMORY.md` note on the first Edge Function → SQL RPC extraction
