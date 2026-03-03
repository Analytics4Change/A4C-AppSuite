# Remediate Frontend Guidelines — Seed Findings

## Source

Audit of Organization Manage Page Phases 3–6 against `.claude/skills/frontend-dev-guidelines/SKILL.md` (13 rules).
Audit date: 2026-02-25.

---

## F1: Hard-coded mock delays (Rule 8) — LOW / Pre-existing tech debt

**Pattern**: `Math.random() * 200 + 100` hard-coded in `simulateDelay()` across mock services.

**Phase 3 files**:
- `frontend/src/services/organization/MockOrganizationQueryService.ts:192`
- `frontend/src/services/organization/MockOrganizationEntityService.ts:93`
- `frontend/src/services/organization/MockOrganizationCommandService.ts:20`

**Pre-existing occurrences (same pattern, 12 additional services)**:
- `frontend/src/services/organization/MockOrganizationUnitService.ts:250`
- `frontend/src/services/roles/MockRoleService.ts:297`
- `frontend/src/services/schedule/MockScheduleService.ts:488`
- `frontend/src/services/users/MockUserCommandService.ts:120`
- `frontend/src/services/users/MockUserQueryService.ts:590`
- `frontend/src/services/assignment/MockAssignmentService.ts:75`
- `frontend/src/services/direct-care/MockDirectCareSettingsService.ts:68`
- `frontend/src/services/mock/MockClientApi.ts:82` (fixed ms param variant)
- `frontend/src/services/mock/MockMedicationApi.ts:114` (fixed ms param variant)

**Total**: 15 mock services with hard-coded delays.

**`TIMINGS` config** (`frontend/src/config/timings.ts`): Has no `mock` or `simulatedLatency` key. Would need to be added.

**Recommendation**: Add `TIMINGS.mock.simulatedLatency` (or similar) to `timings.ts`, then update all 15 services. Single cross-cutting ticket.

---

## F2: `console.log` in workflows bootstrap handler (Rule 13) — LOW / Pre-existing

**File**: `workflows/src/api/routes/workflows.ts:94,99`

```
console.log('[Bootstrap] Getting Supabase client...');
console.log(`[Bootstrap] Generated organization ID: ${organizationId}`);
```

**Context**: Pre-existing bootstrap POST handler. The Phase 5 DELETE endpoint on the same file correctly uses `request.log.info()` (Fastify structured logger).

**Recommendation**: Replace `console.log` with `request.log.info()` in the bootstrap handler for consistency.

---

## F3: File size — MockOrganizationQueryService.ts (439 lines) — INFO

**File**: `frontend/src/services/organization/MockOrganizationQueryService.ts`

**Guideline**: ~300 lines per file.

**Context**: Bulk is mock data arrays (lines 23–180). Reference `MockRoleService.ts` is 850+ lines, `MockUserCommandService.ts` is 785+ lines. Accepted pattern for mock services embedding test data.

**Recommendation**: No action required. If desired, extract `MOCK_ORGANIZATIONS` array to `mocks/organization-mock-data.ts`.

---

## F4: File size — OrganizationManageFormViewModel.ts (570 lines) — INFO

**File**: `frontend/src/viewModels/organization/OrganizationManageFormViewModel.ts`

**Guideline**: ~300 lines per file.

**Context**: Manages org fields + 9 entity CRUD operations via shared `performEntityOperation` helper. Reference `RoleFormViewModel.ts` is 790 lines. The guideline explicitly allows exceeding 300 when splitting would hurt readability.

**Recommendation**: No action required. Entity CRUD is already well-abstracted via the shared helper pattern.
