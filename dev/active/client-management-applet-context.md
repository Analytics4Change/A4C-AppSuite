# Context: Client Management Applet

## Decision Record

**Date**: 2026-02-12
**Feature**: Client Management Applet
**Goal**: Design and build the foundational schema, event architecture, and API layer for client (patient) management in residential behavioral healthcare for at-risk youth.

### Key Decisions

1. **Field storage strategy**: Universal fields as typed columns + org-configurable fields in `custom_fields JSONB`. Avoids per-tenant star schemas and hacky static-to-dynamic field mapping. JSONB with GIN indexes provides queryability without EAV row explosion.

2. **Field registry design**: `client_field_definitions_projection` table (event-sourced, stream_type: `client_field_definition`) stores structural metadata (field name, type, validation, analytical role) per org. This drives: UI form generation, validation, and Cube.js dynamic schema generation. Field keys are always semantic (`placement_type`, never `custom_field_1`).

3. **Value set ownership model**: Three categories identified:
   - **App-owner-defined**: Race (OMB), ethnicity (OMB), language (ISO 639), gender, ICD-10 diagnoses, state/county (FIPS). Inherently conforming across orgs. No mapping needed.
   - **Tenant-defined**: Org units, staff assignments, case numbering. Only meaningful within single org analytics. No cross-org mapping needed.
   - **Narrow middle ground**: Placement type/care level — could use optional `conforming_dimension_value_mappings` table, but push toward app-owner-defined standard value sets to minimize this.

4. **Conforming dimensions for Cube.js**: Core typed columns (age_group computed from DOB, gender, race, ethnicity, language) are the primary conforming dimensions. These feed the `PatientDimension` cube that links fact tables (medication adherence, behavioral incidents). Org-specific JSONB fields are dimensions within that org's analytics only.

5. **CQRS compliance — `clients_projection` as full CQRS projection** (decided 2026-02-12): Stream type is `client` (NOT `clinical` as originally discussed). Table is `clients_projection`. No legacy `clients` table exists in v4 baseline — this is greenfield. API functions emit domain events, event handlers update projection. No direct table writes from frontend.

6. **Race/ethnicity capture**: Federally mandated by CMS, SAMHSA, and state licensing. OMB two-question format: ethnicity first (Hispanic/Latino or not), then race as multi-select. Required for health disparity analysis — a core analytical use case.

7. **Pronouns**: Free text input at runtime, not enum or org-configured dropdown (updated 2026-03-23, Decision 71). LGBTQ+ youth overrepresented in residential care (30%+ of foster care population). Clinical relevance and state regulatory requirements (CA, NY, IL). Not a reporting dimension — no analytical reason to constrain values. Placeholder text guides format (e.g., "he/him, she/her, they/them").

8. **SSN handling**: Capture last 4 digits only (or skip entirely). Use Medicaid ID as primary insurance identifier. Full SSN creates liability under HIPAA breach notification.

9. **~~Junction tables for contact/phone/address~~** (decided 2026-02-12, updated 2026-03-04, **SUPERSEDED 2026-03-19 by Decision 57**): ~~Reuse existing `phones_projection`, `addresses_projection` via junction tables (`client_phones`, `client_addresses`).~~ **Now using Option B: client-owned contact tables** — dedicated `client_phones`, `client_emails`, `client_addresses` as standalone tables, not junctions to shared projections. See Decision 57. The 4NF `client_contact_assignments` model for clinical staff assignment (Decision 13) is unchanged.

10. **Value set reference table** (decided 2026-02-12): Single `client_reference_values` table with `category` column (race, ethnicity, language, gender). App-owner-managed via migrations/seeds. Read-only for tenants. Seeded with OMB + ISO 639 standards.

11. **Two stream types, not one** (decided 2026-02-12): `client` for client lifecycle events (8 event types) + `client_field_definition` for field definition lifecycle (3 event types). Separate routers: `process_client_event()` and `process_client_field_definition_event()`.

12. **Comprehensive event_types seed** (decided 2026-02-12): Seed ALL 110 event types (93 existing + 17 new) in `event_types` catalog table. Table is not used for runtime validation — serves as registry for admin dashboard and documentation.

13. **4NF contact-designation model for clinical assignments** (decided 2026-03-04): `assigned_clinician_id` FK dropped from `clients_projection`. Clinical staff assignment handled via 4NF decomposition: `contacts_projection` (add `user_id` FK for internal users) → `contact_designations_projection` (designation per contact per org) → `client_contact_assignments` (atomic fact: client + contact + designation). Supports internal and external clinicians uniformly, per-client designation distinction, and clean analytics join path. Uses "designation" (not "role") to avoid RBAC semantic collision. Lazy contact creation for internal users — `contacts_projection` record auto-created on first clinical assignment. See `dev/active/client-management-applet-user-notes.md` for full schemas and scenarios.

14. **Fixed designation list, expanded for behavioral analyst** (decided 2026-03-04, updated 2026-03-04): 7 designations: `clinician`, `therapist`, `psychiatrist`, `behavioral_analyst`, `case_worker`, `guardian`, `emergency_contact`. Plain text column with CHECK constraint. No org-defined custom designations. Simplifies system — no admin UI for designation management. **Note**: `behavioral_analyst` added because intake form has 4 clinical contact fields (Clinician, Therapist, Psychiatrist, Behavioral Analyst).

15. **Full event sourcing for designations** (decided 2026-03-04): `contact.designation.created` and `contact.designation.deactivated` as first-class domain events routed through `process_contact_event()`. Codebase audit confirmed 100% event-sourced pattern — zero precedent for projection rows without domain events (only exception: configuration tables like `permission_implications`). Auto-creating designation rows without events would have been the first violation.

16. **Wrapper + individual API functions for assignment** (decided 2026-03-04): `api.assign_client_clinician()` wrapper orchestrates `api.create_organization_contact()` (existing) + `api.create_contact_designation()` (new) + `api.assign_client_contact()` (new) in a single PostgreSQL transaction. Each inner function is independently callable for the future contact management applet. Wrapper provides all-or-nothing consistency; individual functions provide reusability.

17. **Reuse `client.update` permission for contact assignment** (decided 2026-03-04): No new permissions needed. Assigning/unassigning contacts is a client update operation. Keeps permission surface small.

18. **Line staff deferred — Scenario C** (decided 2026-03-04): Contact-designation model is for clinical/external contacts only. Line staff remain in `user_client_assignments_projection` (operational caseload management). The `designation` text field makes future unification possible without schema changes, but no commitment to that path now.

19. **Contact-designation model included in Phases 2-3** (decided 2026-03-04): Ships with client management migrations, not deferred to a follow-up phase. Client registration form needs clinician assignment from day one.

57. **Option B: Client-owned contact tables** (decided 2026-03-19): Client's own contact info (phone, email, address) stored in dedicated `client_phones`, `client_emails`, `client_addresses` tables — NOT flat text columns on `clients_projection`, NOT junctions to shared `phones_projection`/`addresses_projection`, NOT the 4NF contact-designation model. Each table has `client_id` FK, `organization_id` for RLS, type enum, `is_primary` flag. Event-sourced as sub-entity events (`client.phone.added/updated/removed`, etc.) via `process_client_event()`.

58. **Client contact info is configurable_presence + optional** (decided 2026-03-19): Org admin toggles whether contact section appears. Not mandatory at intake.

59. **Configurable label + conforming dimension mapping for designations** (decided 2026-03-19): All 12 contact designations have `configurable_label` (org can rename display label, e.g., "Clinician" → "Primary Counselor") and `conforming_dimension_mapping` (canonical key stays unchanged for cross-org Cube.js analytics). Fixed CHECK constraint set of 12 designation keys is unchanged — orgs relabel only, cannot add new designations. Labels stored in `client_field_definitions_projection`.

60. **`state_agency` configurable label + conforming dimension mapping** (decided 2026-03-19): Same pattern as designations — org can relabel the display name, canonical key stays for analytics.

61. **`admission_type` changed to optional + configurable_presence** (decided 2026-03-19): Was erroneously marked mandatory. Now org-togglable and optional.

62. **Discharge fields mandatory at discharge time only** (decided 2026-03-19): `discharge_date`, `discharge_reason`, `discharge_type` are mandatory when performing a discharge action, NOT at intake registration. `discharge_diagnosis` and `discharge_placement` are configurable_presence + optional.

63. **`internal_case_number` dropped** (decided 2026-03-19): UUID `id` serves as internal identifier. `mrn` covers org's own numbering. Removes the only renamable-label field (superseded by state_agency + designation labels).

64. **`county` dropped** (decided 2026-03-19): Not needed.

65. **`preferred_communication_method` dropped** (decided 2026-03-19): Removed from schema entirely.

66. **Race/ethnicity/primary_language/interpreter_needed changed to configurable_presence + optional** (decided 2026-03-19): Were previously mandatory NOT NULL. Now org-togglable. Orgs that need OMB compliance can enable them; others can skip.

69. **`is_required` configurable per-org for typed columns** (decided 2026-03-23): Org admin can mark any `configurable_presence` typed column as "Required when visible" via the existing `is_required` boolean on `client_field_definitions_projection`. No schema change needed — the column already exists. Enforcement: (1) frontend validation reads org's field definitions, (2) `api.register_client()` validates non-null for `is_required` fields before emitting domain event. Database columns stay nullable — required-ness is a per-org business rule, not a schema invariant.

70. **Language selection changed from org-configured list to runtime search** (decided 2026-03-23): Primary and secondary language fields use a runtime searchbox at intake (similar to medication/ICD-10 search pattern) instead of org admin pre-selecting a subset from the ISO 639 master list. `client_reference_values` remains as the backend lookup table but has no admin UI surface. Removes the language selection grid from the configuration UI entirely.

71. **Pronouns changed from org-configured dropdown to runtime free text** (decided 2026-03-23): Was org-admin-configurable dropdown options stored in `client_field_definitions_projection` with "Other → free text" escape hatch. Now plain free text input at intake. Not a reporting dimension — no analytical reason to constrain values. Placeholder text guides format. Removes pronouns from `client_field_definitions_projection` usage (was the only field with org-configured dropdown values).

72. **Citizenship status changed from free text to hardcoded dropdown** (decided 2026-03-23): Was free text, now a standardized 6-value dropdown hardcoded in frontend: `U.S. Citizen`, `Lawful Permanent Resident (Green Card Holder)`, `Nonimmigrant Visa Holder (Temporary Status)`, `Refugee or Asylee`, `Other Immigration Status`, `Prefer not to answer`. Selected at runtime when field is enabled. DB column remains `text` (stores selected value).

73. **`initial_risk_level` defined as 4-value hardcoded enum, now a reporting dimension** (decided 2026-03-23): Was "Enum TBD". Now: `Low Risk`, `Moderate Risk`, `High Risk`, `Critical/Imminent Risk`. Hardcoded in frontend. Promoted to reporting dimension — conforming across orgs, sliceable in Cube.js PatientDimension.

74. **`medicare` added as 5th payer type** (decided 2026-03-23): `policy_type` enum on `client_insurance_policies_projection` expanded from `primary | secondary | medicaid | state` to `primary | secondary | medicaid | medicare | state`. Applies for youth with disabilities (SSI → Medicare eligibility).

75. **~~"State Program" payer type gets configurable label~~** — **SUPERSEDED by Decision 76**.

76. **`state` payer type replaced by `client_funding_sources_projection` table (Option B)** (decided 2026-03-23): The `state` value is removed from `policy_type` enum (now `primary | secondary | medicaid | medicare`). External funding sources are a separate concept from insurance policies — different data shape, no payer/subscriber/coverage fields. New table `client_funding_sources_projection` supports dynamic, multi-instance funding sources. Org admin defines funding source slots (`external_funding_source_1`, `external_funding_source_2`, ...) in `client_field_definitions_projection`, each with a `configurable_label`. Staff adds funding source rows at intake. Event-sourced sub-entity of `client` (`client.funding_source.added/updated/removed`) via `process_client_event()`. NOT a reporting dimension. Includes `custom_fields jsonb DEFAULT '{}'` for non-standard fields per funding source row (Decision 77).

67. **Mandatory core reduced to 7 fields at intake** (decided 2026-03-19): `first_name`, `last_name`, `date_of_birth`, `gender`, `admission_date`, `allergies`, `medical_conditions`. All other fields are optional and/or configurable_presence. 3 additional fields mandatory at discharge: `discharge_date`, `discharge_outcome`, `discharge_reason` (updated 2026-03-26 per Decision 78).

78. **Discharge three-field decomposition** (decided 2026-03-26): `discharge_type` replaced by three independent fields capturing orthogonal dimensions. Informed by external LLM analysis of discharge classification in residential behavioral health (`~/Downloads/full_discharge_conversation.md`).
   - **`discharge_outcome`** (new, replaces `discharge_type`): Binary — `successful`, `unsuccessful`. Mandatory at discharge. Primary reporting dimension for program success rates.
   - **`discharge_reason`** (existing, now enum): 14 values — `graduated_program`, `achieved_treatment_goals`, `awol`, `ama`, `administrative`, `hospitalization_medical`, `insufficient_progress`, `intermediate_secure_care`, `secure_care`, `ten_day_notice`, `court_ordered`, `deceased`, `transfer`, `medical`. Mandatory at discharge.
   - **`discharge_placement`** (existing, now enum): 9 values — `home`, `lower_level_of_care`, `higher_level_of_care`, `secure_care`, `intermediate_secure_care`, `other_program`, `hospitalization`, `incarceration`, `other`. Configurable presence + optional.
   - **Why decompose**: User's real-world discharge list (e.g., "Successful - Graduated Program / Achieved Treatment Goals - Home") revealed composite values encoding 3 independent dimensions. Single enum creates combinatorial explosion; three fields give clean Cube.js slicing by outcome × reason × placement independently.
   - **Deferred**: Full 4NF discharge management (reporting flags, compliance actions, notifications, follow-up tasks) — future discharge management applet. Three-field decomposition is the foundation.

79. **`marital_status` enum defined** (decided 2026-03-26): 6 values — `single`, `married`, `divorced`, `separated`, `widowed`, `domestic_partnership`. Hardcoded in frontend.

80. **`suicide_risk_status` enum defined** (decided 2026-03-26): 3 values — `low_risk`, `moderate_risk`, `high_risk`. Hardcoded in frontend.

81. **`violence_risk_status` enum defined** (decided 2026-03-26): 3 values — `low_risk`, `moderate_risk`, `high_risk`. Same scale as `suicide_risk_status` (Decision 80) — both are clinical screening assessments using standard behavioral health severity scale. Hardcoded in frontend.

82. **`legal_custody_status` enum defined, separated from placement** (decided 2026-03-26): 6 values — `parent_guardian`, `state_child_welfare`, `juvenile_justice`, `guardianship`, `emancipated_minor`, `other`. `other` does NOT require elaboration. Custody is who holds legal authority over the minor — distinct from placement arrangement (where the client physically lives). Original values (`voluntary`, `court_ordered`, `guardianship` + "etc.") replaced — those described the *legal basis for placement*, not the custodian. External LLM-generated list conflated custody with placement; decomposed into two separate fields.

83. **`placement_arrangement` — new field + `client_placement_history` table (Option C backend, frontend deferred)** (decided 2026-03-26): Not all A4C providers operate residential programs — providers may run group homes, foster care, outpatient, etc. Placement arrangement is a core dimension, not an assumption.
   - **New column**: `placement_arrangement` on `clients_projection` — denormalized current placement, configurable_presence + optional, **reporting dimension**. 13 values: `residential_treatment`, `therapeutic_foster_care`, `group_home`, `foster_care`, `kinship_placement`, `adoptive_placement`, `independent_living`, `home_based`, `detention`, `secure_residential`, `hospital_inpatient`, `shelter`, `other`.
   - **New table**: `client_placement_history` — CQRS event-sourced, full placement trajectory with date ranges. Columns: `id`, `client_id` (FK), `organization_id` (FK, RLS), `placement_arrangement` (text), `start_date` (date NOT NULL), `end_date` (date nullable), `reason_for_change` (text nullable), `is_current` (boolean), `created_at`, `updated_at`. UNIQUE on `(client_id, start_date)`.
   - **Events**: `client.placement.changed` and `client.placement.ended` via `process_client_event()`.
   - **Handler**: On `client.placement.changed` — closes previous row (`end_date`), inserts new row, updates `clients_projection.placement_arrangement`.
   - **Intake**: Captures initial placement → emits `client.placement.changed` as first history entry. No placement transition UI on intake form.
   - **Frontend for transitions**: Deferred — table and events exist, no UI for step-downs/transfers yet.
   - **Why**: Full trajectory analytics (length-of-stay per placement, step-down success rates, point-in-time incident correlation) require history table. Intake form stays simple. Middle ground between snapshot-only and full feature.
   - **New table count**: 12 (was 11).

84. **`financial_guarantor_type` enum defined** (decided 2026-03-26): 8 values — `parent_guardian`, `state_agency`, `juvenile_justice`, `self`, `insurance_only`, `tribal_agency`, `va`, `other`. No required elaboration for `other`. Distinct from `legal_custody_status` — custody = who has legal authority, guarantor = who pays. A youth can be in `parent_guardian` custody but `state_agency` as financial guarantor (e.g., state-funded placement with parental custody retained). `tribal_agency` covers IHS-eligible youth. `va` added for military-connected families. `insurance_only` covers cases where no individual guarantor exists and insurance is sole payer.

85. **Implementation split into two projects** (decided 2026-03-27): (1) Client Field Configuration — settings page + backend for field visibility/required/labels/custom fields/categories. (2) Client Intake — actual intake form, registration API, client lifecycle events. Separate projects because configuration is operationally distinct and provides value before intake form exists.

86. **Page renamed to "Client Field Configuration"** (decided 2026-03-27): Was "Client Intake Configuration". The configuration manages fields across intake, discharge, and placement transitions — not just intake. Route: `/settings/client-fields`.

87. **`client_field_categories` event-sourced** (decided 2026-03-27, architecture review M5): Was marked "not event-sourced (config data)" but org admin can create custom categories — direct writes without events violate CQRS. New stream type `client_field_category` with 2 events: `client_field_category.created`, `client_field_category.deactivated`. Router: `process_client_field_category_event()`.

88. **Batch update RPC for field definitions** (decided 2026-03-27, architecture review m2/R2): `api.batch_update_field_definitions(p_org_id, p_changes jsonb, p_reason text, p_correlation_id uuid DEFAULT NULL)` — single network call, emits individual `client_field_definition.updated` events per changed field internally with shared correlation ID. Follows `api.sync_schedule_assignments()` pattern.

89. **Read RLS relaxed for field definitions** (decided 2026-03-27, architecture review m1): SELECT on `client_field_definitions_projection` requires org-member match only (no permission check). Intake form reads field definitions to know which fields to show — clinicians need read access without `organization.view`. Writes still gated by `organization.update`.

90. **Discharge fields excluded from configuration UI scope** (decided 2026-03-27): The Client Field Configuration page manages Steps 1-10 fields, but discharge configuration (separate operational concern) is a future project. Field definitions for discharge fields are seeded but not exposed in the configuration UI.

68. **Allergy type enum expanded** (decided 2026-03-19): `allergy_type` on each allergy item changed from `medication`/`general` to `medication`/`food`/`environmental`. Standard EMR categorization.

20. **4 clinical contact fields on intake form** (decided 2026-03-04): Separate fields for Assigned Clinician, Therapist, Psychiatrist, and Behavioral Analyst. All share the same reusable `ClinicalContactField` component parameterized by designation. All nullable.

21. **Client-side Jaro-Winkler fuzzy search for clinical contacts** (decided 2026-03-04): Preload all org staff + external contacts on form mount (one RPC call, cached). Score client-side with Jaro-Winkler (threshold ≥ 0.85) on every keystroke. Chosen over Fuse.js (Bitap algorithm penalizes transpositions as 2 edits — too harsh for short names like "Jonh"→"John"). Chosen over server-side `pg_trgm` (unnecessary round trips for 50-500 person pool). ~30 lines TypeScript, no dependency.

22. **Two-phase field UX for clinical contact assignment** (decided 2026-03-04): Each clinical contact field has 4 states: empty → search active (instant client-side results) → selected (chip display) → create-new mode (inline 4-field mini-form). "Add new contact" action always visible at bottom of results. New contact creation is deferred — no DB write until parent form submits. Existing `SearchableDropdown<T>` NOT reused (designed for async server-side search with debounce); simpler local dropdown using `DropdownPortal` + `useDropdownHighlighting`.

23. **Minimal inline contact creation form** (decided 2026-03-04): 4 fields only: First Name, Last Name, Email, Title. Full `ContactInput` (7 fields) rejected as too heavy for this context. Pre-fills name from search query (best-effort whitespace split).

24. **Shared correlation ID across multi-step intake submission** (decided 2026-03-04): Follows Pattern A from `SupabaseRoleService.bulkAssignRole()` — one `correlationId` UUID generated per form submit, passed as `p_correlation_id` flat parameter to all RPCs. All domain events traceable as single business transaction via `api.get_events_by_correlation()`. W3C Trace Context (`traceparent`, `trace_id`, `span_id`) handled automatically by existing `tracingFetch` wrapper + `postgrest_pre_request()` hook.

25. **Failed event detection via RPC read-back guard** (decided 2026-03-04): All event-emitting RPCs include projection read-back after emit. Returns `{success: false, error, correlation_id}` on failure. Frontend surfaces error with correlation ID reference for support. No polling needed — synchronous detection.

26. **data-testid on all interactive elements** (decided 2026-03-04): Designation-interpolated IDs for Playwright UAT (e.g., `clinical-contact-search-clinician`, `clinical-contact-add-new-therapist`). 15 test IDs per field instance × 4 designations.

27. **`photo_url` — Mandatory + NULLABLE** (decided 2026-03-09): Always present as column, not required at registration, uploadable later. Not org-configurable (always available). Not a reporting dimension.

28. **`notes` — DROPPED** (decided 2026-03-09): Omitted entirely from schema. Clinical notes/progress notes would be a separate applet if needed.

29. **`middle_name` — Mandatory + NULLABLE** (decided 2026-03-09): Not required at registration. Not a reporting dimension, but may appear in detail-level reporting (not sliceable).

30. **`preferred_name` — Optional, nullable** (decided 2026-03-09): No reporting requirements for sliceability.

31. **`custom_fields` JSONB confirmed** (decided 2026-03-09): `custom_fields jsonb DEFAULT '{}'` on `clients_projection`. Flat key/value storage. Structure/metadata in `client_field_definitions_projection`. Semantic keys only.

32. **`client_field_categories` reference table** (decided 2026-03-09): Separate config table (not free-text on field definitions). Seeded fixed set: `clinical`, `administrative`, `education`, `insurance`, `legal`. Orgs can add custom categories. No event sourcing (config data). Categories drive UI section grouping and Cube.js schema explorer — NOT analytical dimensions (not sliceable). `client_field_definitions_projection.category_id` FKs to this table.

33. **Audit columns confirmed** (decided 2026-03-09): `created_at` (timestamptz NOT NULL), `updated_at` (timestamptz NOT NULL), `created_by` (uuid NOT NULL), `updated_by` (uuid NOT NULL). All system-managed — no UI rendering in intake form or configuration form. Set by API functions and event handlers.

34. **Enterprise EMR field expansion** (decided 2026-03-09): User provided 17-category enterprise EMR field list. Cross-reference analysis identified ~40% already decided, ~15% partially decided, ~45% genuinely new. Wizard-style multi-step intake form with progressive disclosure — each category gets its own step, user clicks "Next" between categories.

35. **Categories 9, 12, 15 deferred as separate applets** (decided 2026-03-09): Behavioral Health Assessments (Category 9), Consents & Authorizations (Category 12), and Documentation & Attachments (Category 15) are fully longitudinal/ongoing data — no intake-only fields within them. Deferred to future applets. Leaves 14 categories for intake schema.

36. **Architectural scoping questions resolved** (2026-03-14): All 4 questions answered — see decisions 37-41.

37. **Guardian split** (decided 2026-03-14): Guardian *person* data (name, relationship, address, phone, email, custody documents) deferred to contact management applet. Client *legal status* fields captured on `clients_projection` now: `legal_custody_status`, `court_ordered_placement`, `financial_guarantor_type`.

38. **Insurance as normalized CQRS table** (decided 2026-03-14): `client_insurance_policies_projection` table, event-sourced. Events are sub-entity of `client` (`client.insurance_policy.added/updated/removed`) routed through `process_client_event()`. Supports primary + secondary + Medicaid rows.

39. **Per-org payer type configuration** (decided 2026-03-14): Toggles on `organizations_projection.direct_care_settings` JSONB (existing pattern). Controls which insurance sections appear in intake wizard.

40. **Clinical profile as typed columns** (decided 2026-03-14): Intake snapshot on `clients_projection`. Longitudinal tracking adds separate tables later.

41. **Referral upgraded to structured fields** (decided 2026-03-14): Replace `referral_source` plain text with `referral_source_type` (enum), `referral_organization`, `referral_date`, `reason_for_referral`. Referring provider deferred to contact management applet.

42. **Demographics additions** (decided 2026-03-14): `gender_identity` (free text, nullable), `secondary_language` (nullable, same org-configurable pattern), `marital_status` (enum, nullable), `citizenship_status` (text, nullable/optional).

43. **Identifier fields** (decided 2026-03-14): `mrn` (text, nullable, org-assigned), `external_id` (text, nullable, for imports), `drivers_license` (text, nullable).

44. **Client direct contact attributes** (decided 2026-03-14): `email`, `phone_primary`, `phone_secondary`, `preferred_communication_method` (enum), `county` — all on `clients_projection` directly, all nullable. Junction tables remain for additional/related contact points. County is an intake/reporting attribute, not a property of addresses_projection.

45. **Admission fields** (decided 2026-03-14): `admission_type` (enum NOT NULL: planned/emergency/transfer/readmission), `level_of_care` (text, nullable), `expected_length_of_stay` (integer days, nullable), `initial_risk_level` (enum, nullable), `discharge_plan_status` (enum, nullable, updated over time).

46. **Program manager as 8th→ designation** (decided 2026-03-14): Expanded designations. Now 12 total: clinician, therapist, psychiatrist, behavioral_analyst, case_worker, guardian, emergency_contact, program_manager, primary_care_physician, prescriber, probation_officer, caseworker.

47. **Discharge fields** (decided 2026-03-14): `discharge_reason` (text), `discharge_type` (enum: planned/ama/transfer/runaway/etc.), `discharge_diagnosis` (JSONB ICD-10 array), `discharge_placement` (text). All set via `client.discharged` event payload.

48. **Clinical profile fields** (decided 2026-03-14): `primary_diagnosis` (JSONB ICD-10), `secondary_diagnoses` (JSONB array), `dsm5_diagnoses` (JSONB array), `presenting_problem` (text), `suicide_risk_status` (enum), `violence_risk_status` (enum), `trauma_history_indicator` (boolean), `substance_use_history` (text), `developmental_history` (text), `previous_treatment_history` (text). All nullable intake snapshots.

49. **Medical info expansion** (decided 2026-03-14): PCP and prescriber as contact designations (10th, 11th). Allergy type ('medication' vs 'general') merged into existing allergies JSONB items. New columns: `immunization_status`, `dietary_restrictions`, `special_medical_needs`. All nullable.

50. **Legal & compliance fields** (decided 2026-03-14): Probation officer and caseworker as designations (11th, 12th). Typed columns: `court_case_number`, `state_agency`, `legal_status` (enum, reinstated), `legal_custody_status`, `court_ordered_placement` (boolean), `financial_guarantor_type`, `mandated_reporting_status` (boolean), `protective_services_involvement` (boolean), `safety_plan_required` (boolean).

51. **Client Supports & Family deferred** (decided 2026-03-14): Deferred to contact management applet alongside guardian person data. Family contacts + HIPAA release tracking = contact relationship data.

52. **Program config via custom_fields, financial deferred** (decided 2026-03-14): Category 13 (house assignment, privilege level, behavior levels) handled by existing `custom_fields` JSONB + `client_field_definitions_projection`. Category 14 (billing, payment plans) deferred to future billing module.

53. **`data_source` metadata column** (decided 2026-03-14): Enum: manual, api, import. System-managed, not user-facing.

54. **Intake coordinator as staff assignment** (decided 2026-03-14): Via `user_client_assignments_projection`, not a contact designation. Operational role.

55. **Current medications deferred** (decided 2026-03-14): Deferred to medication management applet. No duplicate capture on intake form.

56. **Chronic illnesses merged** (decided 2026-03-14): Add `is_chronic: boolean` to each item in `medical_conditions` JSONB. No new column.

## Technical Context

### Architecture

The client management applet is the central entity in the A4C data model. It sits at the intersection of:
- **Medication management** (existing): `medication_history` and `dosage_info` tables reference `clients.id`
- **Staff assignments** (existing): `user_client_assignments_projection` references `client_id` (currently no FK)
- **Behavioral incidents** (future): Will reference clients for outcome correlation
- **Analytics pipeline** (future): Client demographics become the `PatientDimension` conforming dimension in Cube.js

```
                      ┌─────────────────────┐
                      │   Cube.js Semantic   │
                      │      Layer           │
                      └─────────┬───────────┘
                                │
              ┌─────────────────┼─────────────────┐
              │                 │                  │
    ┌─────────▼──────┐ ┌───────▼────────┐ ┌──────▼──────────┐
    │  Medication    │ │  Behavioral    │ │  Other Future   │
    │  Adherence     │ │  Incidents     │ │  Fact Tables    │
    │  (fact)        │ │  (fact)        │ │                 │
    └────────┬───────┘ └───────┬────────┘ └──────┬──────────┘
             │                 │                  │
             └─────────────────┼──────────────────┘
                               │
                    ┌──────────▼──────────┐
                    │   Client / Patient  │  ← THIS APPLET
                    │   (dimension)       │
                    │   - Core fields     │
                    │   - Custom JSONB    │
                    │   - Field registry  │
                    └─────────────────────┘
```

### Tech Stack
- **Database**: PostgreSQL via Supabase (existing)
- **Event sourcing**: `domain_events` table with `process_domain_event_trigger` (existing)
- **API layer**: `api.*` schema RPC functions (CQRS pattern, existing)
- **Auth**: JWT custom claims v4 with `org_id`, `org_type`, `effective_permissions` (existing)
- **Future analytics**: Cube.js semantic layer, Observable Plot + D3 visualization

### Dependencies
- `organizations_projection` — parent org for multi-tenancy
- `organization_units_projection` — org hierarchy for client placement
- `users` — staff assignments, created_by/updated_by audit
- `domain_events` + `process_domain_event_trigger` — event sourcing infrastructure
- `permissions_projection` — RBAC permissions for client operations
- `contacts_projection` — unified "people" dimension for clinical assignments (add `user_id` FK); also reused via `client_contact_assignments`
- `phones_projection`, `addresses_projection` — reused via junction tables

### Existing Contact Infrastructure (discovered 2026-03-04)

**Contact CRUD API functions already deployed** (migration `20260226002002_organization_manage_page_phase1.sql`):
- `api.create_organization_contact(p_org_id uuid, p_data jsonb)` — emits `contact.created`, permission: `organization.update`
- `api.update_organization_contact(p_contact_id uuid, p_data jsonb)` — emits `contact.updated`
- `api.delete_organization_contact(p_contact_id uuid, p_reason text)` — emits `contact.deleted`

**Contact event pipeline fully deployed**:
- Router: `process_contact_event()` handles 5 events: `contact.created`, `contact.updated`, `contact.deleted`, `contact.user.linked`, `contact.user.unlinked`
- Junction router: `process_junction_event()` handles `organization.contact.linked/unlinked`, `contact.phone.linked/unlinked`, `contact.address.linked/unlinked`, `contact.email.linked/unlinked`
- Workflow activity: `createOrganization()` emits all contact events with full correlation during org bootstrap

**What's new for client management** (not yet deployed):
- `api.create_contact_designation()` — emits `contact.designation.created`
- `api.assign_client_contact()` — emits `client.contact.assigned`
- `api.assign_client_clinician()` — wrapper function orchestrating the above
- 2 new CASE branches in `process_contact_event()` for designation events
- 2 new CASE branches in `process_client_event()` for assignment events

91. **`/clients/register` route for intake, `/clients/:clientId` for post-registration** (decided 2026-04-06): Intake form at `/clients/register` captures initial data only (demographics, contact info, admission, staff assignment, clinical, medical). All post-registration management (discharge, contact info management, insurance, placement changes, contact reassignment, record editing) lives on `/clients/:clientId` detail page. Route order: `/clients/register` declared before `/clients/:clientId` to avoid React Router matching "register" as clientId param.

92. **`api.register_client(p_client_data jsonb, ...)` — JSONB payload, not positional params** (decided 2026-04-06, architecture review M2): Single JSONB parameter for ~50 client fields avoids ~40 positional parameters. Handler extracts fields via `p_event.event_data->>'field_name'`.

93. **`validate_client_required_fields()` helper** (decided 2026-04-06, architecture review M6): Public schema function reads `client_field_definitions_projection` for org-specific required field enforcement. Returns array of missing field keys. Called by `api.register_client()` after validating 7 hardcoded mandatory fields.

94. **`client.discharge` permission** (decided 2026-04-06): New permission added to `permissions_projection`. Assigned to `provider_admin` and `clinician` roles. Implies `client.view` + `client.update`. Backfilled to existing orgs via migration.

95. **`_projection` suffix on `client_placement_history`** (decided 2026-04-06, m1 remediation): All event-sourced tables use `_projection` suffix for consistency. Table is `client_placement_history_projection` (not `client_placement_history`).

## Current State

### Phase B Backend — 7 Migrations Written (2026-04-06, pending push)
All 7 migrations pass `supabase db push --linked --dry-run`.

| Migration | Content |
|-----------|---------|
| `20260406221732_client_contact_tables.sql` | 4 tables: client_phones/emails/addresses/contact_assignments_projection |
| `20260406221738_client_insurance_placement_tables.sql` | 3 tables: client_insurance_policies/placement_history/funding_sources_projection |
| `20260406221739_client_permissions_seed.sql` | client.discharge permission + role templates + implications + backfill |
| `20260406222201_client_lifecycle_event_handlers.sql` | Dispatcher + process_client_event() router + 4 lifecycle handlers |
| `20260406222642_client_sub_entity_event_handlers.sql` | Extended router (23 CASE) + 19 sub-entity handlers |
| `20260406222759_contact_designation_event_handlers.sql` | Extended process_contact_event() + 2 designation handlers |
| `20260406222857_client_api_functions.sql` | 25 RPCs + validate_client_required_fields() helper |

### Handler Reference Files Created
- `handlers/client/` — 23 files (4 lifecycle + 19 sub-entity)
- `handlers/contact/` — 2 files (designation handlers)
- `handlers/routers/process_client_event.sql` — 23 CASE branches
- `handlers/routers/process_contact_event.sql` — 7 CASE branches (5 existing + 2 designation)
- `handlers/trigger/process_domain_event.sql` — updated with `WHEN 'client'`

### AsyncAPI Contracts (B4a, 2026-04-06)
- **New**: `infrastructure/supabase/contracts/asyncapi/domains/client.yaml` — 23 event messages + 37 schemas
  - 4 lifecycle (registered, information_updated, admitted, discharged)
  - 3 phone, 3 email, 3 address, 3 insurance, 3 funding source sub-entity events (add/update/remove)
  - 2 placement (changed, ended), 2 contact assignment (assigned, unassigned)
  - Shared `ClientSubEntityRemovalData` for all remove events
- **Updated**: `contact.yaml` — 2 designation events added (contact.designation.created/deactivated) + 4 schemas
- **Updated**: `asyncapi.yaml` — 25 new channel refs + `client`, `client_field_definition`, `client_field_category` added to stream_type enum
- **Generated**: `types/generated-events.ts` — 38 enums, 271 interfaces (copied to frontend)
- Archived `domains.archived/client.yaml` is now superseded (was 4 events with stale field schemas)

### Existing Files (from Phase 2-3, already deployed)
- `clients_projection` table (53 typed columns) — deployed 2026-03-27
- `client_field_definitions_projection`, `client_field_categories`, `client_reference_values`, `client_field_definition_templates` — deployed 2026-03-27
- `contact_designations_projection` (12-value CHECK) — deployed 2026-03-27
- 8 API RPCs for field definitions/categories — deployed 2026-03-27
- Handler reference files for field definition/category handlers — deployed 2026-03-27
- Frontend Client Field Settings page at `/settings/client-fields` — deployed 2026-03-28

### Implementation Plan
- **Primary plan file**: `.claude/plans/golden-booping-rainbow.md` — Phase B full-stack plan with sequencing

### Cross-Correlation Audit (completed 2026-02-12)
Full audit of all event types across 12 routers + dispatcher vs 14 AsyncAPI domain files. Findings:
- **2 naming mismatches**: AsyncAPI has wrong names vs deployed routers (router is source of truth)
  - `user.access_dates.updated` → should be `user.access_dates_updated` (underscore)
  - `organization.subdomain.verification_failed` → should be `organization.subdomain.failed`
- **3 events in router but NOT in AsyncAPI**: `user.schedule.reactivated`, `user.schedule.deleted`, `organization.subdomain_status.changed`
- **11 events in AsyncAPI but NOT in router**: aspirational/future features (keep, mark aspirational)
- **9 of 12 routers use RAISE WARNING instead of RAISE EXCEPTION**: coding convention violation, fix planned in Migration 3
- **3 dual-routed events**: `user.invited`, `user.role.assigned`, `user.role.revoked` — intentional, correct (different stream_types)
- **Total event count**: 93 existing deployed + 17 new client = 110

### Schema Gaps (Current vs. Required)
| What's Missing | Priority |
|---------------|----------|
| middle_name, preferred_name | High |
| pronouns (free text) | High |
| race (text[], OMB multi-select) | High |
| ethnicity (text, OMB two-question) | High |
| primary_language, interpreter_needed | High |
| case_number | High |
| organization_unit_id (FK) | High |
| referral_source | Medium |
| legal_status, custody_info (JSONB) | Medium |
| insurance/medicaid_id | Medium |
| ssn_last_four | Low |
| education_status, grade_level, iep_status | Medium |
| ~~assigned_clinician_id~~ | ~~High~~ — Replaced by 4NF contact-designation model |
| `contact_designations_projection` (new table) | High |
| `client_contact_assignments` (new table) | High |
| custom_fields (JSONB) | High — **CONFIRMED** (2026-03-09) |
| `client_field_categories` (new table) | High — **NEW** (2026-03-09) |
| photo_url | Medium — **Mandatory + NULLABLE** (2026-03-09) |
| RLS policies (zero currently) | Critical |
| Domain event integration | Critical |
| API RPC functions | Critical |

## Key Patterns and Conventions

- **CQRS**: All writes through `api.*` functions that emit domain events. Never direct table mutations from frontend.
- **Event handlers**: Single trigger pattern (`process_domain_event_trigger`), routes by `stream_type` to router functions, then individual handlers.
- **Handler reference files**: Always read `infrastructure/supabase/handlers/` reference file before modifying a handler.
- **Projections**: Read models derived from event stream. Updated by event handler functions.
- **RLS**: JWT claims-based. `org_id` from `get_current_org_id()` for tenant isolation.
- **Naming**: Event types follow `{stream_type}.{past_tense_verb}` or `{stream_type}.{sub_entity}.{past_tense_verb}` pattern (e.g., `client.registered`, `client.custom_fields_updated`).
- **Router ELSE**: Must use `RAISE EXCEPTION ... USING ERRCODE = 'P9001'`, never `RAISE WARNING`.
- **Junction events**: Auto-routed by dispatcher via `LIKE '%.linked' OR LIKE '%.unlinked'` — bypass stream_type CASE.

## Reference Materials

### Conversations Loaded Into Context
1. **Analytics Architecture Discussion** (2026-02-12) — Cube.js semantic layer, conforming dimensions, self-service BI with Observable Plot, PostgreSQL as analytics foundation
2. **Client Intake Form Design** (2026-02) — Field catalog, regulatory requirements (OMB race/ethnicity, HIPAA), clinical role assignments, configurable schema per org
3. **Clinical Contact Assignment UX Design** (2026-03-04) — ClinicalContactField component, Jaro-Winkler search strategy, observability patterns (W3C Trace Context, Pattern A correlation, read-back guards), data-testid conventions

### Key Documentation
- [Event Handler Pattern](../../documentation/infrastructure/patterns/event-handler-pattern.md) — How to add new event types and handlers
- [Event Processing Patterns](../../documentation/infrastructure/patterns/event-processing-patterns.md) — Sync handler vs async workflow decision
- [Event Sourcing Overview](../../documentation/architecture/data/event-sourcing-overview.md) — CQRS pattern
- [RBAC Architecture](../../documentation/architecture/authorization/rbac-architecture.md) — Permission model
- [SQL Idempotency](../../documentation/infrastructure/guides/supabase/SQL_IDEMPOTENCY_AUDIT.md) — Migration patterns
- [Handler README](../../infrastructure/supabase/handlers/README.md) — Handler reference file conventions
- [Event Observability](../../documentation/infrastructure/guides/event-observability.md) — W3C Trace Context, pre-request hook, correlation ID, failed event detection
- [Event Metadata Schema](../../documentation/workflows/reference/event-metadata-schema.md) — Full JSONB metadata structure

### Plan Files
- `.claude/plans/peaceful-marinating-bonbon.md` — **CURRENT**: Client Field Configuration implementation plan (8 migrations + frontend). Architecture-reviewed, approved 2026-03-27.
- `.claude/plans/peaceful-marinating-bonbon-agent-af9009328e6dbb9f1.md` — Architecture review by software-architect-dbc agent (5 Major + 6 Minor findings, Design by Contract specs)
- `.claude/plans/woolly-beaming-teacup.md` — Clinical Contact Assignment Field UX plan (deferred to Client Intake project)
- `.claude/plans/spicy-bubbling-quail.md` — **ARCHIVED** (no longer exists, superseded by peaceful-marinating-bonbon)

### ADR
- `documentation/architecture/decisions/adr-client-management-schema.md` — Approved ADR: 12 tables, 84 decisions, 7 architectural themes, complete enum reference (2026-03-27)

### UX Prototype
- `dev/active/client-management-applet-ux-prototype/` — Static HTML/CSS/JS prototype (zipped). Design reference only — divergences from authoritative design documented in plan.

### Schema Diagrams (documentation source)
- `dev/active/client-management-applet-schema-diagrams.md` — Mermaid ER diagram (all 12 new tables + 2 modified + 6 existing), event flow diagram, table inventory, RLS patterns. **Serves as partial source for documentation artifacts** (table reference docs, architecture doc, AGENT-INDEX updates) per `documentation/AGENT-GUIDELINES.md`.

## Important Constraints

1. **CQRS compliance**: No direct table writes. All mutations via `api.*` RPC → domain event → handler.
2. **Event handler architecture**: Single trigger, router pattern. NEVER create per-event-type triggers.
3. **RLS before production**: `clients_projection` will need RLS policies from day 1. No zero-policy state.
4. **Greenfield table**: No legacy `clients` table in v4 baseline. This is a fresh `clients_projection` creation.
5. **Field keys are semantic**: Never `custom_field_1`. Always `placement_type`, `care_level`, etc.
6. **App-owner value sets preferred**: Push regulatory/clinical standards as app-defined enums. Minimize `conforming_dimension_value_mappings`.
7. **Client permissions already seeded**: `client.create`, `client.update`, `client.delete`, `client.view` exist in baseline seed. Role templates already include them (viewer: view, clinician: view+update, provider_admin: all).
8. **Existing helper functions to reuse**: `api.emit_domain_event()`, `get_current_org_id()`, `get_current_user_id()`, `has_effective_permission()`, `safe_jsonb_extract_text()`, `safe_jsonb_extract_uuid()`.
9. **`event_types` table has unique constraint on `event_type`**: Dual-routed events (e.g., `user.invited` with stream_type `user` AND `invitation`) can only have ONE row. The seed uses `ON CONFLICT (event_type) DO NOTHING`.
10. **Observability — Pattern A for RPC correlation**: New RPCs accept `p_correlation_id uuid DEFAULT NULL` as flat parameter (NOT `p_event_metadata` JSONB). W3C Trace Context (`traceparent`, `trace_id`, `span_id`) injected automatically by `tracingFetch` wrapper → `postgrest_pre_request()` hook → session variables → `api.emit_domain_event()` fallback. See `frontend/src/lib/supabase-ssr.ts:87-121` and `frontend/src/utils/trace-ids.ts`.
11. **Observability — read-back guard required on all event-emitting RPCs**: After emit, read projection. If NOT FOUND, check `processing_error` from `domain_events`, return `{success: false, error, correlation_id}`. Frontend surfaces error with correlation ID for support reference.

## Data Sensitivity Tiers (HIPAA)

| Tier | Examples | Handling |
|---|---|---|
| PHI-Critical | SSN last 4 (if captured), diagnoses, medications, allergies | Field-level encryption, strict audit, minimum necessary |
| PHI-Standard | Name, DOB, race/ethnicity, contacts | Standard HIPAA protections, role-based access |
| Administrative | Case #, admission date, referral source, org unit | Standard access controls |

## Frontend Patterns to Reuse (Phase 5)

When the frontend intake form is built, these existing patterns apply:

| Pattern | File | Reuse For |
|---|---|---|
| **Settings ViewModel** | `frontend/src/viewModels/settings/DirectCareSettingsViewModel.ts` | Intake form configuration ViewModel (observable state, dirty tracking, save/reset, audit) |
| **Settings hub card** | `frontend/src/pages/settings/SettingsPage.tsx` | "Client Intake Configuration" card (glassmorphism, permission-gated, keyboard accessible) |
| **Multi-section form** | `frontend/src/viewModels/organization/OrganizationFormViewModel.ts` | Client intake form (multi-section, complex validation, draft management) |
| **Multi-select dropdown** | `frontend/src/components/ui/MultiSelectDropdown.tsx` | Race multi-select (WCAG 2.1 AA, checkbox-based, keyboard nav) |
| **JSONB org settings** | `organizations_projection.direct_care_settings` | Pattern for per-org intake config storage |

### Current Frontend State (as of 2026-02-06)
- `/clients` route: Functional page with **mock data** (card grid, search/filter, client name + DOB + med count)
- `/clients/:clientId` detail: Tabs for overview, medications, history (coming soon), documents (coming soon)
- `/settings` route: Hub page with permission-gated cards; DirectCareSettings section with toggle switches + reason-for-change audit
- Root `/` redirects to `/clients`

### Open Frontend Questions (resolve before Phase 5)
- ~~**Navigation**: Intake form configuration under `/settings/organization` (alongside DirectCareSettings) or dedicated `/settings/intake-form` sub-route?~~ **RESOLVED** (Decision 88): Dedicated `/settings/client-fields` sub-route.
- ~~**Configurability UX**: Toggle switches (like DirectCareSettings) vs. drag-and-drop field ordering vs. section-based grouping?~~ **RESOLVED**: Toggle switches + tabbed categories with "Required when visible" pattern.

### Phase A Test Suite ✅ COMPLETE (2026-04-06)

**139 tests total, all passing**:
- `frontend/src/viewModels/settings/__tests__/ClientFieldSettingsViewModel.test.ts` — 56 Vitest unit tests
- `workflows/src/__tests__/activities/seed-field-definitions.test.ts` — 12 Jest unit tests
- `frontend/src/services/client-fields/__tests__/SupabaseClientFieldService.test.ts` — 26 Vitest unit tests
- `frontend/e2e/client-field-settings.spec.ts` — 26 Playwright E2E tests
- `frontend/playwright.client-fields.config.ts` — Dedicated Playwright config (port 3457, VITE_FORCE_MOCK=true, VITE_DEV_PROFILE=provider_admin)
- `infrastructure/supabase/scripts/test-client-field-rls.sql` — 19 RLS verification tests (run via MCP execute_sql or psql)
- `workflows/jest.config.js` + `workflows/src/test-setup.ts` — First Jest tests in workflows project

**RLS test coverage** (19 tests across 7 tables):
- Org isolation: field definitions (own rows, cross-org, bogus org), categories (system + custom cross-org), clients projection, contact designations
- Global-read: reference values (USING true), templates (USING true)
- Platform admin: cross-org override on field defs + templates
- Write denial: INSERT on all 6 projection/reference tables, UPDATE + DELETE on field definitions

**Test infrastructure created (workflows)**:
- `workflows/jest.config.js` — ts-jest preset with path aliases
- `workflows/src/test-setup.ts` — Jest setup file

**E2E config gotcha**: `super_admin` profile has `org_type: 'platform_owner'`, but SettingsPage gates the client fields card on `org_type === 'provider'`. Must use `provider_admin` profile for E2E tests.

**E2E auth gotcha**: When `.env.local` has Supabase credentials, the dev server uses real auth (not mock). The dedicated playwright config sets `VITE_FORCE_MOCK=true` to force mock mode regardless.

**RLS test gotcha**: MCP `execute_sql` doesn't return RAISE NOTICE output. The script is designed for psql/SQL Editor. To verify via MCP, run individual assertions as SELECT queries (see verification pattern in conversation history).

## Why This Approach?

**Why JSONB + field registry instead of per-tenant schemas?**
Single table, single schema, operationally manageable at 300+ orgs. JSONB with GIN indexes provides queryable flexible storage without EAV performance issues. Cube.js dynamic schema generation bridges the gap between flexible storage and typed analytics dimensions.

**Why not EAV?**
Row explosion, terrible query performance, no type safety. JSONB stores a single document per row — no joins needed to reconstruct a client record.

**Why not wide-table (`custom_text_1`, `custom_int_1`)?**
Destroys semantic meaning. Every layer (UI, API, analytics) needs a lookup to translate opaque column names to meaningful field labels. This IS the metadata-as-data antipattern.

**Why app-owner value sets over tenant-defined for analytics dimensions?**
Regulatory and clinical standards already define value sets for nearly every analytically-important field (OMB for demographics, ICD-10 for diagnoses, ISO for languages). Using these eliminates the need for cross-org value mapping for core dimensions. Tenant-specific fields are dimensions within their own analytics only.

**Why `client` stream_type instead of `clinical`?**
`clinical` is too broad — it could encompass behavioral incidents, medication events, treatment plans. `client` is specific to the client entity lifecycle. Each domain entity gets its own stream_type (consistent with existing patterns: `user`, `organization`, `role`, etc.).
