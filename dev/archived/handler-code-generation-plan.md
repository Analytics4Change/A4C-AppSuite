# Implementation Plan: Handler Code Generation

## Executive Summary

Build a code generator that creates PL/pgSQL event handler functions from configuration, eliminating column name mismatches and enforcing CQRS compliance patterns. The generator targets ~60% of handlers (23 of 37) that follow templatable patterns, while explicitly marking complex handlers for manual implementation.

**Trigger**: Column name drift caused runtime failures (e.g., `org_id` vs table column). While plpgsql_check now catches these at CI time, code generation prevents drift entirely and documents event→projection mappings explicitly.

## Phase 1: Foundation

### 1.1 Configuration Schema Design
- Define YAML schema for handler configurations
- Support simple INSERT/UPDATE, conditional branching, soft deletes
- Mark complex handlers as `generated: false` with reason
- Validate schema with JSON Schema or TypeScript types

### 1.2 Generator Script Scaffold
- Create `infrastructure/supabase/scripts/generate-handlers.ts`
- Setup TypeScript compilation in scripts directory
- Add `npm run generate:handlers` command
- Integrate with existing generate-types.js patterns

**Expected outcome**: Working scaffold that can read YAML config and output SQL stubs.

## Phase 2: Core Generator

### 2.1 Simple Handler Templates
- INSERT with field mapping and ON CONFLICT
- UPDATE with COALESCE for optional fields
- Soft delete (UPDATE is_active = false)
- Timestamp compliance (use p_event.created_at, not NOW())

### 2.2 Conditional Handler Templates
- IF/ELSE on org_id (global vs org-specific tables)
- IF/ELSE on removal_type (soft vs hard delete)
- Generate both branches from config

### 2.3 Schema Validation
- Query information_schema via Supabase MCP or direct psql
- Validate all mapped columns exist in target table
- Fail generation if column mismatch detected

**Expected outcome**: Generator produces correct SQL for ~60% of handlers.

## Phase 3: Shadow Mode Validation

### 3.1 Generate to Separate Directory
- Output to `infrastructure/supabase/generated/handlers/`
- Don't modify migrations or current handlers

### 3.2 CI Comparison Pipeline
- Add GitHub Action to generate handlers
- Diff generated vs current handlers (in split_event_handlers migration)
- Report discrepancies without failing build (warning mode)

### 3.3 Manual Review & Iteration
- Fix generator bugs exposed by diff
- Refine templates until generated matches hand-written
- Document any intentional differences

**Expected outcome**: Generated handlers match current hand-written handlers.

## Phase 4: Production Adoption

### 4.1 Replace Simple Handlers
- Migrate 15 SIMPLE handlers to generated versions
- Deploy via new migration
- Verify event processing works

### 4.2 Replace Conditional Handlers
- Migrate 8 CONDITIONAL handlers to generated versions
- More careful testing (branching logic)

### 4.3 Document Complex Handlers
- Ensure all COMPLEX handlers have `generated: false` with clear reason
- These remain hand-written: ltree operations, jsonb_set, validation queries

**Expected outcome**: 60% of handlers generated, 40% documented as hand-written.

## Success Metrics

### Immediate
- [ ] Generator produces valid PL/pgSQL that passes plpgsql_check
- [ ] Generated handlers match current hand-written handlers (diff validation)

### Medium-Term
- [ ] Adding new simple handler = add YAML config (no SQL writing)
- [ ] CI warns if generated handlers drift from deployed

### Long-Term
- [ ] Zero column name mismatches in production
- [ ] Event→projection mappings documented in YAML

## Risk Mitigation

| Risk | Mitigation |
|------|------------|
| Generator bug breaks event processing | Shadow mode first; diff validation |
| Complex handlers can't be templated | Explicit `generated: false` marking |
| YAML config drifts from AsyncAPI | CI validates event_type exists in AsyncAPI |
| Adoption disrupts current workflow | Incremental: simple handlers first |

## Finalized Decisions

| Decision | Choice | Status |
|----------|--------|--------|
| Config location | **Separate YAML** | ✅ Confirmed |
| Initial scope | **SIMPLE + CONDITIONAL (63%, 23 handlers)** | ✅ Confirmed |
| Rollout mode | **Shadow mode first** | ✅ Confirmed |
| Priority | **Deferred to backlog** | ✅ Confirmed |
