# Tasks — Migrate Services to apiRpcEnvelope + Ship ESLint Rule

## Current Status

**Phase**: ACTIVE (2026-04-30)
**Status**: 🟢 READY — awaiting bandwidth
**Priority**: Medium

## Tasks

- [x] Card filed (2026-04-30) — spun out of PR #43 when v3 plan's B2 scope ballooned

### Phase 0 — Inventory

- [ ] Grep `frontend/src/services/` for `.schema('api').rpc(` and produce a complete call-site list grouped by service.
- [ ] Per service method, classify each call as envelope-shaped vs read-shape and record the current return-shape contract for verification.

### Phase 1 — Pilot service

- [ ] Migrate `SupabaseRoleService` envelope-shaped writes to `apiRpcEnvelope<T>`. Run typecheck + Vitest. PR-local commit message: `refactor(services): migrate role service to apiRpcEnvelope (1/N)`.

### Phase 2 — Bulk service migration

- [ ] `SupabaseUserCommandService` (envelope writes) — highest PHI surface.
- [ ] `SupabaseClientService` (envelope writes) — PHI: addresses, names, DOB.
- [ ] `SupabaseClientFieldService` (envelope writes).
- [ ] `SupabaseScheduleService` (envelope writes).
- [ ] `SupabaseOrganizationCommandService` (envelope writes).
- [ ] `SupabaseOrganizationEntityService` (envelope writes; resolve dynamic-name Q1).
- [ ] `SupabaseOrganizationUnitService` (envelope writes).
- [ ] `OrphanedDeletionService` (envelope writes).

### Phase 3 — Read-shape migration

- [ ] `SupabaseUserQueryService` reads → `supabaseService.apiRpc<T>(...)`.
- [ ] `SupabaseOrganizationQueryService` reads → `supabaseService.apiRpc<T>(...)`.

### Phase 4 — ESLint rule

- [ ] Replace placeholder comment in `frontend/eslint.config.js` with the actual `no-restricted-syntax` rule + file-level override allow-listing the 2 SDK files.
- [ ] Audit any test files that mock direct `.rpc()` calls (Q2) and either migrate the mocks or add to allow-list.

### Phase 5 — Verification

- [ ] `npm run typecheck` green for `frontend/`.
- [ ] `npm run lint` green with `--max-warnings 0`.
- [ ] `npm run build` green.
- [ ] All Vitest suites green.
- [ ] Manual smoke test on at least one envelope-shaped UI flow (role assignment / user update).
- [ ] PR opened referencing this card.
