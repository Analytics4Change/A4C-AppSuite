# Context: Frontend Dev-Guidelines Skill Remediation

## Decision Record

**Date**: 2026-02-25
**Feature**: Remediate `.claude/skills/frontend-dev-guidelines/SKILL.md` based on architectural review
**Goal**: Bring skill accuracy and coverage from ~60% to ~90% by fixing inaccuracies, adding missing guard rails, and resolving codebase violations that undermine skill credibility.

### Key Decisions

1. **Three independent workstreams**: (A) SKILL.md updates, (B) codebase violation fixes, (C) tech debt. They can be executed in any order or in parallel.

2. **Skill stays concise**: New rules (10–13) follow the existing pattern — 3–5 lines + code example. The skill is a guard-rail summary, not a replacement for `frontend/CLAUDE.md`.

3. **FocusTrappedCheckboxGroup gets TIMINGS migration, not full useEffect refactor**: The 5 setTimeout sites in this component are tightly coupled to imperative DOM focus. Migrating to `TIMINGS.focus.transitionDelay` centralizes the value and makes tests instant. A full `useEffect` refactor would require significant component restructuring for marginal benefit.

4. **`decodeJWT()` consolidation is tech debt, not blocking**: All 5 copies are functionally identical. The skill will add guidance to prevent further duplication, but consolidation is Phase 3.

5. **Correlation ID rule documents automation**: The new Rule 9 will explain `tracingFetch` as the primary mechanism rather than describing manual header injection. This prevents agents from creating duplicate correlation ID logic.

## Technical Context

### Architecture

The `frontend-dev-guidelines` skill is one of several Claude Code skills in `.claude/skills/`. It's loaded automatically when agents work on frontend code. It provides condensed guard rails that reference the authoritative `frontend/CLAUDE.md` (1,265 lines) and `documentation/frontend/` (64 files) for detailed guidance.

The skill's purpose is preventing the most common and costly mistakes — not comprehensive coverage. The review found it covers the right high-risk areas but has drifted from the actual implementation in places.

### Skill Rule Structure (Current → Planned)

**Current 9 rules**:
1. MobX: Never spread observable arrays — ✅ accurate, 0 violations
2. MobX: Always observer() + runInAction() — ✅ accurate, 0 violations
3. Never cache sessions manually — ⚠️ accurate but missing legacy cache warning (C2)
4. CQRS: api. schema RPC only — ✅ accurate, 0 violations (read path only)
5. Auth: Use IAuthProvider interface — ✅ accurate, 0 violations
6. Accessibility: WCAG 2.1 Level AA — ✅ accurate, aspirational
7. Focus management: useEffect, not setTimeout — ✅ accurate, 6 codebase violations
8. Timing: centralized config — ✅ accurate, 3 codebase violations
9. Correlation ID: business-scoped — ❌ describes manual pattern, implementation is automated (C1)

**Planned 13 rules** (additions):
10. Generated Event Types — import from `@/types/events`, never hand-write (M1)
11. CQRS Write Path — event emission, reason field, useEvents hook (M2)
12. JWT Utility Deduplication — shared location, no per-service copies (M5)
13. Structured Logging — Logger.getLogger(), no bare console.log (M6)

### Dependencies

- `frontend/CLAUDE.md` — authoritative source; skill must not contradict it
- `documentation/AGENT-INDEX.md` — keyword index; skill keywords must align
- `documentation/frontend/guides/EVENT-DRIVEN-GUIDE.md` — write-path reference
- `frontend/src/config/timings.ts` — centralized timing values
- `frontend/src/lib/supabase-ssr.ts` — tracingFetch implementation
- `frontend/src/utils/logger.ts` — structured logging system

## File Structure

### Files to Modify (Workstream A — SKILL.md)

- `.claude/skills/frontend-dev-guidelines/SKILL.md` — primary target, ~150 lines of changes

### Files to Modify (Workstream B — Codebase Violations)

- `frontend/src/pages/organization-units/OrganizationUnitsManagePage.tsx:380` — setTimeout focus
- `frontend/src/components/ui/FocusTrappedCheckboxGroup/FocusTrappedCheckboxGroup.tsx:126,220,237,316,391` — 5 setTimeout focus sites
- `frontend/src/components/ui/EnhancedAutocompleteDropdown.tsx:218` — hardcoded 200ms
- `frontend/src/components/ui/assignment/BulkAssignmentDialog.tsx:299` — hardcoded debounce
- `frontend/src/components/organization/OrganizationTree.tsx:205` — hardcoded typeahead debounce
- `frontend/src/services/workflow/TemporalWorkflowClient.ts:~113` — missing correlation ID header
- `frontend/CLAUDE.md:~1160` — add TreeSelectDropdown to decision tree

### Files to Modify (Workstream C — Tech Debt, Future)

- `frontend/src/services/auth/supabase.service.ts` — remove legacy session cache + dead `.from()` helpers
- `frontend/src/services/auth/SupabaseAuthProvider.ts:530` — replace local decodeJWT
- `frontend/src/services/users/SupabaseUserQueryService.ts:1232` — replace local decodeJWT
- `frontend/src/services/users/SupabaseUserCommandService.ts:701` — replace local decodeJWT
- `frontend/src/services/medications/template.service.ts:33` — replace local decodeJWT
- `frontend/src/services/organization/ProductionOrganizationService.ts:27` — replace local decodeJWT
- `frontend/src/utils/jwt.ts` — NEW: shared decodeJWT utility

## Codebase Audit Results (Full Detail)

### Rule-by-Rule Compliance

| Rule | Violations | Details |
|------|------------|---------|
| 1. No array spreading | 0 | All observable arrays passed directly in props. `.slice()` used only for sort comparison in `UserFormViewModel.ts:218` |
| 2. observer() + runInAction() | 0 | All 54 components reading observables wrapped with `observer()`. `runInAction()` used extensively in all ViewModels |
| 3. No session caching | 0 active | Legacy `currentSession` + `getCurrentSession()` in `supabase.service.ts` exists but no data service calls it |
| 4. api. schema RPC only | 0 | 35+ `.schema('api').rpc()` call sites. Dead `.from()` helpers exist in `supabase.service.ts` but no callers |
| 5. IAuthProvider interface | 0 | `SupabaseAuthProvider` only instantiated in `AuthProviderFactory.ts`. `getAuthProvider()` used correctly |
| 6. WCAG 2.1 AA | Partial | Not verifiable from static analysis alone |
| 7. Focus via useEffect | 6 | See files list above |
| 8. Centralized timing | 3 | See files list above |
| 9. Correlation ID | 1 | `TemporalWorkflowClient.ts` fetch() missing `x-correlation-id` header |

### Correlation ID Implementation Detail

The actual implementation uses `tracingFetch` in `frontend/src/lib/supabase-ssr.ts:112-118`:
```typescript
// Inject tracing headers if not already present
if (!existingHeaders['X-Correlation-ID'] && !existingHeaders['x-correlation-id']) {
  existingHeaders['X-Correlation-ID'] = generateCorrelationId();
}
if (!existingHeaders['traceparent']) {
  existingHeaders['traceparent'] = generateTraceparentHeader();
}
```
This is injected into the Supabase client's `global.fetch`, so ALL Supabase requests automatically get correlation IDs. Only direct `fetch()` calls (like `TemporalWorkflowClient.ts`) bypass this.

### JWT Duplication Detail

All 5 `decodeJWT()` copies are functionally identical:
```typescript
private decodeJWT(token: string): DecodedJWTClaims {
  try {
    const payload = token.split('.')[1];
    return JSON.parse(globalThis.atob(payload));
  } catch {
    return {};
  }
}
```
Comments in 4 of the 5 copies say "Uses same approach as `SupabaseAuthProvider.decodeJWT()`."

### File Locations Gaps Detail

**Components** (skill lists 4, actual has 13+):
- Listed: `ui/`, `auth/`, `medication/`, `layouts/`
- Missing: `debug/`, `navigation/`, `organization/`, `organizations/`, `organization-units/`, `roles/`, `schedules/`, `users/`

**Services** (skill lists 3, actual has 18+):
- Listed: `api/`, `auth/`, `data/`
- Missing: `adapters/`, `admin/`, `assignment/`, `cache/`, `direct-care/`, `http/`, `invitation/`, `medications/`, `mock/`, `organization/`, `roles/`, `schedule/`, `search/`, `storage/`, `users/`, `validation/`, `workflow/`

**Auth config** (skill lists 1, actual has 3+):
- Listed: `oauth.config.ts`
- Missing: `deployment.config.ts` (smart auth detection — this is the KEY file), `dev-auth.config.ts` (mock profiles), `oauth-providers.config.ts`

**Entirely absent**: `frontend/src/views/` directory (contains `client/`, `medication/`)

### Keyword Misalignment Detail

**In skill, NOT in AGENT-INDEX**: `radix`, `tailwind`
**In AGENT-INDEX, NOT in skill**: `dropdown`, `modal`, `forgot-password`, `password-reset`, `logging`, `viewmodel`

### Missing Deep Reference Links

- `documentation/frontend/patterns/mobx-patterns.md` — Advanced MobX patterns (ViewModel Provider, command pattern, state machines)
- `documentation/frontend/patterns/ui-patterns.md` — Modal architecture, focus management, dropdown/autocomplete patterns
- `documentation/frontend/architecture/auth-provider-architecture.md` — IAuthProvider interface, DI patterns (frontend-specific, vs the cross-cutting auth doc already linked)
- `documentation/frontend/testing/TESTING.md` — Testing strategies
- `documentation/frontend/performance/mobx-optimization.md` — MobX performance optimization

## Important Constraints

1. **SKILL.md must stay concise** — it's a guard-rail document, not comprehensive reference. Each rule should be 3–8 lines + 1 code example. Total file should stay under 250 lines.

2. **No contradictions with CLAUDE.md** — the skill is a subset of CLAUDE.md. Any rule in the skill must be consistent with the fuller treatment in CLAUDE.md.

3. **Codebase fixes must preserve keyboard navigation** — the FocusTrappedCheckboxGroup setTimeout sites exist for a reason (ensuring DOM updates before focus moves). Any refactor must be tested with keyboard-only navigation.

4. **Correlation ID header format must match `tracingFetch`** — use `X-Correlation-ID` (capital case) for consistency.

## Implementation Notes (2026-02-25)

### Phase 3 Deviation: SupabaseAuthProvider.decodeJWT() kept in place
The original plan listed 5 `decodeJWT()` copies as identical. During implementation, the Phase 3 agent correctly identified that `SupabaseAuthProvider.decodeJWT()` is NOT the same — it returns the rich `JWTClaims` type (12+ fields with defaults), throws on error instead of returning `{}`, and is semantically part of the auth provider contract. Only 4 of 5 were consolidated.

### Phase 2 Deviation: BulkAssignmentDialog path
The plan listed `frontend/src/components/ui/assignment/BulkAssignmentDialog.tsx` but actual path is `frontend/src/components/roles/BulkAssignmentDialog.tsx`. The agent found the correct file.

### Phase 2 Deviation: OrganizationTree path
The plan listed `frontend/src/components/organization/OrganizationTree.tsx` but actual path is `frontend/src/components/organization-units/OrganizationTree.tsx`. The agent found the correct file.

### Phase 3: supabase.service.ts cleanup scope
5 methods removed (not 4): `queryWithOrgScope`, `insertWithOrgScope`, `updateWithOrgScope`, `deleteWithOrgScope`, plus `subscribeToChanges` (also dead, depended on removed `currentSession`). File now contains only `getClient()` and `apiRpc()`.

### Post-agent lint fixes
Two lint issues from Phase 2 agent fixed in main conversation:
1. Unused `TIMINGS` import in `OrganizationUnitsManagePage.tsx` — agent imported it but used `requestAnimationFrame` instead
2. `react-hooks/exhaustive-deps` warning in `OrganizationTree.tsx` — `TYPE_AHEAD_TIMEOUT` is a module-level constant, added eslint-disable comment

### TemporalWorkflowClient correlation ID
Agent created `frontend/src/utils/trace-ids.ts` with `generateCorrelationId()` and `generateTraceparentHeader()` for the direct `fetch()` call, matching the pattern in `supabase-ssr.ts`.

## Why This Approach?

**Why three workstreams?** They're independent with different risk profiles:
- Workstream A (docs) is zero-risk and can ship immediately
- Workstream B (code fixes) requires testing but is straightforward
- Workstream C (tech debt) is lower priority and can wait

**Why not rewrite the skill from scratch?** Rules 1–5 are excellent — zero violations, well-written, concise. Preserving them maintains continuity.

**Why add 4 new rules instead of just linking to CLAUDE.md?** The skill's value is that agents see guard rails without reading 1,265 lines. Missing critical patterns (event types, write path) defeats that purpose. The new rules follow the existing concise format.
