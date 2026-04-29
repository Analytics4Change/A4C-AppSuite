# manage-user reactivate → SQL RPC — Context

**Feature**: Extract `reactivate` operation from `manage-user` Edge Function into a SQL RPC
**Status**: 🟢 ACTIVE — Seeded 2026-04-24 by `edge-function-vs-sql-rpc-adr` PR #33 remediation; **blocked** pending missing-handler fix
**Priority**: Medium
**Current branch**: TBD

## Activation Trigger

- ✅ `adr-edge-function-vs-sql-rpc.md` published (v1, 2026-04-24)
- **Reclassified from `load-bearing` (LB1) to `candidate-for-extraction` during PR #33 review audit** (2026-04-24). Original classification assumed the op was load-bearing via `auth.admin.updateUserById`, but grep of `manage-user/index.ts` shows the ban-state sync call at line 721 is gated on `operation === 'deactivate'` only. `reactivate` emits the `user.reactivated` event but makes no `auth.admin` call.
- **Blocker**: Handler `handle_user_reactivated` is missing from the repo. Must resolve `dev/active/fix-missing-user-lifecycle-handlers/` before this extraction can proceed — the SQL RPC needs a working handler to update `users_projection` after emission.

## Scope

### In scope
- New SQL RPC (likely `api.reactivate_user`) with Pattern A v2 by construction
- Remove the `reactivate` case from `manage-user/index.ts`
- Frontend service cutover

### Out of scope
- `deactivate` extraction (classified `load-bearing` via LB1 — auth.admin ban call)
- Fixing the missing `handle_user_reactivated` handler — tracked separately

## Open questions (Phase 0 must resolve)

- **O1 — Is the current "no `auth.admin` on reactivate" semantic intentional, or a latent bug?** The comment at `manage-user/index.ts:723` (`ban_duration: 'none' // Use 'none' to indicate unbanned`) was written as if reactivate should unban the user in `auth.users`, but the `if` guard on line 719 only fires for `deactivate`. Either:
  - (a) Design intent is "reactivate restores the projection row only; the user was never banned at auth.users level, so no unban is needed"
  - (b) It's a real bug — reactivate should ALSO call `auth.admin.updateUserById` with an unban value, and the current code never does

  If (b), the extraction must include the missing unban call — which **reclassifies the op back to load-bearing (LB1)** and invalidates this card's scope. Phase 0 must confirm intent before migration design.

- **O2** — Once `handle_user_reactivated` exists, what projection fields does it update? `reactivated_at`, clearing `deactivated_at`, or both? This shapes the RPC's read-back expectations.

## Reference Materials

- [adr-edge-function-vs-sql-rpc.md](../../../documentation/architecture/decisions/adr-edge-function-vs-sql-rpc.md) — activation ADR (inventory row 9)
- [adr-rpc-readback-pattern.md](../../../documentation/architecture/decisions/adr-rpc-readback-pattern.md) — Pattern A v2 contract
- `infrastructure/supabase/supabase/functions/manage-user/index.ts` — current reactivate case (lines 676–680 + shared emit path 660–710)
- `dev/active/fix-missing-user-lifecycle-handlers/` — prerequisite handler-fix issue (to be created after PR #33 merges)
