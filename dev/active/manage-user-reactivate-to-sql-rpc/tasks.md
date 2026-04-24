# manage-user reactivate → SQL RPC — Tasks

## Current Status

**Phase**: SEEDED — blocked on 2 prerequisites
**Status**: 🟢 ACTIVE (scaffold only)
**Priority**: Medium
**Created**: 2026-04-24 (PR #33 remediation; reclassification of inventory row 9)

## Prerequisites

- [ ] `dev/active/fix-missing-user-lifecycle-handlers/` resolved (creates `handle_user_reactivated`)
- [ ] Phase 0 O1 confirms no-`auth.admin`-on-reactivate is intentional (OR reclassify to load-bearing and park)

## Tasks

- [ ] Phase 0 — Resolve O1 (intent) + O2 (handler projection fields)
- [ ] **Gate** — If O1 reveals bug → reclassify LB1, park card, re-route to load-bearing retrofit backlog
- [ ] Phase 1 — Migration creating `api.reactivate_user` with Pattern A v2
- [ ] Phase 2 — Frontend cutover
- [ ] Phase 3 — Edge Function cleanup + DEPLOY_VERSION bump
- [ ] Phase 4 — Verification + PR
- [ ] Post-merge — Archive + append ADR Rollout history
