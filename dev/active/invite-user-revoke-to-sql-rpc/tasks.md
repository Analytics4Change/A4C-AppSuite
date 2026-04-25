# invite-user revoke → SQL RPC — Tasks

## Current Status

**Phase**: Phase 0 complete (2026-04-24); D1–D5 locked; Phase 1' in progress
**Status**: 🟢 ACTIVE
**Priority**: Medium
**Branch**: `invite-user-revoke-to-sql-rpc`

## Tasks (tracked via TaskCreate; see `plan.md` for full context)

- [x] Phase 0 — Inspect v16 revoke case body + existing RPC + caller audit (2026-04-24)
- [ ] Phase 1' — Draft migration modifying `api.revoke_invitation` (gates + jsonb envelope + DbC)
- [ ] Phase 1'/4 — Apply migration + regen TS types in both consumer files; typecheck
- [ ] Phase 2 — Frontend service cutover (`SupabaseUserCommandService.revokeInvitation`)
- [ ] Phase 3 — Remove `revoke` case from Edge Function + bump `DEPLOY_VERSION` → v17
- [ ] Phase 5 — Verify (lint, typecheck, build, manual smoke of revoke flow)
- [ ] Phase 6 — PR + post-merge archive + ADR Rollout history + memory backlog update
