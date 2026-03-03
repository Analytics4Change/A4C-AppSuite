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
**Mandatory**: No (optional)
**Dropdown**: Org-configurable options stored in `client_field_definitions_projection`
- Org admin can add as many pronoun options as they wish (row-by-row addition)
- UI always appends "Other → free text" as the last option (hardcoded in frontend, not in config)
- DB column: plain `text` on `clients_projection.pronouns`
**Not a reporting dimension** — no `client_reference_values` entries

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
**Mandatory**: Yes (NOT NULL at registration)
**Single-select dropdown**: Org-configurable options
- Master list of 20 languages (ISO 639 subset) stored in `client_reference_values` (category: `language`)
- Org admin selects from master list to build their dropdown (stored in `client_field_definitions_projection`)
- **No free-text entry** — must pick from master list
- Defaults for new orgs: English and Spanish pre-selected
- Org admin can unselect defaults and/or add different languages from master list

Master list:
```
Arabic, Bengali, Cantonese, English, French, German, Hindi, Japanese,
Karen, Lahnda, Mandarin, Marathi, Portuguese, Russian, Spanish, Swahili,
Tagalog, Tamil, Turkish, Urdu, Vietnamese
```

### Interpreter Needed
**Label**: Non-configurable
**Mandatory**: Yes (NOT NULL at registration)
**Type**: Boolean

### Internal Case Number
**Label**: Configurable (via `client_field_definitions_projection`)
**Mandatory**: Yes (NOT NULL, auto-populated from client UUID at registration)
**Type**: Text — separate column, NOT a computed column
- At registration, API function copies `id::text` into `internal_case_number`
- Can theoretically be changed later if org wants own numbering scheme
**Not a reporting dimension**

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
- Each item: `name` (free text) + `severity` (enum: `life_threatening` | `controlled_by_medication`)
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

Only one field has a configurable display label:

| DB Column | Default Label | Notes |
|-----------|--------------|-------|
| `internal_case_number` | Internal Case Number | Tenant-facing unique identifier; auto-populated from UUID |

**Dropped**: `external_case_number_1/2/3` — removed entirely from schema.

**All other fields** discussed in this session have **non-configurable labels**.

There will be no `court_case_number` core field.

## Discharge Events

- `client.discharged` — provider-specified `discharge_date` in event payload, system timestamp in `created_at`
- `client.reverse_discharge` — undoes an accidental or unintended discharge (restores previous state)
- `client.readmitted` — re-admits a previously discharged client (new service engagement, distinct from reverse_discharge)

## Dropped Fields (decided 2026-03-02)

| Field | Reason |
|-------|--------|
| `external_case_number_1/2/3` | Not needed |
| `legal_status` | Dropped |
| `blood_type` | Not standard for residential behavioral health EHRs |
| `height_cm` / `weight_kg` | Vitals, not intake fields; belong to future vitals applet |
| `ssn_last_four` | Not required by EHR/EMR, creates HIPAA breach liability |
| `program_manager_id` | Dropped |

## Fields Not Yet Discussed (as of 2026-03-02)

- `assigned_clinician_id`
- `photo_url`
- `notes`
- `middle_name`
- `preferred_name`
- `custom_fields` (JSONB)
- Audit fields (`created_at`, `updated_at`, `created_by`, `updated_by`)

## `client_reference_values` Table

Significantly reduced scope from original plan. Only one category remains:

| Category | Standard | Count | Purpose |
|----------|----------|-------|---------|
| Language | ISO 639 | 20 | Master list for org admin to select from |

Gender, race, ethnicity — all hardcoded in frontend, no reference table entries.
