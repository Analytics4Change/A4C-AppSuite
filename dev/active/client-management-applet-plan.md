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

## Next Steps After Completion

1. **Frontend intake form** — Configurable form driven by field registry
2. **Behavioral incidents domain** — Second fact table for analytics correlation
3. **Cube.js integration** — Semantic layer connecting client dimensions to fact tables
4. **Self-service BI** — Query builder with conforming dimension enforcement
