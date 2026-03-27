# Client Management Applet — User Notes

**Last Updated**: 2026-03-02

## Field UX Decisions

### Gender Assigned at Birth
**Label**: "Gender Assigned at Birth" (non-configurable)
**Mandatory**: Yes (NOT NULL at registration)
**Dropdown**: Hardcoded in frontend — **Male / Female** only
**No expanded mode** — no settings toggle, no Non-binary/Transgender/Other/Prefer Not to Say options
**No `client_reference_values`** — 2 values hardcoded in frontend
**Reporting dimension**: Yes

### Pronouns
**Label**: Non-configurable
**Configurable presence**: Yes — org admin toggles on/off
**Type**: Free text input at runtime (Decision 71, 2026-03-23)
- Placeholder text guides format: "e.g., he/him, she/her, they/them"
- DB column: plain `text` on `clients_projection.pronouns`
- **No org-configured dropdown** — was previously org-configurable options, changed to free text because not a reporting dimension
**Not a reporting dimension** — no analytical reason to constrain values

### Citizenship Status
**Label**: Non-configurable
**Configurable presence**: Yes — org admin toggles on/off
**Dropdown**: Hardcoded in frontend (Decision 72, 2026-03-23) — 6 standardized values:
```
U.S. Citizen
Lawful Permanent Resident (Green Card Holder)
Nonimmigrant Visa Holder (Temporary Status)
Refugee or Asylee
Other Immigration Status
Prefer not to answer
```
**DB column**: plain `text` on `clients_projection.citizenship_status` (stores selected value)
**Not a reporting dimension**

### Race
**Label**: Non-configurable
**Mandatory**: Yes (NOT NULL, at least one selection required at registration)
**Multi-select dropdown**: Hardcoded in frontend (OMB categories)
```
American Indian or Alaska Native
Asian
Black or African American
Native Hawaiian or Other Pacific Islander
White
Two or more Races
Prefer not to say
```
**No `client_reference_values`** — 7 values hardcoded in frontend
**Reporting dimension**: Yes

### Ethnicity
**Label**: Non-configurable
**Mandatory**: Yes (NOT NULL at registration)
**Single-select dropdown**: Hardcoded in frontend (OMB two-question format)
```
Hispanic or Latino
Not Hispanic or Latino
Prefer not to say
```
**No `client_reference_values`** — 3 values hardcoded in frontend
**Reporting dimension**: Yes

### Primary Language
**Label**: Non-configurable
**Configurable presence**: Yes — org admin toggles on/off, can set `is_required` (Decision 69)
**Runtime searchbox**: Staff types to search and select from ISO 639 master list at intake time (Decision 70, 2026-03-23)
- `client_reference_values` (category: `language`) holds 20 ISO 639 languages as backend lookup
- **No org admin configuration** of which languages are available — full list always searchable
- Same pattern as medication/ICD-10 search: type-ahead with autocomplete
- **No free-text entry** — must select from searchbox results

### Interpreter Needed
**Label**: Non-configurable
**Mandatory**: Yes (NOT NULL at registration)
**Type**: Boolean

### Internal Case Number — DROPPED
**DROPPED** (2026-03-19) — eliminated entirely. `id` (UUID) serves as the internal identifier; `mrn` covers org's own numbering scheme. Removes the only renamable-label field.

### Admission Date & Discharge Date — Provider-Specified Dates
Two distinct concepts for both admission and discharge:
1. **Provider-specified date** — entered by the provider (clinical reality), stored on `clients_projection` column, part of the CQRS event payload
2. **System event timestamp** — `domain_events.created_at` on the corresponding event (audit trail)

**admission_date**:
- Provider-specified, captured on the registration form
- Mandatory (NOT NULL at registration)
- Non-configurable label
- Part of `client.registered` event payload → handler writes to projection

**discharge_date**:
- Provider-specified, entered when discharging
- Mandatory field (always present), but NULLABLE (null until discharge)
- Non-configurable label
- Part of `client.discharged` event payload → handler writes to projection

All lifecycle events are retained: `client.registered`, `client.admitted`, `client.discharged`, `client.reverse_discharge`, `client.readmitted`

### Status Field
**Label**: Non-configurable
**Mandatory**: Yes (NOT NULL)
**Canonical values**: `active`, `inactive` (2 values only)
- Simple administrative toggle, not a lifecycle state machine
- Discharge does not change status — discharged client can be active or inactive independently
- Program-location tracking (in-program, AWOL, hospital, detention, etc.) belongs to a future data collection applet

### Referral Source
**Label**: Non-configurable
**Mandatory field, NULLABLE** — always present, but value can be left blank at registration
**Type**: Plain text input (no dropdown)
**Not a reporting dimension**

### Allergies
**Label**: Non-configurable
**Mandatory**: Yes (NOT NULL)
**Type**: JSONB — structured object with mutual exclusivity enforcement
```json
// No known allergies
{ "nka": true, "items": [] }

// Has allergies
{ "nka": false, "items": [
  { "name": "Penicillin", "severity": "life_threatening" },
  { "name": "Ibuprofen", "severity": "controlled_by_medication" }
]}
```
**Business rules**:
- If `nka: true` → `items` must be empty
- If `nka: false` → `items` must have at least one entry
- Each item: `name` (free text) + `allergy_type` (enum: `medication` | `food` | `environmental`) + `severity` (enum: `life_threatening` | `controlled_by_medication`)
- Validation in API function + optional CHECK constraint on column

### Medical Conditions
**Label**: Non-configurable
**Mandatory**: Yes — same pattern as allergies (must explicitly indicate "no known medical conditions")
**Type**: JSONB — structured object with ICD-10 codes
```json
// No known medical conditions
{ "nkmc": true, "items": [] }

// Has conditions
{ "nkmc": false, "items": [
  { "code": "J45.20", "description": "Mild intermittent asthma" },
  { "code": "G40.909", "description": "Epilepsy, unspecified" }
]}
```
**ICD-10 autocomplete** — provider searches by condition name, selects from ICD-10 catalog
- Model the search/cache/modal pattern on existing RxNorm medication search
- BUT build UI to current design standards (RxNorm was pre-standardization)
- ICD-10 catalog source (external API vs local table) — design decision deferred

### Medicaid ID / Medicare ID
**Label**: Non-configurable (both)
**Configurable presence**: Yes — org admin toggles whether field appears (via `client_field_definitions_projection`)
**Type**: Text input, nullable
**Not a reporting dimension**

### Education Fields
All three have **configurable presence** — org admin toggles on/off via `client_field_definitions_projection`.
All three have **non-configurable labels**.

**education_status**:
- Hardcoded dropdown in frontend (~10 values):
```
enrolled, not_enrolled, homeschool, ged_program, ged_completed,
graduated, pre_school, suspended, expelled, vocational
```

**grade_level**: Text input, nullable

**iep_status**: Boolean (Individualized Education Program)

### Organization Unit ID
**Infrastructure column** — NOT rendered as a form field in the UI
- FK to `organization_units_projection`
- NOT NULL
- Set programmatically based on context (e.g., which unit the logged-in user belongs to)
- Used for RLS scoping, analytics, internal data routing

## Renamable Fields

**No fields have configurable display labels.** `internal_case_number` was the only renamable field and was dropped (2026-03-19).

**Dropped**: `external_case_number_1/2/3` — removed entirely from schema.

There will be no `court_case_number` core field.

## Discharge Events

- `client.discharged` — provider-specified `discharge_date` in event payload, system timestamp in `created_at`
- `client.reverse_discharge` — undoes an accidental or unintended discharge (restores previous state)
- `client.readmitted` — re-admits a previously discharged client (new service engagement, distinct from reverse_discharge)

## Clinical Contact Assignment Architecture (decided 2026-03-04)

### Problem
A clinician assigned to a client may be an internal system user OR an external person (outside therapist, psychiatrist, case worker). Storing `assigned_clinician_id` as a FK to `users` would only cover internal users. Additionally, the same person may hold different clinical designations for different clients (clinician for Client A, therapist for Client B). Analytics queries like "incidents grouped by clinician" must work uniformly regardless of whether the clinician is internal or external.

### Solution: 4NF Contact-Designation Model

**`contacts_projection`** becomes the unified "people" dimension for analytics. Internal users get a `user_id` FK linking them to their system account. External people have `user_id = NULL`.

**`contact_designations_projection`** (new) — designations a contact can hold within an org (clinician, therapist, psychiatrist, case_worker, guardian, etc.). One contact can hold multiple designations.

**`client_contact_assignments`** (new, replaces originally planned `client_contacts`) — the 4NF junction: each row is an atomic fact "this client is assigned this contact in this designation."

```
clients_projection
    │
    │ client_contact_assignments (4NF junction)
    │   client_id + contact_id + contact_designation_id + organization_id
    │
    ▼
contacts_projection (the person — add user_id FK)
    │
    │ contact_designations_projection (designations a person holds)
    │   contact_id + designation + organization_id
    │
    ▼
  "Dr. Smith: clinician"    ← same person, different designations
  "Dr. Smith: therapist"       for different clients
```

### Key Decisions

1. **"Designation" not "role"** — `role` has specific RBAC meaning in A4C (`roles_projection`, `user_roles_projection`). Using `designation` avoids semantic collision.

2. **Designation is per-assignment, not per-person** — the same contact can be a clinician for Client A and a therapist for Client B. The designation lives on `client_contact_assignments` (via FK to `contact_designations_projection`), not on the contact record itself.

3. **`contacts_projection.type` (contact_type enum) unchanged** — the existing enum (`a4c_admin`, `billing`, `technical`, `emergency`, `stakeholder`) stays for organizational contact types. Clinical designations are a separate concept in `contact_designations_projection`.

4. **Lazy contact creation for internal users** — a `contacts_projection` record is auto-created for an internal user the first time they are assigned a clinical designation on a client. Users without clinical assignments have no contact record. Auto-creation handled by wrapper function `api.assign_client_clinician()` which emits `contact.created` + `contact.user.linked` events in sequence.

5. **`assigned_clinician_id` column DROPPED** from `clients_projection` — clinician assignment is handled entirely through the contact assignment architecture.

6. **Analytics path is clean** — single join path for all "incidents grouped by clinician" queries:
   `clients_projection` → `client_contact_assignments` → `contacts_projection`
   Filter by `contact_designation_id` → `contact_designations_projection.designation = 'clinician'`

7. **Non-additive measure mitigation** — `contact_designations_projection` provides deduplicated headcounts per designation. The 4NF decomposition prevents fan-out: "count of clinicians" = `COUNT(DISTINCT contact_id) FROM contact_designations_projection WHERE designation = 'clinician'`.

8. **Fixed designation list** (decided 2026-03-04) — 6 values only, no org customization: `clinician`, `therapist`, `psychiatrist`, `case_worker`, `guardian`, `emergency_contact`. Plain text column with CHECK constraint. No admin UI for designation management.

9. **Full event sourcing for designations** (decided 2026-03-04) — `contact.designation.created` / `contact.designation.deactivated` as first-class domain events. Codebase-wide audit found zero precedent for projection rows without domain events. Only configuration tables (`permission_implications`) are non-event-sourced.

10. **Wrapper + individual API functions** (decided 2026-03-04) — `api.assign_client_clinician()` wrapper calls `api.create_organization_contact()` (existing) + `api.create_contact_designation()` (new) + `api.assign_client_contact()` (new) in a single PG transaction. Each inner function callable independently for future contact management applet.

11. **Permission: `client.update`** (decided 2026-03-04) — contact assignment operations gated by existing `client.update` permission. No new permissions needed.

12. **Line staff deferred** (decided 2026-03-04) — Contact-designation model is clinical/external only. Line staff remain in `user_client_assignments_projection`. Future unification possible via adding `direct_care` designation but not committed to now.

13. **Contact CRUD already exists** (discovered 2026-03-04) — `api.create_organization_contact()`, `api.update_organization_contact()`, `api.delete_organization_contact()` deployed in migration `20260226002002`. Full event pipeline operational: events → `process_contact_event()` → handlers → `contacts_projection`. Wrapper function reuses existing `api.create_organization_contact()`.

### Proposed Table Schemas

**`contacts_projection` (existing — add 1 column)**:
| Column | Change | Type | Notes |
|--------|--------|------|-------|
| `user_id` | **ADD** | uuid NULL | FK → `users(id)`. NULL = external. Populated = internal system user |

**`contact_designations_projection` (new)**:
| Column | Type | Nullable | Notes |
|--------|------|----------|-------|
| `id` | uuid | NO | PK |
| `contact_id` | uuid | NO | FK → `contacts_projection(id)` |
| `designation` | text | NO | `clinician`, `therapist`, `psychiatrist`, `case_worker`, `guardian`, `emergency_contact`, etc. |
| `organization_id` | uuid | NO | FK → `organizations_projection(id)` — designation is org-scoped |
| `is_active` | boolean | NO | Default true |
| `created_at` | timestamptz | NO | |
| `updated_at` | timestamptz | YES | |
| UNIQUE | | | `(contact_id, designation, organization_id)` |

**`client_contact_assignments` (new — replaces `client_contacts`)**:
| Column | Type | Nullable | Notes |
|--------|------|----------|-------|
| `id` | uuid | NO | PK |
| `client_id` | uuid | NO | FK → `clients_projection(id)` |
| `contact_id` | uuid | NO | FK → `contacts_projection(id)` |
| `contact_designation_id` | uuid | NO | FK → `contact_designations_projection(id)` |
| `organization_id` | uuid | NO | FK → `organizations_projection(id)` — for RLS |
| `is_active` | boolean | NO | Default true |
| `assigned_at` | timestamptz | NO | |
| `assigned_by` | uuid | YES | User who created the assignment |
| `notes` | text | YES | |
| `created_at` | timestamptz | NO | |
| `updated_at` | timestamptz | YES | |
| UNIQUE | | | `(client_id, contact_id, contact_designation_id)` |

### Scenarios

**A: Internal user assigned as clinician for a client**
1. Check if user has a `contacts_projection` record (via `user_id` FK)
2. If not → auto-create contact, copying name/email from `users`, setting `user_id`
3. Check if contact has `clinician` designation in `contact_designations_projection`
4. If not → create the designation entry
5. Create `client_contact_assignments` row

**B: External person assigned as clinician**
1. Create (or find existing) contact in `contacts_projection` — `user_id` is NULL
2. Create designation in `contact_designations_projection`
3. Create `client_contact_assignments` row

**C: External clinician later becomes a system user (gets invited)**
1. When user account is created, link existing contact by setting `contacts_projection.user_id = new_user.id`
2. All existing `client_contact_assignments` remain intact

### Event Design (decided 2026-03-04, refined 2026-03-04)

**Designation events** — sub-entity of `contact`:
| Event | stream_type | stream_id | Router |
|-------|-------------|-----------|--------|
| `contact.designation.created` | `contact` | contact_id | `process_contact_event()` (existing, add CASE) |
| `contact.designation.deactivated` | `contact` | contact_id | `process_contact_event()` (existing, add CASE) |

**Client assignment events** — sub-entity of `client`:
| Event | stream_type | stream_id | Router |
|-------|-------------|-----------|--------|
| `client.contact.assigned` | `client` | client_id | `process_client_event()` (new, planned) |
| `client.contact.unassigned` | `client` | client_id | `process_client_event()` (new, planned) |

**Why not junction pattern**: `client_contact_assignments` has richer data than simple junctions (`contact_designation_id`, `assigned_by`, `notes`, `is_active`). The `%.linked`/`%.unlinked` junction pattern only does simple INSERT/DELETE.

**Why sub-entity, not separate stream_type**: Designations are a property of the contact entity. Client assignments are about the client's care team. No new routers needed beyond what's already planned.

**Existing infrastructure reused**: `contact.user.linked`/`contact.user.unlinked` events and the `user_id` FK on `contacts_projection` already exist — no new work needed for linking internal users to contacts.

### API Function Design (decided 2026-03-04)

**Wrapper function**: `api.assign_client_clinician(p_client_id, p_user_id_or_contact_id, p_designation, ...)`
- Single PG transaction wrapping up to 4 events
- Handles lazy contact creation for internal users
- Validates designation against fixed list of 6 values
- Calls individual functions in sequence:

**Individual functions** (each independently callable):
| Function | Emits | Existing? |
|----------|-------|-----------|
| `api.create_organization_contact(p_org_id, p_data)` | `contact.created` | ✅ Yes (migration 20260226002002) |
| `api.create_contact_designation(p_contact_id, p_designation, p_org_id)` | `contact.designation.created` | ❌ New |
| `api.assign_client_contact(p_client_id, p_contact_id, p_designation_id)` | `client.contact.assigned` | ❌ New |
| `api.unassign_client_contact(p_assignment_id)` | `client.contact.unassigned` | ❌ New |

**Wrapper flow for first-time internal user assignment**:
1. Check if user has `contacts_projection` record (via `user_id`) → if not, call `api.create_organization_contact()` → `contact.created` event
2. `contact.user.linked` event emitted (existing handler sets `contacts_projection.user_id`)
3. Check if contact has this designation → if not, call `api.create_contact_designation()` → `contact.designation.created` event
4. Call `api.assign_client_contact()` → `client.contact.assigned` event
5. If any step fails, entire transaction rolls back (all-or-nothing)

**Permission**: All functions check `client.update` (reuse existing permission).

### Relationship to `user_client_assignments_projection`

`user_client_assignments_projection` remains for **operational** staff-to-client mapping (caseload management, notification routing). It's an internal system concern separate from the analytics-facing contact assignment model. It may eventually be derived from `client_contact_assignments` for internal users (where `contact.user_id IS NOT NULL`), but that's a future consideration.

## Dropped Fields (decided 2026-03-02, updated 2026-03-04)

| Field | Reason |
|-------|--------|
| `external_case_number_1/2/3` | Not needed |
| `legal_status` | Dropped |
| `blood_type` | Not standard for residential behavioral health EHRs |
| `height_cm` / `weight_kg` | Vitals, not intake fields; belong to future vitals applet |
| `ssn_last_four` | Not required by EHR/EMR, creates HIPAA breach liability |
| `program_manager_id` | Dropped |
| `assigned_clinician_id` | Replaced by 4NF contact-designation model (2026-03-04) |
| `internal_case_number` | UUID `id` serves as internal identifier; `mrn` covers org numbering (2026-03-19) |
| `county` | Not needed (2026-03-19) |
| `preferred_communication_method` | Dropped entirely (2026-03-19) |
| `email` | Moved to `client_emails` table — Option B (2026-03-19) |
| `phone_primary` | Moved to `client_phones` table — Option B (2026-03-19) |
| `phone_secondary` | Moved to `client_phones` table — Option B (2026-03-19) |

## Option B: Client-Owned Contact Tables (decided 2026-03-19)

Client's own contact info stored in dedicated tables, NOT flat text on `clients_projection`, NOT junctions to shared projections, NOT the 4NF contact-designation model.

**Tables**: `client_phones`, `client_emails`, `client_addresses`
- Each has `client_id` FK, `organization_id` for RLS, type enum, `is_primary` flag
- Event-sourced: sub-entity events (`client.phone.added/updated/removed`, etc.) via `process_client_event()`
- Configurable presence + optional — org admin toggles whether contact section appears

**Why not 4NF model**: The 4NF contact-designation model answers "who is assigned to this client and in what role?" Client's own contact info answers "how do we reach this client?" — fundamentally different concepts.

**Why not shared projections**: `phones_projection`/`addresses_projection` were designed for organizational contacts (staff, external people). The client isn't an org contact.

## Configurable Label + Conforming Dimension Mapping (decided 2026-03-19)

Org admin can rename display labels for contact designations and `state_agency`. Canonical key stays unchanged in DB for cross-org Cube.js analytics. Labels stored in `client_field_definitions_projection`.

**Fields using this pattern**: `state_agency` + all 12 contact designations (clinician, therapist, psychiatrist, behavioral_analyst, case_worker, guardian, emergency_contact, program_manager, primary_care_physician, prescriber, probation_officer, caseworker).

**Rule**: Fixed CHECK constraint set — orgs can only relabel, NOT add new designations.

## Mandatory Core (decided 2026-03-19)

**7 fields at intake registration**: `first_name`, `last_name`, `date_of_birth`, `gender`, `admission_date`, `allergies`, `medical_conditions`

**3 fields at discharge time**: `discharge_date`, `discharge_reason`, `discharge_type`

**All other fields** are optional and/or configurable_presence.

**Changed from mandatory to optional**: `race`, `ethnicity`, `primary_language`, `interpreter_needed`, `admission_type`

## Fields Resolved (2026-03-09)

### photo_url
**Classification**: Mandatory + NULLABLE
**Not required at registration** — uploadable later
**Not org-configurable** — always available for all orgs
**Not a reporting dimension**

### notes
**DROPPED** — omitted entirely from schema. If needed later, a separate clinical notes system is a different applet.

### middle_name
**Classification**: Mandatory + NULLABLE
**Not required at registration**
**Not a reporting dimension** — but may appear in detail-level reporting (not sliceable)

### preferred_name
**Classification**: Optional, nullable
**No reporting requirements** for sliceability

### custom_fields (JSONB)
**CONFIRMED** — `custom_fields jsonb DEFAULT '{}'` on `clients_projection`
**Structure**: Flat key/value in the JSONB (`{"placement_type": "residential", "care_level": "intensive"}`)
**Registry**: `client_field_definitions_projection` stores structural metadata per field per org (category, field_key, display_name, field_type, is_required, validation_rules, is_dimension, sort_order)

### client_field_categories (new table)
**Decision**: Option 2 — separate reference table (not free-text on field definitions)
**Fixed set** (seeded, app-owner-defined): `clinical`, `administrative`, `education`, `insurance`, `legal`
**Org-defined**: Orgs can add custom categories (rows in the table)
**No event sourcing** — configuration data (like `permission_implications`)
**Purpose**: Drives UI section grouping and Cube.js schema explorer grouping. Categories themselves are NOT sliceable/analytical dimensions.
**FK**: `client_field_definitions_projection.category_id` → `client_field_categories.id`

### Audit columns
**Status**: CONFIRMED (2026-03-09)
- `created_at` (timestamptz NOT NULL) — system-managed
- `updated_at` (timestamptz NOT NULL) — system-managed
- `created_by` (uuid NOT NULL) — system-managed from `auth.uid()`
- `updated_by` (uuid NOT NULL) — system-managed from `auth.uid()`
- No UI rendering in intake form or configuration form

## Clinical Contact Field UX (designed 2026-03-04)

**4 fields on intake form**: Assigned Clinician, Therapist, Psychiatrist, Behavioral Analyst — all nullable, all sharing same `ClinicalContactField` component.

**Search**: Client-side Jaro-Winkler on preloaded candidate set (one RPC, cached). Threshold ≥ 0.85. Chosen over Fuse.js because Bitap penalizes transpositions as 2 edits (too harsh for short names). Sub-millisecond scoring, zero latency per keystroke.

**Inline creation**: 4-field mini-form (First Name, Last Name, Email, Title). Deferred save — contact not persisted until parent form submits.

**Observability**: Shared `correlationId` across entire intake submission (Pattern A). Auto W3C tracing via existing pipeline. Read-back guards on all RPCs.

**Full plan**: `.claude/plans/woolly-beaming-teacup.md` — PENDING APPROVAL.

## EMR Expansion Decisions (2026-03-14)

### Intake UX — Wizard-Style Multi-Step Form
**Decision 34**: Progressive disclosure. Each EMR category gets its own wizard step. User clicks "Next" between categories. ~10 steps covering 14 active categories.

### Deferred Categories
- **Category 9**: Behavioral Health Assessments → future applet (fully longitudinal)
- **Category 12**: Consents & Authorizations → future applet (fully longitudinal)
- **Category 15**: Documentation & Attachments → future applet (fully longitudinal)
- **Category 3 (person data)**: Guardian/Responsible Party → contact management applet
- **Category 11**: Client Supports & Family → contact management applet
- **Category 14**: Financial & Account → future billing module
- **Current medications**: → medication management applet (existing)

### Guardian Split (Decision 37)
- Guardian *person* data deferred to contact management applet (contact-designation model has `guardian` designation)
- Client *legal status* fields captured NOW on `clients_projection`: `legal_custody_status`, `court_ordered_placement`, `financial_guarantor_type`

### Insurance Architecture (Decisions 38-39)
- **Normalized table**: `client_insurance_policies_projection` (CQRS event-sourced)
- **Sub-entity events**: `client.insurance_policy.added/updated/removed` via `process_client_event()`
- **Per-org config**: Payer type toggles on `organizations_projection.direct_care_settings` JSONB
- `medicaid_id` and `medicare_id` remain on `clients_projection` (configurable presence)

### Referral Upgrade (Decision 41)
- Old: `referral_source` (plain text, nullable)
- New: `referral_source_type` (enum), `referral_organization`, `referral_date`, `reason_for_referral`
- Referring provider deferred to contact management applet
- Intake coordinator via `user_client_assignments_projection` (operational, Decision 54)

### Clinical Profile (Decision 48)
All intake snapshots on `clients_projection`: `primary_diagnosis` (JSONB ICD-10), `secondary_diagnoses`, `dsm5_diagnoses`, `presenting_problem`, `suicide_risk_status`, `violence_risk_status`, `trauma_history_indicator`, `substance_use_history`, `developmental_history`, `previous_treatment_history`. Longitudinal tracking adds separate tables later.

### Medical Expansion (Decision 49)
- PCP and Prescriber as contact designations (not columns)
- Allergy type ('medication' vs 'general') merged into existing `allergies` JSONB items
- Chronic illness `is_chronic` boolean merged into `medical_conditions` JSONB items (Decision 56)
- New columns: `immunization_status`, `dietary_restrictions`, `special_medical_needs`

### Legal Fields (Decision 50)
- Probation officer and caseworker as contact designations (not columns)
- Typed columns: `court_case_number`, `state_agency`, `legal_status` (reinstated), `mandated_reporting_status`, `protective_services_involvement`, `safety_plan_required`

### Designation Expansion (7 → 12)
```
clinician, therapist, psychiatrist, behavioral_analyst, case_worker,
guardian, emergency_contact, program_manager, primary_care_physician,
prescriber, probation_officer, caseworker
```

### Program Configuration (Decision 52)
Category 13 (house assignment, privilege level, behavior levels) handled by existing `custom_fields` JSONB + `client_field_definitions_projection`. Not new typed columns.

### System Metadata (Decision 53)
`data_source` (enum: manual, api, import) — system-managed, not user-facing.

## `client_reference_values` Table

Significantly reduced scope from original plan. Only one category remains. **No admin UI** — backend lookup only (Decision 70, 2026-03-23).

| Category | Standard | Count | Purpose |
|----------|----------|-------|---------|
| Language | ISO 639 | 20 | Backend lookup for runtime searchbox at intake |

Gender, race, ethnicity — all hardcoded in frontend, no reference table entries.
