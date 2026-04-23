---
status: current
last_updated: 2026-04-23
---

<!-- TL;DR-START -->
## TL;DR

**Summary**: CQRS projection for client (patient) records in residential behavioral healthcare — ~49 typed columns covering demographics, referral, admission, clinical profile, medical, legal, discharge, education, and org-defined custom fields (JSONB).

**When to read**:
- Building client intake or discharge forms
- Understanding the client data model and column semantics
- Querying clients by organization, status, demographics, or custom fields
- Implementing client CRUD operations via API RPCs

**Prerequisites**: [organizations_projection](./organizations_projection.md), [organization_units_projection](./organization_units_projection.md), [client_field_definitions_projection](./client_field_definitions_projection.md)

**Key topics**: `client`, `patient`, `intake`, `discharge`, `demographics`, `cqrs-projection`, `custom-fields`, `placement`

**Estimated read time**: 12 minutes
<!-- TL;DR-END -->

# clients_projection

## Overview

CQRS projection table that stores the core client (patient) record for residential behavioral healthcare. Each row represents a youth placed in habilitative care within an organization. The source of truth is `client.*` events in the `domain_events` table, processed by the `process_client_event()` router (not yet implemented — table created ahead of event infrastructure in the Client Intake project).

Key characteristics:
- **~49 typed columns**: Demographics, referral, admission, clinical profile, medical, legal, discharge, education
- **Custom fields**: Org-defined fields stored in `custom_fields` JSONB, controlled by `client_field_definitions_projection`
- **Three-status lifecycle**: `active` (enrolled) → `inactive` (paused) → `discharged` (completed care)
- **Three-field discharge**: `discharge_outcome` (binary), `discharge_reason` (14 values), `discharge_placement` (9 values) per Decision 78
- **Org-configurable visibility**: Field presence/required flags managed per-org via the field definition registry
- **Mandatory at intake**: `first_name`, `last_name`, `date_of_birth`, `gender`, `admission_date`, `allergies` (NKA default), `medical_conditions` (NKMC default)
- **Mandatory at discharge**: `discharge_date`, `discharge_outcome`, `discharge_reason`

## Table Schema

| Column | Type | Nullable | Default | Description |
|--------|------|----------|---------|-------------|
| id | uuid | NO | gen_random_uuid() | Primary key |
| organization_id | uuid | NO | - | FK to organizations_projection |
| organization_unit_id | uuid | YES | - | FK to organization_units_projection (denormalized from the current `client_placement_history_projection` row; mutable ONLY via `client.placement.changed` events, never via info updates — see [ADR: Client OU Placement](../../../../architecture/decisions/adr-client-ou-placement.md)) |
| status | text | NO | 'active' | Lifecycle: `active`, `inactive`, `discharged` |
| data_source | text | NO | 'manual' | How created: `manual`, `api`, `import` |
| first_name | text | NO | - | Legal first name |
| last_name | text | NO | - | Legal last name |
| middle_name | text | YES | - | Legal middle name |
| preferred_name | text | YES | - | Preferred/chosen name |
| date_of_birth | date | NO | - | Date of birth |
| gender | text | NO | - | Gender assigned at birth |
| gender_identity | text | YES | - | Self-reported gender identity |
| pronouns | text | YES | - | Free text pronouns |
| race | text[] | YES | - | OMB multi-select race categories |
| ethnicity | text | YES | - | OMB single-select: Hispanic/Not Hispanic |
| primary_language | text | YES | - | ISO 639 code (see client_reference_values) |
| secondary_language | text | YES | - | ISO 639 code |
| interpreter_needed | boolean | YES | - | Interpreter services required |
| marital_status | text | YES | - | 6 values: single, married, divorced, separated, widowed, domestic_partnership |
| citizenship_status | text | YES | - | Hardcoded dropdown |
| photo_url | text | YES | - | Client photo URL |
| mrn | text | YES | - | Medical record number (org-assigned) |
| external_id | text | YES | - | External system identifier (for imports) |
| drivers_license | text | YES | - | Driver's license number |
| referral_source_type | text | YES | - | Referral source enum |
| referral_organization | text | YES | - | Referring organization name |
| referral_date | date | YES | - | Date of referral |
| reason_for_referral | text | YES | - | Free text reason |
| admission_date | date | NO | - | Date admitted to program |
| admission_type | text | YES | - | Admission type enum |
| level_of_care | text | YES | - | Current level of care |
| expected_length_of_stay | integer | YES | - | Expected days in program |
| initial_risk_level | text | YES | - | 4 values: low, moderate, high, critical |
| placement_arrangement | text | YES | - | Current placement (13 SAMHSA/Medicaid values, Decision 83) |
| medicaid_id | text | YES | - | Medicaid identifier |
| medicare_id | text | YES | - | Medicare identifier |
| primary_diagnosis | jsonb | YES | - | ICD-10: `{code, description}` |
| secondary_diagnoses | jsonb | YES | - | ICD-10 array: `[{code, description}]` |
| dsm5_diagnoses | jsonb | YES | - | DSM-5 array: `[{code, description}]` |
| presenting_problem | text | YES | - | Free text presenting problem |
| suicide_risk_status | text | YES | - | 3 values: low_risk, moderate_risk, high_risk |
| violence_risk_status | text | YES | - | 3 values: low_risk, moderate_risk, high_risk |
| trauma_history_indicator | boolean | YES | - | Trauma history present |
| substance_use_history | text | YES | - | Free text substance use history |
| developmental_history | text | YES | - | Free text developmental history |
| previous_treatment_history | text | YES | - | Free text prior treatment |
| allergies | jsonb | NO | `{"nka": true, "items": []}` | NKA = No Known Allergies |
| medical_conditions | jsonb | NO | `{"nkmc": true, "items": []}` | NKMC = No Known Medical Conditions |
| immunization_status | text | YES | - | Immunization status |
| dietary_restrictions | text | YES | - | Free text dietary needs |
| special_medical_needs | text | YES | - | Free text special medical needs |
| legal_custody_status | text | YES | - | 6 values (Decision 82): parent_guardian, state_child_welfare, juvenile_justice, guardianship, emancipated_minor, other |
| court_ordered_placement | boolean | YES | - | Whether placement is court-ordered |
| financial_guarantor_type | text | YES | - | 8 values (Decision 84): parent_guardian, state_agency, juvenile_justice, self, insurance_only, tribal_agency, va, other |
| court_case_number | text | YES | - | Court case identifier |
| state_agency | text | YES | - | State agency name (configurable label) |
| legal_status | text | YES | - | Legal status enum |
| mandated_reporting_status | boolean | YES | - | Subject to mandated reporting |
| protective_services_involvement | boolean | YES | - | CPS/protective services involved |
| safety_plan_required | boolean | YES | - | Safety plan in place |
| discharge_date | date | YES | - | Date discharged from program |
| discharge_outcome | text | YES | - | Decision 78: `successful` or `unsuccessful` |
| discharge_reason | text | YES | - | Decision 78: 14-value enum (see Column Details) |
| discharge_diagnosis | jsonb | YES | - | ICD-10 at discharge: `{code, description}` |
| discharge_placement | text | YES | - | Decision 78: 9-value enum (see Column Details) |
| education_status | text | YES | - | Education enrollment status |
| grade_level | text | YES | - | Current grade level |
| iep_status | boolean | YES | - | Individualized Education Program active |
| custom_fields | jsonb | NO | `{}` | Org-defined fields (semantic keys, GIN-indexed) |
| created_at | timestamptz | NO | now() | Record creation timestamp |
| updated_at | timestamptz | NO | now() | Record update timestamp |
| created_by | uuid | NO | - | FK to users — who created this record |
| updated_by | uuid | NO | - | FK to users — who last updated |
| last_event_id | uuid | YES | - | Last domain event that modified this row |

### Column Details

#### allergies (JSONB)
```json
{
  "nka": true,
  "items": [
    { "name": "Penicillin", "allergy_type": "medication", "severity": "severe" },
    { "name": "Peanuts", "allergy_type": "food", "severity": "moderate" }
  ]
}
```
- `nka`: No Known Allergies flag (true when items is empty)
- `allergy_type`: `medication`, `food`, or `environmental` (Decision 68)
- Default `{"nka": true, "items": []}` — every client has an allergy record

#### medical_conditions (JSONB)
```json
{
  "nkmc": true,
  "items": [
    { "code": "J45", "description": "Asthma", "is_chronic": true }
  ]
}
```
- `nkmc`: No Known Medical Conditions flag
- `is_chronic`: Chronic illness indicator

#### discharge_reason (14 values)
`graduated_program`, `achieved_treatment_goals`, `awol`, `ama`, `administrative`, `hospitalization_medical`, `insufficient_progress`, `intermediate_secure_care`, `secure_care`, `ten_day_notice`, `court_ordered`, `deceased`, `transfer`, `medical`

#### discharge_placement (9 values)
`home`, `lower_level_of_care`, `higher_level_of_care`, `secure_care`, `intermediate_secure_care`, `other_program`, `hospitalization`, `incarceration`, `other`

#### custom_fields (JSONB)
Org-defined fields with semantic keys (never positional like `custom_field_1`). Structure and metadata controlled by `client_field_definitions_projection`. GIN-indexed for containment queries.

## Constraints

| Constraint | Type | Definition |
|-----------|------|------------|
| `clients_projection_pkey` | PRIMARY KEY | `(id)` |
| `clients_projection_status_check` | CHECK | `status IN ('active', 'inactive', 'discharged')` |
| `clients_projection_data_source_check` | CHECK | `data_source IN ('manual', 'api', 'import')` |
| `clients_projection_organization_id_fkey` | FOREIGN KEY | `organization_id -> organizations_projection(id)` |
| `clients_projection_organization_unit_id_fkey` | FOREIGN KEY | `organization_unit_id -> organization_units_projection(id)` |
| `clients_projection_created_by_fkey` | FOREIGN KEY | `created_by -> users(id)` |
| `clients_projection_updated_by_fkey` | FOREIGN KEY | `updated_by -> users(id)` |

## Indexes

| Index | Definition |
|-------|-----------|
| `clients_projection_pkey` | `UNIQUE (id)` |
| `idx_clients_projection_org` | `(organization_id)` |
| `idx_clients_projection_org_status` | `(organization_id, status)` |
| `idx_clients_projection_name` | `(organization_id, last_name, first_name)` |
| `idx_clients_projection_dob` | `(organization_id, date_of_birth)` |
| `idx_clients_projection_org_unit` | `(organization_unit_id) WHERE organization_unit_id IS NOT NULL` |
| `idx_clients_projection_custom_fields` | `GIN (custom_fields)` |
| `idx_clients_projection_mrn` | `(organization_id, mrn) WHERE mrn IS NOT NULL` |
| `idx_clients_projection_external_id` | `(organization_id, external_id) WHERE external_id IS NOT NULL` |
| `idx_clients_projection_admission_date` | `(organization_id, admission_date)` |

## RLS Policies

| Policy | Command | Condition |
|--------|---------|-----------|
| `clients_projection_select` | SELECT | `organization_id = get_current_org_id()` |
| `clients_projection_platform_admin` | ALL | `has_platform_privilege()` |

No INSERT/UPDATE/DELETE policies for `authenticated` — this is a CQRS projection. Writes come from event handlers running as `service_role` (bypasses RLS). Permission checks at API function layer.

## Domain Events

> **Note**: Event infrastructure not yet implemented. These are the planned events for the Client Intake project.

- `client.registered` — Client record created (stream_type: `client`)
- `client.information_updated` — Client details modified
- `client.admitted` — Client admitted to program
- `client.discharged` — Client discharged
- `client.custom_fields_updated` — Org-defined custom fields changed

## API RPCs

> **Note**: Client API functions will be created in the Client Intake project. The table exists ahead of the event infrastructure.

## Migration History

| Date | Migration | Changes |
|------|-----------|---------|
| 2026-03-27 | `20260327205738_clients_projection.sql` | Initial creation: 53 typed columns, 9 indexes, RLS, FK from `user_client_assignments_projection` |

## See Also

- [client_field_definitions_projection](./client_field_definitions_projection.md) — Per-org field visibility/required configuration
- [client_field_categories](./client_field_categories.md) — Field grouping categories
- [client_reference_values](./client_reference_values.md) — ISO 639 language codes and other reference data
- [contact_designations_projection](./contact_designations_projection.md) — Clinical/administrative contact designations
- [user_client_assignments_projection](./user_client_assignments_projection.md) — Staff-to-client assignments (FK to this table)
- [organizations_projection](./organizations_projection.md) — Parent organization
- [organization_units_projection](./organization_units_projection.md) — Optional OU scope

## Related Documentation

- [Client Data Model](../../../../documentation/architecture/data/client-data-model.md) — Architecture overview
- [Event Handler Pattern](../../../patterns/event-handler-pattern.md) — Event processing architecture
- [Event Sourcing Overview](../../../../documentation/architecture/data/event-sourcing-overview.md) — CQRS pattern
