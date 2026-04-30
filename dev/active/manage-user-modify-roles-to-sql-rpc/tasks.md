# manage-user modify_roles → SQL RPC — Tasks

## Current Status

**Phase**: 1 (Pre-PR audit complete) → 2 (Migration)
**Status**: 🟢 ACTIVE — execution
**Plan**: `/home/lars/.claude/plans/start-phase-0-inspection-whimsical-pixel.md`
**Branch**: `feat/manage-user-modify-roles-to-sql-rpc`

## Pre-activation Checklist

- [x] `adr-edge-function-vs-sql-rpc.md` PR merged (PR #33)
- [x] `manage-user-to-sql-rpc` notification_preferences shipped (PR #36)
- [x] Learnings captured in memory `edge-function-sql-rpc-backlog.md` precedents (1)–(11)
- [x] Architect review complete (APPROVE WITH MINOR FOLLOW-UPS, 2026-04-30)

## Wrong-helper inventory (Phase 1 result)

**10 confirmed sites** to migrate to `apiRpcEnvelope<T>` when helper signatures narrow:

| File:Line | Method | RPC | Verified shape |
|---|---|---|---|
| `frontend/src/services/users/SupabaseUserCommandService.ts:246` | `revokeInvitation` | `revoke_invitation` | jsonb envelope |
| `frontend/src/services/users/SupabaseUserCommandService.ts:461` | `deleteUser` | `delete_user` | jsonb envelope |
| `frontend/src/services/users/SupabaseUserCommandService.ts:558` | `updateUser` | `update_user` | jsonb envelope |
| `frontend/src/services/users/SupabaseUserCommandService.ts:833` | `addUserPhone` | `add_user_phone` | jsonb envelope |
| `frontend/src/services/users/SupabaseUserCommandService.ts:940` | `updateUserPhone` | `update_user_phone` | jsonb envelope |
| `frontend/src/services/users/SupabaseUserCommandService.ts:1059` | `removeUserPhone` | `remove_user_phone` | jsonb envelope |
| `frontend/src/services/users/SupabaseUserCommandService.ts:1218` | `updateNotificationPreferences` | `update_user_notification_preferences` | jsonb envelope |
| `frontend/src/services/admin/EventMonitoringService.ts:254` | `retryFailedEvent` | `retry_failed_event` | jsonb envelope (`{success, event_id, ...}`) |
| `frontend/src/services/admin/EventMonitoringService.ts:355` | `dismissFailedEvent` | `dismiss_failed_event` | jsonb envelope (`{success, message?, error?}`) |
| `frontend/src/services/admin/EventMonitoringService.ts:437` | `undismissFailedEvent` | `undismiss_failed_event` | jsonb envelope (`{success, message?, error?}`) |

**Verified correct (NOT wrong-helper)**:
- `EventMonitoringService.ts:520` — `get_event_processing_stats` returns jsonb but no `success` discriminator → READ shape, `apiRpc<T>` is correct.
- `SupabaseUserCommandService.ts:1125` — `update_user_access_dates` returns `void` → no envelope, `apiRpc<void>` is correct.

## Tasks

- [x] Phase 0 — Inspect modify_roles case; resolve open questions
- [x] Phase 1 — Validate wrong-helper inventory (10 sites, no surprises)
- [x] Phase 2 — Migration `api.modify_user_roles` (with shape COMMENT) — `20260430172139`
- [x] Phase 3 — Migration: backfill 168 RPC shape comments — `20260430172625` + `20260430172836` (13 reclassifications)
- [x] Phase 4 — Codegen `frontend/scripts/gen-rpc-registry.cjs` + npm scripts
- [x] Phase 5 — Type regen (Rule 15) — both consumers byte-identical
- [x] Phase 6 — Helper signature narrowing + ApiEnvelopeFailure extension (violations, partial, errorDetails)
- [x] Phase 7 — Migrate all 10 wrong-helper sites to `apiRpcEnvelope<T>`
- [x] Phase 8 — Frontend modify_roles cutover + 7 mapping tests + VM violation/partial UI
- [x] Phase 9 — Edge Function cleanup + DEPLOY_VERSION bump v15
- [x] Phase 10 — CI gate `rpc-registry-sync.yml` (local-container anchor)
- [x] Phase 11 — Documentation: 6 surfaces (2 SKILLs + 2 CLAUDE.mds + ADR + MEMORY)
- [x] Phase 12 — Verification (typecheck/lint/build green; 41 service tests pass; 0 regressions; RPC smoke confirms 42501 guard fires)
- [ ] Phase 13 — PR + archive card + ADR Rollout history append (in progress)

## Final scope summary

- **2 new migrations** + **1 fixup migration** applied to dev
- **89 envelope-tagged + 80 read-tagged + 0 untagged** = 169 RPCs total
- **10 wrong-helper sites migrated** to `apiRpcEnvelope<T>` (7 in SupabaseUserCommandService, 3 in EventMonitoringService)
- **13 RPCs reclassified** during fixup (4 envelope→read, 9 read→envelope) — heuristic regex was wrong on functions whose name suggested a category their actual return shape contradicted
- **6 documentation surfaces** updated
- **Edge Function `manage-user` v14 → v15** deployed; modify_roles operation removed
- **Net test delta**: +6 passing (23 mapping tests + previously 17 → now 23, all 41 service tests green)
