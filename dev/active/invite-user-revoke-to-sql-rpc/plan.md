# invite-user revoke → SQL RPC — Plan

## Executive Summary

Extract `revoke` operation from the `invite-user` Edge Function. Phase 0 (2026-04-24) confirmed this is **not** a pure RPC forward — the Edge Function carries permission and access-blocked gates that the existing `api.revoke_invitation` RPC does not. Path is **Phase 1'**: modify the existing RPC in place to absorb the Edge Function's gates, grant EXECUTE to `authenticated`, cut the frontend over to direct RPC calls, and remove the Edge Function case.

## Phase 0 Findings (2026-04-24)

**Edge Function `revoke` case** (`infrastructure/supabase/supabase/functions/invite-user/index.ts:538–578`):
- Above op switch: JWT decode → `access_blocked` guard → `org_id` extraction → `user.create` permission check via `hasPermission(effectivePermissions, ...)`.
- Op body: `supabaseAdmin.rpc('revoke_invitation', { p_invitation_id, p_reason: 'Revoked by administrator' })` — **service-role** call (so `auth.uid()` is null inside the RPC, leaving `event_metadata->>'user_id'` null today — a latent audit-trail gap that this extraction *fixes*).
- Hardcoded reason: `'Revoked by administrator'`.
- Response: `{ success: true, invitationId }`.

**Existing `api.revoke_invitation`** (`baseline_v4.sql:5337–5371`):
- `(p_invitation_id uuid, p_reason text DEFAULT 'manual_revocation') RETURNS boolean`, `SECURITY DEFINER`.
- Existence check (status = 'pending') → emits `invitation.revoked` with `auth.uid()` in metadata.
- **No permission check, no `access_blocked` check.**
- Grant: `GRANT ALL ... TO service_role` only.
- Single signature — no overloads (Rule 15 baseline-overload audit confirmed).

**Caller audit (O2)**:
- Frontend: `UserListPage.tsx:210`, `UsersManagePage.tsx:480` → ViewModel → `SupabaseUserCommandService.revokeInvitation` (line 234) → `invite-user` Edge Function.
- Workflows: no callers (only type-definition reference).
- Direct callers of `api.revoke_invitation`: none.

## Locked Design Decisions (D1–D5, 2026-04-24)

- **D1 — Modify in-place vs new RPC**: Modify `api.revoke_invitation` in place. The only existing caller is the Edge Function we are removing. Per PR #36 Rule 15 audit, no overloads — safe to mutate. (Avoids a `_v2` proliferation.)
- **D2 — Permission gate**: Keep `user.create` to match current Edge semantics. Use `public.has_permission('user.create')` (presence-only, unscoped) per PR #36 precedent.
- **D3 — `access_blocked` guard**: Port into the RPC. Read `current_setting('request.jwt.claims', true)::jsonb ->> 'access_blocked'`; if `'true'`, return error envelope.
- **D4 — Reason argument**: Keep RPC default `'manual_revocation'`. Frontend passes `'Revoked by administrator'` exactly (preserves current event-data shape byte-for-byte).
- **D5 — Response shape**: Migrate from `boolean` → `jsonb` envelope `{ success, error? }`. Breaking change to a function with no other callers. Aligns with PR #36 precedent and lets us surface distinct error reasons (`access_blocked`, `permission_denied`, `not_found_or_not_pending`) without overloading a boolean.

## Phases

| Phase | Description |
|-------|-------------|
| 0 | ✅ Complete — Phase 0 findings above. |
| 1' | Migration: modify `api.revoke_invitation` to absorb gates, change return type to `jsonb`, GRANT EXECUTE to `authenticated`, REVOKE from `service_role`. Add DbC `COMMENT ON FUNCTION` block. |
| 2 | Frontend cutover: `SupabaseUserCommandService.revokeInvitation` calls `client.schema('api').rpc('revoke_invitation', ...)` directly. Service result-shape mapping unchanged externally. |
| 3 | Edge Function: remove `revoke` case + bump `DEPLOY_VERSION` to `v17-revoke-extracted`. Remove `'revoke'` from `Operation` type union. |
| 4 | Type regen: `supabase gen types typescript --linked` → both `frontend/` + `workflows/` `database.types.ts` byte-identical. Typecheck both. |
| 5 | Verification: lint, typecheck, build, manual revoke flow check. PR. |
| 6 | Post-merge: archive folder, append ADR Rollout history (inventory row #7 → extracted), update `memory/edge-function-sql-rpc-backlog.md` chain. |

## Open Questions

All Phase 0 questions resolved. None remain.

## Risks

- **R1 — Pattern A v2 read-back**: NOT applicable here. The RPC returns *outcome* (`success`), not a projection entity. The handler updating `invitations_projection.status` runs synchronously in-trigger; there's no projection field in the response to read back. Skip Pattern A v2; the existing-row-existence check (`SELECT EXISTS ... WHERE status='pending'`) is the equivalent guard.
- **R2 — Auth context shift**: Frontend cutover changes the call from service-role (Edge) → authenticated (direct RPC). `auth.uid()` will populate inside the RPC. Event metadata gains accurate `user_id` (improvement). RLS implications: the RPC is `SECURITY DEFINER`, so no RLS exposure on the projection read. ✅ Safe.
- **R3 — Breaking RPC return type**: `boolean → jsonb` is a wire-level breaking change. Mitigated by the no-other-callers verification in Phase 0; both type-regen and frontend cutover land in the same PR.

## Reference Materials

- [adr-edge-function-vs-sql-rpc.md](../../../documentation/architecture/decisions/adr-edge-function-vs-sql-rpc.md) — Inventory row #7
- [adr-rpc-readback-pattern.md](../../../documentation/architecture/decisions/adr-rpc-readback-pattern.md) — Pattern A v2 (R1 above explains why N/A)
- PR #36 (commit `4037f320`) — Precedent for snake_case wire, `has_permission()`, DbC COMMENT block, type-regen-both-copies, baseline-overload audit
- `infrastructure/supabase/supabase/functions/invite-user/index.ts` (v16)
- `frontend/src/services/users/SupabaseUserCommandService.ts:234`
- `infrastructure/supabase/supabase/migrations/20260212010625_baseline_v4.sql:5337–5377`
