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
- [x] Decision: Discharge three-field decomposition — `discharge_outcome` + `discharge_reason` + `discharge_placement` replaces `discharge_type` (2026-03-26)
- [x] Decision: `marital_status` enum — 6 values (2026-03-26)
- [x] Decision: `suicide_risk_status` enum — 3 values (2026-03-26)
- [x] Resolve `violence_risk_status` enum — 3 values, same as suicide_risk_status (2026-03-26)
- [x] Resolve `legal_custody_status` enum — 6 values, separated from placement (Decision 82, 2026-03-26)
- [x] Decision: `placement_arrangement` — new field + `client_placement_history` table, Option C backend (Decision 83, 2026-03-26)
- [x] Resolve `financial_guarantor_type` enum — 8 values (Decision 84, 2026-03-26)
- [x] Draft ADR document for client management schema decisions (2026-03-27) → `documentation/architecture/decisions/adr-client-management-schema.md`
- [x] Review with stakeholder and finalize field list (2026-03-27)
- [x] Recreate implementation plan file — plan file was cleaned up, worked from dev-docs directly

## Phase 2: Schema Foundation ⏸️ PENDING

### Migration 1: `clients_projection` ✅ COMPLETE (2026-03-27)
- [x] Create `clients_projection` table with 53 typed columns (demographics, referral, admission, clinical, medical, legal, discharge, education + custom_fields JSONB)
- [x] Create 9 indexes (org, org+status, name, dob, ou, GIN on custom_fields, mrn, external_id, admission_date)
- [x] Create RLS policies (SELECT org-scoped + platform admin override)
- [x] Create FK from `user_client_assignments_projection` to `clients_projection`
- [x] Create GRANTs for authenticated + service_role
- Migration: `20260327205738_clients_projection.sql`

### Migration 1b: Client-owned contact tables + contact-designation model ⏸️ DEFERRED (Client Intake project)
_Client phones/emails/addresses/contact_assignments tables deferred to Client Intake implementation._

### Migration 3: `contact_designations_projection` ✅ COMPLETE (2026-03-27)
- [x] `contact_designations_projection` table + 12-value CHECK + UNIQUE(contact_id, designation, org_id)
- [x] 3 partial indexes (contact, org, org+designation)
- [x] RLS policies (SELECT org-scoped + platform admin)
- [x] GRANTs + FKs to contacts_projection + organizations_projection
- [x] `contacts_projection.user_id` FK already existed in baseline — no change needed
- Migration: `20260327210838_contact_designations_projection.sql`

### Migration 1c: `client_insurance_policies_projection` ⏸️ DEFERRED (Client Intake project)
_Insurance and funding source tables deferred to Client Intake implementation._

### Migration 1d: `client_placement_history` ⏸️ DEFERRED (Client Intake project)
_Placement history table deferred to Client Intake implementation._

### Migration 2: Field registry + reference tables ✅ COMPLETE (2026-03-27)
- [x] `client_field_categories` table + indexes + RLS + 11 system category seeds
- [x] `client_field_definitions_projection` table + indexes + RLS + FK to categories
- [x] `client_reference_values` table + indexes + RLS + 40 ISO 639 language seeds
- [x] `client_field_definition_templates` table + RLS + 66 template row seeds
- Migration: `20260327210520_client_field_registry.sql`

### Verification ✅ COMPLETE (2026-03-27)
- [x] Test RLS policies with different JWT claim profiles — 11 assertions passed via Supabase MCP `execute_sql`
- [x] Verify all columns present on `clients_projection` — 75 total (53 typed data + system columns)
- [ ] Verify insurance table supports primary + secondary + medicaid rows — DEFERRED (table not yet created)
- [x] Verify 12 designations in CHECK constraint — confirmed 12 values

## Phase 3: Event Integration — Client Field Configuration ✅ COMPLETE (2026-03-27)

### Migration 4: Field definition event infrastructure ✅ COMPLETE
- [x] Add `client_field_definition` stream_type CASE to `process_domain_event()`
- [x] `process_client_field_definition_event()` router (3 event types)
- [x] 3 field definition handlers (created, updated, deactivated) with ON CONFLICT idempotency
- [x] Handler reference files: `handlers/client_field_definition/` (3 files)
- [x] Router reference file: `handlers/routers/process_client_field_definition_event.sql`
- [x] Updated dispatcher reference: `handlers/trigger/process_domain_event.sql`
- Migration: `20260327211210_client_field_definition_events.sql`
- Architecture review: No Major findings, 1 Minor (no reactivated event — intentional one-way deactivation)

### Migration 5: Field category event infrastructure ✅ COMPLETE
- [x] Add `client_field_category` stream_type CASE to `process_domain_event()`
- [x] `process_client_field_category_event()` router (2 event types)
- [x] 2 category handlers (created, deactivated) with ON CONFLICT idempotency
- [x] Handler reference files: `handlers/client_field_category/` (2 files)
- [x] Router reference file: `handlers/routers/process_client_field_category_event.sql`
- Migration: `20260327211636_client_field_category_events.sql`

### Migration 6: API functions ✅ COMPLETE
- [x] 5 field definition API functions (create, update, deactivate, list, batch_update)
- [x] 3 category API functions (create, deactivate, list)
- [x] All write RPCs include `p_correlation_id` parameter
- [x] `api.list_field_definitions()` uses `#variable_conflict use_column` + `p_include_inactive`
- [x] `api.batch_update_field_definitions()` — single network call, individual events with shared correlation_id
- [x] Read RLS relaxed: `api.list_field_definitions()` no permission check (Decision 89)
- [x] Write permission: `organization.update` for all write RPCs
- [x] GRANTs for authenticated + service_role (bootstrap)
- Migration: `20260327212247_client_field_api_functions.sql`

### Migration 7: Event registry + AsyncAPI ✅ COMPLETE
- [x] 5 new event types seeded in `event_types` table
- [x] AsyncAPI contract: `client-field-definition.yaml` (3 messages + schemas)
- [x] AsyncAPI contract: `client-field-category.yaml` (2 messages + schemas)
- [x] Updated `asyncapi.yaml` with 5 new $ref entries
- Migration: `20260327212739_client_field_event_types_seed.sql`

### Migration 8: Bootstrap workflow activity ✅ COMPLETE
- [x] `seedFieldDefinitions` activity — reads templates, resolves categories, emits events
- [x] `deleteFieldDefinitions` compensation — deactivates all field definitions for org
- [x] Layer 2 idempotency: checks if definitions already exist
- [x] Workflow Step 1.6 inserted after grantProviderAdminPermissions, before configureDNS
- [x] `fieldDefinitionsSeeded` flag on WorkflowState for compensation tracking
- [x] Compensation runs in Saga reverse order (before deleteContacts)
- [x] TypeScript + ESLint clean (eslint-disable blocks for untyped tables)
- Files: `workflows/src/activities/organization-bootstrap/seed-field-definitions.ts`
- Modified: `workflow.ts`, `index.ts`, `shared/types/index.ts`

### Remaining Event Integration (Client Intake project — FUTURE)
- [ ] `process_client_event()` router (~11 event types)
- [ ] Client lifecycle handlers (registered, updated, admitted, discharged, etc.)
- [ ] Insurance/placement/contact sub-entity handlers
- [ ] Contact-designation handlers in `process_contact_event()`
- [ ] Client API functions (register, update, admit, discharge, etc.)
- [ ] Fix RAISE WARNING → RAISE EXCEPTION in 9 existing routers
- [ ] Full AsyncAPI cross-correlation audit (93 existing events)
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

### 5.0 Scope Decisions ✅ COMPLETE (2026-03-27)
- [x] Decide navigation placement → dedicated `/settings/client-fields` sub-route (Decision 88)
- [x] Decide configurability UX → toggle switches with "Required when visible" pattern + tabbed categories

### 5.1 Client Field Configuration (Settings UI) ✅ COMPLETE (2026-03-27)
- [x] Add "Client Field Configuration" card to SettingsPage hub (emerald icon, glassmorphism card)
- [x] Define TypeScript interfaces (`client-field-settings.types.ts`: FieldDefinition, FieldCategory, BatchUpdateResult, etc.)
- [x] Create `IClientFieldService` + `SupabaseClientFieldService` + `MockClientFieldService` + factory
- [x] Create `ClientFieldSettingsViewModel` (MobX: batch save, dirty tracking, custom field/category CRUD)
- [x] Create 6 UI components: `ClientFieldSettingsPage`, `ClientFieldTabBar`, `FieldDefinitionTab`, `FieldDefinitionRow`, `CustomFieldsTab`, `CategoriesTab`
- [x] Route at `/settings/client-fields` with `RequirePermission` gate on `organization.update`
- [x] `LOCKED_FIELD_KEYS` constant for 7 mandatory fields (lock icon, disabled toggles)
- [x] WAI-ARIA Tabs pattern with keyboard navigation (Arrow keys, Home/End)
- [x] Mock service seeded with 66 fields + 11 categories (matches bootstrap)

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
- [x] ADR document written and approved (2026-03-27)

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

**Phase**: Client Field Configuration — Backend DEPLOYED, Frontend IMPLEMENTED (not yet deployed)
**Status**: All 8 backend migrations deployed. Frontend `/settings/client-fields` page implemented (12 new files, 4 modified). Phase 2 RLS verification passed (11 assertions). Build + lint clean.

### Deployed (2026-03-27):
- **8 SQL migrations** (all deployed via CI/CD):
  1. `20260327205738_clients_projection.sql` — 53-column CQRS projection
  2. `20260327210520_client_field_registry.sql` — 4 tables + seeds (categories, definitions, references, templates)
  3. `20260327210838_contact_designations_projection.sql` — 12-value designation model
  4. `20260327211210_client_field_definition_events.sql` — dispatcher + router + 3 handlers
  5. `20260327211636_client_field_category_events.sql` — dispatcher + router + 2 handlers
  6. `20260327212247_client_field_api_functions.sql` — 8 API RPCs
  7. `20260327212739_client_field_event_types_seed.sql` — 5 event_types + AsyncAPI contracts
  8. `20260327223918_bootstrap_dynamic_progress.sql` — dynamic bootstrap progress (RPC rewrite + router CASE)
- **Temporal workflow changes**:
  - `seedFieldDefinitions` activity + `deleteFieldDefinitions` compensation (Step 1.6)
  - `emitBootstrapStepCompletedActivity` — 7 progress events per bootstrap
- **Handler reference files**: 5 new handlers + 2 routers + updated dispatcher + updated org router
- **AsyncAPI contracts**: 3 new domain files (field-definition, field-category, step-completed), `BootstrapStepKey` enum
- **Edge Function**: `workflow-status` v27 — removed hardcoded stages, passthrough from RPC
- **Frontend**: `BOOTSTRAP_STEPS` shared constant, `MockWorkflowClient` updated, `data-testid` on status page

### New tables created (7):
`clients_projection`, `client_field_categories`, `client_field_definitions_projection`, `client_reference_values`, `client_field_definition_templates`, `contact_designations_projection` + FK added on `user_client_assignments_projection`

### New functions created/modified (14):
5 handlers + 2 routers + 8 API RPCs (5 field def + 3 category) + rewritten `get_bootstrap_status()` (public + api)

### Bootstrap Progress Tracking (2026-03-27):
- **Problem solved**: 3 hardcoded stage lists (DB RPC, Edge Function, Mock client) drifted from actual workflow
- **Solution**: Workflow emits `organization.bootstrap.step_completed` events to org stream; RPC reads them via CTE manifest
- **Architecture review**: software-architect-dbc agent — 4 Major + 7 Minor findings, all remediated
- **Plan file**: `.claude/plans/vectorized-bouncing-iverson.md`
- **Gotcha**: `event_types` table has `event_schema` (jsonb NOT NULL), not `category` — CI caught this, fixed in follow-up commit

**Last Updated**: 2026-03-27
**Next Step**: Commit frontend changes + RLS test script + documentation updates. Then deploy via `git push` (triggers CI/CD). After deploy, test in mock mode at `/settings/client-fields`.

### Static Configuration Prototype Created (2026-03-23, archived 2026-03-27)
- Static HTML/CSS/JS prototype archived at `dev/active/client-management-applet-ux-prototype/` (zipped)
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
