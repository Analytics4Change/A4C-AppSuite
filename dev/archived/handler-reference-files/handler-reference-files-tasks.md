# Tasks: Handler Reference Files

## Phase 1: Extract Functions from Database ⏸️ PENDING

- [ ] Query `pg_get_functiondef()` for `process_domain_event()` (main dispatcher)
- [ ] Query `pg_get_functiondef()` for 4 trigger-related functions (`handle_bootstrap_workflow`, `enqueue_workflow_from_bootstrap_event`, `notify_workflow_worker_bootstrap`, `update_workflow_queue_projection_from_event`)
- [ ] Query `pg_get_functiondef()` for all 12 active routers that exist in DB (`process_user_event`, `process_organization_event`, `process_organization_unit_event`, `process_rbac_event`, `process_contact_event`, `process_address_event`, `process_phone_event`, `process_email_event`, `process_invitation_event`, `process_access_grant_event`, `process_impersonation_event`, `process_junction_event`)
- [ ] Query `pg_get_functiondef()` for all 51 `handle_*` functions
- [ ] Confirm 4 missing routers (`process_client_event`, `process_medication_event`, `process_medication_history_event`, `process_dosage_event`) are absent — these get removed from dispatcher in Phase 4

## Phase 2: Create Directory Structure and Files ⏸️ PENDING

- [ ] Create directory tree: `infrastructure/supabase/handlers/{trigger,routers,user,organization,organization_unit,rbac,bootstrap,invitation}/`
- [ ] Write `trigger/process_domain_event.sql` (main dispatcher)
- [ ] Write 4 trigger function files in `trigger/`
- [ ] Write 12 active router files in `routers/`
- [ ] Write 16 user handler files in `user/`
- [ ] Write 10 organization handler files in `organization/`
- [ ] Write 5 organization_unit handler files in `organization_unit/`
- [ ] Write 9 rbac handler files in `rbac/`
- [ ] Write 3 bootstrap handler files in `bootstrap/`
- [ ] Write 1 invitation handler file in `invitation/`
- [ ] Create `handlers/README.md` with purpose, sync rules, file conventions

## Phase 3: Update Agent Instructions ⏸️ PENDING

- [ ] Update `infrastructure/CLAUDE.md`: add "Handler Reference Files" subsection, update counts (51 handlers, 16 routers, 5 triggers)
- [ ] Update `.claude/skills/infrastructure-guidelines/SKILL.md`: add rule 7b
- [ ] Update `documentation/infrastructure/patterns/event-handler-pattern.md`: add reference file section, verify counts
- [ ] Update `documentation/AGENT-INDEX.md`: add `handler-reference` keyword entry

## Phase 4: Clean Up Dispatcher Dead Code ⏸️ PENDING

- [ ] Create migration: remove 4 dead CASE branches from `process_domain_event()` (`client`, `medication`, `medication_history`, `dosage`)
- [ ] Create migration: `DROP FUNCTION IF EXISTS process_rbac_events(record)`
- [ ] Create migration: `DROP FUNCTION IF EXISTS process_program_event(record)`
- [ ] Update `trigger/process_domain_event.sql` reference file to match cleaned-up dispatcher
- [ ] Update handler/router counts in agent instructions if affected
- [ ] Deploy migration and verify: events with unknown stream_types hit `ELSE RAISE EXCEPTION`

## Phase 5: Archive and Validation ⏸️ PENDING

- [ ] Archive `dev/active/handler-reference-files.md` → `dev/archived/handler-code-generation/`
- [ ] Confirm no stale `handler-code-generation-*` files remain in `dev/active/`
- [ ] Validate: every `handle_*` function in DB has a `.sql` file
- [ ] Validate: every `process_*` router in DB has a `.sql` file (no orphans)
- [ ] Validate: `.sql` file content matches `pg_get_functiondef()` output
- [ ] Confirm no dead CASE branches remain in dispatcher
- [ ] Confirm legacy functions are dropped from DB

## Success Validation Checkpoints

### Immediate Validation
- [ ] `ls infrastructure/supabase/handlers/**/*.sql | wc -l` returns ~66 files (5 trigger + 12 routers + ~49 handlers)
- [ ] All 4 agent instruction files updated (CLAUDE.md, SKILL.md, event-handler-pattern.md, AGENT-INDEX.md)
- [ ] README.md exists and explains sync protocol

### Feature Complete Validation
- [ ] No handler in the live DB is missing a reference file
- [ ] No reference file is missing from the live DB — 1:1 match after cleanup
- [ ] Agent instructions in all 4 locations reference the handlers directory
- [ ] Dispatcher has zero dead CASE branches
- [ ] `process_rbac_events` and `process_program_event` no longer exist in DB

## Current Status

**Phase**: Not started
**Status**: ⏸️ PENDING
**Last Updated**: 2026-02-11
**Next Step**: Begin Phase 1 — extract function definitions from live DB using `pg_get_functiondef()`

## Notes

### Dead Code Cleanup (Phase 4)
- 4 CASE branches in `process_domain_event()` reference non-existent routers (`client`, `medication`, `medication_history`, `dosage`) — removed by migration so unknown stream_types hit the explicit `ELSE RAISE EXCEPTION` path
- `process_rbac_events` (plural) superseded by `process_rbac_event` — dropped
- `process_program_event` not dispatched — dropped
- After cleanup: dispatcher routes only to functions that exist, no `_deprecated/` directory needed

### Count Corrections (from context investigation)
- The original plan doc (handler-reference-files.md) listed 16 routers and 41+ handlers — actual counts are 12 active routers and 51 handlers
