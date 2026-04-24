# manage-user delete → SQL RPC — Tasks

## Current Status

**Phase**: SEEDED — awaiting activation after `edge-function-vs-sql-rpc-adr` PR merges
**Status**: 🟢 ACTIVE (scaffold only)
**Priority**: Medium

## Tasks

- [ ] Phase 0 — Inspect delete case + handler; resolve O1/O2/O3 questions in plan.md
- [ ] **Gate** — If O3 reveals `auth.users` deletion → reclassify load-bearing, park card, update ADR Rollout note
- [ ] Phase 1 — Migration creating `api.delete_user` with Pattern A v2
- [ ] Phase 2 — Frontend cutover
- [ ] Phase 3 — Edge Function cleanup + DEPLOY_VERSION bump
- [ ] Phase 4 — Verification + PR
- [ ] Post-merge — Archive + append ADR Rollout history
