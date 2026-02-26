# Tasks: Frontend Dev-Guidelines Skill Remediation

## Phase 1: Update SKILL.md (Workstream A) ✅ COMPLETE

### Critical Fixes
- [x] C1: Rewrite Rule 9 — document `tracingFetch` automation in `supabase-ssr.ts:112-118`, note `TemporalWorkflowClient.ts` gap
- [x] C2: Add legacy cache warning to Rule 3 — callout about `supabase.service.ts` `getCurrentSession()`

### New Rules
- [x] M1: Add Rule 10 — Generated Event Types (`@/types/events`, never hand-write)
- [x] M2: Add Rule 11 — CQRS Write Path (event emission, reason field min 10 chars, `useEvents`, `ReasonInput`)
- [x] M5: Add Rule 12 — JWT Utility Deduplication (shared location, no per-service copies)
- [x] M6: Add Rule 13 — Structured Logging (`Logger.getLogger()`, no bare `console.log`)

### File Locations Table
- [x] M3: Rebuild File Locations table to match actual codebase structure
  - Added 12 component subdirs
  - Added `views/` directory
  - Added 19 service subdirs
  - Added `deployment.config.ts` and `dev-auth.config.ts` to auth config
  - Added `logging.config.ts` and `mobx.config.ts`

### Minor Fixes
- [x] m1: Align keyword list — removed `radix`/`tailwind`, added `dropdown`/`modal`/`forgot-password`/`password-reset`/`logging`/`viewmodel`
- [x] m2: Add 3 Deep Reference links (`mobx-patterns.md`, `ui-patterns.md`, `auth-provider-architecture.md`)
- [x] m3: Add ~300 line file size standard note
- [x] m4: Add Definition of Done section (`npm run docs:check`, typecheck, lint, build)

### Version: SKILL.md bumped from 2.0.0 → 3.0.0, 226 lines (under 250 limit)

## Phase 2: Fix Codebase Violations (Workstream B) ✅ COMPLETE

### Rule 7 — setTimeout-for-Focus (6 violations)
- [x] Fix `OrganizationUnitsManagePage.tsx:380` — replaced `setTimeout(() => el.focus(), 0)` with `requestAnimationFrame(() => el.focus())`
- [x] Fix `FocusTrappedCheckboxGroup.tsx:126-133` — migrated to `TIMINGS.focus.transitionDelay`
- [x] Fix `FocusTrappedCheckboxGroup.tsx:220-227` — migrated cancel handler focus
- [x] Fix `FocusTrappedCheckboxGroup.tsx:237-244` — migrated continue handler focus
- [x] Fix `FocusTrappedCheckboxGroup.tsx:316-319` — migrated header expand focus
- [x] Fix `FocusTrappedCheckboxGroup.tsx:391-393` — migrated checkbox ref focus
- [ ] Test all 5 FocusTrappedCheckboxGroup scenarios with keyboard-only navigation (manual, deferred)

### Rule 8 — Hardcoded Timing (3 violations)
- [x] Fix `EnhancedAutocompleteDropdown.tsx:218` — replaced `200` with `TIMINGS.dropdown.closeDelay`
- [x] Fix `BulkAssignmentDialog.tsx:299` — replaced `300` with `TIMINGS.debounce.default`
- [x] Fix `OrganizationTree.tsx:205` — replaced `500` with `TIMINGS.debounce.search`

### Rule 9 — Missing Correlation ID (1 violation)
- [x] Fix `TemporalWorkflowClient.ts:~113` — added `X-Correlation-ID` and `traceparent` headers via `generateCorrelationId()` and `generateTraceparentHeader()` from `@/utils/trace-ids`

### M4 — TreeSelectDropdown Decision Tree
- [x] Add `TreeSelectDropdown` to `frontend/CLAUDE.md` Component Selection Decision Tree (under "Hierarchical data?")

### Post-fix lint cleanup
- [x] Remove unused `TIMINGS` import from `OrganizationUnitsManagePage.tsx` (agent added it but used `requestAnimationFrame` instead)
- [x] Add eslint-disable for `TYPE_AHEAD_TIMEOUT` in `OrganizationTree.tsx` useCallback deps (module-level constant, false positive)

## Phase 3: Tech Debt (Workstream C) ✅ COMPLETE

### Consolidate decodeJWT() (M5 implementation)
- [x] Create `frontend/src/utils/jwt.ts` with shared `decodeJWT()` and `DecodedJWTClaims` interface (`{ org_id?: string; sub?: string }`)
- [ ] ~~Update `SupabaseAuthProvider.ts:530` to import from shared utility~~ — **SKIPPED**: Its `decodeJWT` returns rich `JWTClaims` type (12+ fields with defaults), throws on error, semantically part of auth provider contract — NOT the same function
- [x] Update `SupabaseUserQueryService.ts:1232` to import from shared utility (8 call sites)
- [x] Update `SupabaseUserCommandService.ts:701` to import from shared utility (1 call site)
- [x] Update `template.service.ts:33` to import from shared utility (3 call sites)
- [x] Update `ProductionOrganizationService.ts:27` to import from shared utility (2 call sites)
- [x] Verify all 4 services still function correctly (typecheck passes)

### Remove Legacy Session Cache
- [x] Verify no external callers of `getCurrentSession()` — confirmed zero external callers
- [x] `impersonation.service.ts` uses its OWN `getCurrentSession()`, not the one on `supabaseService` — no dependency
- [x] Remove `currentSession` property, `getCurrentSession()`, `updateAuthSession()`, and `Session` import from `supabase.service.ts`

### Remove Dead `.from()` Helpers
- [x] Grep confirmed zero external callers for all 4 methods
- [x] Remove `queryWithOrgScope()`, `insertWithOrgScope()`, `updateWithOrgScope()`, `deleteWithOrgScope()` from `supabase.service.ts`
- [x] Also removed `subscribeToChanges()` — zero callers, depended on removed `currentSession`
- [x] `supabase.service.ts` now contains only `getClient()` and `apiRpc()` — the two actively used methods

## Success Validation Checkpoints

### After Phase 1 ✅
- [x] SKILL.md has 13 rules (up from 9)
- [x] File Locations table covers all major directories
- [x] Keywords match AGENT-INDEX entries
- [x] Deep Reference includes all key docs
- [x] Definition of Done section present
- [x] No contradictions between SKILL.md and CLAUDE.md

### After Phase 2 ✅
- [x] `TemporalWorkflowClient.ts` includes `X-Correlation-ID` header
- [x] TreeSelectDropdown appears in CLAUDE.md decision tree
- [ ] Keyboard navigation still works in FocusTrappedCheckboxGroup (manual test — deferred)
- [x] `npm run typecheck` passes (zero errors)
- [x] `npm run lint` passes (zero errors on all changed files)

### After Phase 3 ✅
- [x] Single `decodeJWT()` in `frontend/src/utils/jwt.ts`
- [x] 4 of 5 `private decodeJWT` methods removed (SupabaseAuthProvider intentionally kept — different implementation)
- [x] No `getCurrentSession()` method in `supabase.service.ts`
- [x] No `queryWithOrgScope`/`insertWithOrgScope`/etc. in `supabase.service.ts`

## Current Status

**Phase**: All three phases complete
**Status**: ✅ COMPLETE — all code changes done, typecheck + lint clean
**Last Updated**: 2026-02-25
**Next Step**: Commit all changes, then archive dev-docs to `dev/archived/frontend-skill-remediation/`
**Outstanding**: Manual keyboard navigation testing of FocusTrappedCheckboxGroup (deferred — requires running app)
