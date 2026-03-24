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

### Phase 2: Schema Foundation ⏸️ PENDING (scope expanded 2026-03-14, updated 2026-03-19)
Migrations planned:
1. `clients_projection` (~50 typed columns + custom_fields JSONB) + indexes + RLS + FK — reduced from ~55 (dropped internal_case_number, county, email, phones, preferred_communication_method)
1b. Client-owned contact tables (`client_phones`, `client_emails`, `client_addresses` — standalone, NOT junctions) + contact-designation model (12 designations)
1c. `client_insurance_policies_projection` (CQRS event-sourced, new table)
2. `client_field_definitions_projection` + `client_reference_values` + `client_field_categories` + seeds + RLS
3. Dispatcher update + 2 routers + ~23 handlers (expanded for insurance + discharge + client contact sub-entities) + 9 RAISE WARNING fixes
4. ~34 API functions (expanded client CRUD + insurance + client contact CRUD + field definitions + contact-designation)
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
