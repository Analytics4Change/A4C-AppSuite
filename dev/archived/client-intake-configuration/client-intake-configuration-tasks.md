# Tasks: Client Intake Form Configuration

## Prerequisites: Resolve Scope Questions ⏸️ PENDING

- [ ] Decide configurability level (Option A: toggle optional / B: toggle + custom / C: full builder)
- [ ] Decide navigation placement (under /settings/organization or new /settings/intake-form sub-route)
- [ ] Decide schema evolution strategy (add columns / metadata JSONB / hybrid)

## Phase 1: Intake Form Configuration (Settings) ⏸️ PENDING

### 1.1 Database
- [ ] Design intake form configuration storage (JSONB on org table or separate table)
- [ ] Create migration for configuration schema
- [ ] Create `api.get_intake_form_config(p_org_id)` RPC
- [ ] Create `api.update_intake_form_config(p_org_id, p_config)` RPC
- [ ] Add RLS policies for configuration access

### 1.2 Frontend Service Layer
- [ ] Define `IntakeFormConfig` TypeScript interface
- [ ] Create `IIntakeFormConfigService` interface
- [ ] Implement `SupabaseIntakeFormConfigService`
- [ ] Implement `MockIntakeFormConfigService`

### 1.3 Frontend ViewModel
- [ ] Create `IntakeFormConfigViewModel` (mirror DirectCareSettingsViewModel)
- [ ] Observable config state, dirty tracking, validation
- [ ] Save/reset with reason-for-change audit

### 1.4 Frontend UI
- [ ] Add "Client Intake Configuration" card to SettingsPage hub
- [ ] Create IntakeFormConfigSection component (or dedicated page)
- [ ] Core fields display (read-only, always enabled)
- [ ] Optional field toggles
- [ ] Save/reset with reason input
- [ ] Permission gate on `organization.update`

## Phase 2: Schema Evolution ⏸️ PENDING

### 2.1 Clients Table Migration
- [ ] Add missing core columns (case_number, preferred_name, pronouns, race, ethnicity, primary_language, interpreter_needed, medicaid_id, organization_unit_id, assigned_manager_id, assigned_clinician_id)
- [ ] Update gender CHECK constraint (or remove for free-text)
- [ ] Add ethnicity CHECK constraint (OMB values + prefer_not_to_say)
- [ ] Add FK to organizations_projection
- [ ] Add FK to organization_units_projection
- [ ] Add FK to users for manager and clinician assignments

### 2.2 RLS Policies
- [ ] Implement SELECT policy (org isolation + super_admin bypass)
- [ ] Implement INSERT policy (permission-based)
- [ ] Implement UPDATE policy (permission-based)
- [ ] Implement DELETE policy (permission-based, prefer archive)

### 2.3 CQRS RPCs
- [ ] Create `api.create_client()` RPC
- [ ] Create `api.update_client()` RPC
- [ ] Create `api.list_clients()` RPC (with search, filter, pagination)
- [ ] Create `api.get_client_by_id()` RPC
- [ ] Create `api.archive_client()` RPC

### 2.4 Event Sourcing
- [ ] Define client domain events (registered, updated, admitted, discharged, archived)
- [ ] Add AsyncAPI contract entries for clinical domain
- [ ] Add `client` stream_type to event router (process_domain_event)
- [ ] Create event handler functions
- [ ] Update clients projection from events

## Phase 3: Client Intake Form UI ⏸️ PENDING

### 3.1 Form Components
- [ ] Create ClientIntakeFormViewModel (multi-section, mirrors OrganizationFormViewModel)
- [ ] Create intake form page/dialog
- [ ] Demographics section (name, DOB, gender, pronouns)
- [ ] Race/ethnicity section (OMB two-question format)
- [ ] Contact section (phone, email, address, emergency contacts)
- [ ] Administrative section (case #, admission date, org unit, referral source)
- [ ] Staff assignment section (manager, clinical lead)
- [ ] Conditional rendering based on org's intake form configuration
- [ ] Validation (required fields, format checks)

### 3.2 Client List Enhancements
- [ ] Replace mock data with Supabase RPC queries
- [ ] Update ClientListPage to show configurable columns
- [ ] Update search/filter for new fields
- [ ] Update ClientDetailLayout for richer data display

## Phase 4: Advanced Features (Future) ⏸️ PENDING

- [ ] Legal/custody section (legal status, guardian, caseworker, jurisdiction)
- [ ] Medical section (PCP, diagnoses/ICD-10, height/weight, crisis plan)
- [ ] Insurance/billing section (carrier, plan, member ID, Medicaid ID display)
- [ ] Education section (school, grade, IEP/504 status)
- [ ] Multiple emergency contacts (expand from single JSONB to array)
- [ ] Photo upload (Supabase Storage integration)
- [ ] Custom field definitions (if scope B/C chosen)

## Success Validation Checkpoints

### After Phase 1
- [ ] Org admin can view intake form configuration in settings
- [ ] Org admin can toggle optional fields on/off
- [ ] Configuration persists across sessions
- [ ] Audit trail captured (reason for change)
- [ ] Mock mode works without Supabase

### After Phase 2
- [ ] Clients table has expanded schema
- [ ] RLS policies enforce org isolation
- [ ] CQRS RPCs return correct data
- [ ] Domain events emitted on client lifecycle changes
- [ ] Event handlers update projection correctly

### After Phase 3
- [ ] Intake form renders based on org configuration
- [ ] Race/ethnicity uses OMB two-question format
- [ ] All form fields properly validated
- [ ] WCAG 2.1 AA compliant (keyboard nav, ARIA, focus management)
- [ ] Client list shows real data from Supabase

## Current Status

**Phase**: Prerequisites (scope questions)
**Status**: ⏸️ PENDING — awaiting scope decisions
**Last Updated**: 2026-02-06
**Next Step**: Resolve the three scope questions (configurability level, navigation, schema strategy), then begin Phase 1
