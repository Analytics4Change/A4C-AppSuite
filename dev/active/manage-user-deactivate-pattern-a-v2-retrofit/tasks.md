# Tasks — manage-user-deactivate Pattern A v2 retrofit

## Current Status

**Phase**: SQL-RPC pivot shipped (PR #63); awaiting CI + UAT
**Status**: 🟢 PR open
**Branches** (chronological):
- `feat/manage-user-deactivate-pattern-a-v2-retrofit` — PR #60 (merged) — wire-tier helper. FAILED UAT.
- `hotfix/edge-function-schema-pinning` — PR #61 (merged) — `.schema('public')` pinning. FAILED UAT.
- `fix/accept-invitation-lint-unblock-deploy` — PR #62 (merged) — tiny lint fix.
- `feat/deactivate-sql-rpc-pivot` — **PR #63 (open)** — SQL-RPC pivot. Current.

## Plan reference

- Original retrofit: `~/.claude/plans/ddoes-it-make-sense-lucky-dongarra.md`
- SQL-RPC pivot (post-PR-#60/#61 failures): same plan file (final section)

## Tasks

- [x] Card seeded (2026-05-12)
- [x] Architect plan review (verdict: APPROVE WITH PLAN REVISION; Q2 + Q6 + Q1/Q3 doc-only improvements absorbed)

### Phase 1 — Helper

- [x] Create `_shared/rpc-readback.ts` with `checkProjectionReadback<T>` (expectedState predicate, maskPii on processing_error, transactional-model docblock)

### Phase 2 — Edge Function

- [x] Bump DEPLOY_VERSION to `v16-deactivate-pattern-a-v2-readback`
- [x] Capture eventId from emit
- [x] Call helper with `{is_active: false}` on deactivate path only (reactivate deferred to next card)
- [x] Add `eventId?: string` to `ManageUserResponse`
- [x] Return eventId on success response

### Phase 3 — Tests

- [x] 8 Deno cases (happy / handler-throws / race-safe / predicate-mismatch / event-id query verification / domain_events error / projection error / PII masking)
- [x] All pass locally via `deno test --allow-net manage-user/__tests__/deactivate-readback.test.ts`

### Phase 4 — Frontend additive

- [x] Add `eventId?: string` to `UserRpcEnvelope` (`frontend/src/types/user.types.ts`)
- [x] Add `eventId?: string` to `ClientRpcEnvelope` (`frontend/src/types/client.types.ts`) for cross-service uniformity
- [x] Plumb through `SupabaseUserCommandService.deactivateUser` on success path

### Phase 5 — Verification

- [ ] `cd frontend && npm run typecheck` — green
- [ ] `cd frontend && npm run lint -- --max-warnings 0` — green
- [ ] `cd frontend && npm run test -- --run` — pre-existing 56-fail baseline unchanged
- [ ] `cd frontend && npm run build` — green
- [ ] `deno test --allow-net manage-user/__tests__/` — 8/8 pass
- [ ] Commit, push, open PR
- [ ] Manual smoke (post-deploy): force handler failure (e.g. revoke handler GRANT on users), confirm `{success: false, error: 'Event processing failed: ...'}` surfaces

### Phase 6 — Follow-up

- [ ] Seed `manage-user-reactivate-pattern-a-v2-retrofit/` card after PR #63 merges. **Mirror `api.deactivate_user` SQL-RPC pattern** — create `api.reactivate_user` RPC (Pattern A v2 with predicate `is_active = true`), then thin Edge Function wrapper that calls the RPC + `auth.admin.updateUserById({ban_duration: 'none'})`. **Do NOT reuse a wire-tier helper** — that approach is dead per Rule 19.

### Phase 7 — SQL-RPC pivot (PR #63, 2026-05-12)

- [x] Architect approves pivot plan
- [x] Migration `20260512194836_deactivate_user_rpc_and_check_user_invitation_existence.sql` — creates `api.deactivate_user` + `api.check_user_invitation_existence`
- [x] Apply migration to dev DB
- [x] Regenerate `database.types.ts` (frontend + workflows, byte-identical)
- [x] Patch `rpc-registry.generated.ts` for both new RPCs
- [x] Rewrite `manage-user/index.ts` deactivate path → calls `api.deactivate_user`; reactivate path untouched
- [x] Rewrite `accept-invitation/index.ts` `checkExistingUserPath` → calls `api.check_user_invitation_existence`; signature preserved
- [x] Delete `_shared/rpc-readback.ts`
- [x] Delete `manage-user/__tests__/deactivate-readback.test.ts` (tested deleted helper)
- [x] Rewrite `accept-invitation/__tests__/existing-user-check-schema.test.ts` to mock RPC — 6 cases passing
- [x] INVALIDATE Rule 19 in SKILL.md + `infrastructure/supabase/CLAUDE.md` (replace with "no PostgREST cross-schema reads"); MEMORY.md updated
- [x] Verify: typecheck (frontend + workflows), lint, build, deno tests (96/96), migration plpgsql_check
- [x] Open PR #63
- [x] CI green (commit `59a9f826`)
- [x] Architect review on PR #63 — 8 findings + 2 architecture concerns (verdict: APPROVE WITH IN-PR FIXES)
- [x] Address findings (commit `1568c768`): NT-1/2/3 doc, F1 collapse client, F2 UAT-8, F3 carve-out, F4 throw-stub, Arch-1 config.toml, Arch-2 tasks.md
- [x] CI green on `1568c768`
- [x] Redeploy `manage-user` to dev (v17 with F1 collapsed client)
- [ ] **UAT against dev** — 8 scenarios (see "UAT progress" section below)
- [ ] Merge

---

## UAT progress (PR #63)

**Deployed dev state**:
- Migration `20260512194836_…` applied to dev DB
- Edge Function `manage-user@v17-deactivate-sql-rpc-pivot` (with F1 `supabaseUser.schema('api').rpc()` collapsed client)
- Edge Function `accept-invitation@v24-existing-user-check-sql-rpc-pivot`
- `api.deactivate_user` envelope-shape RPC available
- `api.check_user_invitation_existence` read-shape RPC available

**Test scenarios** (paste log evidence + DB-query results into this table as each runs):

| # | Scenario | Status | Notes |
|---|---|---|---|
| 1 | Happy path deactivate (Lars deactivates another user) | ✅ PASS | userId=`093c0e7b-…ef5`, eventId=`63f2c5ab-…f91`. Q1: `is_active=false`, `updated_at` matches event. Q2: `processing_error=null`. Q3: `auth.users.banned_until=2126-04-18`. SQL-RPC pivot proven end-to-end. |
| 2 | Pattern A v2 failure surfacing (force handler to fail) | ✅ PASS | eventId=`34c587de-…454b`, target user=`61cbb03f-…0821`. Sabotaged `handle_user_deactivated` to `RAISE EXCEPTION`. Envelope: `{success: false, error: "Event processing failed: UAT Test 2 — simulated handler failure", eventId}`. DB: `processing_error` captured by trigger; `users.is_active` stayed `true` (projection untouched); `auth.users.banned_until=null` (LB1 short-circuited correctly). Handler restored to canonical body. |
| 3 | Idempotency — already deactivated | ✅ PASS | Re-invoked `api.deactivate_user` on Test 1 target (server-side via Management API, simulating Lars's JWT claims). Envelope: `{success: false, error: "User is already deactivated"}` — **no eventId** (correct: idempotency guard returns pre-emit). DB confirms zero new `domain_events` rows for that stream after Test 1's event. NT-2 contract holds: only emit-then-fail paths carry eventId. |
| 4 | Cross-tenant tenancy guard | ✅ PASS | Lars (org `2d0829ae-…`) targeting foreign user `65350fa6-…` (org `43ede501-…liveforlife`) returns `{success: false, error: "User not found in this organization"}`. Fabricated UUID returns BYTE-IDENTICAL envelope — empirical no-leak proof. Structural: SQL has no side effects in this branch. NT-2: no eventId on pre-emit envelopes. |
| 5 | Sally scenario, accept-invitation OAuth/SSO | ✅ PASS | Sally = `dakaratekid@gmail.com` (Google SSO, existing `provider_admin` in liveforlife). Lars invited to testorg-20260329 (`emailStatus: 'other_org_member'`, invitation `89f1cdcc-…` / projection `a33080e6-…`, role `Cypress Admin`). Sally accepted via Google OAuth. **Sally short-circuit verified end-to-end**: zero `user.created` events for `bab8077f-…` in acceptance window (the architectural property under test). `user.role.assigned` event clean (event `442087dd-…`, role `Cypress Admin`, org testorg). `invitation.accepted` event clean (`007d0afb-…`, roles array carries resolved `{role_id, role_name}`). DB: `invitations_projection.status='accepted'`, `accepted_at=00:52:12.044+00`. `user_roles_projection` for dakaratekid: 2 rows (existing liveforlife + new testorg). HAR start postdated acceptance by 245ms, hence no accept-invitation POST visible — DB evidence conclusive. |
| 6 | Re-invitation of soft-deleted user | ✅ PASS (with documented gap) | Soft-deleted `lars.tice+test@gmail.com` (`61cbb03f-…`) via UI `api.delete_user` (event `df88a0e0-…`, `deleted_at` set, projection clean). Re-invited same email (invitation `52a92337-…`, status `pending`, RPC response `emailStatus: "deactivated"` — pre-invite lookup correctly classified target). **Server-side `api.check_user_invitation_existence` truth table verified**: soft-deleted user → `{isDeleted: true, isExistingUser: false}` (correct — re-onboarding branch). Active user → `{isExistingUser: true}`. Nonexistent UUID → both false. Edge Function `!isExistingUser` branch logic + Deno unit tests close the rest. **Documented gap**: full HTTP-tier OAuth acceptance with `isDeleted=true` blocked by Google's `+alias`-not-an-identity constraint (test infrastructure limitation, not code-coverage). Pending invitation `52a92337-…` left in place (revoke needs explicit per-call auth and is harmless — will auto-expire 2026-05-19). |
| 7 | Reactivate regression check | ✅ PASS | UI reactivate on Test 1 target (`093c0e7b-…`). Envelope: `{success: true, operation: "reactivate", eventId: "5dccba5f-…", userId}`. DB: `users.is_active=true`, `updated_at=21:33:12` (advanced past Test 1's `21:09:02`); `domain_events` row `user.reactivated` with `processing_error=null`; `auth.users.banned_until=null` (LB1 unban applied). Legacy emit flow + Edge Function `serve` handler regression surface clean post-F1. |
| 8 | Partial failure — RPC succeeds, ban fails | ✅ PASS | Source-patched `manage-user/index.ts:412` to `ban_duration: 'UAT-TEST-8-INVALID-DURATION'`, deployed, Lars deactivated `+test2@gmail.com` (event `1c3d7459-…`). Envelope: `{success: true, ...}` (fail-open ✅). DB: `users.is_active=false`, `processing_error=null` (RPC clean), `auth.users.banned_until=null` (auth ban swallowed). Documented divergent state confirmed end-to-end. Source restored + function redeployed; verified `'876000h'` at L412. F2 architectural contract empirically proven. |

**History of previous UAT attempts** (PR #60, PR #61, PR #62):
- PR #60 UAT Test 1: ❌ failed with `Could not find the table 'api.users' in the schema cache`
- PR #61 UAT Test 1 (post-hotfix): ❌ failed AGAIN with `The schema must be one of the following: api`
- PR #62: lint-only fix; no UAT
- PR #63: ⏳ third attempt with SQL-RPC pivot; CI green; awaiting UAT

---

## Process discipline (template — apply to any Edge Function / _shared/ helper card)

Per the 2026-05-12 PR #60→#61 hotfix lesson (MEMORY.md "Pre-deploy ritual gap — config-dependent SDK behavior"), for tasks that touch Edge Functions or `_shared/` helpers:

- [x] **Deploy to dev + smoke against real Supabase + paste log evidence into this card BEFORE opening PR.** Smoke artifact validates SDK-boundary config (schema, RLS, GRANT, db.headers, auth) that local unit tests cannot. _Status for THIS card_: this discipline was first formalized DURING this card's hotfix cycle — the deactivate retrofit shipped without it, surfaced the schema-mismatch defect at UAT Test 1, and the template line is now codified here as the precedent for all future Edge Function cards. Reactivate retrofit (next card) must satisfy this BEFORE opening its PR.

## Cross-references

- Plan file: `~/.claude/plans/ddoes-it-make-sense-lucky-dongarra.md`
- Helper: `infrastructure/supabase/supabase/functions/_shared/rpc-readback.ts`
- Edge Function: `infrastructure/supabase/supabase/functions/manage-user/index.ts`
- Tests: `infrastructure/supabase/supabase/functions/manage-user/__tests__/deactivate-readback.test.ts`
- Frontend: `frontend/src/services/users/SupabaseUserCommandService.ts:305-362`
- ADR: `documentation/architecture/decisions/adr-rpc-readback-pattern.md`
