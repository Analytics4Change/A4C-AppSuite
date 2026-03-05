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
- [ ] Create migration 1b: Junction tables (`client_phones`, `client_addresses`)
- [ ] Create migration 1b: `contacts_projection` — add `user_id` FK column (nullable, FK → users)
- [ ] Create migration 1b: `contact_designations_projection` table + indexes + RLS + UNIQUE constraint
- [ ] Create migration 1b: `client_contact_assignments` table + indexes + RLS + UNIQUE constraint (replaces originally planned `client_contacts`)
- [ ] Create migration 1b: Junction/assignment RLS policies (org-scoped via subquery + permission check)
- [ ] Create migration 1b: Platform admin override policies for junction + assignment tables
- [ ] Create migration 1b: Junction/assignment GRANTs
- [ ] Create migration 2: `client_field_definitions_projection` table + indexes + RLS
- [ ] Create migration 2: `client_reference_values` table + indexes + RLS (read-only)
- [ ] Create migration 2: Seed `client_reference_values` (ISO 639 languages 20 only — gender/race/ethnicity hardcoded in frontend)
- [ ] Test RLS policies with different JWT claim profiles

## Phase 3: Event Integration ⏸️ PENDING

- [ ] Create migration 3: Add `client` + `client_field_definition` stream_type CASE lines to `process_domain_event()`
- [ ] Create migration 3: `process_client_event()` router (8 event types)
- [ ] Create migration 3: `process_client_field_definition_event()` router (3 event types)
- [ ] Create migration 3: 6 client handlers (registered, updated, admitted, discharged, status_changed, custom_fields_updated) — clinician_assigned/manager_assigned dropped, handled by contact-designation model
- [ ] Create migration 3: 3 field definition handlers (created, updated, deactivated)
- [ ] Create migration 3: Add client junction CASE lines to `process_junction_event()` (client_phone, client_address linked/unlinked)
- [ ] Create migration 3: Contact-designation event handlers (`handle_contact_designation_created`, `handle_contact_designation_deactivated`) — add 2 CASE branches to `process_contact_event()`
- [ ] Create migration 3: Client contact assignment handlers (`handle_client_contact_assigned`, `handle_client_contact_unassigned`) — add 2 CASE branches to `process_client_event()`
- [ ] Create migration 3: Fix RAISE WARNING → RAISE EXCEPTION in 9 existing routers
- [ ] Create migration 4: 8 client API functions (register, update, admit, discharge, change_status, update_custom_fields, get, list)
- [ ] Create migration 4: 4 junction API functions (link/unlink client_phone, client_address)
- [ ] Create migration 4: Contact-designation API functions — 3 individual (`api.create_contact_designation`, `api.assign_client_contact`, `api.unassign_client_contact`) + 1 wrapper (`api.assign_client_clinician`) + `api.list_client_contacts`
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

### 5.0 Scope Decisions (resolve before implementation)
- [ ] Decide navigation placement: intake config under `/settings/organization` or dedicated `/settings/intake-form` sub-route
- [ ] Decide configurability UX: toggle switches vs drag-and-drop ordering vs section-based grouping

### 5.1 Intake Form Configuration (Settings UI)
- [ ] Add "Client Intake Configuration" card to SettingsPage hub (reuse glassmorphism card pattern)
- [ ] Define `IntakeFormConfig` TypeScript interface
- [ ] Create `IIntakeFormConfigService` + Supabase + Mock implementations
- [ ] Create `IntakeFormConfigViewModel` (mirror DirectCareSettingsViewModel: observable state, dirty tracking, save/reset, audit)
- [ ] Create IntakeFormConfigSection component (core fields read-only, optional field toggles)
- [ ] Permission gate on `organization.update`

### 5.2 Client Intake Form
- [ ] Create `ClientIntakeFormViewModel` (mirror OrganizationFormViewModel: multi-section, validation, draft management)
- [ ] Demographics section (name, DOB, gender dropdown, pronouns dropdown)
- [ ] Race/ethnicity section (OMB two-question: ethnicity single-select → race multi-select via MultiSelectDropdown)
- [ ] Contact section (phone, email, address, emergency contacts)
- [ ] Administrative section (internal case number, external case numbers, admission date, org unit, referral source)
- [ ] Staff assignment section (contact-designation model: assign clinician/therapist/etc. via contacts)
- [ ] Conditional rendering based on org's intake form configuration
- [ ] Validation (required fields, format checks)
- [ ] WCAG 2.1 AA compliance (keyboard nav, ARIA, focus management)

### 5.3 Client List Enhancements
- [ ] Replace mock data with `api.list_clients()` RPC queries
- [ ] Update ClientListPage to show configurable columns
- [ ] Update search/filter for new fields
- [ ] Update ClientDetailLayout for richer data display

## Documentation Tasks (after Phase 3)

- [ ] Create table docs: `clients_projection.md`
- [ ] Create table docs: `client_field_definitions_projection.md`
- [ ] Create table docs: `client_reference_values.md`
- [ ] Create table docs: `contact_designations_projection.md`
- [ ] Create table docs: `client_contact_assignments.md`
- [ ] Update `contacts_projection.md` — document `user_id` FK addition
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

### Phase 5 Complete
- [ ] Org admin can view/toggle intake form configuration in settings
- [ ] Configuration persists across sessions with audit trail (reason for change)
- [ ] Intake form renders based on org configuration (conditional fields)
- [ ] Race/ethnicity uses OMB two-question format
- [ ] Mock mode works without Supabase
- [ ] Client list shows real data from `api.list_clients()` RPC
- [ ] WCAG 2.1 AA compliant (keyboard nav, ARIA, focus management)

## Current Status

**Phase**: 1 — Research & Discovery (nearly complete, pending ADR + remaining field discussions)
**Status**: Clinical contact field UX fully designed (decisions 20-26). ClinicalContactField plan at `.claude/plans/woolly-beaming-teacup.md` — PENDING USER APPROVAL. Remaining: 6 undiscussed fields + ADR.
**Last Updated**: 2026-03-04
**Next Step**: (1) Get user approval on `woolly-beaming-teacup.md` plan. (2) Resolve remaining undiscussed fields (`photo_url`, `notes`, `middle_name`, `preferred_name`, `custom_fields`, audit columns). (3) Update main plan at `.claude/plans/spicy-bubbling-quail.md` with all new decisions (14-26 in context.md) and finalize for approval.

### Clinical Contact Field UX Designed (2026-03-04)
- 4 clinical contact fields on intake form: Clinician, Therapist, Psychiatrist, Behavioral Analyst
- `behavioral_analyst` added to designation CHECK constraint (6 → 7 values)
- Client-side Jaro-Winkler fuzzy search (not Fuse.js Bitap — transposition handling)
- Preloaded candidate set (one RPC, cached), sub-ms scoring per keystroke
- Two-phase field: search → select OR inline create (4-field mini-form, deferred save)
- Reusable `ClinicalContactField` component with designation prop
- `SearchableDropdown<T>` NOT reused (designed for async); uses `DropdownPortal` + `useDropdownHighlighting` directly
- Observability: shared `correlationId` (Pattern A), auto W3C tracing, read-back guards
- data-testid on all 15 interactive elements per field, designation-interpolated
- Plan file: `.claude/plans/woolly-beaming-teacup.md`

### Contact-Designation Decisions Resolved (2026-03-04)
All 6 outstanding questions answered:
1. Fixed list of 7 designations (was 6, added `behavioral_analyst`), no org customization
2. Full event sourcing (contact.designation.created/deactivated) — codebase audit confirmed 100% event-sourced pattern
3. Wrapper + individual API functions in single PG transaction
4. Permission: reuse `client.update`
5. Designations are event-sourced projections (resolved in Q2)
6. Include in Phases 2-3 (not deferred)

### Key Discovery: Contact CRUD Already Deployed
- `api.create_organization_contact()`, `api.update_organization_contact()`, `api.delete_organization_contact()` exist (migration 20260226002002)
- Full contact event pipeline operational: events → `process_contact_event()` → handlers → `contacts_projection`
- Wrapper function will reuse existing `api.create_organization_contact()`

### Key Discovery: Observability Pipeline (2026-03-04)
- Three-layer auto-tracing: `tracingFetch` wrapper → `postgrest_pre_request()` hook → `api.emit_domain_event()` fallback
- Regular RPC services do NOT pass `p_event_metadata` JSONB — tracing is automatic via headers
- Multi-step operations use `p_correlation_id` flat param (Pattern A: `bulkAssignRole`, `syncScheduleAssignments`)
- Failed event detection is synchronous via RPC read-back guard (no frontend polling)
- Key files: `frontend/src/lib/supabase-ssr.ts:87-121`, `frontend/src/utils/trace-ids.ts`, `frontend/src/utils/tracing.ts`
