# invite-user revoke → SQL RPC — Context

**Feature**: Extract the `revoke` operation from the `invite-user` Edge Function into a SQL RPC
**Status**: 🟢 ACTIVE — Seeded by `edge-function-vs-sql-rpc-adr` (2026-04-24)
**Priority**: Medium
**Current branch**: TBD — start from `main` after the ADR PR merges

## Activation Trigger

- ✅ `adr-edge-function-vs-sql-rpc.md` published (v1, 2026-04-24)
- Classification: Phase 0 inventory row #7 — `candidate-for-extraction`; all 6 LB criteria are ❌; pure RPC + event emission on existing invitation

## Scope

### In scope
- New SQL RPC wrapping the revoke operation (likely `api.revoke_invitation` — verify; `api.revoke_invitation` may already exist as the current RPC that the Edge Function's revoke case forwards to)
- Remove the `revoke` case from `invite-user/index.ts`
- Frontend service cutover if `invite-user.revoke` is called from frontend

### Out of scope
- `create` and `resend` operations (load-bearing via LB1/LB2 — Resend API)

## Notes

Per MEMORY.md entry "Invitation Resend/Revoke Fix Complete (2026-02-19)": `api.revoke_invitation` already exists as an RPC (with signature `(p_invitation_id uuid, p_reason text)`; uses `auth.uid()` internally). The `invite-user` Edge Function v15's `revoke` case may just forward to it. This extraction may be a frontend-only change (point frontend directly at the existing RPC) rather than a new RPC authoring.

**Verify before planning**: inspect `invite-user/index.ts` revoke case body — if it's a pure RPC forward, this card reduces to "point frontend at existing RPC; delete Edge Function case." If it adds meaningful pre/post logic, port that logic to the RPC or a new wrapping RPC.

## Reference Materials

- [adr-edge-function-vs-sql-rpc.md](../../../documentation/architecture/decisions/adr-edge-function-vs-sql-rpc.md)
- `infrastructure/supabase/supabase/functions/invite-user/index.ts` (v15)
- MEMORY.md "Invitation Resend/Revoke Fix Complete (2026-02-19)"
