# Tasks: Client Management Applet

## Phase 1: Research & Discovery ✅ COMPLETE

- [x] Catalog intake fields from clinical design conversations
- [x] Classify field value set ownership (app-owner vs. tenant vs. free-form)
- [x] Analyze conforming dimension strategy for Cube.js
- [x] Audit current `clients` table schema — gap analysis complete
- [x] Audit `user_client_assignments_projection` — no FK to clients (documented)
- [x] Identify analytics architecture (Cube.js + PostgreSQL + Observable Plot)
- [x] Decide: `clients_projection` as full CQRS projection (stream_type: `client`, greenfield)
- [x] Cross-correlate router events vs AsyncAPI contracts (110 total events audited)
- [x] Identify 2 AsyncAPI naming mismatches, 3 missing contracts, 9 RAISE WARNING fixes
- [x] Design comprehensive `event_types` seed (all 110 events)
- [x] Write detailed implementation plan (`.claude/plans/spicy-bubbling-quail.md`, ~1,150 lines)
- [ ] Draft ADR document for client management schema decisions
- [ ] Review with stakeholder and finalize field list

## Phase 2: Schema Foundation ⏸️ PENDING

- [ ] Create migration 1: `clients_projection` table with all typed columns + `custom_fields JSONB`
- [ ] Create migration 1: indexes (org, org+status, name, dob, ou, clinician, GIN, active)
- [ ] Create migration 1: RLS policies (SELECT, INSERT, UPDATE, DELETE) for `clients_projection`
- [ ] Create migration 1: FK from `user_client_assignments_projection` to `clients_projection`
- [ ] Create migration 1: GRANTs for authenticated + service_role
- [ ] Create migration 1b: Junction tables (`client_contacts`, `client_phones`, `client_addresses`)
- [ ] Create migration 1b: Junction RLS policies (org-scoped via subquery + permission check)
- [ ] Create migration 1b: Platform admin override policies for junction tables
- [ ] Create migration 1b: Junction GRANTs
- [ ] Create migration 2: `client_field_definitions_projection` table + indexes + RLS
- [ ] Create migration 2: `client_reference_values` table + indexes + RLS (read-only)
- [ ] Create migration 2: Seed `client_reference_values` (OMB race 7, ethnicity 2, ISO 639 languages 20, gender 7)
- [ ] Test RLS policies with different JWT claim profiles

## Phase 3: Event Integration ⏸️ PENDING

- [ ] Create migration 3: Add `client` + `client_field_definition` stream_type CASE lines to `process_domain_event()`
- [ ] Create migration 3: `process_client_event()` router (8 event types)
- [ ] Create migration 3: `process_client_field_definition_event()` router (3 event types)
- [ ] Create migration 3: 8 client handlers (registered, updated, admitted, discharged, status_changed, custom_fields_updated, clinician_assigned, manager_assigned)
- [ ] Create migration 3: 3 field definition handlers (created, updated, deactivated)
- [ ] Create migration 3: Add 6 client junction CASE lines to `process_junction_event()`
- [ ] Create migration 3: Fix RAISE WARNING → RAISE EXCEPTION in 9 existing routers
- [ ] Create migration 4: 10 client API functions (register, update, admit, discharge, change_status, update_custom_fields, assign_clinician, assign_manager, get, list)
- [ ] Create migration 4: 6 junction API functions (link/unlink client_contact, client_phone, client_address)
- [ ] Create migration 4: 4 field definition API functions (create, update, deactivate, list)
- [ ] Create migration 4: GRANTs for all `api.*` functions
- [ ] Create migration 5: `event_types` seed data (110 event types — 93 existing + 17 new)
- [ ] Update handler reference files (13 new + 11 updated existing)
- [ ] Create AsyncAPI contracts: `client.yaml`, `client_field_definition.yaml`
- [ ] Update AsyncAPI: `junction.yaml` (6 client junction messages)
- [ ] Fix AsyncAPI naming mismatches: `user.yaml` (access_dates), `organization.yaml` (subdomain.failed)
- [ ] Add missing AsyncAPI contracts: `user.schedule.reactivated`, `user.schedule.deleted`, `organization.subdomain_status.changed`
- [ ] Update `asyncapi.yaml` (stream_type enum + $ref entries)
- [ ] Generate TypeScript types from AsyncAPI
- [ ] Verify: plpgsql_check passes (`supabase db lint --level error`)
- [ ] Verify: AsyncAPI validates (`npm run check`)
- [ ] Verify: event_types count = 110
- [ ] Verify: client CRUD event flow via SQL

## Phase 4: Analytics Foundation ⏸️ PENDING

- [ ] Design Cube.js `PatientDimension` cube (core typed columns)
- [ ] Design Cube.js dynamic schema generation from field registry
- [ ] Design computed dimensions (age_group, length_of_stay, admission_cohort)
- [ ] Document conforming dimension relationships for fact table joins
- [ ] Design pre-aggregation / materialized view strategy

## Phase 5: Frontend Intake Form ⏸️ PENDING

_Deferred — no tasks defined yet. Will be planned after Phase 3 is complete._

## Documentation Tasks (after Phase 3)

- [ ] Create table docs: `clients_projection.md`
- [ ] Create table docs: `client_field_definitions_projection.md`
- [ ] Create table docs: `client_reference_values.md`
- [ ] Update `user_client_assignments_projection.md` — note new FK
- [ ] Update `clients.md` — redirect to clients_projection.md
- [ ] Update `documentation/AGENT-INDEX.md` — add client keywords
- [ ] Update `dev/active/client-management-applet-tasks.md` — mark complete

## Success Validation Checkpoints

### Phase 1 Complete ✅
- [x] All field classifications documented (core vs. custom, owner vs. tenant)
- [x] Decision made on CQRS projection vs. direct table → `clients_projection` (full projection)
- [x] Cross-correlation audit complete (routers vs AsyncAPI)
- [x] Implementation plan written and ready for approval
- [ ] ADR document written and approved

### Phase 2 Complete
- [ ] All migrations applied successfully
- [ ] RLS policies block cross-org access (tested)
- [ ] RLS policies allow same-org access (tested)
- [ ] `client_field_definitions_projection` has seed data for default field set
- [ ] Value set tables seeded with OMB/ISO standards

### Phase 3 Complete
- [ ] `api.register_client()` emits event, handler updates projection
- [ ] `api.list_clients()` returns filtered results with RLS
- [ ] Domain events appear in `domain_events` table with stream_type='client'
- [ ] `user_client_assignments_projection` FK to `clients_projection.id` works
- [ ] All 9 RAISE WARNING routers fixed to RAISE EXCEPTION
- [ ] AsyncAPI naming mismatches fixed (2)
- [ ] All 110 event types registered in `event_types` table
- [ ] Handler reference files created (13 new) and updated (11 existing)

### Phase 4 Complete
- [ ] Cube.js schema document covers all conforming dimensions
- [ ] Dynamic dimension generation design documented
- [ ] Pre-aggregation strategy defined

## Current Status

**Phase**: 1 — Research & Discovery (nearly complete, pending ADR)
**Status**: Plan written, awaiting approval
**Last Updated**: 2026-02-12
**Next Step**: Approve plan at `.claude/plans/spicy-bubbling-quail.md`, then begin Migration 1 (`clients_projection` table + indexes + RLS + junction tables). Alternatively, write ADR first if stakeholder review is needed before implementation.
