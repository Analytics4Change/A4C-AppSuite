# Context: Client Intake Form Configuration

## Decision Record

**Date**: 2026-02-06
**Feature**: Client Intake Form — Configurable per-organization intake fields
**Goal**: Build a settings-first approach to client intake, allowing organizations to configure which fields appear on their intake forms before building the form itself.

### Key Decisions

1. **Settings before intake form**: The intake form has per-org configurable fields, so the configuration system must exist before the form can render correctly. Build settings config first.

2. **Sequencing**: Settings configuration (Phase 1) → Schema evolution (Phase 2) → Intake form UI (Phase 3) → Client list enhancements (Phase 4).

3. **Scope TBD**: Three configurability levels under consideration (toggle optional fields / toggle + custom fields / full builder). Must be decided before implementation begins.

4. **CQRS compliance**: All client data access will use `api.` schema RPC functions, following the established pattern. No direct table queries with PostgREST embedding.

5. **Event sourcing**: Client lifecycle events (registered, updated, admitted, discharged) will flow through the existing single-trigger event processing architecture (`process_domain_event_trigger`).

## Source Material

Design notes captured in `~/tmp/A4C_Client_Intake_Form_Design_Notes.md` from February 2026 design discussion.

## Technical Context

### Current State — Database (`clients` table)

**File**: `documentation/infrastructure/reference/database/tables/clients.md`

Current columns:
- `id`, `organization_id`, `first_name`, `last_name`, `date_of_birth`
- `gender` (CHECK: male, female, other, prefer_not_to_say)
- `email`, `phone`, `address` (JSONB), `emergency_contact` (JSONB)
- `allergies` (text[]), `medical_conditions` (text[]), `blood_type`
- `status` (active, inactive, archived), `admission_date`, `discharge_date`
- `notes`, `metadata` (JSONB — extensible), `created_by`, `updated_by`, timestamps

**Critical gaps**:
- RLS enabled but NO POLICIES — all access currently denied
- No FK constraint to organizations_projection
- No CQRS RPCs (no `api.create_client`, `api.list_clients`, etc.)
- No domain events (no event sourcing integration)
- No triggers for updated_at or event emission

### Current State — Frontend (`/clients` route)

**File**: `frontend/src/pages/clients/ClientListPage.tsx`

- Functional page with **mock data** (not connected to Supabase)
- Card-based grid with search/filter
- Shows client name, DOB, active medication count
- Route structure: `/clients` (list), `/clients/:clientId` (detail with tabs)
- Detail tabs: overview, medications, history (coming soon), documents (coming soon)
- Root `/` redirects to `/clients`

### Current State — Frontend (`/settings` route)

**Files**:
- `frontend/src/pages/settings/SettingsPage.tsx` — Hub page with card links
- `frontend/src/pages/settings/OrganizationSettingsPage.tsx` — Org settings container
- `frontend/src/pages/settings/DirectCareSettingsSection.tsx` — Feature flag toggles

The settings infrastructure is mature:
- Permission-gated (`organization.update`)
- Org-type filtered (provider only)
- DirectCareSettings has toggle switches, reason-for-change audit, save/reset
- ViewModel pattern: `DirectCareSettingsViewModel` with observable state, dirty tracking, validation
- Stored in `organizations_projection.direct_care_settings` JSONB column

### Gap Analysis — Current Schema vs Design Notes

| Field from Design Notes | Current Status | Recommendation |
|---|---|---|
| Case # | MISSING | Add as column (`case_number`) |
| Preferred Name | MISSING | Add as column |
| Gender | EXISTS (limited CHECK) | Expand options or make free-text |
| Pronouns | MISSING | Add as column (free text) |
| Race | MISSING | Add as column (text[] for multi-select, OMB categories) |
| Ethnicity | MISSING | Add as column (text, OMB categories) |
| Primary Language | MISSING | Add as column |
| Interpreter Needed | MISSING | Add as column (boolean) |
| Religion | MISSING | Configurable optional field (metadata JSONB) |
| Manager (Program/Case) | MISSING | Add as FK to users |
| Clinical Lead | MISSING | Add as FK to users |
| SSN | MISSING | **Do NOT add** — use Medicaid ID instead |
| Medicaid ID | MISSING | Add as column |
| Legal status / custody type | MISSING | Phase 4 (legal section) |
| Legal guardian | MISSING | Phase 4 (legal section) |
| Caseworker / placing agency | MISSING | Phase 4 (legal section) |
| Allergies | EXISTS (text[]) | Already present |
| Current medications | EXISTS (via medication_history) | Already modeled |
| PCP / prescribing provider | MISSING | Phase 4 (medical section) |
| Diagnoses (ICD-10) | MISSING | Phase 4 (medical section) |
| Height / Weight | MISSING | Phase 4 (medical section) |
| Insurance / payer | MISSING | Phase 4 (billing section) |
| Emergency contacts | EXISTS (single JSONB) | Expand to array for multiple contacts |
| Education status | MISSING | Phase 4 (education section) |
| Referral source | MISSING | Configurable optional field |
| Photo | MISSING | Phase 4 (Supabase Storage) |
| Organization Unit | MISSING | Add as FK to organization_units_projection |

### Race & Ethnicity — OMB Two-Question Format (Federally Mandated)

**Required by**: CMS, SAMHSA, state licensing bodies, Office of Minority Health

1. **Ethnicity** (asked first, single select):
   - Hispanic or Latino
   - Not Hispanic or Latino
   - Prefer not to answer

2. **Race** (asked second, multi-select):
   - American Indian or Alaska Native
   - Asian
   - Black or African American
   - Native Hawaiian or Other Pacific Islander
   - White
   - Other (with free text)
   - Prefer not to answer

### Data Sensitivity Tiers (from Design Notes)

| Tier | Examples | Handling |
|---|---|---|
| PHI-Critical | SSN (if captured), diagnoses, medications, allergies | Field-level encryption, strict audit, minimum necessary |
| PHI-Standard | Name, DOB, race/ethnicity, contacts | Standard HIPAA protections, role-based access |
| Administrative | Case #, admission date, referral source, org unit | Standard access controls |

## Existing Patterns to Reuse

### ViewModel Pattern (DirectCareSettingsViewModel)
**File**: `frontend/src/viewModels/settings/DirectCareSettingsViewModel.ts`
- Observable form state, dirty tracking, validation, save/reset
- Async load/save with error handling
- Auto-reload after save for confirmation
- This is the pattern for the intake form configuration ViewModel

### Settings Hub Card Pattern (SettingsPage)
**File**: `frontend/src/pages/settings/SettingsPage.tsx`
- Glassmorphism card with icon, title, description, chevron
- Permission-gated display
- Keyboard accessible (Enter/Space to navigate)

### JSONB Column for Org Settings
**Pattern**: `organizations_projection.direct_care_settings`
- JSONB column on org table for feature configuration
- API RPCs for get/update with org_id parameter
- Could extend with `intake_form_config` JSONB column, or create separate table

### Form ViewModel Pattern (OrganizationFormViewModel)
**File**: `frontend/src/viewModels/organization/OrganizationFormViewModel.ts`
- Multi-section form state, complex validation
- Draft management with localStorage
- Pattern for the actual intake form (Phase 3)

### Multi-Select UI Pattern (MultiSelectDropdown)
**File**: `frontend/src/components/ui/MultiSelectDropdown.tsx`
- Checkbox-based multi-selection with keyboard navigation
- WCAG 2.1 AA compliant
- Needed for race multi-select field

## Three Configurability Approaches

### Approach A: Toggle Optional Fields (Simplest)
- Predefined set of optional fields with on/off toggles per org
- Configuration stored as JSONB: `{"show_religion": true, "show_ssn_last4": false, ...}`
- Core fields always shown, optional fields toggled
- No dynamic form rendering needed — just conditional `{showField && <Field />}`

### Approach B: Toggle + Custom Fields (Medium)
- Same as A, plus org admins can add custom fields
- Requires: field definition table, dynamic form rendering, JSONB storage for custom field values
- Configuration: `{optional_fields: {...}, custom_fields: [{name, type, required, options}]}`

### Approach C: Full Custom Field Builder (Complex)
- Complete form builder: sections, ordering, conditional logic, validation rules
- Requires: form builder UI, section/field configuration tables, complex rendering engine
- Significant scope — more of a platform feature than a settings section

## Important Constraints

- **HIPAA**: All client data is PHI. Must have proper RLS, audit logging, minimum necessary access
- **SSN**: Design notes strongly recommend NOT capturing full SSN. Use Medicaid ID instead
- **Race/Ethnicity**: Federally mandated — not optional. Must use OMB two-question format
- **Pronouns**: Free text field (not dropdown) — LGBTQ+ youth overrepresented in this population
- **Gender CHECK constraint**: Current constraint is too restrictive (`male, female, other, prefer_not_to_say`). Design notes suggest broader options
- **Event processing**: Must use existing single-trigger architecture. Add `client` stream_type to router, NOT per-event-type triggers

## Reference Materials

- Design notes: `~/tmp/A4C_Client_Intake_Form_Design_Notes.md`
- Clients table docs: `documentation/infrastructure/reference/database/tables/clients.md`
- Event processing architecture: `documentation/infrastructure/guides/supabase/docs/EVENT-DRIVEN-ARCHITECTURE.md`
- OMB race/ethnicity standards: https://www.govinfo.gov/content/pkg/FR-1997-10-30/pdf/97-28653.pdf
- SAMHSA data requirements: https://www.samhsa.gov/
