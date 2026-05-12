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
- [ ] CI green
- [ ] **UAT against dev** (required merge gate — see PR description for the 7-scenario plan)
- [ ] Merge

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
