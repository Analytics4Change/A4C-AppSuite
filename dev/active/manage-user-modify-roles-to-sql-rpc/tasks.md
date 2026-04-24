# manage-user modify_roles → SQL RPC — Tasks

## Current Status

**Phase**: SEEDED — awaiting activation after (1) `edge-function-vs-sql-rpc-adr` PR merges AND (2) `manage-user-to-sql-rpc` (update_notification_preferences) ships
**Status**: 🟢 ACTIVE (scaffold only)
**Priority**: Low

## Pre-activation Checklist

- [ ] `adr-edge-function-vs-sql-rpc.md` PR merged
- [ ] `manage-user-to-sql-rpc` (notification_preferences) shipped
- [ ] Learnings from that extraction captured (patterns, gotchas)

## Tasks

- [ ] Phase 0 — Inspect modify_roles case; resolve context.md questions
- [ ] Phase 1 — Migration with multi-event `v_event_ids uuid[]` Pattern A v2
- [ ] Phase 2 — Frontend cutover
- [ ] Phase 3 — Edge Function cleanup + DEPLOY_VERSION bump
- [ ] Phase 4 — Verification + PR
- [ ] Post-merge — Archive + append ADR Rollout history
