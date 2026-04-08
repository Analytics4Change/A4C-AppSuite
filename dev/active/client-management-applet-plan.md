# Implementation Plan: Client Management Applet

## Executive Summary

The client management applet is the core data-entry surface for A4C-AppSuite. It captures intake data for at-risk youth placed in habilitative care across ~300 provider organizations. The applet must support org-configurable intake fields while producing conforming dimensional attributes that feed a Cube.js semantic layer for self-service BI analytics.

No legacy `clients` table exists in the v4 baseline — this is greenfield. The implementation creates `clients_projection` as a full CQRS projection table with event-sourced field definitions, value set reference tables, 11 event handlers, 20 API functions, and comprehensive event type registration.

## Detailed Plan Location

**The authoritative implementation plan is at**: `.claude/plans/spicy-bubbling-quail.md`

This ~1,150-line plan file contains:
- Complete SQL schemas for all 5 migrations
- Full cross-correlation audit of all 110 event types (routers vs AsyncAPI)
- Handler specifications for 11 new handlers + 9 router ELSE fixes
- API function signatures for 20 functions
- AsyncAPI contract creation and fix specifications
- Handler reference file creation plan (13 new + 11 updated)
- Verification plan with SQL test queries
- Complete file creation/modification manifest

## Phase Summary

### Phase 1: Research & Discovery ✅ COMPLETE
- All intake fields cataloged and classified
- `clients_projection` as full CQRS projection (stream_type: `client`)
- Cross-correlation audit complete: 93 existing + 17 new = 110 total events
- Found: 2 AsyncAPI naming mismatches, 3 missing contracts, 9 RAISE WARNING fixes
- Plan written and ready for approval

### Phase 2: Schema Foundation ⏸️ PENDING (scope expanded 2026-03-14, updated 2026-03-26)
Migrations planned:
1. `clients_projection` (~50 typed columns + `placement_arrangement` + custom_fields JSONB) + indexes + RLS + FK — reduced from ~55 (dropped internal_case_number, county, email, phones, preferred_communication_method)
1b. Client-owned contact tables (`client_phones`, `client_emails`, `client_addresses` — standalone, NOT junctions) + contact-designation model (12 designations)
1c. `client_insurance_policies_projection` (CQRS event-sourced) + `client_funding_sources_projection`
1d. `client_placement_history` (CQRS event-sourced, placement trajectory with date ranges — Decision 83)
2. `client_field_definitions_projection` + `client_reference_values` + `client_field_categories` + seeds + RLS
3. Dispatcher update + 2 routers + ~25 handlers (expanded for insurance + discharge + placement + client contact sub-entities) + 9 RAISE WARNING fixes
4. ~36 API functions (expanded client CRUD + insurance + placement + client contact CRUD + field definitions + contact-designation)
5. `event_types` seed (expanded) + AsyncAPI contracts + TypeScript types

### Phase 3: Event Integration ⏸️ PENDING
Covered by migrations 3-5 above. Also includes:
- Handler reference files (13 new, 11 updated)
- AsyncAPI contract creation + fixes
- Verification and testing

### Phase 4: Analytics Foundation ⏸️ PENDING
- Cube.js PatientDimension cube design
- Dynamic schema generation from field registry
- Computed dimensions (age_group, length_of_stay, admission_cohort)
- Pre-aggregation strategy

### Phase 5: Frontend Intake Form (Future)
_Deferred — this plan covers foundation only._

## Plan Updates (2026-03-26) — Enum Definitions & Discharge Decomposition

### Discharge Three-Field Decomposition (Decision 78)
`discharge_type` replaced by three orthogonal fields. Informed by external LLM analysis of discharge classification in residential behavioral health:
- **`discharge_outcome`**: Binary (`successful` | `unsuccessful`) — mandatory at discharge, primary reporting dimension
- **`discharge_reason`**: 14 values — mandatory at discharge (graduated_program, achieved_treatment_goals, awol, ama, administrative, hospitalization_medical, insufficient_progress, intermediate_secure_care, secure_care, ten_day_notice, court_ordered, deceased, transfer, medical)
- **`discharge_placement`**: 9 values — configurable presence + optional (home, lower_level_of_care, higher_level_of_care, secure_care, intermediate_secure_care, other_program, hospitalization, incarceration, other)
- Mandatory-at-discharge fields updated: `discharge_date`, `discharge_outcome`, `discharge_reason` (was: `discharge_date`, `discharge_reason`, `discharge_type`)
- Full 4NF discharge management (reporting flags, compliance actions) deferred to future applet

### Enum Values Defined (Decisions 79-80)
- `marital_status`: single, married, divorced, separated, widowed, domestic_partnership
- `suicide_risk_status`: low_risk, moderate_risk, high_risk

### Legal Custody Status Separated from Placement (Decision 82)
`legal_custody_status` = who holds legal authority (6 values: `parent_guardian`, `state_child_welfare`, `juvenile_justice`, `guardianship`, `emancipated_minor`, `other`). No required elaboration for `other`. Replaces old values (`voluntary`, `court_ordered`, `guardianship`).

### Placement Arrangement — New Field + History Table (Decision 83)
- `placement_arrangement` on `clients_projection` — denormalized current placement, 13 values (SAMHSA/state Medicaid standard), configurable_presence + optional, **reporting dimension**
- `client_placement_history` — CQRS event-sourced history table with date ranges. Events: `client.placement.changed`, `client.placement.ended`
- Intake captures initial placement; transition UI deferred
- **New table count: 12** (was 11). Added Migration 1d.

### Financial Guarantor Type Defined (Decision 84)
8 values: `parent_guardian`, `state_agency`, `juvenile_justice`, `self`, `insurance_only`, `tribal_agency`, `va`, `other`. All TBD enums now resolved.

### Implementation Plan File — Recreated (2026-03-27)
New plan file: `.claude/plans/peaceful-marinating-bonbon.md` — covers Client Field Configuration project (8 migrations + frontend).
Architecture review: `.claude/plans/peaceful-marinating-bonbon-agent-af9009328e6dbb9f1.md` — 5 Major + 6 Minor findings, all remediated.

## Plan Updates (2026-03-27) — Implementation Split & Architecture Review

### Implementation Split into Two Projects
1. **Client Field Configuration** (current focus) — Settings page + backend for configuring field visibility, required flags, labels, custom fields, categories. 8 migrations + frontend. Plan: `.claude/plans/peaceful-marinating-bonbon.md`
2. **Client Intake** (future) — Actual intake form, registration API, client lifecycle events, sub-entity tables, contact assignments.

### Page Renamed
"Client Intake Configuration" → **"Client Field Configuration"** at `/settings/client-fields`. The page manages fields across all lifecycle operations (intake, discharge, placement), not just intake.

### Architecture Review Findings (software-architect-dbc agent)
5 Major findings remediated:
- **M1**: Missing AsyncAPI contracts → added `client-field-definition.yaml` + `client-field-category.yaml` + type generation
- **M2**: Missing `event_types` seed → added 5 new event types
- **M3**: Bootstrap activity not specified → added `client_field_definition_templates` table + `seedFieldDefinitions` activity + compensation
- **M4**: `p_correlation_id` missing from write RPCs → added to all signatures
- **M5**: `client_field_categories` CQRS violation → now event-sourced with `client_field_category` stream type

6 Minor findings remediated:
- m1: Read RLS relaxed to org-member match (no permission check)
- m2: Batch RPC `api.batch_update_field_definitions()` for single network call
- m3: Tab navigation documented as intentional, WAI-ARIA Tabs Pattern required
- m4: `p_include_inactive` param added to `api.list_field_definitions()`
- m5: `#variable_conflict use_column` required in all RETURNS TABLE functions
- m6: Handler reference files explicitly listed (5 handlers + 2 routers)

### New Stream Types (from architecture review)
- `client_field_category` (2 events: created, deactivated) — M5 remediation
- Total new event types in this implementation: 5 (3 field definition + 2 category)

### Migration Count Updated
8 migrations (was 5 in Phase 2 tasks):
1. `clients_projection` DDL
2. Field registry + reference tables + templates
3. `contact_designations_projection` DDL
4. Field definition event infrastructure (dispatcher + router + 3 handlers)
5. Field category event infrastructure (dispatcher + router + 2 handlers)
6. API functions (5 field def + 3 category)
7. AsyncAPI contracts + `event_types` seed
8. Bootstrap workflow activity + compensation

### UX Prototype Archived
Static HTML prototype moved from `~/tmp/` to `dev/active/client-management-applet-ux-prototype/` (zipped). Design reference only — divergences from authoritative design documented in plan.

## Plan Updates (2026-03-27) — Frontend Settings Page + RLS Verification

### Frontend `/settings/client-fields` Implemented
12 new files + 4 modified files. Build + lint clean. Pattern follows DirectCareSettings exactly.

**New files created**:
- `frontend/src/types/client-field-settings.types.ts` — FieldDefinition, FieldCategory, BatchUpdateResult, LOCKED_FIELD_KEYS
- `frontend/src/services/client-fields/` — IClientFieldService, SupabaseClientFieldService, MockClientFieldService, ClientFieldServiceFactory
- `frontend/src/viewModels/settings/ClientFieldSettingsViewModel.ts` — MobX VM with batch save, dirty tracking, CRUD
- `frontend/src/pages/settings/ClientFieldSettingsPage.tsx` — Page shell with save/reset actions
- `frontend/src/pages/settings/client-fields/` — ClientFieldTabBar, FieldDefinitionTab, FieldDefinitionRow, CustomFieldsTab, CategoriesTab

**Modified files**:
- `frontend/src/App.tsx` — added `/settings/client-fields` route with RequirePermission
- `frontend/src/pages/settings/SettingsPage.tsx` — added "Client Field Configuration" card (emerald ClipboardList icon)
- `frontend/src/pages/settings/index.ts` — added ClientFieldSettingsPage export

### Phase 2 RLS Verification Completed
11 RLS assertions passed via Supabase MCP `execute_sql` tool:
- Org isolation (field definitions, categories), bogus org sees 0, system categories visible to all
- Platform admin cross-org access, write denial for authenticated role
- Test script: `infrastructure/supabase/scripts/test-client-field-rls.sql`
- Note: `client_field_definitions_projection` is empty (existing orgs bootstrapped before seedFieldDefinitions activity)

### Documentation Updated
- `DAY0-MIGRATION-GUIDE.md` — new "Post-Reset RLS Verification" section (why, how, future pgTAP)
- `AGENT-INDEX.md` — added `rls-verification` keyword, updated catalog entry

## Plan Updates (2026-03-27) — All 8 Backend Migrations Implemented

### Implementation Session Summary
All 8 backend migrations for Client Field Configuration implemented in a single session. All 7 SQL migrations pass `supabase db push --linked --dry-run`. TypeScript + ESLint clean.

### Key Implementation Details
- **`clients_projection`**: 53 typed columns (not 55 — `email`, `phone_primary`, `phone_secondary`, `preferred_communication_method`, `county` dropped per Decisions 57/64/65). Status CHECK: `active | inactive | discharged` (3 values, not 2).
- **Field categories**: 11 system categories (demographics through education), matching wizard steps. Was 5 in Decision 32 but expanded to cover all wizard sections.
- **Template seeds**: 67 field definition templates covering all 11 categories. 7 mandatory fields locked (`is_locked = true`).
- **Language seeds**: 40 ISO 639 entries ranked by US healthcare relevance.
- **RLS pattern**: CQRS projections use org-scoped SELECT only — no INSERT/UPDATE/DELETE for `authenticated` (service_role writes via event handlers bypass RLS). Matches `schedule_templates_projection` precedent.
- **Handler pattern**: `handle_client_field_definition_updated` uses COALESCE for non-nullable fields + CASE/`?` for nullable fields (partial update support).
- **Workflow integration**: Step 1.6 (after permissions, before DNS). Compensation deactivates field definitions (before deleteContacts in reverse order).
- **Untyped Supabase tables**: Activity uses `(supabase as any).from('new_table')` with eslint-disable blocks since generated types don't include new tables yet. Types will be regenerated after migration push.
- **Plan file**: `.claude/plans/peaceful-marinating-bonbon.md` was cleaned up and does not exist. All implementation was driven from dev-docs files directly.

### All Migrations Deployed (2026-03-27)
All 8 SQL migrations deployed via CI/CD (`git push` → GitHub Actions). 5 pipelines passed:
- Deploy Database Migrations (8 migrations applied)
- Deploy Temporal Workers (Docker build + k8s rollout)
- Deploy Frontend (mock client + data-testid)
- Deploy Edge Functions (workflow-status v27)
- Validate Frontend Documentation

## Plan Updates (2026-04-07) — Client Field Configuration UI Enhancements

### 8 UX Defects Fixed
Architecture review by software-architect-dbc agent (4 Major + 7 Minor findings, all remediated).
Plan file: `.claude/plans/jazzy-watching-creek.md`

**Items implemented** (all build + lint + 54 Playwright tests pass):
1. **Item 5**: Removed `jsonb` ("Structured") from custom field creation dropdown (kept for system fields)
2. **Item 8**: Server-side sort_order auto-assignment — custom categories appear after system tabs (M4: race condition fix)
3. **Item 2**: Previous/Next tab navigation buttons below tab content
4. **Item 3**: "Create & Add Another" button for custom field creation
5. **Item 6**: Edit custom fields — pencil button + inline form (field_type locked in edit per m3)
6. **Item 4**: Enum value configuration — chip-based UI for single/multi-select options, stored in `validation_rules` JSONB
7. **Item 7**: Edit custom categories — rename via inline form (slug immutable per m5)
8. **Item 1**: 9 contact designation field templates (7 Clinical, 2 Legal) with `validation_rules: {"widget":"contact_assignment"}` hint

### Consolidated Migration
`20260408023403_client_field_config_enhancements.sql` — single migration covers:
- M2: Read-back guards on 4 existing RPCs (`create_field_definition`, `update_field_definition`, `create_field_category`, `deactivate_field_category`)
- M4: Server-side `MAX(sort_order)+1` in `api.create_field_category()`
- New `api.update_field_category()` RPC + `handle_client_field_category_updated()` handler + router CASE + event_types seed
- 9 new template seeds with `validation_rules` JSONB widget hints
- Handler reference files: `handle_client_field_category_updated.sql` (new), `process_client_field_category_event.sql` (updated)

### Compliance Fixes (from audit)
- **Correlation ID**: All 7 write methods now generate UUID per user action, forwarded end-to-end to event metadata
- **WCAG aria-live**: Save-changes panel has `role="region" aria-live="polite"`
- **Focus management**: Edit form auto-focuses name input via `useRef` + `useEffect`
- **Enum validation**: Create button disabled when enum type has zero values; edit handler guards too
- **Error clearing**: `clearFieldErrors()`/`clearCategoryErrors()` on all cancel handlers
- **File extraction**: `EnumValuesInput` component extracted (94 lines), `CustomFieldsTab` reduced from 614→478 lines
- **Loading spinner fix**: Full-page spinner only on initial load (no data), not on CRUD refreshes — prevents component unmount that reset local state

### New Files Created
- `frontend/src/pages/settings/client-fields/EnumValuesInput.tsx` — reusable chip-based enum values input
- `infrastructure/supabase/handlers/client_field_category/handle_client_field_category_updated.sql` — handler reference
- `infrastructure/supabase/supabase/migrations/20260408023403_client_field_config_enhancements.sql` — consolidated migration

### Playwright Tests
25 new test cases added to `frontend/e2e/client-field-settings.spec.ts` (54 total, all passing).
Config: `playwright.client-fields.config.ts` (mock mode, provider_admin, port 3457).

### Migration NOT YET DEPLOYED
The consolidated migration has not been pushed/deployed. Local files only. Deploy via `supabase db push --linked` after code review.

### Remaining (NOT in scope)
- AsyncAPI contract update for `validation_rules` shape (m1) — tracked but deferred
- AsyncAPI contract for `client_field_category.updated` event (M3) — schema file not yet created

## Plan Updates (2026-03-27) — Dynamic Bootstrap Progress Tracking

### Problem
Bootstrap status page had hardcoded stage lists in 3 places (DB RPC, Edge Function, Mock client) that drifted from the actual workflow. Adding Step 1.6 exposed the drift.

### Solution
- Workflow emits `organization.bootstrap.step_completed` events (7 per bootstrap) to org stream
- `get_bootstrap_status()` RPC rewritten with CTE-based step manifest → `stages` JSONB array
- Edge Function simplified to passthrough (removed 11-stage hardcoded list + `getStageStatus()`)
- Mock client uses shared `BOOTSTRAP_STEPS` constant from `frontend/src/constants/bootstrap-steps.ts`
- Architecture review by software-architect-dbc: 4 Major + 7 Minor findings, all remediated
- Plan file: `.claude/plans/vectorized-bouncing-iverson.md`

### Key Implementation Details
- **Migration**: `20260327223918_bootstrap_dynamic_progress.sql` — router CASE + RPC rewrite + API wrapper + event_types seed
- **Typed event helper**: `emitBootstrapStepCompleted()` in `typed-events.ts` with AsyncAPI-generated `BootstrapStepKey` enum
- **Activity**: `emit-step-completed.ts` — lightweight activity called after each workflow step
- **Temporal replay safety (M1)**: Verified zero in-flight workflows before deploying via `temporal workflow list`
- **Legacy compat (M3)**: Pre-existing orgs show `status='completed'` with empty stages array (acceptable — status page only visible during active bootstrap)
- **Gotcha**: `event_types` table has `event_schema` (jsonb NOT NULL), not `category` — first deploy failed, fixed in follow-up commit `5d53c890`

## Plan Updates (2026-03-19) — Field Classification & Contact Architecture

### Full Field Classification via CSV Review
All ~80 fields classified. Mandatory core reduced from 14 to 7 user-facing fields at intake (+ 3 at discharge). Nearly all non-core fields changed to `configurable_presence` + `optional`. Key changes:
- Race, ethnicity, primary language, interpreter needed → configurable_presence + optional (were mandatory)
- admission_type → configurable_presence + optional (was mandatory)
- Discharge date/reason/type → mandatory at discharge time only (not at intake)
- internal_case_number, county, preferred_communication_method → DROPPED

### Option B: Client-Owned Contact Tables (Decision 57)
Client contact info (phone, email, address) moved from flat text columns on `clients_projection` to dedicated `client_phones`, `client_emails`, `client_addresses` tables. Event-sourced sub-entities. Replaces originally planned junction tables to shared projections.

### Configurable Label + Conforming Dimension Mapping (Decisions 59-60)
All 12 contact designations + `state_agency` gain configurable labels (org can rename display) and conforming dimension mapping (canonical key stays for cross-org Cube.js analytics).

### Allergy Type Enum Expanded (Decision 68)
`medication`/`general` → `medication`/`food`/`environmental`.

## Plan Updates (2026-03-14) — Enterprise EMR Expansion

### Scope Expansion: 17-Category Enterprise EMR Field List
User provided comprehensive EMR field list covering 17 categories. Cross-reference analysis found ~40% already decided, ~15% partial, ~45% genuinely new. Key changes:
- **~35 new typed columns** on `clients_projection` (demographics, contact, referral, admission, clinical, medical, legal, discharge)
- **New table**: `client_insurance_policies_projection` (CQRS event-sourced, sub-entity of `client`)
- **Contact designations**: 7 → 12 values (added program_manager, primary_care_physician, prescriber, probation_officer, caseworker)
- **6 categories deferred**: Assessments (9), Consents (12), Docs (15) as future applets; Guardian person data (3), Family contacts (11) to contact management applet; Financial (14) to billing module
- **Intake UX**: Wizard-style multi-step form with progressive disclosure (~10 steps)
- **Per-org payer config**: Toggles on `direct_care_settings` JSONB
- **Referral upgraded**: Plain text → structured fields (type enum, organization, date, reason)
- **Clinical profile**: Typed columns as intake snapshot (diagnoses, risk, trauma, substance use)
- **Medical expansion**: Allergy types merged, chronic illness flag added, new columns for immunization/dietary/special needs

### Decisions 34-56 (23 new decisions)
All documented in `dev/active/client-management-applet-context.md`.

## Plan Updates (2026-02-12)

### Scope Expansion: Cross-Correlation Audit
Original plan only covered new client events. Expanded to audit ALL existing events across 12 routers vs 14 AsyncAPI domain files. This surfaced:
- 2 naming mismatches (AsyncAPI wrong vs deployed router)
- 3 missing AsyncAPI contracts for deployed handlers
- 9 routers with RAISE WARNING instead of RAISE EXCEPTION
- 3 intentional dual-routed events
These fixes are now included in Migration 3 and Migration 5.

### Scope Expansion: Comprehensive event_types Seed
Originally planned to seed only 17 new client event types. Expanded to seed ALL 110 event types (93 existing + 17 new) since `event_types` table had zero seed data.

### Stream Type Change
Changed from `clinical` (too broad) to `client` (entity-specific). Added separate `client_field_definition` stream type for field registry events.

### Table Name Change
Changed from `clients` (direct table) to `clients_projection` (full CQRS projection). No legacy table exists in v4 baseline — greenfield creation.

## Success Metrics

### Immediate (Phase 2-3)
- [ ] Expanded `clients_projection` schema deployed with all universal fields
- [ ] `client_field_definitions_projection` table created
- [ ] RLS policies implemented and tested
- [ ] Value set tables seeded with OMB/ISO standards
- [ ] `client.*` event stream functional
- [ ] Client CRUD via `api.*` RPC functions (CQRS compliant)
- [ ] `user_client_assignments_projection` has FK to `clients_projection`
- [ ] All 110 event types registered in `event_types` table
- [ ] All 9 RAISE WARNING fixes applied

### Long-Term (Phase 4-5)
- [ ] Cube.js schema generates dimensions from field registry
- [ ] Self-service BI can slice by client demographics
- [ ] Intake form is org-configurable

## Risk Mitigation

| Risk | Impact | Mitigation |
|------|--------|------------|
| CQRS conversion complexity | Migration complexity | Greenfield — no legacy table to convert |
| Field registry complexity | Over-engineering | Start with core fields only; field registry can be deferred if premature |
| Conforming dimension mapping overhead | Operational burden on orgs | Push app-owner value sets; mapping table is opt-in for edge cases |
| RAISE WARNING fixes break existing events | Unhandled event types would fail loudly | These are coding convention fixes — unhandled types were silently dropped before, now they'll be caught and recorded in `processing_error` |

## Plan Updates (2026-04-06) — Test Suite + Client Intake Full-Stack Plan

### Implementation Plan Created
Comprehensive plan at `.claude/plans/cached-shimmying-feigenbaum.md` covering:
- **Phase A0**: Data-testid instrumentation (✅ COMPLETE — 14 testids across 7 files)
- **Phase A**: Full test suite for Client Field Configuration (ViewModel, activity, service, E2E, RLS)
- **Phase B**: Full-spec Client Intake (7 sub-entity tables, ~21 event handlers, ~24 API RPCs, 7 frontend form sections)

### Architecture Review (software-architect-dbc, 2026-04-06)
Review at `.claude/plans/cached-shimmying-feigenbaum-agent-ada0924ae4c589c74.md`.
6 Major + 10 Minor findings, all remediated in plan:
- **M1**: B2c (RAISE WARNING fix) already done in `20260220185837` — removed from plan
- **M2**: `register_client` uses `p_client_data jsonb` payload (not ~40 positional params)
- **M3**: All write RPCs include `p_event_metadata jsonb DEFAULT NULL` for audit
- **M4**: B2a split into lifecycle (4 handlers) + sub-entity (17 handlers) for reviewability
- **M5**: B4 split into AsyncAPI contracts (early) + seed migration (after handlers)
- **M6**: Added `validate_client_required_fields()` helper for org-specific validation
- **m1**: All event-sourced sub-entity tables use `_projection` suffix (verified: codebase convention applies to ALL event-sourced tables including junctions)
- **m8**: Clinical contact testids renamed `intake-clinical-contact-{designation}` (avoid collision with contact info section)
- **m9**: 4 permission keys specified: `client.create`, `client.view`, `client.update`, `client.discharge`
- **m10**: Draft uses `sessionStorage` (not localStorage) — PII safety

### Key Sequencing Decision (User Choice)
1. Full test suite for deployed Client Field Configuration first
2. Then full-spec Client Intake (all ~21 event types + sub-entity tables)

## Plan Updates (2026-04-06) — Phase B Backend Implemented

### 7 Backend Migrations Written (all dry-run validated)
Full plan at `.claude/plans/golden-booping-rainbow.md`.

**B1a-c** (3 table + seed migrations):
- 7 new tables: `client_phones_projection`, `client_emails_projection`, `client_addresses_projection`, `client_contact_assignments_projection`, `client_insurance_policies_projection`, `client_placement_history_projection`, `client_funding_sources_projection`
- `client.discharge` permission seeded (only new one — other 4 client.* permissions already in baseline)
- Permission implications: discharge → view + update. Backfill for existing orgs.
- `_projection` suffix on `client_placement_history_projection` per m1 remediation

**B2a-1** (lifecycle handlers):
- Added `WHEN 'client'` to dispatcher
- `process_client_event()` router: 4 lifecycle CASE branches
- `handle_client_registered`: INSERT ON CONFLICT (full 50+ column insert from JSONB payload)
- `handle_client_information_updated`: Partial UPDATE via `changes` JSONB with `?` key-presence checks
- `handle_client_admitted`, `handle_client_discharged`: Status transitions + field updates

**B2a-2** (sub-entity handlers):
- Router extended to 23 CASE branches
- 19 handlers: phone(3) + email(3) + address(3) + insurance(3) + placement(2) + funding(3) + contact_assignment(2)
- Placement handler: closes previous (is_current=false, end_date set), inserts new, denormalizes to `clients_projection.placement_arrangement`
- Contact assignment: ON CONFLICT reactivation pattern

**B2b** (contact designation handlers):
- 2 CASE branches added to `process_contact_event()` (now 7 total)
- `handle_contact_designation_created`, `handle_contact_designation_deactivated`

**B3** (API functions):
- `validate_client_required_fields()` helper — reads org field definitions for per-org required field enforcement
- 4 lifecycle RPCs: `register_client` (JSONB payload, 7 mandatory + org-specific validation, read-back guard), `update_client`, `admit_client`, `discharge_client`
- 2 query RPCs: `list_clients` (status filter + search), `get_client` (full record with sub-entity lateral joins)
- 15 sub-entity CRUD RPCs: phone(3) + email(3) + address(3) + insurance(3) + funding(3)
- 2 placement RPCs: `change_client_placement`, `end_client_placement`
- 2 contact assignment RPCs: `assign_client_contact`, `unassign_client_contact`
- Total: 25 RPCs + 1 helper

### Handler Reference Files
- `handlers/client/` — 23 files (4 lifecycle + 19 sub-entity)
- `handlers/contact/` — 2 new files
- Updated routers: `process_client_event.sql` (23 CASE), `process_contact_event.sql` (7 CASE)
- Updated dispatcher: `process_domain_event.sql` (16 stream_types + 3 admin)

### Routing Decision (2026-04-06)
- `/clients/register` — initial intake form only (demographics, contact, admission, staff, clinical, medical)
- `/clients/:clientId` — all post-registration management (discharge, contact CRUD, insurance, placement, edit record)
- Route order matters: `/clients/register` before `/:clientId` to avoid "register" matching as clientId param

### What Remains
- ~~**B4a**: AsyncAPI contracts~~ ✅ DONE
- ~~**B4b**: event_types seed migration + type generation~~ ✅ DONE
- ~~**B5a-c**: Frontend types, service layer, ViewModel~~ ✅ DONE
- ~~**B6a-b**: 10 intake form sections + ClientIntakePage~~ ✅ DONE (deployed 2026-04-08, commit `5bfe06b7`)
- ~~**B6c-d**: Rewrite ClientListPage + ClientDetailLayout~~ ✅ DONE (deployed 2026-04-08, commit `5bfe06b7`)
- ~~**B6-review**: Architecture review fixes~~ ✅ DONE (migration `20260408000351`, deployed 2026-04-08)
- ~~**B6-scalar-fix**: PostgREST jsonb scalar fix~~ ✅ DONE (migration `20260408012329`, deployed 2026-04-08)
- **B7**: Tests (ViewModel, service, E2E, RLS) + documentation (7 table docs, AGENT-INDEX)

## Plan Updates (2026-04-07) — B4b + B5a-c Frontend Layer Implemented

### B4b: Event Types Seed Migration
- Migration `20260406225150_client_event_types_seed.sql` — 25 event types seeded (23 client + 2 contact designation)
- Each entry has `event_schema` (required fields JSONB), `projection_function`, `projection_tables`
- AsyncAPI types regenerated (38 enums, 271 interfaces) and copied to frontend

### B5a: Client Types (`frontend/src/types/client.types.ts`)
- **Design decision**: Independent `Client` interface (read-model from `api.get_client`), NOT re-exported from generated `ClientRegistrationData` (event payload). They diverge: `Client` has id, timestamps, created_by, sub-entity arrays; generated type uses `Map<string, any>` for JSONB (Modelina artifact).
- 17 union types matching DB CHECK constraints exactly
- Display label const objects for all enums
- 7 sub-entity interfaces matching projection table columns
- `Client` (50+ fields + sub-entity arrays), `ClientListItem` (list subset)
- Params types for all write RPCs + `ClientRpcResult`
- `discharge_plan_status` excluded — dropped in migration `20260330204308`

### B5b: Client Service Layer (`frontend/src/services/clients/`)
- `IClientService.ts` — 25 methods mapping 1:1 to API RPCs
- `SupabaseClientService.ts` — all calls via `supabase.schema('api').rpc()`, `parseResponse()` helper for JSON.parse string responses
- `MockClientService.ts` — 3 seeded clients (Marcus Johnson/active, Sofia Ramirez/active, Jayden Williams/discharged), in-memory sub-entity arrays, `simulateDelay()`, deep copies
- `ClientServiceFactory.ts` — `getDeploymentConfig()` detection, singleton with `resetClientService()`

### B5c: ClientIntakeFormViewModel (`frontend/src/viewModels/client/ClientIntakeFormViewModel.ts`)
- 10-section fixed navigation: demographics → contact_info → guardian → referral → admission → insurance → clinical → medical → legal → education
- Field-definition-driven validation from `IClientFieldService.listFieldDefinitions()`
- Draft sub-entity types: `DraftPhone`, `DraftEmail`, `DraftAddress`, `DraftInsurance`, `DraftClinicalContact`
- sessionStorage drafts (`a4c-client-intake-draft` key) — PII safety per Decision m10
- Submit: `registerClient()` first, then `Promise.allSettled` sub-entity RPCs with shared `correlation_id` (Decision 24)

### Legacy Model Deletion (B6c/B6d)
- Delete `frontend/src/types/models/Client.ts` (camelCase, minimal) and `frontend/src/mocks/data/clients.mock.ts`
- Rewrite all consumers: `ClientListPage`, `ClientDetailLayout`, `ClientSelectionViewModel` on new `client.types.ts` + `IClientService`
- No backward compatibility — complete replacement

## Plan Updates (2026-04-07) — All Phase B Backend Migrations Deployed

### Deployment
All 8 migrations pushed to production via CI/CD. All 5 pipelines green:
- Deploy Database Migrations (8 migrations applied)
- Deploy Temporal Workers
- Deploy Frontend
- Validate Frontend Documentation

### Gotcha: `role_permissions_projection` has no `organization_id` column
Migration `20260406221739_client_permissions_seed.sql` initially failed because the backfill INSERT included `organization_id` — that column doesn't exist on `role_permissions_projection` (only `role_id`, `permission_id`, `granted_at`). Org scope is implicit via `role_id` FK to `roles_projection`. Fix: commit `61caf26e`.

**Lesson**: Always verify projection table schemas before writing backfill migrations. The handler reference files at `handlers/rbac/` show the actual columns.

### Updated Counts (Post-Deployment)
- 5 trigger functions, 15 active routers, 74 handlers, 97 .sql reference files
- 43 event types seeded in `event_types` table (18 prior + 25 new)
- 14 new tables total (7 from Phase 2 field config + 7 from Phase B client intake)

## Plan Updates (2026-04-07) — B6a Intake Form Section Components

### B6a: 10 Intake Form Section Components
Created `frontend/src/pages/clients/intake/` with 14 files:

**Shared infrastructure**:
- `IntakeFormField.tsx` — generic field renderer supporting text/date/number/enum/multi_enum/boolean/jsonb
- `useFieldProps.ts` — `getFieldProps(vm, fieldKey)` derives visibility/required/error from ViewModel field definitions
- `types.ts` — shared `IntakeSectionProps` (just `{ viewModel: ClientIntakeFormViewModel }`)
- `index.ts` — barrel exports

**10 section components** (all `observer`-wrapped, field-definition-driven):
1. `DemographicsSection` — 19 fields: names, DOB, gender (5 options), race (OMB multi-select 7 options), ethnicity (3), language, pronouns (free text), marital status, citizenship (6 options), identifiers
2. `ContactInfoSection` — sub-entity collections: phones/emails/addresses with add/remove, type select, is_primary toggle. Visibility controlled by `client_phones`/`client_emails`/`client_addresses` field definitions
3. `GuardianSection` — legal_custody_status (6 options), court_ordered_placement (bool), financial_guarantor_type (8 options)
4. `ReferralSection` — referral_source_type (10 options), referral_organization, referral_date, reason_for_referral
5. `AdmissionSection` — admission_date, admission_type (5 options), level_of_care, expected_length_of_stay (number), initial_risk_level (4 options), placement_arrangement (13 options)
6. `InsuranceSection` — medicaid_id, medicare_id + insurance policy sub-entity collection (type/payer/policy#/group#/subscriber/dates)
7. `ClinicalSection` — primary_diagnosis/secondary/DSM-5 (JSONB), presenting_problem, suicide_risk_status (3), violence_risk_status (3), trauma history, substance/developmental/treatment history
8. `MedicalSection` — allergies, medical_conditions (both required JSONB), immunization_status, dietary_restrictions, special_medical_needs
9. `LegalSection` — court_case_number, state_agency, legal_status (4 options), mandated_reporting/protective_services/safety_plan (booleans)
10. `EducationSection` — education_status (8 options), grade_level, iep_status (bool)

**Design decisions**:
- Task said "7 sections" but ViewModel has 10 `INTAKE_SECTIONS` — built all 10 for 1:1 mapping
- Enum options are hardcoded const arrays (not fetched from `client_reference_values`) for gender, ethnicity, race, citizenship, admission_type, referral_source, education_status, legal_status — these are app-owner-defined per Decision 3
- `reason_for_referral`, `presenting_problem`, `substance_use_history` etc. use `fieldType="jsonb"` override to render as textarea even though their FieldDefinition field_type is `text` — better UX for long-form content
- Contact sub-entity sections check `vm.visibleFieldKeys.has('client_phones')` etc. for section-level visibility
- All fields use `getFieldProps()` which reads from `vm.fieldDefinitions` — if an org hasn't seeded field definitions yet, fields won't render (graceful degradation)

## Plan Updates (2026-04-07) — B6b ClientIntakePage

### B6b: ClientIntakePage at `/clients/register`
Created `frontend/src/pages/clients/ClientIntakePage.tsx` — multi-section intake form page.

**Features**:
- **Section sidebar** (desktop): 10-item nav with validation status icons (CheckCircle/AlertCircle/Circle) from `vm.sectionValidation`
- **Mobile fallback**: `<select>` dropdown with unicode status indicators
- **Progress bar**: ARIA progressbar driven by `vm.completionPercentage`, animated width transition
- **Active section rendering**: `SECTION_COMPONENTS` map → one of 10 `*Section` components, all receiving ViewModel as prop
- **Navigation footer**: Previous/Next buttons cycle through `INTAKE_SECTIONS`, Submit button replaces Next on last section
- **Submit**: Calls `vm.submit(orgId)` where orgId comes from `useAuth().session.claims.org_id`
- **Success redirect**: `useEffect` watching `vm.submitSuccess` → `navigate(/clients/:registeredClientId)`
- **Error handling**: Submit error (red alert), sub-entity warnings (amber alert with list)
- **Loading/error states**: Spinner while loading field definitions, retry on failure
- **Glassmorphism**: `glassCardStyle` matching existing settings pages (rgba white, blur backdrop)

**Route wiring** (`App.tsx`):
- `/clients/register` added BEFORE `/:clientId` (route order matters — "register" would match as clientId param)
- Import added for `ClientIntakePage`

**Design decisions**:
- ViewModel created via `useMemo` (one per page mount), `loadFieldDefinitions()` called in `useEffect`
- Section labels are a static `SECTION_LABELS` record (not derived from field categories) — simpler, matches section component names
- No `RequirePermission` wrapper on route — the submit RPC enforces `client.create` server-side. Can add frontend guard later if needed.

## Plan Updates (2026-04-07) — B6d ClientDetailLayout Rewrite

### B6d: ClientOverviewPage — Full Client Record Display
Complete rewrite of `ClientOverviewPage.tsx` (was ~77 lines placeholder with `client: any` and camelCase fields, now ~300 lines with typed `Client` interface).

**12 sections** organized as cards with icons:
1. **Demographics** — 19 fields (names, DOB, gender, race, ethnicity, language, marital status, citizenship, identifiers)
2. **Contact Info** — Sub-entity card lists for phones, emails, addresses (filtered to `is_active`, with primary badges)
3. **Guardian/Custody** — legal_custody_status, court_ordered_placement, financial_guarantor_type
4. **Referral** — source type, organization, date, reason
5. **Admission** — date, type, level of care, expected LOS, initial risk level, current placement
6. **Placement History** — Timeline cards (current highlighted green, sorted by date range)
7. **Insurance** — Medicaid/Medicare IDs + policy cards (type badge, payer, policy#, group#, dates)
8. **Funding Sources** — Conditional section (only shown if sources exist)
9. **Clinical Profile** — Diagnoses (JSONB display), risk statuses, trauma/substance/treatment history
10. **Medical** — Allergies, conditions (both JSONB), immunization, dietary, special needs
11. **Legal** — Court case, state agency, legal status, mandated reporting booleans
12. **Education** — Status, grade level, IEP status
13. **Assigned Contacts** — Designation badge cards with contact name/email
14. **Discharge** — Conditional (only for discharged clients): date, outcome, reason, placement, diagnosis

**Helper utilities** (inline, not extracted):
- `Field` component: label + value renderer, returns null for empty values
- `fmtDate()`, `labelOf()`, `fmtJson()` formatters
- `Section` wrapper: Card with icon + title + 3-col grid
- `EmptyList` for empty sub-entity collections

**Discharged client UX**:
- Amber banner at top of overview: "This client was discharged on [date]"
- Discharge section rendered at bottom with all discharge fields

### B6d: ClientDetailLayout — Discharge Action
Enhanced header with:
- **Status badge** in header (green=active, amber=discharged, gray=inactive)
- **Discharge button** (amber outline, `LogOut` icon) — only visible when `client.status === 'active'`
- **Custom DischargeDialog** (inline component, not reusing ConfirmDialog — needs 4 form fields):
  - `discharge_date` (date input, required, defaults to today)
  - `discharge_outcome` (select, required): Successful / Unsuccessful
  - `discharge_reason` (select, required): 14 options from `DISCHARGE_REASON_LABELS`
  - `discharge_placement` (select, optional): 9 options from `DISCHARGE_PLACEMENT_LABELS`
  - Confirm button disabled until all required fields filled
  - Error display inline in dialog
  - On success: dialog closes, `loadClient()` refreshes data (status → discharged)
- **Refactored loading**: Extracted `loadClient()` as `useCallback` for reuse after discharge

**Files modified**:
- `frontend/src/pages/clients/ClientOverviewPage.tsx` — Full rewrite (~300 lines)
- `frontend/src/pages/clients/ClientDetailLayout.tsx` — Discharge action + status badge (~355 lines)

**Build + lint**: Clean (zero errors, zero warnings).

## Plan Updates (2026-04-08) — Architecture Review Fix Migration

### Architecture Review by software-architect-dbc Agent
Reviewed all committed + uncommitted Phase B work against 95 design decisions.

**5 Major + 4 Minor findings**, all remediated in:
- **Migration**: `20260408000351_fix_client_api_architecture_review.sql` (DEPLOYED 2026-04-08)
- **Frontend**: 2 file edits (DEPLOYED 2026-04-08, commit `5bfe06b7`)

### Key Fixes
1. **Read-back guards** added to `api.update_client`, `api.admit_client`, `api.discharge_client` + 7 sub-entity "add" RPCs (M3/M4/M5)
2. **`discharge_plan_status`** removed from `handle_client_registered` and `handle_client_information_updated` — column was dropped in `20260330204308` but handlers still referenced it (m1, upgraded to Major — would cause runtime failure)
3. **`admission_type` enum** in `AdmissionSection.tsx` fixed: `voluntary/involuntary/court_ordered` → `planned/emergency/transfer/readmission` per Decision 45 (M6)
4. **"All" status tab** in `SupabaseClientService.ts` fixed: `status ?? 'active'` → `status ?? null` (m4)
5. **`event_types` seed** for `client.registered` corrected: stale `race/ethnicity/primary_language` → `admission_date/allergies/medical_conditions` per Decision 67 (M2)
6. **`UNIQUE(client_id, start_date)`** added to `client_placement_history_projection` per Decision 83 (m7)
7. **`api.get_client`** contact_assignments lateral join expanded to return all `ClientContactAssignment` fields (m6)

### Gotcha: `discharge_plan_status` column timeline
- `20260327205738` created `clients_projection` WITH the column
- `20260330204308` DROPPED the column
- `20260406222201` created handlers that REFERENCED the dropped column
- `20260408000351` fixes the handlers

### What Remains
- ~~Commit all uncommitted work~~ ✅ DONE (commit `5bfe06b7`, deployed 2026-04-08)
- B7: Integration testing + documentation

## Plan Updates (2026-04-08) — All B6 Deployed + PostgREST Scalar Fix

### Full Deployment (commit `5bfe06b7`)
All B6 frontend + architecture review fix + batch update scalar fix deployed. 3 CI/CD pipelines green:
- Deploy Database Migrations (2 migrations: `20260408000351` + `20260408012329`)
- Deploy Frontend (intake form sections, page rewrites, legacy deletions)
- Validate Frontend Documentation

### PostgREST jsonb Scalar Fix (Decision 96)
**Problem**: `api.batch_update_field_definitions` failed with "cannot extract elements from a scalar" even after removing `JSON.stringify` from frontend (commit `4849122b`).

**Root cause**: PostgREST wraps jsonb ARRAY parameters as jsonb STRING SCALARS during RPC parameter binding. The `jsonb_array_elements()` call receives `"[...]"` (a jsonb text scalar) instead of `[...]` (a jsonb array). This is a PostgREST behavior, not a Supabase SDK issue.

**Fix**: Server-side unwrap guard in the SQL function:
```sql
IF jsonb_typeof(p_changes) = 'string' THEN
    v_changes := (p_changes #>> '{}')::jsonb;
ELSE
    v_changes := p_changes;
END IF;
```

**Migration**: `20260408012329_fix_batch_update_jsonb_scalar.sql`
**Also applied live** via Supabase MCP `execute_sql` before CI/CD deploy for immediate testing.

**Pattern for future**: Any RPC that takes a `jsonb` param expecting an array MUST include this unwrap guard. The frontend `JSON.stringify` removal was correct but insufficient — the problem is at the PostgREST layer.

### Migration Count
10 total deployed migrations for Phase B:
1. `20260406221732_client_contact_tables.sql`
2. `20260406221738_client_insurance_placement_tables.sql`
3. `20260406221739_client_permissions_seed.sql`
4. `20260406222201_client_lifecycle_event_handlers.sql`
5. `20260406222642_client_sub_entity_event_handlers.sql`
6. `20260406222759_contact_designation_event_handlers.sql`
7. `20260406222857_client_api_functions.sql`
8. `20260406225150_client_event_types_seed.sql`
9. `20260408000351_fix_client_api_architecture_review.sql`
10. `20260408012329_fix_batch_update_jsonb_scalar.sql`

## Next Steps After Completion

1. **Behavioral incidents domain** — Second fact table for analytics correlation
2. **Cube.js integration** — Semantic layer connecting client dimensions to fact tables
3. **Self-service BI** — Query builder with conforming dimension enforcement
