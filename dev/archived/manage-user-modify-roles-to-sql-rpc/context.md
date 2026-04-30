# manage-user modify_roles → SQL RPC — Context

**Feature**: Extract `modify_roles` operation from `manage-user` Edge Function into a SQL RPC
**Status**: 🟢 ACTIVE — Seeded by `edge-function-vs-sql-rpc-adr` (2026-04-24)
**Priority**: Low — defer until `update_notification_preferences` (high-priority card) ships and we have extraction patterns proven
**Current branch**: TBD

## Activation Trigger

- ✅ `adr-edge-function-vs-sql-rpc.md` published (v1, 2026-04-24)
- Classification: Phase 0 inventory row #11 — `candidate-for-extraction`; all 6 LB criteria are ❌
- **Defer rationale**: `manage-user update_notification_preferences` is the architect-validated first target. Ship that extraction, learn from it, then tackle `modify_roles` with the patterns proven. Plus: `modify_roles` emits 1+N+M events (1 `user.role.assigned` per add + M `user.role.revoked` per remove? verify) — multi-emit extraction may surface complexity not present in the single-emit case.

## Scope

### In scope
- New SQL RPC (name TBD, possibly `api.modify_user_roles`)
- Multi-event Pattern A v2 per `update_role` COMPLEX-CASE variant (captured `uuid[]` checked with `WHERE id = ANY(v_event_ids)`)
- Remove `modify_roles` case from `manage-user/index.ts`
- Frontend service cutover

### Out of scope
- Other `manage-user` ops
- Refactoring the underlying role-assignment handlers

## Open Questions (resolve during Phase 0)

- Exact event emission pattern — single `user.roles.modified` event? Or N `role.assigned` + M `role.revoked` like `update_role`?
- Permission check — requires `user.role_assign` per baseline?
- Response envelope shape — returns list of assigned role ids?

## Reference Materials

- [adr-edge-function-vs-sql-rpc.md](../../../documentation/architecture/decisions/adr-edge-function-vs-sql-rpc.md)
- [adr-rpc-readback-pattern.md](../../../documentation/architecture/decisions/adr-rpc-readback-pattern.md) — multi-event COMPLEX-CASE pattern in Decision 1 + Rollout history
- `infrastructure/supabase/supabase/functions/manage-user/index.ts` — modify_roles case
- `api.update_role` migration (example of multi-event Pattern A v2)
