# manage-user delete → SQL RPC — Tasks

## Current Status

**Phase**: SEEDED — awaiting activation after `edge-function-vs-sql-rpc-adr` PR merges
**Status**: 🟢 ACTIVE (scaffold only)
**Priority**: Medium

## Tasks

- [ ] **Prerequisite** — Missing-handlers issue resolved (creates `handle_user_deleted`) — see `dev/active/fix-missing-user-lifecycle-handlers/`
- [ ] Phase 0 — Inspect delete case + handler; resolve O1/O2 questions in plan.md (O3 already closed)
- [ ] Phase 1 — Migration creating `api.delete_user` with Pattern A v2
- [ ] Phase 2 — Frontend cutover
- [ ] Phase 3 — Edge Function cleanup + DEPLOY_VERSION bump
- [ ] Phase 4 — Verification + PR
- [ ] Post-merge — Archive + append ADR Rollout history
