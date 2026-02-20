# Implementation Plan: Client Intake Form Configuration

## Executive Summary

Build a configurable client intake form system for A4C-AppSuite's ~300 behavioral healthcare organizations. The intake form needs **core universal fields** (name, DOB, admission date) plus **organization-configurable extensions** (state-mandated fields, org-specific fields). This requires building the settings configuration system first, then evolving the database schema, then building the intake form UI.

The current `clients` table exists with basic fields but is missing most fields from the design notes (case #, pronouns, race/ethnicity, legal/custody, medical details, insurance, etc.). The current `/clients` route is functional with mock data. The `/settings` route already has org-level settings infrastructure (DirectCareSettings pattern) that can be extended.

## Open Scope Questions (Must Resolve Before Implementation)

### Q1: Configurability Level
What level of field configurability is needed?

| Option | Description | Complexity |
|--------|-------------|------------|
| **A: Toggle optional fields** | Core fields always shown. Org admins toggle predefined optional fields on/off (e.g., SSN last 4, religion, photo). No custom fields. | Low |
| **B: Toggle + custom fields** | Same as A, plus org admins can define custom fields (name, type, options). Requires dynamic form rendering. | Medium |
| **C: Full custom field builder** | Complete form builder with sections, field ordering, conditional logic, validation rules. | High |

**Recommendation**: Start with Option A. It covers most needs, is simpler to build, and the `metadata` JSONB column on `clients` already supports future custom field data storage.

### Q2: Navigation Placement
Where should intake form configuration live?

| Option | Description |
|--------|-------------|
| **A: Under /settings/organization** | Add section alongside existing DirectCareSettings. Keeps settings consolidated. |
| **B: New /settings/intake-form sub-route** | Dedicated page linked from settings hub. Better for complex configuration. |

**Recommendation**: Option B if scope is B or C. Option A if scope is A.

### Q3: Schema Evolution Strategy
How do we handle the gap between current `clients` table and design notes fields?

| Option | Description |
|--------|-------------|
| **Add columns to clients table** | Add missing core fields (case_number, preferred_name, pronouns, race, ethnicity, etc.) as real columns |
| **Use metadata JSONB for everything new** | Keep current columns, store all new fields in `metadata` JSONB |
| **Hybrid** | Add universally-required fields as columns, use `metadata` for optional/configurable fields |

**Recommendation**: Hybrid. Core fields (case #, gender identity, pronouns, race, ethnicity, primary language) become columns. Org-configurable fields use `metadata` JSONB keyed by a configuration schema.

## Phase 1: Intake Form Configuration (Settings UI)

### 1.1 Database — Configuration Table
- Create `intake_form_configurations` table (or add JSONB column to `organizations_projection`)
- Store per-org configuration: which optional fields are enabled, display order, section grouping
- Create `api.` schema RPCs for CRUD operations
- RLS policies for org isolation

### 1.2 Frontend — Settings Section
- Add "Client Intake Configuration" card to SettingsPage hub
- Create configuration page/section (mirrors DirectCareSettings pattern)
- ViewModel for intake form config (mirrors DirectCareSettingsViewModel)
- Service layer for config CRUD

## Phase 2: Schema Evolution (Database)

### 2.1 Clients Table Migration
- Add missing core columns (case_number, preferred_name, pronouns, race, ethnicity, primary_language, interpreter_needed, religion, etc.)
- Update CHECK constraints (race/ethnicity use OMB categories)
- Add CQRS RPCs for client CRUD (`api.create_client`, `api.update_client`, `api.list_clients`, etc.)
- Implement RLS policies (critical gap — currently DENY ALL)
- Add FK constraint to organizations_projection

### 2.2 Event Sourcing Integration
- Define domain events (client.registered, client.updated, client.admitted, client.discharged)
- Add AsyncAPI contract entries
- Create event handlers in process_domain_event router
- Update clients table via event handlers (projection pattern)

## Phase 3: Client Intake Form UI

### 3.1 Intake Form Components
- Multi-section form (mirrors OrganizationFormViewModel pattern)
- Dynamic rendering based on org's intake form configuration
- OMB two-question race/ethnicity component (ethnicity single-select, race multi-select)
- Free-text pronouns field
- Data sensitivity tier indicators

### 3.2 Client List Enhancements
- Replace mock data with real Supabase queries via RPCs
- Display configurable columns based on org's intake config
- Search/filter enhancements

## Phase 4: Advanced Features (Future)

- Custom field definitions (if scope B/C chosen)
- Legal/custody section
- Medical section (allergies, medications, diagnoses, PCP)
- Insurance/billing section
- Emergency contacts (multiple)
- Education status
- Photo upload

## Dependencies and Prerequisites

| Prerequisite | Status | Blocker For |
|---|---|---|
| RLS policies on clients table | NOT IMPLEMENTED | Phase 2+ (production use) |
| CQRS RPCs for clients | NOT IMPLEMENTED | Phase 2+ (frontend queries) |
| Domain events for clients | NOT IMPLEMENTED | Phase 2+ (event sourcing) |
| DirectCareSettings pattern | COMPLETE | Phase 1 (pattern to follow) |
| Settings hub page | COMPLETE | Phase 1 (add new card) |

## Risk Mitigation

- **HIPAA compliance**: SSN should NOT be stored (use Medicaid ID). Race/ethnicity data is federally mandated but requires proper access controls.
- **RLS gap**: The clients table has RLS enabled but no policies — this means ALL access is currently denied. Must be resolved before any real client data flows through.
- **Scope creep**: The design notes cover extensive fields. Start with core demographics + configurable toggles, not everything at once.

## Next Steps After Scope Decision

1. Resolve Q1 (configurability level) — drives complexity of Phase 1
2. Resolve Q2 (navigation placement) — drives UI architecture
3. Resolve Q3 (schema strategy) — drives Phase 2 migration design
4. Begin Phase 1 implementation
