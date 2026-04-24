# manage-user → SQL RPC (update_notification_preferences) — Context

**Feature**: Extract `update_notification_preferences` operation from the `manage-user` Edge Function into a SQL RPC in the `api.` schema
**Status**: 🟢 ACTIVE — Seeded by `edge-function-vs-sql-rpc-adr` (2026-04-24); scope pinned to this one operation
**Priority**: **High** — architect-validated first extraction target (PR #32 architect `a060ef3faaa5b630c`, "strictly superior architecturally")
**Supersedes**: Blocker-3-followup-7 from the archived `api-rpc-readback-pattern` feature
**Current branch**: TBD — start from `main` after the ADR PR merges

## Activation Trigger

- ✅ `adr-edge-function-vs-sql-rpc.md` published (v1, 2026-04-24)
- Classification: Phase 0 inventory row #12 — `candidate-for-extraction`; all 6 LB criteria are ❌; Pattern A v2 reference implementation already in place in TypeScript

## Scope

### In scope
- New SQL RPC at `api.update_user_notification_preferences` (name to be finalized)
  - Signature matches the current Edge Function payload: `(p_user_id uuid, p_organization_id uuid, p_notification_preferences jsonb, p_reason text)`
  - Full Pattern A v2: capture event_id → projection read-back → `processing_error` check → envelope return
  - Returns `{success: true, notificationPreferences: <projection row>}` on success
- Edge Function `manage-user` loses its `update_notification_preferences` case:
  - Either (a) delete the case branch (clean cutover) or (b) keep a thin proxy that forwards to the new RPC (dual-deploy safety window), then delete in a follow-up
- Frontend service (`SupabaseUserCommandService.updateNotificationPreferences`) switches from `supabase.functions.invoke('manage-user', { body: { operation: 'update_notification_preferences', ... }})` to `supabase.schema('api').rpc('update_user_notification_preferences', ...)`
- AsyncAPI contract unchanged (event type / stream_type stay the same)

### Out of scope
- Other `manage-user` operations (`deactivate`, `reactivate`, `delete`, `modify_roles`) — separate cards
- Pattern A v2 retrofit of `manage-user` load-bearing ops (`deactivate`, `reactivate`) — tracked separately
- Renaming `user_notification_preferences_projection` or its schema

## Why this is the right first extraction

Per `adr-edge-function-vs-sql-rpc.md` Decision 5, `manage-user update_notification_preferences` (v11) is the SOLE reference implementation cited for Pattern A v2 in an Edge Function — and the architect already concluded that the SQL RPC form would be strictly superior:
- Single-transaction PL/pgSQL read-back instead of two TypeScript round-trips
- No version-gated fallback (current v11 uses `deployVersion: 'v11-pattern-a-v2-readback'` marker)
- No snake↔camel transformation at the response boundary — RPC returns the projection row shape directly
- Consolidates two deploy surfaces (function + migration) into one (migration only)

Frontend consumers already expect the `{success, notificationPreferences}` envelope shape; the migration is compatible at the TypeScript type level.

## Rollout considerations

- **Dual-deploy vs direct cutover**: The Edge Function currently returns `deployVersion` in its envelope. Dual-deploy means: land the SQL RPC + frontend cutover + KEEP the Edge Function case branch as a fallback for 1–2 weeks, then delete the branch. Direct cutover means: land the SQL RPC + frontend cutover + delete the Edge Function case branch in the same PR. Recommendation: direct cutover, given the narrow consumer surface and the architect's already-validated design.
- **Rollback**: If the SQL RPC form fails post-deploy, rollback = revert the frontend service change; the Edge Function remains callable via `supabase.functions.invoke()`. Direct cutover deletes the Edge Function path, so rollback requires redeploying the function. Dual-deploy preserves an in-place fallback.
- **Zero pre-existing callers outside the frontend**: Verify via git grep across `workflows/`, admin scripts, smoke tests.

## Constraints

- Preserve the `processing_error` surfacing behavior. Existing v11 consumer VMs expect `{success: false, error: 'Event processing failed: ...'}` on handler failure; new RPC must produce the same envelope.
- Do NOT change AsyncAPI event definitions (`user.notification_preferences.updated` stays on the `user` stream).
- The handler (`handle_user_notification_preferences_updated`) is UPSERT-based; read-back NOT-FOUND is a genuine invariant violation (not a stale-row case) and must be logged accordingly.

## Reference Materials

- [adr-edge-function-vs-sql-rpc.md](../../../documentation/architecture/decisions/adr-edge-function-vs-sql-rpc.md) — activation ADR
- [adr-rpc-readback-pattern.md](../../../documentation/architecture/decisions/adr-rpc-readback-pattern.md) — Pattern A v2 contract that the new RPC must implement
- `infrastructure/supabase/supabase/functions/manage-user/index.ts` — current v11 implementation (reference-impl two-step check to port)
- `infrastructure/supabase/handlers/user/handle_user_notification_preferences_updated.sql` — handler that the read-back must confirm wrote the row
- `frontend/src/services/users/SupabaseUserCommandService.ts` — `updateNotificationPreferences` consumer that will switch to `rpc()`
- `dev/archived/api-rpc-readback-pattern/` — archived feature that motivated this extraction
