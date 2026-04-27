# manage-user delete → SQL RPC — Tasks

## Current Status

**Phase**: ALL PHASES COMPLETE (2026-04-27) — awaiting commit + PR open + merge
**Status**: 🟢 READY-FOR-PR
**Priority**: Medium

## Tasks

- [x] **Prerequisite** — Missing-handlers issue resolved (creates `handle_user_deleted`) — PR #35 merged 2026-04-24, commit `8eae916f`
- [x] Phase 0 — Inspect delete case + handler; resolve O1/O2 questions in plan.md — completed 2026-04-27
- [x] Pre-deploy regression check (2026-04-27) — 0 suspect cross-OU calls in last 30 days; verdict GO
- [x] Phase 1 — Migrations applied to `tmrjlswbsxmbglmaclxu`:
  - [x] M1 `20260427203747_add_get_user_target_path_helper.sql` — canonical helper with tenancy guard
  - [x] M2 `20260427205333_extract_delete_user_rpc.sql` — `api.delete_user` with Pattern A v2 + scoped permission
  - [x] M3 `20260427205449_scope_update_user_notification_preferences.sql` — retrofit to scoped (admin branch only)
  - [x] M4 `20260427205549_scope_revoke_invitation.sql` — retrofit to scoped + tenancy guard
  - [x] Type regen + byte-identical between `frontend/` and `workflows/`
- [x] Phase 2 — Frontend cutover: `SupabaseUserCommandService.deleteUser` calls `api.delete_user`; 4 new envelope tests pass
- [x] Phase 3 — Edge Function cleanup: removed `'delete'` from `Operation`, perm check, self-action guard, state guard, event-type switch, validation array, JSDoc; `DEPLOY_VERSION = 'v13-delete-extracted'`
- [x] Phase 4 — Verification: typecheck (frontend + workflows), lint, docs:check, build, user-services tests (35/35) — all green
- [ ] Commit + open PR (in progress)
- [ ] Post-merge — Archive card to `dev/archived/`
