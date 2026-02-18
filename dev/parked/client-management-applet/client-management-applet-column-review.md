# Client Management Applet — Column Review

**Date**: 2026-02-12
**Purpose**: Candidate field inventory for `clients_projection` with customizability classification.

---

## Core Typed Columns (universal, NOT customizable)

These exist as real PostgreSQL columns on `clients_projection`. Every org gets them. They serve as conforming dimensions for Cube.js analytics.

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `id` | uuid | yes | PK, auto-generated |
| `organization_id` | uuid | yes | FK → organizations_projection |
| `organization_unit_id` | uuid | no | FK → organization_units_projection (placement) |
| **Demographics** | | | |
| `first_name` | text | yes | |
| `last_name` | text | yes | |
| `middle_name` | text | no | |
| `preferred_name` | text | no | |
| `date_of_birth` | date | yes | Drives computed `age_group` dimension |
| `gender` | text | no | Expanded values via `client_reference_values` |
| `pronouns` | text | no | Free text (not enum) |
| **Regulatory Demographics** | | | |
| `race` | text[] | no | Multi-select, OMB categories (federally mandated) |
| `ethnicity` | text | no | OMB two-question format |
| `primary_language` | text | no | ISO 639 |
| `interpreter_needed` | boolean | no | Default false |
| **Administrative** | | | |
| `case_number` | text | no | Org-specific numbering |
| `admission_date` | date | no | Set by `client.admitted` event |
| `discharge_date` | date | no | Set by `client.discharged` event |
| `status` | text | yes | `registered`/`active`/`inactive`/`discharged`/`archived` |
| `referral_source` | text | no | |
| **Legal/Custody** | | | |
| `legal_status` | jsonb | no | Guardianship, court order, case worker |
| **Medical** | | | |
| `allergies` | text[] | no | |
| `medical_conditions` | text[] | no | ICD-10 codes |
| `blood_type` | text | no | |
| `height_cm` | numeric | no | |
| `weight_kg` | numeric | no | |
| **Insurance** | | | |
| `medicaid_id` | text | no | Primary insurance identifier |
| `ssn_last_four` | text | no | Last 4 only (HIPAA liability) |
| **Education** | | | |
| `education_status` | text | no | enrolled, homeschool, ged, etc. |
| `grade_level` | text | no | |
| `iep_status` | boolean | no | Individualized Education Program |
| **Staff Assignments** | | | |
| `assigned_clinician_id` | uuid | no | FK → users |
| `program_manager_id` | uuid | no | FK → users |
| **Other** | | | |
| `photo_url` | text | no | |
| `notes` | text | no | |
| **Audit** | | | |
| `created_at` | timestamptz | yes | Auto |
| `updated_at` | timestamptz | no | Auto |
| `created_by` | uuid | no | |
| `updated_by` | uuid | no | |

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

## Contact Info (via junction tables, NOT columns)

Not stored on `clients_projection` directly. Linked via junction tables reusing existing projections:

| Junction Table | Links To | Examples |
|---------------|----------|----------|
| `client_contacts` | `contacts_projection` | Emergency contacts, guardians, caseworkers |
| `client_phones` | `phones_projection` | Client/guardian phone numbers |
| `client_addresses` | `addresses_projection` | Placement address, home address |

## App-Owner Reference Values (read-only for tenants)

Stored in `client_reference_values`, managed by migrations/seeds. Tenants can't modify these — they're standardized for cross-org analytics.

| Category | Standard | Count | Examples |
|----------|----------|-------|---------|
| Race | OMB | 7 | American Indian/Alaska Native, Asian, Black/African American, White, ... |
| Ethnicity | OMB | 2 | Hispanic or Latino, Not Hispanic or Latino |
| Language | ISO 639 | 20 | English, Spanish, Mandarin, Vietnamese, ... |
| Gender | A4C | 7 | Male, Female, Non-binary, Transgender Male, Transgender Female, Other, Prefer Not to Say |

---

**The dividing line**: If a field is analytically important across ALL orgs (demographics, regulatory) → core typed column. If it's org-specific or varies by program type → `custom_fields` JSONB with a field definition in the registry.
