# Implementation Plan: Handler Reference Files

## Executive Summary

Extract all 51 event handler functions, 15 router functions, and the main trigger dispatcher from the 14,648-line baseline migration (and post-baseline migrations) into individual `.sql` reference files under `infrastructure/supabase/handlers/`. Update agent instructions in CLAUDE.md, SKILL.md, event-handler-pattern.md, and AGENT-INDEX.md so that AI agents always read these reference files before writing handler code — eliminating column name drift and rewrite-from-memory errors.

This replaces the over-engineered YAML code generation plan (deferred 2026-01-20) with a simpler, more practical approach: canonical `.sql` files that serve as copy-paste sources.

## Phase 1: Extract Functions from Database

Query the live Supabase database to get the complete, current source for every handler and router. The baseline migration file has encoding quirks that make grep unreliable, so `pg_get_functiondef()` is the authoritative source.

### 1.1 Extract Main Dispatcher + Trigger Functions
- `process_domain_event()` — main BEFORE INSERT/UPDATE trigger
- `handle_bootstrap_workflow()` — AFTER INSERT bootstrap cleanup
- `enqueue_workflow_from_bootstrap_event()` — AFTER INSERT workflow queue
- `notify_workflow_worker_bootstrap()` — BEFORE INSERT pg_notify
- `update_workflow_queue_projection_from_event()` — AFTER INSERT workflow queue projection

### 1.2 Extract All Active Router Functions (12 that exist in DB)
Routers dispatched by `process_domain_event()` that have implementations:
- `process_user_event`, `process_organization_event`, `process_organization_unit_event`
- `process_rbac_event`
- `process_contact_event`, `process_address_event`, `process_phone_event`, `process_email_event`
- `process_invitation_event`, `process_access_grant_event`, `process_impersonation_event`
- `process_junction_event`

Note: 4 stream types (`client`, `medication`, `medication_history`, `dosage`) have CASE branches in the dispatcher but no router functions. These dead branches are removed in Phase 4. Legacy functions (`process_rbac_events`, `process_program_event`) are also dropped in Phase 4 — no reference files needed for dead code.

### 1.3 Extract All 51 Handler Functions
Organized by domain:
- **user** (16): `handle_user_created`, `handle_user_invited`, `handle_user_synced_from_auth`, `handle_user_access_dates_updated`, `handle_user_notification_preferences_updated`, `handle_user_phone_added/updated/removed`, `handle_user_address_added/updated/removed`, `handle_user_role_assigned/revoked`, `handle_user_client_assigned/unassigned`, `handle_user_schedule_created/updated/deactivated/reactivated/deleted`
- **organization** (10): `handle_organization_created/updated/activated/deactivated/reactivated/deleted`, `handle_organization_subdomain_*` (4), `handle_organization_direct_care_settings_updated`
- **organization_unit** (5): `handle_organization_unit_created/updated/deactivated/reactivated/deleted`
- **rbac** (9): `handle_role_created/updated/deactivated/reactivated/deleted`, `handle_role_permission_granted/revoked`, `handle_permission_defined/updated`, `handle_rbac_user_role_assigned`
- **bootstrap** (3): `handle_bootstrap_completed/failed/cancelled`
- **invitation** (1): `handle_invitation_resent`

## Phase 2: Create Directory Structure and Files

### 2.1 Create Directory Layout
```
infrastructure/supabase/handlers/
├── README.md
├── trigger/
│   ├── process_domain_event.sql
│   ├── handle_bootstrap_workflow.sql
│   ├── enqueue_workflow_from_bootstrap_event.sql
│   ├── notify_workflow_worker_bootstrap.sql
│   └── update_workflow_queue_projection_from_event.sql
├── routers/
│   ├── process_user_event.sql
│   ├── ... (12 active router files)
│   └── (no _deprecated/ — legacy functions dropped in Phase 4)
├── user/
├── organization/
├── organization_unit/
├── rbac/
├── bootstrap/
└── invitation/
```

### 2.2 Write Individual .sql Files
Each file: one `CREATE OR REPLACE FUNCTION` statement extracted from `pg_get_functiondef()`. No header boilerplate, no wrapping — just the canonical SQL, ready to copy-paste into a migration.

### 2.3 Create README.md
Purpose, sync rules, file conventions, usage instructions for agents and humans.

## Phase 3: Update Agent Instructions

### 3.1 infrastructure/CLAUDE.md
- Add subsection under "Event Handler Architecture": "Handler Reference Files — Read Before Writing"
- Update handler/router/trigger counts (51 handlers, 16 routers, 5 triggers)

### 3.2 .claude/skills/infrastructure-guidelines/SKILL.md
- Add rule 7b: "Handler Reference Files — Always Read Before Writing"

### 3.3 documentation/infrastructure/patterns/event-handler-pattern.md
- Add section pointing to reference files directory
- Verify handler/router counts match reality (54+ handlers per TL;DR — update if wrong)

### 3.4 documentation/AGENT-INDEX.md
- Add `handler-reference` keyword entry pointing to handler files

## Phase 4: Clean Up Dispatcher Dead Code

Create a migration that removes the 4 dead CASE branches from `process_domain_event()` for stream types that have no corresponding router function (`client`, `medication`, `medication_history`, `dosage`). Also drop the 2 legacy functions (`process_rbac_events`, `process_program_event`).

### 4.1 Migration: Remove Dead Dispatcher Branches
- Remove CASE branches for `client`, `medication`, `medication_history`, `dosage` from `process_domain_event()`
- These stream types will then hit the `ELSE RAISE EXCEPTION 'Unknown stream_type'` path, which is honest — they are not supported yet
- When support is added later, the router function AND the dispatcher branch get added in the same migration

### 4.2 Migration: Drop Legacy Functions
- `DROP FUNCTION IF EXISTS process_rbac_events(record)` — superseded by `process_rbac_event`
- `DROP FUNCTION IF EXISTS process_program_event(record)` — dead code, not dispatched
- These can be in the same migration as 4.1 or separate — single migration is cleaner

### 4.3 Update Reference Files
- Update `trigger/process_domain_event.sql` to reflect the cleaned-up dispatcher
- Remove `routers/_deprecated/` directory — no longer needed since functions are dropped
- Update handler/router counts in agent instructions if affected

## Phase 5: Archive and Validation

### 5.1 Archive Old Dev Docs
- Move `dev/active/handler-reference-files.md` → `dev/archived/handler-code-generation/`
- Confirm no remaining `handler-code-generation-*` files in `dev/active/`

### 5.2 Validate Completeness
- Compare: every `handle_*` and `process_*` function in DB has a corresponding `.sql` file
- Compare: every `.sql` file matches the DB source exactly
- Confirm no dead CASE branches remain in dispatcher
- Confirm legacy functions are dropped

## Success Metrics

### Immediate
- [ ] Every handler/router in the live DB has a corresponding `.sql` reference file
- [ ] Agent instructions updated in all 4 locations
- [ ] README.md in handlers directory explains purpose and sync rules
- [ ] Dispatcher has no dead CASE branches — only routes to functions that exist
- [ ] Legacy functions (`process_rbac_events`, `process_program_event`) dropped

### Medium-Term
- [ ] Next handler modification uses reference file as starting point (not rewrite from memory)
- [ ] No column name drift in next 3 handler-related migrations

### Long-Term
- [ ] Reference files stay in sync with deployed code (enforced by convention)
- [ ] Documentation counts match reality

## Risk Mitigation

| Risk | Mitigation |
|------|-----------|
| Reference files drift from deployed code | README sync rules + agent instructions to update after migrations |
| Dead dispatcher branches call non-existent functions | Phase 4 migration removes them; stream types hit explicit `ELSE RAISE EXCEPTION` |
| Legacy functions confuse agents | Phase 4 migration drops them entirely |
| Future domains need new routers | Add router function + dispatcher CASE branch in same migration |

## Next Steps After Completion
- When adding new event handlers, create the reference file first, then copy into migration
- Consider a CI check that compares reference files to deployed function source (future enhancement)
