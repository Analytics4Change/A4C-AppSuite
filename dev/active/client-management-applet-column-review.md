# Client Management Applet — Column Review

**Date**: 2026-02-12
**Last Updated**: 2026-03-04
**Purpose**: Finalized field inventory for `clients_projection` with mandatory/optional classification and configurability decisions.

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

## Mandatory + NOT NULL (value required at registration)

| Field | Type | Label Configurable | Dropdown Source | Reporting Dimension | Notes |
|-------|------|-------------------|----------------|-------------------|-------|
| `id` | uuid | N/A | — | — | PK, auto-generated |
| `organization_id` | uuid | N/A | — | — | FK → organizations_projection |
| `first_name` | text | No | — | No | |
| `last_name` | text | No | — | No | |
| `date_of_birth` | date | No | — | Yes | Drives computed `age_group` dimension |
| `gender` | text | No | Hardcoded (Male, Female) | Yes | Label: "Gender Assigned at Birth" |
| `race` | text[] | No | Hardcoded (7 OMB values) | Yes | Multi-select |
| `ethnicity` | text | No | Hardcoded (3 OMB values) | Yes | Single-select |
| `primary_language` | text | No | Org-configurable from `client_reference_values` master list | Yes | Defaults: English, Spanish |
| `interpreter_needed` | boolean | No | — | No | |
| `admission_date` | date | No | — | Yes | Provider-specified (not set by event handler) |
| `internal_case_number` | text | **Yes** | — | No | Auto-populated from UUID; only renamable field |
| `status` | text | No | — | Yes | Domain: `active` / `inactive` only |
| `allergies` | jsonb | No | — | No | `{ nka, items: [{ name, severity }] }` with mutual exclusivity |
| `medical_conditions` | jsonb | No | — | No | `{ nkmc, items: [{ code, description }] }` ICD-10 autocomplete |

## Mandatory + NULLABLE (always present, value null until lifecycle event)

| Field | Type | Label Configurable | Dropdown Source | Reporting Dimension | Notes |
|-------|------|-------------------|----------------|-------------------|-------|
| `discharge_date` | date | No | — | Yes | Provider-specified, set via `client.discharged` event payload |
| `referral_source` | text | No | — (free text) | No | |

## Optional (always present as column, not required)

| Field | Type | Label Configurable | Dropdown Source | Reporting Dimension | Notes |
|-------|------|-------------------|----------------|-------------------|-------|
| `pronouns` | text | No | Org-configurable (via `client_field_definitions_projection`) | No | UI always appends "Other → free text" |
| `middle_name` | text | No | — | No | **Not yet discussed** |
| `preferred_name` | text | No | — | No | **Not yet discussed** |

## Configurable Presence (org toggles on/off)

| Field | Type | Label Configurable | Dropdown Source | Reporting Dimension | Notes |
|-------|------|-------------------|----------------|-------------------|-------|
| `medicaid_id` | text | No | — (free text) | No | Insurance identifier |
| `medicare_id` | text | No | — (free text) | No | Insurance identifier |
| `education_status` | text | No | Hardcoded (~10 values) | No | enrolled, not_enrolled, homeschool, etc. |
| `grade_level` | text | No | — (free text) | No | |
| `iep_status` | boolean | No | — | No | Individualized Education Program |

## Infrastructure Columns (not rendered in UI)

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `organization_unit_id` | uuid | NOT NULL | FK → organization_units_projection; set programmatically |

## Not Yet Discussed (as of 2026-03-04)

**Resume here next session** — user was about to answer when session ended.

| Field | Type | Original Notes |
|-------|------|---------------|
| `photo_url` | text | Requires Supabase Storage infrastructure — likely defer |
| `notes` | text | Free-text on client record vs separate notes system |

## Audit Columns (standard, not yet discussed)

| Field | Type | Notes |
|-------|------|-------|
| `created_at` | timestamptz | Auto |
| `updated_at` | timestamptz | Auto |
| `created_by` | uuid | |
| `updated_by` | uuid | |

## Dropped Fields (decided 2026-03-02, updated 2026-03-04)

| Field | Original Type | Reason |
|-------|--------------|--------|
| `external_case_number_1` | text | Not needed |
| `external_case_number_2` | text | Not needed |
| `external_case_number_3` | text | Not needed |
| `legal_status` | jsonb | Dropped |
| `blood_type` | text | Not standard for residential behavioral health |
| `height_cm` | numeric | Vitals — defer to future applet |
| `weight_kg` | numeric | Vitals — defer to future applet |
| `ssn_last_four` | text | Not required by EHR/EMR, HIPAA breach liability |
| `program_manager_id` | uuid | Dropped |
| `assigned_clinician_id` | uuid | Replaced by 4NF contact-designation model (2026-03-04) |

---

## Customizable Fields (org-configurable via JSONB)

Stored in `custom_fields jsonb DEFAULT '{}'` on `clients_projection`. Defined per-org in `client_field_definitions_projection`.

| Property | Description |
|----------|-------------|
| **Storage** | `custom_fields` JSONB column with GIN index |
| **Registry** | `client_field_definitions_projection` defines what fields each org uses |
| **Field types** | `text`, `number`, `date`, `enum`, `multi_enum`, `boolean` |
| **Keys** | Always semantic (`placement_type`, never `custom_field_1`) |
| **Validation** | `validation_rules` JSONB on field definition (min/max, pattern, etc.) |
| **Analytics** | `is_dimension = true` exposes field in Cube.js for that org |

**Example custom fields an org might define:**

| field_key | display_name | field_type | is_dimension | Owner |
|-----------|-------------|------------|--------------|-------|
| `placement_type` | Placement Type | enum | yes | Tenant |
| `care_level` | Care Level | enum | yes | Tenant |
| `treatment_modality` | Treatment Modality | multi_enum | yes | Tenant |
| `funding_source` | Funding Source | enum | yes | Tenant |
| `court_case_number` | Court Case Number | text | no | Tenant |
| `probation_officer` | Probation Officer | text | no | Tenant |
| `discharge_plan` | Discharge Plan | text | no | Tenant |
| `behavioral_tier` | Behavioral Tier | enum | yes | Tenant |

---

## Contact Info & Clinical Assignment (via junction tables, NOT columns)

Not stored on `clients_projection` directly. Linked via junction tables reusing existing projections.

### Standard Junction Tables

| Junction Table | Links To | Examples |
|---------------|----------|----------|
| `client_phones` | `phones_projection` | Client/guardian phone numbers |
| `client_addresses` | `addresses_projection` | Placement address, home address |

### 4NF Contact-Designation Model (decided 2026-03-04)

Clinician assignment uses a 4NF decomposition instead of a simple FK column. This supports internal users AND external people as clinical contacts, with per-client designation (clinician for Client A, therapist for Client B).

| Table | Purpose | Key Columns |
|-------|---------|-------------|
| `contacts_projection` (existing, add `user_id`) | Unified "people" dimension | `user_id` (nullable FK → users; NULL = external) |
| `contact_designations_projection` (new) | Designations a contact holds within an org (7 values: clinician, therapist, psychiatrist, behavioral_analyst, case_worker, guardian, emergency_contact) | `contact_id`, `designation`, `organization_id`; UNIQUE on all 3 |
| `client_contact_assignments` (new, replaces `client_contacts`) | 4NF junction: client + contact + designation | `client_id`, `contact_id`, `contact_designation_id`, `organization_id`; UNIQUE on first 3 |

**Replaces**: Originally planned `client_contacts` junction table.
**Replaces**: `assigned_clinician_id` column on `clients_projection`.

See `dev/active/client-management-applet-user-notes.md` "Clinical Contact Assignment Architecture" section for full table schemas, scenarios, and rationale.

### Clinical Contact Fields (intake form)

These are data entry fields on the registration form, stored via the contact-designation model above — **not** columns on `clients_projection`.

| Field | Designation Value | Mandatory | Notes |
|-------|------------------|-----------|-------|
| Assigned Clinician | `clinician` | No (nullable) | |
| Therapist | `therapist` | No (nullable) | |
| Psychiatrist | `psychiatrist` | No (nullable) | |
| Behavioral Analyst | `behavioral_analyst` | No (nullable) | Added per intake form design (decision 20) |

**UI**: Shared `ClinicalContactField` component parameterized by designation. Client-side Jaro-Winkler fuzzy search on preloaded org contacts. Inline 4-field mini-form for new contact creation (deferred save). See `.claude/plans/woolly-beaming-teacup.md` for full UX plan.

---

## `client_reference_values` Table (reduced scope)

Only **language** remains in the reference table. All other categories moved to hardcoded frontend dropdowns.

| Category | Standard | Count | Purpose |
|----------|----------|-------|---------|
| Language | ISO 639 | 20 | Master list for org admin to select from |

**Removed from reference table** (hardcoded in frontend instead):
- Gender (2 values: Male, Female)
- Race (7 OMB values)
- Ethnicity (3 OMB values)

---

## `client_field_definitions_projection` Usage Summary

This table is used for:
1. **Pronouns** — storing org-configurable dropdown options
2. **Primary Language** — storing which languages from the master list the org has selected (defaults: English, Spanish)
3. **Medicaid ID / Medicare ID** — toggling presence on/off
4. **Education fields** — toggling presence on/off (education_status, grade_level, iep_status)
5. **Internal Case Number** — configurable display label
6. **Custom fields** — defining org-specific JSONB fields

It is **NOT** used for configuring labels on any field other than `internal_case_number`.

---

## Provider-Specified Dates vs System Event Timestamps

Two distinct date concepts for admission and discharge:

| Concept | Storage | Source |
|---------|---------|--------|
| **Provider-specified date** | `admission_date` / `discharge_date` column on `clients_projection` | Entered by provider, part of CQRS event payload |
| **System event timestamp** | `domain_events.created_at` | Automatic when event is recorded |

Both flow through the full CQRS pipeline: API function → domain event payload → event handler → projection column.

---

**The dividing line**: If a field is analytically important across ALL orgs (demographics, regulatory) → core typed column. If it's org-specific or varies by program type → `custom_fields` JSONB with a field definition in the registry.
