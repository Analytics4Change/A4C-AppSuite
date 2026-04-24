# manage-user reactivate → SQL RPC — Plan

## Executive Summary

Extract `reactivate` from `manage-user` Edge Function into an SQL RPC. Blocked pending resolution of missing-handler issue + Phase 0 clarification of reactivate's intended `auth.admin` semantic.

## Phases

| Phase | Description |
|-------|-------------|
| 0 | Resolve O1 (intent) + O2 (handler projection fields). If O1 resolves to "bug, should unban" → reclassify LB1, park this card, re-route to retrofit backlog. |
| 1 | Migration: create `api.reactivate_user` with Pattern A v2 |
| 2 | Frontend service cutover |
| 3 | Edge Function cleanup + DEPLOY_VERSION bump |
| 4 | Verification + PR |

## Prerequisites

- [ ] `dev/active/fix-missing-user-lifecycle-handlers/` resolved (creates `handle_user_reactivated`)
- [ ] Phase 0 O1 confirms current no-`auth.admin` behavior is intentional (otherwise reclassify to load-bearing)

## Open Questions

See `context.md` (O1, O2).

## Risk

- **R1** — If Phase 0 reveals O1 is a bug, extraction scope changes fundamentally. Keeping the card medium priority until Phase 0 runs.
- **R2** — `handle_user_reactivated` semantic depends on the missing-handlers fix. Extraction test plan must verify the handler's projection writes before the RPC's read-back will work.
