# manage-user modify_roles → SQL RPC — Plan

## Executive Summary

Extract `modify_roles` from `manage-user` Edge Function. Use multi-event COMPLEX-CASE Pattern A v2 (same shape as `api.update_role`). Defer activation until `manage-user update_notification_preferences` extraction ships and proves the pattern.

## Phases

| Phase | Description |
|-------|-------------|
| 0 | Activation gate — check that `manage-user-to-sql-rpc` (update_notification_preferences) has shipped; inspect modify_roles case + event emission pattern |
| 1 | Migration: create RPC with captured `v_event_ids uuid[]` pattern |
| 2 | Frontend service cutover |
| 3 | Edge Function cleanup |
| 4 | Verification + PR |

## Open Questions

See `context.md`. Main ones: event emission pattern, permission requirement, response shape.

## Risk

- **R1** — Complexity relative to single-event extraction. Use `update_role` migration as reference.
- **R2** — Activation gate depends on completion of Card 1 (high-priority).
