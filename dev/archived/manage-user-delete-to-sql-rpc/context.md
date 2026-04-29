# manage-user delete → SQL RPC — Context

**Feature**: Extract `delete` operation from `manage-user` Edge Function into a SQL RPC
**Status**: 🟢 ACTIVE — Seeded by `edge-function-vs-sql-rpc-adr` (2026-04-24)
**Priority**: Medium (couples with Pattern A v2 retrofit opportunity)
**Current branch**: TBD

## Activation Trigger

- ✅ `adr-edge-function-vs-sql-rpc.md` published (v1, 2026-04-24)
- Classification: Phase 0 inventory row #10 — `candidate-for-extraction`; all 6 LB criteria are ❌; pure RPC + event emission
- Inventory note: **"Pattern A v2 retrofit inherited on extraction"** — current Edge Function code is emit-and-return-success; the SQL RPC form includes Pattern A v2 by construction

## Scope

### In scope
- New SQL RPC `api.delete_user` (verify name; soft-delete or hard-delete TBD per existing handler semantics)
- Pattern A v2 read-back confirming `user.deleted` event processed
- Remove `delete` case from `manage-user/index.ts`
- Frontend service cutover

### Out of scope
- `deactivate` / `reactivate` (load-bearing via LB1 — `auth.admin.updateUserById`)

## Coupling with other work

**Pattern A v2 retrofit opportunity**: Since the current Edge Function path is pre-v11-style emit-and-return, extracting to SQL RPC gets Pattern A v2 read-back for free. This simultaneously closes the silent-failure gap for this operation. **Attractive scope bundle** — one extraction addresses two architectural goals.

## Reference Materials

- [adr-edge-function-vs-sql-rpc.md](../../../documentation/architecture/decisions/adr-edge-function-vs-sql-rpc.md)
- [adr-rpc-readback-pattern.md](../../../documentation/architecture/decisions/adr-rpc-readback-pattern.md) — Pattern A v2 contract
- `infrastructure/supabase/supabase/functions/manage-user/index.ts` — delete case body
- Handler reference: `infrastructure/supabase/handlers/user/handle_user_deleted.sql` (verify exists)
