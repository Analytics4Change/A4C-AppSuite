# Tasks — Migrate Services to apiRpcEnvelope + Ship ESLint Rule

## Current Status

**Phase**: PR-A in progress (2026-05-11)
**Status**: 🟢 ACTIVE
**Priority**: Medium
**Branch**: `refactor/migrate-services-to-api-rpc-envelope`

## Plan reference

`~/.claude/plans/ddoes-it-make-sense-lucky-dongarra.md` (v2, post-architect-review) and `inventory.md` in this directory.

## Open question resolutions (Phase 0)

- **Q1 (dynamic RPC names)**: Solved by `rpcName: EnvelopeRpcs` typing on `SupabaseOrganizationEntityService.callEntityRpc`. The 9 public methods continue passing static literals; TypeScript narrows without `as const`. No `eslint-disable` needed.
- **Q2 (test mocks)**: Refactor `SupabaseClientFieldService.test.ts:14-20` to mock `supabaseService.apiRpc` / `apiRpcEnvelope` mirroring `SupabaseUserCommandService.mapping.test.ts:18-47`. Confirmed mechanical.
- **Q3 (dead `@/lib/supabase` imports)**: Drop per-file if unused after migration.
- **Q4 (ESLint lifecycle)**: Accept the window (user controls cadence). PR-A and PR-B leave eslint config untouched; PR-C activates the rule.
- **Q5 (`.single<T>()` site)**: Refactor `getOrganizationSubdomainInfo.ts:54-55` in place to `apiRpc<Organization[]>(...)` + `data?.[0] ?? null`. UUID lookup makes multi-row case impossible.
- **Q6 (Schedule throw-vs-return)**: Preserve throw-on-`!success` for `parseOrThrow` methods; preserve return-on-failure for `parseRpcResult` methods.
- **Q7 (ESLint selector scope)**: Selector matches any `.schema(*).rpc(...)`. Repo has zero non-`api` schema RPC calls today — comment notes the assumption.

## Tasks

- [x] Card filed (2026-04-30) — spun out of PR #43 when v3 plan's B2 scope ballooned

### Phase 0 — Inventory

- [x] Grep `frontend/src/services/` for `.schema('api').rpc(` and produce a complete call-site list grouped by service.
- [x] Per service method, classify each call as envelope-shaped vs read-shape via M3 registry (source of truth) and record current return-shape contract.
- [x] Persist as `inventory.md` in this directory (85 sites across 11 service files, 65 env + 20 read).

### Phase 1 — Pilots (PR-A)

- [x] `SupabaseOrganizationEntityService.ts` (1 envelope site via `callEntityRpc` wrapper). Re-typed `rpcName: EnvelopeRpcs`; all 9 callers continue passing static literals.
- [x] `SupabaseRoleService.ts` (5 envelope + 8 read = 13 sites). All read methods preserve throw-on-error contract. `bulkAssignRole` and `sync_role_assignments` correctly classified as read per registry (agent inventory had these as envelope; M3 registry is authoritative).
- [x] `envelope.ts` — added `count?: number` to `EnvelopeErrorDetails` (preserves real-world contract used by `OrganizationUnitsManagePage.tsx:562` cannot-delete dialog; minimal scope addition).
- [ ] Verify: typecheck + tests + build
- [ ] Commit, push, open PR-A

### Phase 2 — Bulk wave (PR-B)

- [ ] `SupabaseOrganizationCommandService.ts` (4 env) — handle `{data: result, error}` destructure variant
- [ ] `SupabaseOrganizationUnitService.ts` (5 env + 2 read)
- [ ] `SupabaseClientFieldService.ts` (13 env + 1 read) + Q2 test-mock refactor at `__tests__/SupabaseClientFieldService.test.ts`
- [ ] `SupabaseScheduleService.ts` (9 env + 2 read) — preserve throw-on-failure contract for `parseOrThrow` methods (Q6)
- [ ] `SupabaseDirectCareSettingsService.ts` (1 env + 1 read) — verify v1 path is dead before deleting dual-shape parse at L84-95
- [ ] `SupabaseAssignmentService.ts` (2 env + 1 read)

### Phase 3 — Closeout + rule (PR-C)

- [ ] `SupabaseClientService.ts` (25 env) — replace `parseResponse` with direct `apiRpcEnvelope` consumption
- [ ] `SupabaseOrganizationQueryService.ts` (4 read)
- [ ] `getOrganizationSubdomainInfo.ts` (1 read) — refactor in place per Q5
- [ ] Pre-merge inventory refresh — `grep -rEn ".schema\(['\"]api['\"]\)\.rpc" frontend/src/` + multi-line grep
- [ ] Activate ESLint rule at `frontend/eslint.config.js:124-131` + files-glob override for SDK helpers
- [ ] Confirm `npm run lint -- --max-warnings 0` green

### Phase 4 — Verification (per PR)

- [ ] `cd frontend && npm run typecheck` green
- [ ] `cd frontend && npm run test -- --run` green
- [ ] `cd frontend && npm run build` green
- [ ] PR-C only: `cd frontend && npm run lint` green with `--max-warnings 0`
- [ ] Manual smoke on one envelope flow per PR

## Cross-references

- Plan file: `~/.claude/plans/ddoes-it-make-sense-lucky-dongarra.md`
- Inventory artifact: `./inventory.md`
- Origin PR: PR #43 (HIPAA PII sanitization)
- ADR: `documentation/architecture/decisions/adr-rpc-readback-pattern.md` § PII handling
- Service-side conventions: `frontend/src/services/CLAUDE.md` §3
