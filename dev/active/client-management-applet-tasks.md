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
- [x] `client_field_definition_templates` table + RLS + 67 template row seeds
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

### Remaining Event Integration ✅ COMPLETE (2026-04-06)
- [x] `process_client_event()` router (22 CASE branches) — migration `20260406221738_client_sub_entity_events.sql`
- [x] Client lifecycle handlers (registered, updated, admitted, discharged) — 4 handlers
- [x] Insurance/placement/contact sub-entity handlers — 18 handlers
- [x] Client API functions (26 RPCs: 4 lifecycle + 2 query + 18 sub-entity + validation) — migration `20260406222857_client_api_functions.sql`
- [x] AsyncAPI contracts — 21 event types in `infrastructure/supabase/contracts/asyncapi/domains/client.yaml`
- [x] 23 event types seeded in `event_types` table
- [x] Fix RAISE WARNING → RAISE EXCEPTION — fixed earlier in migration `20260220185837`
- [x] TypeScript types generated from AsyncAPI

### Verification ✅ COMPLETE (2026-03-28)
- [x] plpgsql_check (`supabase db lint --level error`) — ⚠️ known limitation: all handlers report `RECORD not assigned` (sqlState 55000) because `p_event RECORD` parameter structure is indeterminate at static analysis time. Pre-existing across ALL handlers, not specific to new code. Functions work correctly at runtime.
- [x] AsyncAPI validates (`npm run check`) — 0 errors, 110 warnings (all pre-existing `messageId` governance). Type generation: 38 enums, 225 interfaces. New domain files `client-field-definition.yaml` + `client-field-category.yaml` processed successfully.
- [x] event_types count matches — 18 rows in `event_types` table. All 5 new client field events present (3 field definition + 2 category). Remaining ~92 existing events deferred to Client Intake comprehensive seed.
- [ ] Client CRUD event flow via SQL — DEFERRED (Client Intake project)
- [ ] Insurance policy CRUD event flow via SQL — DEFERRED (Client Intake project)

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
- [x] Mock service seeded with 67 fields + 11 categories (matches bootstrap)

### 5.2 Client Intake Form ✅ COMPLETE (2026-04-07)
- [x] Create `ClientIntakeFormViewModel` (612 lines: multi-section, validation, draft management, sub-entity collections)
- [x] 10 intake section components: Demographics, ContactInfo, Guardian, Referral, Admission, Insurance, Clinical, Medical, Legal, Education
- [x] `IntakeFormField` generic renderer (text, number, date, enum, multi_enum, boolean, jsonb)
- [x] `useFieldProps` hook — maps ViewModel field definitions to component props
- [x] Sub-entity collections: phones, emails, addresses, insurance policies, clinical contacts
- [x] Conditional rendering based on org's intake form configuration (field definitions → visibility)
- [x] Validation (required fields per section, sectionValidation computed)
- [x] Draft persistence to sessionStorage (PII-safe)
- [x] Submit flow: registerClient + parallel sub-entity RPCs with shared correlation ID
- [x] `ClientIntakePage` with multi-section stepper, sidebar nav, progress bar, footer nav

### 5.2b Client Intake E2E Tests ⏸️ IN PROGRESS (2026-04-13)
- [ ] Registration happy path: fill required fields across sections → submit → verify redirect
- [ ] Sub-entity collections: add phone/email/address → verify persistence across section nav
- [ ] Validation: submit button disabled without required fields → enabled after filling
- [ ] Draft persistence: fill fields → reload → verify data survives
- [ ] Error handling: submit error display, sub-entity partial failure warnings
- [ ] Diagnose co-owner-reported registration failure via E2E test failures

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
- [x] Create table docs: `clients_projection.md` (2026-03-28)
- [x] Create table docs: `client_field_definitions_projection.md` (2026-03-28)
- [x] Create table docs: `client_field_categories.md` (2026-03-28)
- [x] Create table docs: `client_reference_values.md` (2026-03-28)
- [x] Create table docs: `client_field_definition_templates.md` (2026-03-28)
- [x] Create table docs: `contact_designations_projection.md` (2026-03-28)
- [ ] Create table docs: `client_insurance_policies_projection.md` — DEFERRED (table not yet created)
- [ ] Create table docs: `client_contact_assignments.md` — DEFERRED (table not yet created)
- [x] Create architecture doc: `documentation/architecture/data/client-data-model.md` (2026-03-28)
- [ ] Update `contacts_projection.md` — document `user_id` FK addition — DEFERRED (FK existed in baseline)
- [x] Update `user_client_assignments_projection.md` — note new FK to clients_projection (2026-03-28)
- [x] Update `clients.md` — archived, redirects to clients_projection.md (2026-03-28)
- [x] Update `documentation/AGENT-INDEX.md` — 14 new keywords, 8 catalog entries (2026-03-28)
- [x] Update `documentation/README.md` — added Client Management section, client-data-model.md, updated table count to 37 (2026-03-28)
- [x] Update `dev/active/client-management-applet-tasks.md` — marked complete (2026-03-28)

## Success Validation Checkpoints

### Phase 1 Complete ✅
- [x] All field classifications documented (core vs. custom, owner vs. tenant)
- [x] Decision made on CQRS projection vs. direct table → `clients_projection` (full projection)
- [x] Cross-correlation audit complete (routers vs AsyncAPI)
- [x] Implementation plan written and ready for approval
- [x] ADR document written and approved (2026-03-27)

### Phase 2 Complete ✅ (2026-03-27)
- [x] All migrations applied successfully (8 migrations deployed via CI/CD)
- [x] RLS policies block cross-org access (tested — 11 assertions via Supabase MCP)
- [x] RLS policies allow same-org access (tested — 11 assertions via Supabase MCP)
- [x] `client_field_definitions_projection` has seed data for default field set (67 templates, seeded at bootstrap)
- [x] Value set tables seeded with OMB/ISO standards (40 ISO 639 languages)

### Phase 3 Complete (Client Field Configuration) ✅ (2026-03-28)
- [x] Field definition CRUD emits events, handlers update projection (3 handlers + 3 API RPCs)
- [x] Field category CRUD emits events, handlers update projection (2 handlers + 3 API RPCs)
- [x] Batch update API function (`api.batch_update_field_definitions`) for single network call
- [x] AsyncAPI validates — 0 errors, type generation produces 38 enums + 225 interfaces
- [x] 5 new event types registered in `event_types` table (18 total)
- [x] Handler reference files created (5 new handlers + 2 routers + updated dispatcher)
- [x] `plpgsql_check` — known limitation: `RECORD not assigned` false positive on all handlers (pre-existing)
- [x] Frontend settings page deployed via CI/CD (2026-03-28, health check green)
- [ ] `api.register_client()` emits event, handler updates projection — DEFERRED (Client Intake project)
- [ ] `api.list_clients()` returns filtered results with RLS — DEFERRED (Client Intake project)
- [ ] Domain events appear in `domain_events` table with stream_type='client' — DEFERRED (Client Intake project)
- [ ] `user_client_assignments_projection` FK to `clients_projection.id` works — DEFERRED (Client Intake project)
- [ ] All 9 RAISE WARNING routers fixed to RAISE EXCEPTION — DEFERRED (Client Intake project)
- [ ] AsyncAPI naming mismatches fixed (2) — DEFERRED (Client Intake project)
- [ ] All 110 event types registered in `event_types` table — DEFERRED (18/110 seeded, remaining in Client Intake comprehensive seed)
- [ ] Handler reference files created (13 new) and updated (11 existing) — DEFERRED (Client Intake project, 5/13 done)

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

## Phase B7: Client Field Configuration UI Enhancements ✅ COMPLETE (2026-04-07)

Architecture review: software-architect-dbc (4 Major + 7 Minor, all remediated).
Plan: `.claude/plans/jazzy-watching-creek.md`

### Frontend Changes ✅ COMPLETE
- [x] Item 5: Remove `jsonb` from custom field creation dropdown
- [x] Item 2: Previous/Next tab navigation buttons
- [x] Item 3: "Create & Add Another" button for custom fields
- [x] Item 4: Enum value configuration — chip UI for single/multi-select options
- [x] Item 5: Remove Structured from custom field creation (1 line)
- [x] Item 6: Edit custom fields — pencil button, inline form, field_type locked
- [x] Item 7: Edit custom categories — rename inline form, slug immutable
- [x] Item 1: 9 contact designation field templates in SYSTEM_FIELD_KEYS + MockClientFieldService

### Compliance Fixes ✅ COMPLETE
- [x] Correlation ID: All 7 write methods generate UUID per user action, forwarded end-to-end
- [x] WCAG aria-live: Save-changes panel has `role="region" aria-live="polite"`
- [x] Focus management: Edit form auto-focuses name input via useRef + useEffect
- [x] Enum validation: Create disabled without values; edit handler guards
- [x] Error clearing: clearFieldErrors()/clearCategoryErrors() on all cancel handlers
- [x] File extraction: EnumValuesInput component (94 lines) extracted from CustomFieldsTab
- [x] Loading spinner fix: Full-page spinner only on initial load to preserve local state

### Consolidated Migration (NOT YET DEPLOYED)
- [x] M2: Read-back guards on 4 existing RPCs
- [x] M4: Server-side sort_order auto-assignment in api.create_field_category()
- [x] Item 7: api.update_field_category() RPC + handler + router CASE + event_types seed
- [x] Item 1: 9 new contact designation template seeds with validation_rules widget hints
- [x] Handler reference files updated (1 new, 1 updated)
- [x] Deploy migration via CI/CD (commit `5d479918`, 2026-04-08)

### Playwright E2E Tests ✅ COMPLETE
- [x] 25 new test cases (54 total), all passing
- [x] Covers: prev/next nav, create another, enum values, structured removed, edit fields, edit categories, tab ordering, designation fields

### Remaining (deferred)
- [x] AsyncAPI contract for `client_field_category.updated` (M3) — added to client-field-category.yaml, types regenerated (273 interfaces)
- [ ] AsyncAPI `validation_rules` shape documentation (m1)
- [x] AsyncAPI type regeneration after schema updates (2026-04-08)

## Phase A0: Data-TestID Instrumentation ✅ COMPLETE (2026-04-06)

- [x] A0a: Add data-testid to Client Field Settings components (8 testids: SettingsPage 2 cards, ClientFieldSettingsPage back btn, TabBar scroll btns, CustomFieldsTab cancel+error, CategoriesTab cancel+error)
- [x] A0b: Add data-testid to Client List & Detail pages (6 testids: ClientListPage add btn+search+cards, ClientDetailLayout back btn+tabs)
- [x] Verify build clean after all changes

## Phase A: Client Field Configuration Test Suite ✅ COMPLETE (2026-04-06)

- [x] A1: ClientFieldSettingsViewModel unit test (56 cases) — `frontend/src/viewModels/settings/__tests__/ClientFieldSettingsViewModel.test.ts` (2026-04-06)
- [x] A2: seedFieldDefinitions activity unit test (12 cases) — `workflows/src/__tests__/activities/seed-field-definitions.test.ts` (2026-04-06)
  - Also created `workflows/jest.config.js` and `workflows/src/test-setup.ts` (first Jest tests in workflows project)
- [x] A3: SupabaseClientFieldService unit tests (26 cases) — `frontend/src/services/client-fields/__tests__/SupabaseClientFieldService.test.ts` (2026-04-06)
- [x] A4: E2E tests for Client Field Settings page (26 cases) — `frontend/e2e/client-field-settings.spec.ts` + `frontend/playwright.client-fields.config.ts` (2026-04-06)
- [x] A5: RLS verification script — 19 tests across 7 tables (org isolation, cross-org, bogus org, platform admin, global-read, write denial INSERT/UPDATE/DELETE) — `infrastructure/supabase/scripts/test-client-field-rls.sql` (2026-04-06)

## Phase B: Client Intake Full-Stack 🔄 IN PROGRESS

_Full plan at `.claude/plans/golden-booping-rainbow.md`._
_Key remediations: M1 (B2c removed — already done), M2 (JSONB payload), M3 (p_event_metadata), M4 (split B2a), M5 (split B4), M6 (validation helper), m1 (_projection suffix on all event-sourced tables)._

- [x] B1a: `client_contact_tables` migration — 4 tables (client_phones_projection, client_emails_projection, client_addresses_projection, client_contact_assignments_projection)
  - Migration: `20260406221732_client_contact_tables.sql`
- [x] B1b: `client_insurance_placement_tables` migration — 3 tables (client_insurance_policies_projection, client_placement_history_projection, client_funding_sources_projection)
  - Migration: `20260406221738_client_insurance_placement_tables.sql`
  - Note: `client_placement_history_projection` uses `_projection` suffix per m1 remediation
- [x] B1c: `client_permissions_seed` migration — only `client.discharge` is new (other 4 already in baseline)
  - Migration: `20260406221739_client_permissions_seed.sql`
  - Backfills existing provider_admin + clinician roles, adds permission implications
  - Updated authoritative seed files: `001-permissions-seed.sql` (reference), `002-role-permission-templates-seed.sql`
- [x] B2a-1: `client_lifecycle_event_handlers` migration — dispatcher + router + 4 lifecycle handlers
  - Migration: `20260406222201_client_lifecycle_event_handlers.sql`
  - Dispatcher: added `WHEN 'client' THEN PERFORM process_client_event(NEW)`
  - Router: `process_client_event()` with 4 CASE branches
  - Handlers: `handle_client_registered` (INSERT ON CONFLICT), `handle_client_information_updated` (partial UPDATE via changes JSONB), `handle_client_admitted`, `handle_client_discharged` (Decision 78 three-field decomposition)
  - Handler reference files: `handlers/client/` (4 files) + `handlers/routers/process_client_event.sql` + updated `handlers/trigger/process_domain_event.sql`
- [x] B2a-2: `client_sub_entity_event_handlers` migration — 19 sub-entity handlers + extended router (23 CASE branches)
  - Migration: `20260406222642_client_sub_entity_event_handlers.sql`
  - Phone (3), Email (3), Address (3), Insurance (3), Placement (2), Funding (3), Contact Assignment (2)
  - Placement handler: closes previous (is_current=false), inserts new, denormalizes to clients_projection.placement_arrangement
  - Handler reference files: `handlers/client/` (19 new files) + updated `handlers/routers/process_client_event.sql`
- [x] B2b: `contact_designation_event_handlers` migration — 2 handlers in process_contact_event()
  - Migration: `20260406222759_contact_designation_event_handlers.sql`
  - Added `contact.designation.created` + `contact.designation.deactivated` CASE branches
  - Handler reference files: `handlers/contact/` (2 files) + updated `handlers/routers/process_contact_event.sql`
- [x] B3: `client_api_functions` migration — 22 RPCs + validate_client_required_fields() helper
  - Migration: `20260406222857_client_api_functions.sql`
  - Lifecycle: register_client (JSONB payload, 7 mandatory + org-specific validation), update_client, admit_client, discharge_client
  - Query: list_clients (status filter + search), get_client (full record with sub-entity lateral joins)
  - Sub-entity CRUD: add/update/remove × phone/email/address/insurance (12 RPCs)
  - Placement: change_client_placement, end_client_placement
  - Contact: assign_client_contact, unassign_client_contact
  - All write RPCs include p_event_metadata + p_correlation_id, permission checks, org-scoped
- [x] B4a: AsyncAPI contracts — new `client.yaml` (23 events, 37 schemas), 2 designation events + 4 schemas added to `contact.yaml`, `asyncapi.yaml` channel refs + stream_type enum updated, types regenerated + copied to frontend
- [x] B4b: `client_event_types_seed` migration + type generation
  - Migration: `20260406225150_client_event_types_seed.sql`
  - 25 event types seeded: 23 client (lifecycle + sub-entity CRUD + placement + contact assignment) + 2 contact designation
  - AsyncAPI types regenerated (38 enums, 271 interfaces) and copied to frontend
- [x] B5a: Client types (`frontend/src/types/client.types.ts`)
  - 17 union types (matching DB CHECK constraints), display label maps, 7 sub-entity interfaces
  - `Client` (full read model, 50+ fields + sub-entity arrays), `ClientListItem` (list subset)
  - Params types (Register, Update, Admit, Discharge, sub-entity CRUD), `ClientRpcResult`
- [x] B5b: Client service layer (IClientService, Supabase, Mock, Factory)
  - `frontend/src/services/clients/` — 5 files, 25 methods on IClientService
  - SupabaseClientService: all calls via `supabase.schema('api').rpc()`, JSON.parse responses
  - MockClientService: 3 seeded clients, in-memory CRUD, simulateDelay, deep copies
  - ClientServiceFactory: getDeploymentConfig() detection, singleton with reset
- [x] B5c: ClientIntakeFormViewModel (multi-section, validation, sessionStorage draft)
  - `frontend/src/viewModels/client/ClientIntakeFormViewModel.ts`
  - 10-section navigation, field-definition-driven validation, sessionStorage drafts
  - Submit orchestration: registerClient + Promise.allSettled sub-entity RPCs with shared correlation ID
  - Draft types: DraftPhone, DraftEmail, DraftAddress, DraftInsurance, DraftClinicalContact
- [x] B6a: 10 intake form section components + IntakeFormField helper + getFieldProps utility
  - `frontend/src/pages/clients/intake/` — 14 files (10 sections, helper, field props util, types, barrel index)
  - IntakeFormField: renders text/date/number/enum/multi_enum/boolean/jsonb based on FieldDefinition metadata
  - getFieldProps: derives field props from ViewModel (visibility, required, validation errors)
  - DemographicsSection: 19 fields (names, DOB, gender, race/ethnicity, language, identifiers)
  - ContactInfoSection: sub-entity collections (phones, emails, addresses) with add/remove/type/primary
  - GuardianSection: legal_custody_status, court_ordered_placement, financial_guarantor_type
  - ReferralSection: referral source, org, date, reason
  - AdmissionSection: admission date/type, level of care, risk level, placement arrangement
  - InsuranceSection: medicaid/medicare IDs + insurance policy sub-entity collection
  - ClinicalSection: diagnoses (JSONB), risk statuses, trauma/substance/developmental/treatment history
  - MedicalSection: allergies, conditions, immunization, dietary, special needs
  - LegalSection: court case, state agency, legal status, mandated reporting, protective services, safety plan
  - EducationSection: education status, grade level, IEP status
- [x] B6b: ClientIntakePage (multi-section layout, route: /clients/register)
- [x] B6c: Rewrite ClientListPage on new types/service + delete legacy `types/models/Client.ts` and `mocks/data/clients.mock.ts`
- [x] B6d: Rewrite ClientDetailLayout (full record display, discharge action)
- [x] B6-review: Architecture review by software-architect-dbc — 5 Major + 4 Minor findings (2026-04-08)
  - Migration `20260408000351_fix_client_api_architecture_review.sql` — DEPLOYED (2026-04-08)
  - Frontend: AdmissionSection enum fix + SupabaseClientService "All" tab fix — DEPLOYED (2026-04-08)
- [x] B6-scalar-fix: PostgREST jsonb scalar wrapping fix for batch_update_field_definitions (2026-04-08)
  - Migration `20260408012329_fix_batch_update_jsonb_scalar.sql` — DEPLOYED (2026-04-08)
  - Root cause: PostgREST wraps jsonb array params as string scalars; server-side unwrap via `jsonb_typeof` + `#>> '{}'`
  - Also applied live via `execute_sql` before CI/CD deploy for immediate testing
- [x] B7: Integration testing + documentation (7 table docs, E2E, RLS, AGENT-INDEX) (2026-04-08)

## Phase B8: Custom Field & Category Lifecycle Parity 🔄 IN PROGRESS (2026-04-20)

Goal: bring Custom Fields and Custom Categories to full 3-stage lifecycle parity with Roles / Organization Units / Users / Schedules. Today they only support deactivate (one-way) and have no Inactive-state UI. Target: Deactivate → Reactivate → Hard Delete, with deactivated rows visible under a status filter.

User-confirmed decisions (2026-04-20):
- Full parity — add reactivate + hard delete to BOTH entity types (Decision 98).
- Field delete gate: block if `api.get_field_usage_count > 0` (Decision 99).
- Category delete gate: zero rows in `client_field_definitions_projection` (active + inactive). Hard-deleted fields are physically gone so they don't block the category delete (Decision 100).
- Reactivation does NOT cascade to children — user reactivates each field individually. Asymmetric with deactivation (which does cascade via events) (Decision 101).

Plan file: `.claude/plans/read-dev-active-client-management-applet-mellow-sprout.md`

### Backend (all done, NOT YET DEPLOYED — on local disk only)
- [x] Migration `20260420160421_field_category_reactivate_delete.sql` — created via `supabase migration new`, passes `db push --dry-run`
- [x] 4 new RPCs: `api.reactivate_field_definition`, `api.delete_field_definition`, `api.reactivate_field_category`, `api.delete_field_category` (all with `p_correlation_id`, permission check on `organization.update`, read-back guards)
- [x] 4 new handlers: `handle_client_field_definition_reactivated`, `handle_client_field_definition_deleted`, `handle_client_field_category_reactivated`, `handle_client_field_category_deleted`
- [x] Router updates: `process_client_field_definition_event` + `process_client_field_category_event` each get 2 new CASE branches (keep `RAISE EXCEPTION` ELSE)
- [x] `event_types` seed: 4 new rows (field + category × reactivated + deleted)
- [x] `api.list_field_categories(p_include_inactive boolean)` — dropped old signature, recreated with optional param
- [x] `api.get_category_field_count(p_category_id, p_include_inactive)` — extended with optional param for delete-gate query
- [x] GRANTs updated (authenticated, service_role for list_field_categories)
- [x] Handler reference files: 4 new `.sql` files created under `handlers/client_field_definition/` and `handlers/client_field_category/`
- [x] Router reference files updated: `handlers/routers/process_client_field_definition_event.sql`, `.../process_client_field_category_event.sql`

### AsyncAPI + Types (all done)
- [x] `client-field-definition.yaml`: added `ClientFieldDefinitionReactivated` + `ClientFieldDefinitionDeleted` messages, `*ReactivatedEvent/Data` + `*DeletedEvent/Data` schemas
- [x] `client-field-category.yaml`: same pattern for category
- [x] `asyncapi.yaml`: 4 new `$ref` entries added to messages union
- [x] Regenerated types: **38 enums, 281 interfaces** (was 271). Copied to `frontend/src/types/generated/generated-events.ts`.

### Service Layer (all done)
- [x] `IClientFieldService`: added `reactivateFieldDefinition`, `deleteFieldDefinition`, `reactivateFieldCategory`, `deleteFieldCategory`. Extended `listFieldCategories(includeInactive?)` and `getCategoryFieldCount(categoryId, includeInactive?)`.
- [x] `SupabaseClientFieldService`: 4 new RPC calls, wired `p_include_inactive` param through for list + count helpers
- [x] `MockClientFieldService`: 4 new in-memory methods, usage-count gate mirrored in deleteFieldDefinition mock (matches backend UX for E2E). `listFieldCategories(true)` returns inactive rows.
- [x] `RpcResult` type: added `usage_count?`, `child_count?`, `child_names?` fields (for blocked-delete dialog enumeration)

### ViewModel (all done)
- [x] `FieldStatusFilter = 'all' | 'active' | 'inactive'` exported type
- [x] Observables: `fieldStatusFilter`, `categoryStatusFilter` (default `'active'`)
- [x] Setters: `setFieldStatusFilter`, `setCategoryStatusFilter`
- [x] Computeds: `visibleCustomFields` (non-system + status filter + alphabetical), `visibleCustomCategories` (system always included)
- [x] `fieldsByCategory` now filters `is_active = true` explicitly (avoids leaking deactivated custom fields into system-category tabs since loadData now pulls all rows)
- [x] `changedFields` skips `!is_active` (can't batch-edit deactivated)
- [x] `loadData` calls `listFieldDefinitions(true)` + `listFieldCategories(true)` — always loads all rows, UI filters client-side
- [x] 4 new action methods: `reactivateCustomField`, `deleteCustomField`, `reactivateCategory`, `deleteCategory`. `delete*` methods return a richer result (`{success, error, usageCount | childCount, childNames}`) so callers can enumerate dependencies.
- [x] New state: `isFieldLifecycleActionInProgress`, `fieldLifecycleError`, `isCategoryLifecycleActionInProgress`, `categoryLifecycleError`, and clear* helpers
- [x] `getCategoryFieldCount(id, includeInactive)` pass-through

### UI — CustomFieldsTab ✅ COMPLETE
- [x] Imports updated (`RotateCcw` from lucide-react, `FieldStatusFilter` type)
- [x] Replaced inline `customFields = fields.filter(...is_active)` with `viewModel.visibleCustomFields`
- [x] Added `reactivateTarget` + `deleteTarget` local state
- [x] Status filter bar (All / Active / Inactive) bound to `viewModel.setFieldStatusFilter` with `aria-pressed` and `data-testid="cf-status-filter-{all|active|inactive}"`
- [x] "Inactive" badge on rows where `!field.is_active` (`data-testid="cf-inactive-badge-{field_key}"`)
- [x] Conditional row actions: active → Edit + Deactivate (unchanged); inactive → Reactivate (green `RotateCcw`) + Delete (red `Trash2`). Edit hidden on inactive.
- [x] Reactivate button + success-variant `ConfirmDialog` calling `vm.reactivateCustomField`.
- [x] Delete button with pre-query `vm.getFieldUsageCount`: count > 0 → blocked dialog with `confirmDisabled={true}`, "Dismiss" cancel label; count = 0 → danger confirm with `requireConfirmText = field.display_name`.
- [x] `aria-label` on new action buttons: `Reactivate <name>` / `Delete <name>`.
- [x] `ConfirmDialog` extended with `confirmDisabled?: boolean` prop for blocked-destructive-action dialogs.
- [x] `fieldLifecycleError` banner surfaced at top of tab (`role="alert"`).

### UI — CategoriesTab ✅ COMPLETE
- [x] Status filter bar (`data-testid="cat-status-filter-{all|active|inactive}"`) bound to `viewModel.setCategoryStatusFilter`
- [x] Replaced inline `activeCategories = categories.filter((c) => c.is_active)` with `viewModel.visibleCustomCategories`
- [x] System categories always visible (never filtered out) — matches pre-existing behavior
- [x] Inactive badge (`data-testid="cat-inactive-badge-{slug}"`) + conditional Edit/Deactivate vs Reactivate/Delete action buttons
- [x] Reactivate dialog (`variant="success"`) calling `vm.reactivateCategory` — explanatory copy notes children do NOT auto-reactivate
- [x] Delete pre-query `vm.getCategoryFieldCount(id, includeInactive=true)` — matches server-side gate exactly. count > 0 → blocked dialog with enumerated field names via `details` prop; count = 0 → danger confirm with `requireConfirmText = category.name`
- [x] `categoryLifecycleError` banner surfaced at top of tab (`role="alert"`)
- [x] Uses `result.childNames` from `vm.deleteCategory` to refresh enumeration if the server disagrees with the client pre-check

### E2E Tests ✅ COMPLETE
- [x] Appended to `frontend/e2e/client-field-settings.spec.ts` (6 new tests, 60 total)
- [x] `Inactive filter reveals deactivated fields with Inactive badge` — verifies Reactivate/Delete buttons present, Edit hidden
- [x] `Reactivate flow returns a deactivated field to Active` — success dialog → confirm → disappears from Inactive, re-appears in Active
- [x] `Delete blocked when field has client usage` — `field_key` containing `weekend` (mock returns usage=3) → dialog confirm button disabled, Dismiss remains enabled
- [x] `Delete happy path removes field from all filters with typed confirmation` — typed-confirm → removed from Active, Inactive, and All filters
- [x] `Reactivate flow returns a deactivated category to Active` — inactive badge visible, reactivate → Active filter shows row
- [x] `Delete happy path removes empty deactivated category with typed confirmation` — typed-confirm flow for categories

### Documentation ✅ COMPLETE
- [x] Updated `documentation/frontend/patterns/danger-zone-pattern.md` Consumer table: new `Lifecycle` column showing 3-stage verbs for ALL rows, CustomFieldsTab + CategoriesTab rows updated with full lifecycle + accurate cascade/dependency-check detail. `last_updated: 2026-04-20`.
- [x] Added Decisions 98-101 to `dev/active/client-management-applet-context.md` — full lifecycle, field delete gate (usage count), category delete gate (projection row count, active + inactive), reactivation no-cascade.
- [x] `dev/active/client-management-applet-plan.md` already has "Plan Updates (2026-04-20) — Custom Field/Category Lifecycle Parity" section (line 646).

### Verification ✅ COMPLETE (2026-04-20)
- [x] `supabase db push --linked --dry-run` clean
- [x] `cd frontend && npx tsc --noEmit` clean, `npx eslint` clean on changed files, `npm run build` green (5.71s, 1,783 KB bundle)
- [x] Playwright full suite: **60/60 passing** (54 pre-existing + 6 new lifecycle tests)
- [ ] Deploy migration via `git push` → CI/CD pipeline (FINAL STEP — not yet done)

### Architecture Review + Remediation ✅ COMPLETE (2026-04-20)

software-architect-dbc reviewed Phase B8 and flagged **0 Major + 7 Minor findings**. All actionable Minors remediated; 3 accepted as-is per architect's own guidance.

Remediated:
- **m3** (consolidate dup preconditions): `api.delete_field_definition` + `api.delete_field_category` each collapsed two SELECTs into a single `SELECT ... INTO v_field/v_category` with `is_active` included; dropped the subsequent `IF EXISTS` check. Migration still passes dry-run.
- **m2/m6** (orphan-category warning on field reactivate): `CustomFieldsTab` reactivate dialog now detects when the field's parent category is inactive and shows *"The parent category 'X' is currently inactive, so this field will stay hidden from the intake form until the category is reactivated too. Proceed anyway?"* Warn-don't-block per architect recommendation. `reactivateTarget` state extended with `parentCategoryInactive` + `parentCategoryName`.
- **m7** (inactive child count on category reactivate): `CategoriesTab` reactivate dialog now reports *"N child field(s) are still inactive and will stay inactive"* and renders the enumerated list via `details` prop. `reactivateTarget` state extended with `inactiveChildCount` + `inactiveChildNames`. Count sourced from `viewModel.fieldDefinitions` filtered by `category_id && !is_active`.

Accepted (no action needed):
- **m1** (smaller event-metadata surface): inherited from peer RPCs (schedule-assignment family uses the same minimal set). Future cleanup is an `api.build_event_metadata()` helper, not a B8 concern.
- **m4** (child-count query via event-data predicate, not JWT session): Safe because `v_org_id` is JWT-derived via `get_current_org_id()`.
- **m5** (mock `getFieldUsageCount` is a stub): Conscious mock-mode limitation. Add server-side integration test in a follow-up if desired.

### Gotchas Discovered
- `SYSTEM_FIELD_KEYS` moved to ViewModel: was used inline in CustomFieldsTab, now applied inside `visibleCustomFields` computed. Tab no longer imports it directly.
- `fieldsByCategory` requires explicit `is_active=true` filter after switching loadData to include inactive rows. Without this, deactivated custom fields assigned to a system category (like Clinical) would leak into that system tab.
- `changedFields` must skip `!is_active` — otherwise a deactivated row with stale original state generates phantom batch-update diffs.
- `api.list_field_categories` and `api.get_category_field_count` signatures changed — used `DROP FUNCTION IF EXISTS ...(uuid)` first, then recreated with optional `p_include_inactive` param. New GRANTs are needed on the new signatures.
- Tab-level Custom Fields/Categories UX **intentionally uses inline `ConfirmDialog`**, NOT the collapsible `DangerZone` component. The danger-zone-pattern doc (line 26-37) defines this split: DangerZone for manage-page entities, inline ConfirmDialog for tab-level list items. Don't change this.
- The mock service's `getFieldUsageCount` returns 3 when `fieldKey.includes('weekend')` — use this as a hook for E2E tests to trigger the blocked-delete path.
- `ConfirmDialog` got a new `confirmDisabled?: boolean` prop (shared-component extension, NOT a fork). Use it for blocked-destructive-action dialogs where only the Cancel button should be interactive — keeps the Confirm button visible-but-disabled (communicates "action blocked" better than hiding it). Pairs with `cancelLabel="Dismiss"` for the blocked state.
- Architect finding m2 resolved via **warn-don't-block**: `api.reactivate_field_definition` does NOT gate on parent category state. The UI surfaces the orphan state instead. This keeps the RPC contract simple and lets admins reactivate in any order.

## Current Status

**Phase**: Phase B8 — Custom Field/Category Lifecycle Parity 🟢 READY TO DEPLOY
**Status**: All code + tests + docs + architect remediation complete. 60/60 Playwright tests green. Only step remaining is `git push` to trigger CI/CD deployment of the undeployed migration.
**Migrations**: 15 deployed + 1 **uncommitted, undeployed** (`20260420160421_field_category_reactivate_delete.sql`) on local disk only. Dry-run passes.

**Last Updated**: 2026-04-20 (after architect review + remediation)
**Next Step (after /clear)**: Final review of staged changes, then `git add` + `git commit` + `git push`. Plan file: `.claude/plans/read-dev-active-client-management-applet-mellow-sprout.md`. Architect remediation is inline in this file under "Architecture Review + Remediation" above.

**Plan file**: `.claude/plans/read-dev-active-client-management-applet-mellow-sprout.md` (approved plan for Phase B8).

### Recent Fixes (2026-04-14):
- `aee11d28`: Danger-zone confirmation for custom field/category deactivation. New migration `20260415022432_field_deactivation_confirmation.sql`; new pattern doc `documentation/frontend/patterns/danger-zone-pattern.md`; `BaseDangerZoneState` shared type; cascade-via-events (category deactivate emits individual `client_field_definition.deactivated` events under shared `correlation_id`); new RPCs `api.get_field_usage_count`, `api.get_category_field_count`. Architecture review: 3 Major + 4 Minor remediated.
- `9abbe28c`: Sort custom fields alphabetically by display name (CustomFieldsTab).
- `998ebe14`: Custom category tabs sorted alphabetically after system categories (ViewModel `tabList`). Also a data patch for Live-for-Life tenant `sort_order=0` row.
- `864f2b4d`: Read-back guard fix for re-creating a deactivated custom field. `ON CONFLICT (organization_id, field_key)` updates the existing row retaining its original `id`, so the read-back guard must query by `(organization_id, field_key)`, not `id`. Migration `20260415003931_fix_create_field_readback_guard.sql`.
- `1d6dcf10`: Friendly error message for duplicate custom field name (`"<Display Name>" already exists. Choose another name.`).

### Recent Fixes (2026-04-09):
- `283a21f0`: ViewModel preserveChanges + session correlation ID
- `697068b8`: Enum validation_rules double-stringification fix + data repair migration + enum display in read-only view

### Test Files Created (2026-04-06):
- `frontend/src/viewModels/settings/__tests__/ClientFieldSettingsViewModel.test.ts` — 56 tests (Vitest): default state, loadData, computed properties (fieldsByCategory, tabList, configurableFieldCount), toggle/set actions, change tracking (locked field skip, multi-change, toggle-back), reason validation, canSave, saveChanges (success/reload/failure/partial), resetChanges, custom field CRUD (create/deactivate success/failure/exception), category CRUD (create/deactivate success/failure/exception)
- `workflows/src/__tests__/activities/seed-field-definitions.test.ts` — 12 tests (Jest): idempotency guard, empty/null templates, 3 RPC error cases, happy path event emission (2 templates → 2 events with correct params), category slug mismatch skip, correlation ID from tracing vs generated, deleteFieldDefinitions RPC call + error
- `frontend/src/services/client-fields/__tests__/SupabaseClientFieldService.test.ts` — 26 tests (Vitest): all 7 methods success + error paths, null→empty array, JSON string parse, default parameter values, stringified p_changes
- `frontend/e2e/client-field-settings.spec.ts` — 26 tests (Playwright E2E): navigation (settings hub → client fields, back button, page header), tab bar (system tabs, click switch, keyboard nav, WAI-ARIA attributes), field definitions (display, locked indicator, disabled toggle, visibility toggle, required toggle, label input), save/reset (no panel without changes, reason validation, reset, save success), custom fields (empty state, form open/close, create, deactivate), categories (system lock, form open/close, auto-slug, create, deactivate)
- `frontend/playwright.client-fields.config.ts` — Dedicated Playwright config (port 3457, VITE_FORCE_MOCK=true, VITE_DEV_PROFILE=provider_admin)
- `workflows/jest.config.js` — Jest config with ts-jest preset and path aliases
- `workflows/src/test-setup.ts` — Jest setup file

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

**Plan**: `.claude/plans/cached-shimmying-feigenbaum.md` (may have been cleaned up — work from dev-docs directly if missing).

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
