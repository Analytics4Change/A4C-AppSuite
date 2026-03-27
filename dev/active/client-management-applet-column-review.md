# Client Management Applet — Column Review

**Date**: 2026-02-12
**Last Updated**: 2026-03-14
**Purpose**: Complete field inventory for `clients_projection` with mandatory/optional classification, configurability decisions, and intake wizard category mapping. Expanded from 17-category enterprise EMR field list.

---

## Field Classification Legend

| Classification | Meaning |
|---------------|---------|
| **Mandatory + NOT NULL** | Always present, value required at registration |
| **Mandatory + NULLABLE** | Always present as a field, but value can be null until a lifecycle event sets it |
| **Optional** | Always present as a column, but not required |
| **Configurable presence** | Org admin toggles whether field appears (via `client_field_definitions_projection`) |
| **Infrastructure** | Column exists but not rendered in UI |

---

## Intake Wizard Categories

The intake form is a wizard-style multi-step form with progressive disclosure. Each section below maps to a wizard step.

### Step 1: Demographics (Category 1)

#### Mandatory + NOT NULL

| Field | Type | Label Configurable | Dropdown Source | Reporting Dimension | Notes |
|-------|------|-------------------|----------------|-------------------|-------|
| `id` | uuid | N/A | — | — | PK, auto-generated |
| `organization_id` | uuid | N/A | — | — | FK → organizations_projection |
| `first_name` | text | No | — | No | |
| `last_name` | text | No | — | No | |
| `date_of_birth` | date | No | — | Yes | Drives computed `age_group` dimension |
| `gender` | text | No | Hardcoded (Male, Female) | Yes | Label: "Gender Assigned at Birth" |
| `status` | text | No | — | Yes | Domain: `active` / `inactive` only |

#### Optional (no configurable_presence)

| Field | Type | Label Configurable | Dropdown Source | Reporting Dimension | Notes |
|-------|------|-------------------|----------------|-------------------|-------|
| `middle_name` | text | No | — | No | Detail-level reporting only (not sliceable) |

#### Configurable Presence + Optional (org toggles on/off)

| Field | Type | Label Configurable | Dropdown Source | Reporting Dimension | Notes |
|-------|------|-------------------|----------------|-------------------|-------|
| `race` | text[] | No | Hardcoded (7 OMB values) | Yes | Multi-select. Changed from mandatory 2026-03-19 |
| `ethnicity` | text | No | Hardcoded (3 OMB values) | Yes | Single-select. Changed from mandatory 2026-03-19 |
| `primary_language` | text | No | Org-configurable from `client_reference_values` master list | Yes | Defaults: English, Spanish. Changed from mandatory 2026-03-19 |
| `interpreter_needed` | boolean | No | — | No | Changed from mandatory 2026-03-19 |
| `photo_url` | text | No | — | No | Not required at registration, uploadable later |
| `preferred_name` | text | No | — | No | |
| `pronouns` | text | No | — (free text, placeholder guides format) | No | Changed from org-configured dropdown to free text (Decision 71, 2026-03-23) |
| `gender_identity` | text | No | — (free text) | No | Separate from Sex at Birth (Decision 42) |
| `secondary_language` | text | No | Org-configurable from `client_reference_values` master list | No | Same pattern as primary_language (Decision 42) |
| `marital_status` | text | No | Hardcoded (6 values: single, married, divorced, separated, widowed, domestic_partnership) | No | (Decisions 42, 79) |
| `citizenship_status` | text | No | Hardcoded (6 values) | No | Changed from free text to standardized dropdown (Decision 72, 2026-03-23) |
| `mrn` | text | No | — | No | Medical Record Number, org-assigned |
| `external_id` | text | No | — | No | For imports from other systems |
| `drivers_license` | text | No | — | No | State ID for older youth/young adults |

### Step 2: Contact Information (Category 2) — Decisions 44, 57

**REDESIGNED 2026-03-19**: Client's own contact info moved to dedicated client-owned tables (Option B). See `client-management-applet-user-notes.md` for full table schemas.

| Table | Purpose | Configurable Presence | Notes |
|-------|---------|----------------------|-------|
| `client_phones` | Client's phone numbers | Yes | type enum: mobile, home, work, other; `is_primary` flag |
| `client_emails` | Client's email addresses | Yes | type enum: personal, school, work, other; `is_primary` flag |
| `client_addresses` | Client's addresses | Yes | type enum: home, mailing, previous, other; `is_primary` flag |

**Dropped from `clients_projection`**: `email`, `phone_primary`, `phone_secondary`, `preferred_communication_method`, `county`

### Step 3: Guardian / Responsible Party (Category 3) — Decision 37

Guardian *person* data (name, relationship, address, phone, email, custody documents) **DEFERRED to contact management applet**. Only client *legal status* fields captured now:

| Field | Type | Nullable | Notes |
|-------|------|----------|-------|
| `legal_custody_status` | text | YES | Enum: `parent_guardian`, `state_child_welfare`, `juvenile_justice`, `guardianship`, `emancipated_minor`, `other` (Decision 82). No required elaboration for `other`. |
| `court_ordered_placement` | boolean | YES | |
| `financial_guarantor_type` | text | YES | Enum: `parent_guardian`, `state_agency`, `juvenile_justice`, `self`, `insurance_only`, `tribal_agency`, `va`, `other` (Decision 84) |

### Step 4: Referral Information (Category 4) — Decision 41

Replaces former `referral_source` plain text field.

| Field | Type | Nullable | Notes |
|-------|------|----------|-------|
| `referral_source_type` | text | YES | Enum: self, parent_guardian, therapist, school, court, hospital, agency, insurance, other |
| `referral_organization` | text | YES | |
| `referral_date` | date | YES | |
| `reason_for_referral` | text | YES | |

**Deferred**: Referring provider (contact management applet). Intake coordinator (staff assignment via `user_client_assignments_projection`).

### Step 5: Admission Details (Category 5) — Decision 45

| Field | Type | Nullable | Notes |
|-------|------|----------|-------|
| `admission_date` | date | NO | Provider-specified (existing) |
| `admission_type` | text | YES | Enum: planned, emergency, transfer, readmission. Configurable presence + optional (changed from mandatory 2026-03-19) |
| `level_of_care` | text | YES | Configurable presence + optional |
| `expected_length_of_stay` | integer | YES | Days. Configurable presence + optional |
| `initial_risk_level` | text | YES | Enum: Low Risk, Moderate Risk, High Risk, Critical/Imminent Risk. Configurable presence + optional. **Reporting dimension** (Decision 73, 2026-03-23) |
| `discharge_plan_status` | text | YES | Enum: not_started, in_progress, complete. Optional (no configurable_presence) |
| `placement_arrangement` | text | YES | Enum: 13 values (residential_treatment, therapeutic_foster_care, group_home, foster_care, kinship_placement, adoptive_placement, independent_living, home_based, detention, secure_residential, hospital_inpatient, shelter, other). Configurable presence + optional. **Reporting dimension.** Denormalized current placement — source of truth is `client_placement_history` table. (Decision 83, 2026-03-26) |

**Via contact-designation model** (not columns): Assigned Therapist, Psychiatrist, Case Manager, Program Manager.

### Step 6: Insurance & Payer Information (Category 6) — Decisions 38-39

`medicaid_id` and `medicare_id` remain on `clients_projection` (configurable presence). Full insurance in separate table.

| Field on clients_projection | Type | Nullable | Notes |
|-----------------------------|------|----------|-------|
| `medicaid_id` | text | YES | Configurable presence |
| `medicare_id` | text | YES | Configurable presence |

**Separate table**: `client_insurance_policies_projection` (CQRS event-sourced, sub-entity of `client`). See Insurance Table section below.

**Per-org config**: Payer type toggles on `organizations_projection.direct_care_settings` JSONB.

### Step 7: Clinical Profile (Category 7) — Decision 48

All intake snapshots. Longitudinal tracking adds separate tables later.

| Field | Type | Nullable | Notes |
|-------|------|----------|-------|
| `primary_diagnosis` | jsonb | YES | Single ICD-10 `{code, description}` |
| `secondary_diagnoses` | jsonb | YES | Array of ICD-10 |
| `dsm5_diagnoses` | jsonb | YES | Array of DSM-5 |
| `presenting_problem` | text | YES | |
| `suicide_risk_status` | text | YES | Enum: `low_risk`, `moderate_risk`, `high_risk` (Decision 80) |
| `violence_risk_status` | text | YES | Enum: `low_risk`, `moderate_risk`, `high_risk` (Decision 81) |
| `trauma_history_indicator` | boolean | YES | |
| `substance_use_history` | text | YES | Text (may become JSONB) |
| `developmental_history` | text | YES | |
| `previous_treatment_history` | text | YES | Text (may become JSONB) |

### Step 8: Medical Information (Category 8) — Decision 49

| Field | Type | Nullable | Notes |
|-------|------|----------|-------|
| `allergies` | jsonb | NO | `{ nka, items: [{ name, allergy_type, severity }] }` — `allergy_type`: 'medication', 'food', or 'environmental'; `severity`: 'life_threatening' or 'controlled_by_medication' |
| `medical_conditions` | jsonb | NO | `{ nkmc, items: [{ code, description, is_chronic }] }` — `is_chronic` boolean added (Decision 56) |
| `immunization_status` | text | YES | |
| `dietary_restrictions` | text | YES | |
| `special_medical_needs` | text | YES | |

**Via contact-designation model**: Primary Care Physician, Prescriber.
**Deferred**: Current medications (medication management applet, Decision 55).

### Step 9: Legal & Compliance (Category 10) — Decision 50

| Field | Type | Nullable | Notes |
|-------|------|----------|-------|
| `court_case_number` | text | YES | Reinstated as typed column |
| `state_agency` | text | YES | DCFS/DHS etc. Configurable label + conforming dimension mapping (Decision 60) |
| `legal_status` | text | YES | Enum: voluntary, court_ordered, guardianship. Reinstated |
| `mandated_reporting_status` | boolean | YES | |
| `protective_services_involvement` | boolean | YES | |
| `safety_plan_required` | boolean | YES | |

**Via contact-designation model**: Probation officer, Caseworker.

**Note**: `legal_custody_status`, `court_ordered_placement`, `financial_guarantor_type` are in Step 3 (Guardian section).

### Step 10: Discharge Information (Category 17) — Decisions 47, 62, 78

Populated when discharge occurs. **Not filled at intake.** Three-field decomposition (Decision 78, 2026-03-26) replaces single `discharge_type` with `discharge_outcome` + `discharge_reason` + `discharge_placement` capturing orthogonal dimensions.

#### Mandatory at Discharge Time

| Field | Type | Nullable | Notes |
|-------|------|----------|-------|
| `discharge_date` | date | YES | Provider-specified, set via `client.discharged` event payload. Required when discharging. |
| `discharge_outcome` | text | YES | Enum: `successful`, `unsuccessful`. Binary program success indicator. Required when discharging. **Reporting dimension.** (Decision 78, replaces `discharge_type`) |
| `discharge_reason` | text | YES | Enum: `graduated_program`, `achieved_treatment_goals`, `awol`, `ama`, `administrative`, `hospitalization_medical`, `insufficient_progress`, `intermediate_secure_care`, `secure_care`, `ten_day_notice`, `court_ordered`, `deceased`, `transfer`, `medical`. Required when discharging. **Reporting dimension.** |

#### Configurable Presence + Optional at Discharge

| Field | Type | Nullable | Notes |
|-------|------|----------|-------|
| `discharge_diagnosis` | jsonb | YES | ICD-10 array |
| `discharge_placement` | text | YES | Enum: `home`, `lower_level_of_care`, `higher_level_of_care`, `secure_care`, `intermediate_secure_care`, `other_program`, `hospitalization`, `incarceration`, `other`. Where client went. **Reporting dimension.** |

---

## Infrastructure Columns (not rendered in UI)

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `organization_unit_id` | uuid | NOT NULL | FK → organization_units_projection; set programmatically |
| `data_source` | text | NOT NULL | Enum: manual, api, import. System-managed (Decision 53) |

## Audit Columns (confirmed 2026-03-09)

All system-managed, NOT NULL, mandatory. No UI rendering.

| Field | Type | Nullable | Notes |
|-------|------|----------|-------|
| `created_at` | timestamptz | NOT NULL | Set by API function on creation |
| `updated_at` | timestamptz | NOT NULL | Set by API function on every mutation |
| `created_by` | uuid | NOT NULL | Set by API function from `auth.uid()` |
| `updated_by` | uuid | NOT NULL | Set by API function from `auth.uid()` |

## Configurable Presence (org toggles on/off)

| Field | Type | Label Configurable | Dropdown Source | Notes |
|-------|------|-------------------|----------------|-------|
| `medicaid_id` | text | No | — (free text) | Insurance identifier |
| `medicare_id` | text | No | — (free text) | Insurance identifier |
| `education_status` | text | No | Hardcoded (~10 values) | enrolled, not_enrolled, homeschool, etc. |
| `grade_level` | text | No | — (free text) | |
| `iep_status` | boolean | No | — | Individualized Education Program |

---

## Dropped Fields

| Field | Original Type | Reason |
|-------|--------------|--------|
| `external_case_number_1/2/3` | text | Not needed |
| `blood_type` | text | Not standard for residential behavioral health |
| `height_cm` / `weight_kg` | numeric | Vitals — defer to future applet |
| `ssn_last_four` | text | Not required by EHR/EMR, HIPAA breach liability |
| `program_manager_id` | uuid | Replaced by contact-designation model |
| `assigned_clinician_id` | uuid | Replaced by 4NF contact-designation model |
| `notes` | text | Dropped entirely — separate applet if needed |
| `referral_source` | text | **REPLACED** by structured referral fields (Decision 41) |
| `internal_case_number` | text | UUID `id` is internal ID; `mrn` covers org numbering (Decision 63, 2026-03-19) |
| `county` | text | Not needed (Decision 64, 2026-03-19) |
| `preferred_communication_method` | text | Dropped entirely (Decision 65, 2026-03-19) |
| `email` | text | Moved to `client_emails` table (Decision 57, 2026-03-19) |
| `phone_primary` | text | Moved to `client_phones` table (Decision 57, 2026-03-19) |
| `phone_secondary` | text | Moved to `client_phones` table (Decision 57, 2026-03-19) |

## Deferred Categories (future applets/modules)

| Category | Reason | Decision |
|----------|--------|----------|
| 9: Behavioral Health Assessments | Fully longitudinal (repeated measures) | 35 |
| 11: Client Supports & Family | Contact relationship data → contact management applet | 51 |
| 12: Consents & Authorizations | Fully longitudinal (expire/renew) | 35 |
| 14: Financial & Account | Future billing module | 52 |
| 15: Documentation & Attachments | Fully longitudinal (accumulate) | 35 |
| Guardian person data (Cat 3) | Contact management applet | 37 |
| Current medications (Cat 8) | Medication management applet | 55 |

---

## `client_insurance_policies_projection` Table (Decision 38)

CQRS event-sourced projection. Sub-entity events via `process_client_event()`:
- `client.insurance_policy.added`
- `client.insurance_policy.updated`
- `client.insurance_policy.removed`

Per-org payer type config via `organizations_projection.direct_care_settings` JSONB toggles (Decision 39).

Fields TBD — will include: payer_name, payer_id, plan_name, member_id, group_number, subscriber_name, subscriber_dob, subscriber_relationship, coverage_start_date, coverage_end_date, copay, deductible, authorization_required, policy_type (primary/secondary/medicaid/medicare — Decision 74, `state` removed by Decision 76), authorization tracking fields.

---

## `client_funding_sources_projection` Table (Decision 76, 2026-03-23)

CQRS event-sourced projection. Separate from insurance — different data shape, no payer/subscriber/coverage fields. Sub-entity events via `process_client_event()`:
- `client.funding_source.added`
- `client.funding_source.updated`
- `client.funding_source.removed`

Org admin defines funding source slots dynamically in `client_field_definitions_projection` (each with `configurable_label`). Staff adds rows at intake. **NOT a reporting dimension.**

| Column | Type | Nullable | Notes |
|--------|------|----------|-------|
| `id` | uuid | NO | PK |
| `client_id` | uuid | NO | FK → `clients_projection` |
| `organization_id` | uuid | NO | FK → `organizations_projection` (RLS) |
| `funding_source_key` | text | NO | e.g., `external_funding_source_1` — links to `client_field_definitions_projection` for label |
| `source_name` | text | YES | Name of the funding program |
| `source_id` | text | YES | Identifier/account number |
| `amount` | numeric | YES | Funding amount if applicable |
| `start_date` | date | YES | Coverage/funding start |
| `end_date` | date | YES | Coverage/funding end |
| `notes` | text | YES | Additional details |
| `custom_fields` | jsonb | NO | DEFAULT '{}' — non-standard fields per funding source (Decision 77, 2026-03-23) |
| `is_active` | boolean | NO | Default true |
| `created_at` | timestamptz | NO | |
| `updated_at` | timestamptz | NO | |

**Note**: Fields TBD — the above is a starting proposal. Actual fields will be refined during implementation.

---

## `client_placement_history` Table (Decision 83, 2026-03-26)

CQRS event-sourced history table. Tracks full placement trajectory with date ranges. Sub-entity events via `process_client_event()`:
- `client.placement.changed` — closes previous row (sets `end_date`), inserts new row, updates `clients_projection.placement_arrangement`
- `client.placement.ended` — closes current row without opening a new one

Intake form captures initial placement → emits `client.placement.changed` as first entry. Frontend for placement transitions (step-downs, transfers) deferred.

| Column | Type | Nullable | Notes |
|--------|------|----------|-------|
| `id` | uuid | NO | PK |
| `client_id` | uuid | NO | FK → `clients_projection` |
| `organization_id` | uuid | NO | FK → `organizations_projection` (RLS) |
| `placement_arrangement` | text | NO | 13-value enum (same as `clients_projection.placement_arrangement`) |
| `start_date` | date | NO | When this placement began |
| `end_date` | date | YES | When this placement ended (NULL = current) |
| `reason_for_change` | text | YES | Why placement changed |
| `is_current` | boolean | NO | Default true. Only one current row per client. |
| `created_at` | timestamptz | NO | |
| `updated_at` | timestamptz | NO | |

**Constraints**: UNIQUE on `(client_id, start_date)` — one placement per client per date.

---

## Contact-Designation Model (expanded)

Designations expanded from 7 → 12 (Decision 46):

```
clinician, therapist, psychiatrist, behavioral_analyst, case_worker,
guardian, emergency_contact, program_manager, primary_care_physician,
prescriber, probation_officer, caseworker
```

| Table | Purpose | Key Columns |
|-------|---------|-------------|
| `contacts_projection` (existing, add `user_id`) | Unified "people" dimension | `user_id` (nullable FK → users; NULL = external) |
| `contact_designations_projection` (new) | Designations per contact per org | `contact_id`, `designation`, `organization_id`; UNIQUE on all 3 |
| `client_contact_assignments` (new) | 4NF junction: client + contact + designation | `client_id`, `contact_id`, `contact_designation_id`, `organization_id`; UNIQUE on first 3 |

### Clinical Contact Fields (intake form)

Stored via contact-designation model — **not** columns on `clients_projection`.
All have **configurable_presence** + **configurable_label** + **conforming_dimension_mapping** (Decision 59).

| Field | Designation Value (canonical) | Configurable Label | Wizard Step |
|-------|-------------------------------|-------------------|-------------|
| Assigned Clinician | `clinician` | Yes | Step 5: Admission |
| Therapist | `therapist` | Yes | Step 5: Admission |
| Psychiatrist | `psychiatrist` | Yes | Step 5: Admission |
| Behavioral Analyst | `behavioral_analyst` | Yes | Step 5: Admission |
| Program Manager | `program_manager` | Yes | Step 5: Admission |
| Primary Care Physician | `primary_care_physician` | Yes | Step 8: Medical |
| Prescriber | `prescriber` | Yes | Step 8: Medical |
| Probation Officer | `probation_officer` | Yes | Step 9: Legal |
| Caseworker | `caseworker` | Yes | Step 9: Legal |

**Guardian** and **Emergency Contact** designations deferred to contact management applet.

---

## Customizable Fields (org-configurable via JSONB) — includes Program Config (Category 13)

Stored in `custom_fields jsonb DEFAULT '{}'` on `clients_projection`. Defined per-org in `client_field_definitions_projection`.

| Property | Description |
|----------|-------------|
| **Storage** | `custom_fields` JSONB column with GIN index |
| **Registry** | `client_field_definitions_projection` defines what fields each org uses |
| **Field types** | `text`, `number`, `date`, `enum`, `multi_enum`, `boolean` |
| **Keys** | Always semantic (`placement_type`, never `custom_field_1`) |
| **Validation** | `validation_rules` JSONB on field definition (min/max, pattern, etc.) |
| **Analytics** | `is_dimension = true` exposes field in Cube.js for that org |

**Example custom fields** (includes Category 13 Program Configuration):

| field_key | display_name | field_type | is_dimension | Owner |
|-----------|-------------|------------|--------------|-------|
| `placement_type` | Placement Type | enum | yes | Tenant |
| `care_level` | Care Level | enum | yes | Tenant |
| `treatment_modality` | Treatment Modality | multi_enum | yes | Tenant |
| `funding_source` | Funding Source | enum | yes | Tenant |
| `behavioral_tier` | Behavioral Tier | enum | yes | Tenant |
| `house_assignment` | House Assignment | text | no | Tenant |
| `privilege_level` | Privilege Level | enum | no | Tenant |
| `observation_status` | Observation Status | enum | no | Tenant |
| `school_enrollment_status` | School Enrollment Status | enum | no | Tenant |
| `employment_status` | Employment Status | enum | no | Tenant |

---

## `client_reference_values` Table (reduced scope, updated 2026-03-23)

Only **language** remains in the reference table. All other categories hardcoded in frontend. **No admin UI** — used as backend lookup table for runtime search only.

| Category | Standard | Count | Purpose |
|----------|----------|-------|---------|
| Language | ISO 639 | 20 | Backend lookup for runtime searchbox at intake (Decision 70) |

---

## `client_field_categories` Table (decided 2026-03-09)

Small config table — no event sourcing.

**Fixed set**: `clinical`, `administrative`, `education`, `insurance`, `legal`
**Org-defined**: Orgs can add custom category rows.
**FK**: `client_field_definitions_projection.category_id` → `client_field_categories.id`

---

## `client_field_definitions_projection` Usage Summary

1. ~~**Pronouns** — org-configurable dropdown options~~ **REMOVED** (2026-03-23): Changed to runtime free text (Decision 71)
2. ~~**Primary/Secondary Language** — which languages from master list the org has selected~~ **REMOVED** (2026-03-23): Changed to runtime search (Decision 70)
3. **Configurable presence toggles** — ~40 fields across all sections (race, ethnicity, language, interpreter, photo, identifiers, referral, admission details, insurance, clinical profile, medical, legal, education, discharge, contact designations, client contact tables)
4. **Configurable required** — `is_required` boolean per field, org admin sets "Required when visible" for any configurable_presence typed column (Decision 69, 2026-03-23). Enforcement: frontend validation + API function validation. Database columns stay nullable.
5. **Custom fields** — defining org-specific JSONB fields (Category 13 program config)
6. **Configurable labels** — `state_agency` + 12 contact designations + dynamic external funding source slots (org can rename display label, canonical key stays for analytics). Decision 76 replaced `state` payer type with dynamic funding sources (2026-03-23).
7. **Conforming dimension mapping** — same fields as #6 (renamed label maps back to canonical value for cross-org Cube.js analytics)

---

## Provider-Specified Dates vs System Event Timestamps

| Concept | Storage | Source |
|---------|---------|--------|
| **Provider-specified date** | `admission_date` / `discharge_date` on `clients_projection` | Entered by provider, part of CQRS event payload |
| **System event timestamp** | `domain_events.created_at` | Automatic when event is recorded |

---

**The dividing line**: If a field is analytically important across ALL orgs (demographics, regulatory) → core typed column. If it's org-specific or varies by program type → `custom_fields` JSONB with a field definition in the registry.
