# manage-user delete → SQL RPC — Tasks

## Current Status

**Phase**: ALL PHASES COMPLETE INCLUDING COURSE CORRECTION (2026-04-27) — awaiting commit + PR open + merge
**Status**: 🟢 READY-FOR-PR
**Priority**: Medium

## Tasks

- [x] **Prerequisite** — Missing-handlers issue resolved (creates `handle_user_deleted`) — PR #35 merged 2026-04-24, commit `8eae916f`
- [x] Phase 0 — Inspect delete case + handler; resolve O1/O2 questions in plan.md — completed 2026-04-27
- [x] Phase 1 — Migrations applied to `tmrjlswbsxmbglmaclxu`:
  - [x] M1 `20260427203747_add_get_user_target_path_helper.sql` — helper (REVERTED via R4)
  - [x] M2 `20260427205333_extract_delete_user_rpc.sql` — `api.delete_user` with scoped permission (REPLACED via R1)
  - [x] M3 `20260427205449_scope_update_user_notification_preferences.sql` — scoped retrofit (REPLACED via R2)
  - [x] M4 `20260427205549_scope_revoke_invitation.sql` — scoped retrofit + tenancy guard (REPLACED via R3, tenancy guard preserved)
- [x] Phase 1.5 — **Course correction** (2026-04-27): user-model authority clarified A4C users have no OU-bounded identity. Scoped retrofit reverted same-day. See plan.md § Phase 1.5 Course Correction for full context.
  - [x] R1 `20260427220143_unscope_delete_user.sql` — unscoped `has_permission('user.delete')` + inline tenancy guard
  - [x] R2 `20260427220243_unscope_update_user_notification_preferences.sql` — restored PR #36 form
  - [x] R3 `20260427220331_unscope_revoke_invitation.sql` — restored PR #39 permission style + KEPT cross-tenant UUID-leak fix
  - [x] R4 `20260427220419_drop_get_user_target_path_helper.sql` — helper dropped
  - [x] Type regen post-revert; byte-identical between `frontend/` and `workflows/`
- [x] Phase 2 — Frontend cutover: `SupabaseUserCommandService.deleteUser` calls `api.delete_user`; 4 new envelope tests pass (unaffected by revert — RPC envelope shape didn't move)
- [x] Phase 3 — Edge Function cleanup: removed `'delete'` from `Operation`, perm check, self-action guard, state guard, event-type switch, validation array, JSDoc; `DEPLOY_VERSION = 'v13-delete-extracted'`
- [x] Phase 4 — Verification: typecheck (frontend + workflows), lint, user-services tests (35/35) — all green post-revert
- [x] Documentation rollback: CLAUDE.md, rbac-architecture.md, ADR Rollout entry, MEMORY.md, edge-function-sql-rpc-backlog.md
- [x] Sub-tenant-admin design card seeded at `dev/active/sub-tenant-admin-design/`
- [ ] Commit + open PR (in progress)
- [ ] Post-merge — Archive card to `dev/archived/`
