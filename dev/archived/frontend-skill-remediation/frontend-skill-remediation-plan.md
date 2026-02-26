# Implementation Plan: Frontend Dev-Guidelines Skill Remediation

## Executive Summary

An architectural review of `.claude/skills/frontend-dev-guidelines/SKILL.md` revealed that while Rules 1–5 (MobX, sessions, CQRS reads, auth) are production-quality with zero codebase violations, the remaining rules and supporting sections have critical inaccuracies, major omissions, and stale references. The codebase itself violates Rules 7, 8, and 9 in 10 call sites across 6 files.

This remediation brings the skill from ~60% to ~90% coverage of what an agent needs for safe autonomous frontend development, and fixes the codebase violations that undermine the skill's credibility.

## Phase 1: Update SKILL.md (Workstream A — Documentation Only)

### 1.1 Fix Critical Findings (C1, C2)

**C1 — Rewrite Rule 9 (Correlation ID)**:
- Current rule describes manual `crypto.randomUUID()` + header injection per request
- Actual implementation: `tracingFetch` wrapper in `frontend/src/lib/supabase-ssr.ts:112-118` auto-injects `X-Correlation-ID` on all Supabase requests
- Rewrite to document `tracingFetch` as primary path, retain business-scoped concept
- Note the one gap: `TemporalWorkflowClient.ts` direct `fetch()` needs manual headers

**C2 — Add legacy cache warning to Rule 3**:
- `frontend/src/services/auth/supabase.service.ts` has `currentSession` cache + `getCurrentSession()` method
- Not used by data services but an agent could copy the pattern
- Add explicit callout: "Do NOT use `getCurrentSession()` in new code"

### 1.2 Add Missing Rules (M1, M2, M5, M6)

**New Rule 10 — Generated Event Types**:
- Always import from `@/types/events` (re-exports from generated)
- Never hand-write event interfaces; they are auto-generated from AsyncAPI
- Reference `frontend/CLAUDE.md` Generated Event Types section

**New Rule 11 — CQRS Write Path**:
- All mutations go through event emission
- Mandatory `reason` field (minimum 10 characters)
- Use `useEvents` hook and `ReasonInput` component
- Batch emission pattern for multi-entity operations
- Reference `documentation/frontend/guides/EVENT-DRIVEN-GUIDE.md`

**New Rule 12 — JWT Utility Deduplication**:
- Import JWT parsing from a shared location
- Do NOT duplicate `decodeJWT()` in individual services
- Flag existing 5 copies as tech debt

**New Rule 13 — Structured Logging**:
- Use `Logger.getLogger(category)` for all logging
- Never bare `console.log` in committed code
- Reference logging categories and debug panel shortcuts

### 1.3 Rebuild File Locations Table (M3)

Current table lists ~30% of actual directories. Rebuild to include:
- **Components**: Add organization/, organizations/, organization-units/, roles/, schedules/, users/, debug/, navigation/
- **Views**: Add `frontend/src/views/` (client/, medication/) — currently missing entirely
- **Services**: Add organization/, users/, schedule/, invitation/, workflow/, roles/, admin/, assignment/, medications/, storage/
- **Auth config**: Add `deployment.config.ts` (smart detection), `dev-auth.config.ts` (mock profiles)
- **Logging config**: Add `logging.config.ts`, `mobx.config.ts`

### 1.4 Fix Minor Findings (m1–m4)

**m1 — Align keyword list**: Remove `radix`, `tailwind` (no AGENT-INDEX entries). Add `dropdown`, `modal`, `forgot-password`, `password-reset`, `logging`, `viewmodel`.

**m2 — Add Deep Reference links**:
- `documentation/frontend/patterns/mobx-patterns.md`
- `documentation/frontend/patterns/ui-patterns.md`
- `documentation/frontend/architecture/auth-provider-architecture.md`

**m3 — Add file size standard**: ~300 lines per file, split when exceeding.

**m4 — Add Definition of Done**: `npm run docs:check`, `npm run typecheck`, `npm run lint`, `npm run build`, zero violations.

**Estimated scope**: Single file (SKILL.md), ~150 lines of net changes.

## Phase 2: Fix Codebase Violations (Workstream B — Code Changes)

### 2.1 Fix setTimeout-for-Focus Violations (Rule 7) — 6 Sites

| File | Line(s) | Current | Fix |
|------|---------|---------|-----|
| `OrganizationUnitsManagePage.tsx` | 380 | `setTimeout(() => el.focus(), 0)` | `useEffect` with dependency on create-mode state |
| `FocusTrappedCheckboxGroup.tsx` | 126–133 | `setTimeout(() => el.focus(), 50)` | Use `TIMINGS.focus.transitionDelay` via `useFocusAdvancement` hook |
| `FocusTrappedCheckboxGroup.tsx` | 220–227 | `setTimeout(() => el.focus(), 50)` | Same — cancel handler focus |
| `FocusTrappedCheckboxGroup.tsx` | 237–244 | `setTimeout(() => el.focus(), 50)` | Same — continue handler focus |
| `FocusTrappedCheckboxGroup.tsx` | 316–319 | `setTimeout(() => el.focus(), 50)` | Same — header expand focus |
| `FocusTrappedCheckboxGroup.tsx` | 391–393 | `setTimeout(() => el.focus(), 0)` | Same — checkbox ref focus |

**Approach**: For `FocusTrappedCheckboxGroup`, the `setTimeout` calls can be migrated to use `TIMINGS.focus.transitionDelay` at minimum (centralizing the value), or fully refactored to `useEffect` where the trigger is a state change. The 0ms delays are likely ensuring DOM updates complete — `requestAnimationFrame` or `useEffect` with the right dependency is the correct React pattern.

### 2.2 Fix Hardcoded Timing Violations (Rule 8) — 3 Sites

| File | Line | Current | Fix |
|------|------|---------|-----|
| `EnhancedAutocompleteDropdown.tsx` | 218 | `200` (blur delay) | `TIMINGS.dropdown.closeDelay` |
| `BulkAssignmentDialog.tsx` | 299 | Hardcoded debounce | `TIMINGS.debounce.search` or `TIMINGS.debounce.default` |
| `OrganizationTree.tsx` | 205 | Hardcoded typeahead debounce | `TIMINGS.debounce.search` |

### 2.3 Fix Missing Correlation ID Header (Rule 9) — 1 Site

| File | Line | Current | Fix |
|------|------|---------|-----|
| `TemporalWorkflowClient.ts` | ~113 | Direct `fetch()` without tracing headers | Add `X-Correlation-ID` and `traceparent` headers to the `fetch()` call |

### 2.4 Add TreeSelectDropdown to Decision Tree (M4)

Update `frontend/CLAUDE.md` Component Selection Decision Tree to include:
```
├── Hierarchical data? → TreeSelectDropdown
```
Reference: `frontend/src/components/ui/TreeSelectDropdown.tsx`

**Estimated scope**: 6 files, ~50 lines of changes.

## Phase 3: Tech Debt (Workstream C — Future)

### 3.1 Consolidate Duplicated `decodeJWT()` — 5 Files

Extract shared utility from:
1. `frontend/src/services/auth/SupabaseAuthProvider.ts:530`
2. `frontend/src/services/users/SupabaseUserQueryService.ts:1232`
3. `frontend/src/services/users/SupabaseUserCommandService.ts:701`
4. `frontend/src/services/medications/template.service.ts:33`
5. `frontend/src/services/organization/ProductionOrganizationService.ts:27`

Create `frontend/src/utils/jwt.ts` with shared `decodeJWT()`. Update all 5 consumers.

### 3.2 Remove Legacy Session Cache

Remove from `frontend/src/services/auth/supabase.service.ts`:
- `private currentSession: Session | null` property
- `getCurrentSession()` method
- `updateSession()` method (if it exists)
- Verify no callers remain (audit confirmed: only internal + `impersonation.service.ts`)

### 3.3 Remove Dead `.from()` Helpers

Remove from `supabase.service.ts`:
- `queryWithOrgScope()` — no external callers found
- `insertWithOrgScope()` — no external callers found
- `updateWithOrgScope()` — no external callers found
- `deleteWithOrgScope()` — no external callers found

**Estimated scope**: 6 files, ~200 lines removed, ~30 lines added.

## Success Metrics

### Immediate (After Phase 1)
- [ ] SKILL.md has 13 rules (up from 9)
- [ ] File Locations table reflects actual directory structure
- [ ] Keywords align with AGENT-INDEX entries
- [ ] Deep Reference section has all key documentation links

### Medium-Term (After Phase 2)
- [ ] Zero setTimeout-for-focus violations in codebase
- [ ] Zero hardcoded timing values outside `timings.ts`
- [ ] All fetch() calls include correlation ID headers
- [ ] TreeSelectDropdown appears in CLAUDE.md decision tree
- [ ] Codebase compliance: 9/9 rules passing (up from 5/9)

### Long-Term (After Phase 3)
- [ ] Single `decodeJWT()` utility shared across all services
- [ ] No legacy session cache in `supabase.service.ts`
- [ ] No dead `.from()` helper methods

## Risk Mitigation

| Risk | Mitigation |
|------|------------|
| FocusTrappedCheckboxGroup refactor breaks keyboard navigation | Test all 5 focus scenarios manually with keyboard-only navigation before and after |
| Removing `.from()` helpers breaks undiscovered callers | Grep entire codebase for `queryWithOrgScope`, `insertWithOrgScope`, etc. before removal |
| `decodeJWT()` consolidation changes behavior subtly | All 5 copies have identical logic — diff to confirm before extracting |
| SKILL.md becomes too long with 4 new rules | Keep new rules concise (3–5 lines each with code example) — aim for <250 total lines |

## Next Steps After Completion

1. Run the same architectural review process on `infrastructure-guidelines` and `temporal-workflow-guidelines` skills
2. Consider automated skill-vs-codebase drift detection (grep-based CI check)
3. Archive this dev-doc set to `dev/archived/frontend-skill-remediation/`
