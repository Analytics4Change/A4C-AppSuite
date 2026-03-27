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
- [x] Resolve `photo_url` — Mandatory + NULLABLE, not org-configurable (2026-03-09)
- [x] Resolve `notes` — DROPPED from schema (2026-03-09)
- [x] Resolve `middle_name` — Mandatory + NULLABLE, detail-level reporting only (2026-03-09)
- [x] Resolve `preferred_name` — Optional, nullable, no reporting (2026-03-09)
- [x] Confirm `custom_fields` JSONB design (2026-03-09)
- [x] Design `client_field_categories` reference table — seeded fixed set + org-defined (2026-03-09)
- [x] Confirm audit columns (`created_at`, `updated_at`, `created_by`, `updated_by`) — confirmed 2026-03-09: all NOT NULL, system-managed, no UI
- [x] Resolve EMR expansion: 17-category enterprise EMR field list cross-referenced (2026-03-14)
- [x] Resolve 4 architectural scoping questions: guardian, insurance, clinical profile, referral (2026-03-14)
- [x] Classify all new fields per category (decisions 37-56, 2026-03-14)
- [x] Deferred categories identified: 9, 12, 15 (applets), 3/11 (contact mgmt), 14 (billing) (2026-03-14)
- [x] Classify remaining field properties: reporting dimension, configurable presence for all new fields (2026-03-19 — via CSV review, all 43 fields classified)
- [x] Resolve allergy_type enum: medication/general → medication/food/environmental (2026-03-19)
- [x] Drop `internal_case_number` — UUID is internal ID, mrn covers org numbering (2026-03-19)
- [x] Drop `county` (2026-03-19)
- [x] Drop `preferred_communication_method` (2026-03-19)
- [x] Decision: Option B client-owned contact tables for client phone/email/address (2026-03-19)
- [x] Decision: configurable_label + conforming_dimension_mapping for 12 designations + state_agency (2026-03-19)
- [x] Decision: Mandatory core reduced to 7 intake fields + 3 discharge fields (2026-03-19)
- [x] Decision: Race/ethnicity/language/interpreter changed to configurable_presence + optional (2026-03-19)
- [x] Decision: admission_type changed to optional + configurable_presence (2026-03-19)
- [x] Decision: Discharge fields mandatory at discharge time only (2026-03-19)
- [ ] Draft ADR document for client management schema decisions
- [ ] Review with stakeholder and finalize field list

## Phase 2: Schema Foundation ⏸️ PENDING

### Migration 1: `clients_projection` (expanded — ~55 typed columns + custom_fields JSONB)
- [ ] Create `clients_projection` table with ALL typed columns (demographics, contact, referral, admission, clinical, medical, legal, discharge + custom_fields JSONB)
- [ ] Create indexes (org, org+status, name, dob, ou, GIN on custom_fields, status+org, referral_source_type, admission_type)
- [ ] Create RLS policies (SELECT, INSERT, UPDATE, DELETE) for `clients_projection`
- [ ] Create FK from `user_client_assignments_projection` to `clients_projection`
- [ ] Create GRANTs for authenticated + service_role

### Migration 1b: Client-owned contact tables + contact-designation model
- [ ] `client_phones` table (standalone, NOT junction) + indexes + RLS
- [ ] `client_emails` table (standalone, NOT junction) + indexes + RLS
- [ ] `client_addresses` table (standalone, NOT junction) + indexes + RLS
- [ ] `contacts_projection` — add `user_id` FK column (nullable, FK → users)
- [ ] `contact_designations_projection` table + indexes + RLS + UNIQUE + CHECK constraint (12 designations)
- [ ] `client_contact_assignments` table + indexes + RLS + UNIQUE constraint
- [ ] RLS policies for all 5 new tables (org-scoped via subquery + permission check)
- [ ] Platform admin override policies for all new tables
- [ ] GRANTs for all new tables

### Migration 1c: `client_insurance_policies_projection` (Decision 38) + `client_funding_sources_projection` (Decision 76)
- [ ] Create `client_insurance_policies_projection` table (payer, member_id, group_number, subscriber info, coverage dates, auth fields, policy_type: primary/secondary/medicaid/medicare)
- [ ] Create `client_funding_sources_projection` table (funding_source_key, source_name, source_id, amount, dates, notes)
- [ ] Create indexes (client_id, org_id) for both tables
- [ ] Create RLS policies for both tables
- [ ] Create GRANTs for both tables

### Migration 2: Field registry + reference tables
- [ ] `client_field_categories` table + indexes + RLS + seed fixed set
- [ ] `client_field_definitions_projection` table + indexes + RLS + FK to categories
- [ ] `client_reference_values` table + indexes + RLS + seed (ISO 639 languages only)

### Verification
- [ ] Test RLS policies with different JWT claim profiles
- [ ] Verify all ~55 columns present on `clients_projection`
- [ ] Verify insurance table supports primary + secondary + medicaid rows
- [ ] Verify 12 designations in CHECK constraint

## Phase 3: Event Integration ⏸️ PENDING

### Migration 3: Dispatcher + routers + handlers
- [ ] Add `client` + `client_field_definition` stream_type CASE lines to `process_domain_event()`
- [ ] `process_client_event()` router (expanded: ~11 event types including insurance sub-entity + contact assignment + lifecycle)
- [ ] `process_client_field_definition_event()` router (3 event types)
- [ ] Client handlers: registered, updated, admitted, discharged, reverse_discharged, readmitted, status_changed, custom_fields_updated
- [ ] Insurance handlers: insurance_policy_added, insurance_policy_updated, insurance_policy_removed
- [ ] Client contact assignment handlers: contact_assigned, contact_unassigned
- [ ] 3 field definition handlers (created, updated, deactivated)
- [ ] Client contact sub-entity handlers: phone added/updated/removed, email added/updated/removed, address added/updated/removed (9 handlers)
- [ ] Contact-designation handlers (`handle_contact_designation_created`, `handle_contact_designation_deactivated`) — 2 CASE branches in `process_contact_event()`
- [ ] Fix RAISE WARNING → RAISE EXCEPTION in 9 existing routers

### Migration 4: API functions (expanded)
- [ ] ~10 client API functions (register, update, admit, discharge, reverse_discharge, readmit, change_status, update_custom_fields, get, list)
- [ ] 3 insurance API functions (add_policy, update_policy, remove_policy)
- [ ] 9 client contact API functions (add/update/remove phone, email, address)
- [ ] Contact-designation API functions — 3 individual + 1 wrapper + `api.list_client_contacts`
- [ ] 4 field definition API functions (create, update, deactivate, list)
- [ ] GRANTs for all `api.*` functions

### Migration 5: Event registry + AsyncAPI
- [ ] `event_types` seed data (93 existing + expanded new client events)
- [ ] Update handler reference files
- [ ] Create AsyncAPI contracts: `client.yaml`, `client_field_definition.yaml`
- [ ] Update AsyncAPI: `junction.yaml` (client junction messages)
- [ ] Fix AsyncAPI naming mismatches: `user.yaml` (access_dates), `organization.yaml` (subdomain.failed)
- [ ] Add missing AsyncAPI contracts
- [ ] Update `asyncapi.yaml` (stream_type enum + $ref entries)
- [ ] Generate TypeScript types from AsyncAPI

### Verification
- [ ] plpgsql_check passes (`supabase db lint --level error`)
- [ ] AsyncAPI validates (`npm run check`)
- [ ] event_types count matches total
- [ ] Client CRUD event flow via SQL
- [ ] Insurance policy CRUD event flow via SQL

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

**Source**: `dev/active/client-management-applet-schema-diagrams.md` — use as partial source per `documentation/AGENT-GUIDELINES.md`

- [ ] Create table docs: `clients_projection.md`
- [ ] Create table docs: `client_phones.md`
- [ ] Create table docs: `client_emails.md`
- [ ] Create table docs: `client_addresses.md`
- [ ] Create table docs: `client_insurance_policies_projection.md`
- [ ] Create table docs: `client_field_definitions_projection.md`
- [ ] Create table docs: `client_field_categories.md`
- [ ] Create table docs: `client_reference_values.md`
- [ ] Create table docs: `contact_designations_projection.md`
- [ ] Create table docs: `client_contact_assignments.md`
- [ ] Create architecture doc: `documentation/architecture/data/client-data-model.md` — derived from schema diagrams
- [ ] Update `contacts_projection.md` — document `user_id` FK addition
- [ ] Update `user_client_assignments_projection.md` — note new FK
- [ ] Update `clients.md` — redirect to clients_projection.md
- [ ] Update `documentation/AGENT-INDEX.md` — add client keywords
- [ ] Update `documentation/README.md` — add client docs to table of contents
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

**Phase**: 1 — Research & Discovery (nearing completion — 2 tasks remain: ADR draft + stakeholder review)
**Status**: All 77 decisions complete (9 new decisions 2026-03-23: #69–#77). Key changes this session:
- `is_required` configurable per-org for typed columns (Decision 69)
- Language selection → runtime search, no admin config (Decision 70)
- Pronouns → runtime free text, no admin config (Decision 71)
- Citizenship status → hardcoded 6-value dropdown (Decision 72)
- `initial_risk_level` → 4-value enum, promoted to reporting dimension (Decision 73)
- Medicare added as 5th payer type (Decision 74)
- `state` payer type removed, replaced by `client_funding_sources_projection` table (Decision 76, supersedes 75)
- Funding sources get `custom_fields` JSONB for non-standard fields (Decision 77)
- New table count: 11 (was 10)
**Last Updated**: 2026-03-23
**Next Step**: (1) Draft ADR document. (2) Review with stakeholder and finalize field list. (3) Update main plan file (`.claude/plans/spicy-bubbling-quail.md`) with all post-2026-03-14 changes. (4) Begin Phase 2 implementation.

### Static Configuration Prototype Created (2026-03-23)
- Static HTML/CSS/JS prototype at `~/tmp/client-intake-config-prototype/` (not in git)
- 13 horizontal tabs covering all wizard steps + custom fields + categories
- Glassmorphism design matching existing app (extracted from `frontend/src/index.css`)
- 56 "Required when visible" checkboxes on all configurable_presence fields (Decision 69)
- 9 designation cards with configurable label rename inputs
- State agency configurable label
- Custom field management (add/edit/delete with type, category, dimension, required flags)
- Category management (5 locked system + org-defined custom)
- Language selection grid REMOVED (Decision 70) — runtime search at intake instead
- Pronouns changed to free text (Decision 71)
- Citizenship status changed to hardcoded dropdown (Decision 72)
- Initial risk level defined with 4 values + reporting dimension badge (Decision 73)
- Medicare added to payer type toggles (Decision 74)
- State Program payer replaced by External Funding Sources section with dynamic slots + configurable labels (Decision 76)
- Upload to Google Drive for stakeholder review

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
