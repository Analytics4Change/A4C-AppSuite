# Plan: AsyncAPI Contract Drift + Event Processor Bugs

## Problem Summary

**Problem 0 (Contract Drift)**: TypeScript types in `types/events.ts` are stale - contain Zitadel references removed during Oct 2025 migration. No build-time validation exists to catch drift.

**Problem 1 (Column Mismatch)**: The `process_organization_event` PostgreSQL function tries to INSERT into column `org_type`, but the table `organizations_projection` has column `type`.

**Problem 2 (Missing Event)**: Workflow compensation doesn't emit `organization.bootstrap.failed` event, causing UI to show incorrect status.

## Solution Overview

1. **Phase 1**: Prepare AsyncAPI schemas for Modelina (add `title`, extract enums)
2. **Phase 2**: Configure Modelina type generation (scripts, CI)
3. **Phase 3**: Documentation updates
4. **Phase 4**: Add failed event emission to workflow (observe `org_type` bug)
5. **Phase 5**: Fix column name bug via migration

## Detailed Plan

See `/home/lars/.claude/plans/magical-scribbling-honey.md` for:
- Complete `generate-types.js` implementation
- Full `contracts-validation.yml` CI workflow
- All 41 enums to extract by category
- Package.json script updates
- Verification queries

## Key Architecture Decisions

1. **Enum Location**: `asyncapi/components/enums.yaml` (not `domains/`)
   - AsyncAPI best practice: reusable components in `components/` directory
   - Adjacent to existing `schemas.yaml`

2. **Generated File**: `types/generated-events.ts` (committed, not .gitignored)
   - Industry standard (like Prisma)
   - Enables code review of type changes
   - CI validates sync

3. **Modelina Configuration**:
   - `modelType: 'interface'` - Generates TypeScript interfaces
   - `enumType: 'enum'` - Generates proper enum types
   - Requires `title` on all schemas for named types

## Files to Create/Modify

| Phase | File | Action |
|-------|------|--------|
| P1 | `contracts/asyncapi/components/enums.yaml` | CREATE - 41 enum definitions |
| P1 | `contracts/asyncapi/domains/*.yaml` | MODIFY - Add title, $ref to enums |
| P2 | `contracts/scripts/generate-types.js` | CREATE - Modelina script |
| P2 | `contracts/package.json` | MODIFY - Add scripts |
| P2 | `contracts/types/generated-events.ts` | CREATE - Auto-generated |
| P2 | `.github/workflows/contracts-validation.yml` | CREATE - CI workflow |
| P3 | `documentation/.../CONTRACT-TYPE-GENERATION.md` | CREATE - Guide |
| P3 | `infrastructure/CLAUDE.md` | MODIFY - Add section |
| P3 | `.claude/skills/.../asyncapi-contracts.md` | MODIFY - Update patterns |
| P4 | `workflows/.../emit-bootstrap-failed.ts` | CREATE - Activity |
| P4 | `workflows/.../workflow.ts` | MODIFY - Call activity |
| P5 | `migrations/20260109XXXXXX_fix_org_type.sql` | CREATE - Bug fix |

## Verification

```bash
# After Phases 1-2
cd infrastructure/supabase/contracts
npm run check

# Verify named types generated
grep "interface OrganizationBootstrapFailureData" types/generated-events.ts
grep "enum BootstrapFailureStage" types/generated-events.ts
grep "AnonymousSchema" types/generated-events.ts  # Should return nothing

# After Phase 4
SELECT pg_get_functiondef(oid) FROM pg_proc
WHERE proname = 'process_organization_event'
  AND pg_get_functiondef(oid) LIKE '%org_type%';
-- Should return 0 rows
```

## Phase 6: Cleanup

- [ ] Delete `~/.claude/plans/magical-scribbling-honey.md` after all phases complete

## Risk Assessment

| Phase | Risk | Mitigation |
|-------|------|------------|
| P1-2 | Breaking imports | Generate to new file, migrate consumers gradually |
| P1-2 | Type name differences | Keep `events.ts` as re-export barrel initially |
| P4 | Workflow change | Additive only, doesn't affect happy path |
| P5 | Migration failure | CREATE OR REPLACE is atomic, test dry-run first |

## Estimated Effort

**Total: 9.5-12.5 hours**

- Phase 1 (AsyncAPI prep): 5-7 hours
- Phase 2 (Modelina config): 2-3 hours
- Phase 3 (Documentation): 1.5 hours
- Phase 4 (Workflow + observe bug): 1 hour
- Phase 5 (Migration fix): 30 min

## Plan Updates

**2026-01-09 (afternoon)**: Scope expanded from simple bug fix to comprehensive contract-first solution after discovering TypeScript types contained stale Zitadel references. User chose Option B (full Modelina auto-generation) over Option A (manual fix + drift detection). Plan reviewed and approved by software-architect-dbc agent.
