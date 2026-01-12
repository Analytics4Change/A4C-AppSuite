# Context: AsyncAPI Contract Drift + Event Processor Bugs

## Decision Record

**Date**: 2026-01-09
**Feature**: Fix AsyncAPI ↔ TypeScript type drift + org_type column bug + failed event emission
**Goal**: Establish contract-first type generation with Modelina, fix event processing bugs

### Scope Evolution

**Original Scope** (2026-01-09 morning):
- Fix column name `org_type` → `type` in event processor
- Add `organization.bootstrap.failed` event emission

**Expanded Scope** (2026-01-09 afternoon):
- During investigation, discovered TypeScript types in `types/events.ts` are stale (contain Zitadel references removed during Oct 2025 migration)
- User decided to address contract drift FIRST using Modelina auto-generation
- This became a 5-phase project with documentation updates

### Key Decisions

1. **Use Modelina for Type Generation** (2026-01-09)
   - Tested: Modelina CAN generate named types (not `AnonymousSchema_X`) IF:
     - All schemas have `title` property
     - Inline enums are extracted to standalone schemas with `$ref`
   - Confirmed via testing with test YAML files

2. **Centralize Enums in components/enums.yaml** (2026-01-09)
   - AsyncAPI best practice: reusable components in `components/` directory
   - Adjacent to existing `asyncapi/components/schemas.yaml`
   - 41 business enums to extract from inline definitions

3. **Commit Generated Files** (2026-01-09)
   - Output: `types/generated-events.ts` (committed, not .gitignored)
   - Industry standard (like Prisma)
   - CI validates types are in sync with spec

4. **Keep Original Bugs as Later Phases** (2026-01-09)
   - Phase 4: Fix `org_type` → `type` column
   - Phase 5: Add failed event emission
   - These are now downstream of the contract work

## Technical Context

### Problem 0: AsyncAPI ↔ TypeScript Contract Drift

**Discovery**: While investigating the `org_type` column bug, sourced the `OrganizationBootstrapFailureData` interface and found stale Zitadel references.

**Evidence**:
```typescript
// types/events.ts:441-452 (STALE)
export interface OrganizationBootstrapFailureData {
  failure_stage: 'zitadel_org_creation' | 'zitadel_user_creation' | ...;  // WRONG
  zitadel_org_id?: string;  // NOT IN ASYNCAPI
}

// organization.yaml:701-721 (CURRENT - correct)
OrganizationBootstrapFailureData:
  properties:
    failure_stage:
      enum: [organization_creation, dns_provisioning, admin_user_creation, ...]
    # NO zitadel_org_id
```

**Root Cause**: Types in `events.ts` are hand-crafted (per README) but weren't updated during Zitadel → Supabase Auth migration.

### Modelina Testing Results

**Test 1** (without `title`):
```
Generated: AnonymousSchema_1, AnonymousSchema_2, ...  (UNUSABLE)
```

**Test 2** (with `title` property):
```
Generated: TestEventData, NestedObject, StatusEnum   (CORRECT)
```

**Conclusion**: Adding `title` to schemas + extracting enums allows proper named type generation.

### Bug 1: Column Name Mismatch (Phase 4)

Migration `20260109020002_business_scoped_correlation_id.sql` line 78:
```sql
INSERT INTO organizations_projection (
  id, name, display_name, slug, org_type, ...  -- WRONG: should be 'type'
```

### Bug 2: Missing Failed Event (Phase 5)

Workflow compensation runs but doesn't emit `organization.bootstrap.failed` event.
- `get_bootstrap_status()` returns `'running'` instead of `'failed'`
- UI shows incorrect status

## File Structure

### New Files to Create

- `contracts/asyncapi/components/enums.yaml` - 41 business enum definitions
- `contracts/scripts/generate-types.js` - Modelina generation script
- `contracts/types/generated-events.ts` - Auto-generated TypeScript types
- `.github/workflows/contracts-validation.yml` - CI workflow
- `documentation/infrastructure/guides/supabase/CONTRACT-TYPE-GENERATION.md` - Guide
- `migrations/20260109XXXXXX_fix_org_type_column_name.sql` - Bug fix
- `workflows/src/activities/organization-bootstrap/emit-bootstrap-failed.ts` - Activity

### Files to Modify

- `contracts/asyncapi/domains/*.yaml` (15 files) - Add `title`, replace inline enums with `$ref`
- `contracts/package.json` - Add scripts: bundle, validate, generate:types, check
- `infrastructure/CLAUDE.md` - Add type generation section
- `.claude/skills/infrastructure-guidelines/resources/asyncapi-contracts.md` - Update patterns
- `documentation/AGENT-INDEX.md` - Add keywords
- `workflows/src/workflows/organization-bootstrap/workflow.ts` - Emit failed event

## Reference Materials

### Plan File
- `/home/lars/.claude/plans/magical-scribbling-honey.md` - Detailed implementation plan with code examples

### Related Dev-Docs
- `dev/active/oauth-invitation-acceptance-*.md` - Context where bug was discovered

### AsyncAPI Domain Files (15 files with enums to extract)
- `asyncapi/domains/organization.yaml` - OrganizationType, PartnerType, FailureStage, etc.
- `asyncapi/domains/user.yaml` - AuthMethod, InvitationMethod, AddressType, PhoneType
- `asyncapi/domains/client.yaml` - Gender, BloodType, AdmissionType, DischargeType
- `asyncapi/domains/medication.yaml` - ControlledSubstanceSchedule, MedicationForm, Route
- `asyncapi/domains/rbac.yaml` - ScopeType, AuthorizationType
- `asyncapi/domains/access_grant.yaml` - GrantScope, RevocationReason
- And 9 more domain files...

## Important Constraints

1. **All schemas MUST have `title` property** - Critical for Modelina named types
2. **Enums must be extracted** - Inline enums generate as anonymous types
3. **Use `../components/` relative path** - From domain files to components
4. **Generated types committed** - Not .gitignored, CI validates sync
5. **Worker redeploy required** - After Phase 4 workflow change
6. **Phase 5 requires explicit user approval** - Do NOT auto-execute; user wants to observe the bug first

## Why This Approach?

**Why Modelina over json-schema-to-typescript?**
- Native AsyncAPI support (no intermediate conversion)
- Already installed in project (`@asyncapi/modelina@5.10.1`)
- Official AsyncAPI Initiative tool
- Active maintenance (v5.2.3+)

**Why centralize enums in components/?**
- AsyncAPI best practice
- Adjacent to existing `schemas.yaml`
- Eliminates duplication (e.g., `AddressType` was defined in 3 places)

**Why commit generated files?**
- Visibility in code review
- Works without running generation locally
- Industry standard (Prisma, OpenAPI generators)
