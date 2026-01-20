# Tasks: Handler Code Generation

## Phase 1: Foundation ⏸️ PENDING

- [ ] Create `infrastructure/supabase/config/handlers/` directory
- [ ] Define YAML schema for handler configuration
- [ ] Create TypeScript types for handler config
- [ ] Create `infrastructure/supabase/scripts/generate-handlers.ts` scaffold
- [ ] Add `npm run generate:handlers` to package.json
- [ ] Test scaffold runs without errors

## Phase 2: Core Generator ⏸️ PENDING

- [ ] Implement SIMPLE handler template (INSERT with ON CONFLICT)
- [ ] Implement UPDATE handler template (with COALESCE)
- [ ] Implement soft delete template
- [ ] Implement CONDITIONAL handler template (IF/ELSE)
- [ ] Add schema validation via information_schema query
- [ ] Fail generation if column doesn't exist

## Phase 3: YAML Configuration ⏸️ PENDING

- [ ] Create `user-events.yml` (12 handlers)
- [ ] Create `organization-events.yml` (14 handlers)
- [ ] Create `organization-unit-events.yml` (5 handlers)
- [ ] Create `rbac-events.yml` (10 handlers)
- [ ] Mark complex handlers as `generated: false`

## Phase 4: Shadow Mode Validation ⏸️ PENDING

- [ ] Create `generated/handlers/` output directory
- [ ] Generate all handlers to output directory
- [ ] Create diff script vs current handlers
- [ ] Add CI step to report diffs
- [ ] Fix discrepancies until diff is clean

## Phase 5: Production Adoption ⏸️ PENDING

- [ ] Replace SIMPLE handlers (15) with generated
- [ ] Deploy and verify
- [ ] Replace CONDITIONAL handlers (8) with generated
- [ ] Deploy and verify
- [ ] Update documentation

## Success Validation Checkpoints

### After Phase 2
- [ ] Generated SQL passes plpgsql_check
- [ ] Schema validation catches column errors

### After Phase 4
- [ ] Generated handlers match hand-written (zero diff)

### After Phase 5
- [ ] Event processing works correctly
- [ ] New handler addable via YAML only

## Current Status

**Phase**: Pre-Phase 1 (Planning Complete)
**Status**: 📋 DEFERRED TO BACKLOG
**Last Updated**: 2026-01-20
**Scope**: SIMPLE + CONDITIONAL handlers (63%, 23 of 37 handlers)
**Config**: Separate YAML files
**Rollout**: Shadow mode when implemented
**Next Step**: Pick up from backlog when column drift becomes a recurring issue
