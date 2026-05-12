# Tasks — manage-user-deactivate Pattern A v2 retrofit

## Current Status

**Phase**: Implementation complete; awaiting CI + review + merge
**Status**: 🟢 PR-ready
**Branch**: `feat/manage-user-deactivate-pattern-a-v2-retrofit`

## Plan reference

`~/.claude/plans/ddoes-it-make-sense-lucky-dongarra.md` (post-architect-review)

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

- [ ] Seed `manage-user-reactivate-pattern-a-v2-retrofit/` card after this PR merges. Will reuse `_shared/rpc-readback.ts` with `expectedState: { is_active: true }`.

## Cross-references

- Plan file: `~/.claude/plans/ddoes-it-make-sense-lucky-dongarra.md`
- Helper: `infrastructure/supabase/supabase/functions/_shared/rpc-readback.ts`
- Edge Function: `infrastructure/supabase/supabase/functions/manage-user/index.ts`
- Tests: `infrastructure/supabase/supabase/functions/manage-user/__tests__/deactivate-readback.test.ts`
- Frontend: `frontend/src/services/users/SupabaseUserCommandService.ts:305-362`
- ADR: `documentation/architecture/decisions/adr-rpc-readback-pattern.md`
