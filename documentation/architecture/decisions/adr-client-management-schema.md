---
status: current
last_updated: 2026-03-27
---

<!-- TL;DR-START -->
## TL;DR

**Summary**: ADR for the client management schema — 12 new tables, 84 design decisions, event-sourced CQRS projections for client intake/lifecycle in residential behavioral healthcare. Covers field storage strategy (typed columns + JSONB), configurable field registry, 4NF contact-designation model, discharge decomposition, placement history, and Cube.js analytics dimensions.

**When to read**:
- Before implementing any client management migration
- Before modifying client event handlers or adding new client fields
- When understanding the rationale behind table decomposition and enum choices
- When extending the client schema for new applets (discharge management, billing, assessments)

**Prerequisites**: [event-sourcing-overview](../data/event-sourcing-overview.md), [event-handler-pattern](../../infrastructure/patterns/event-handler-pattern.md), [multi-tenancy-architecture](../data/multi-tenancy-architecture.md)

**Key topics**: `adr`, `client-management`, `schema-design`, `intake-form`, `cqrs`, `event-sourcing`, `configurable-fields`, `contact-designation`, `placement-history`, `discharge`, `analytics-dimensions`

**Estimated read time**: 20 minutes
<!-- TL;DR-END -->

# ADR: Client Management Schema Design

**Date**: 2026-02-12 (initial), refined through 2026-03-27
**Status**: Approved, pending implementation
**Deciders**: Lars (product/architect), Claude (design partner)
**Decision log**: `dev/active/client-management-applet-context.md` (84 numbered decisions)

## Context

### The Problem

A4C providers need client (patient) management for at-risk youth in behavioral health settings. No client schema exists in the v4 baseline — this is greenfield. The schema must support:

- **Multi-org configurable intake forms**: Each provider customizes which fields appear, which are required, and what labels are displayed
- **HIPAA-compliant data handling**: PHI tiered by sensitivity (SSN last-4 vs. name/DOB vs. administrative)
- **CQRS event sourcing**: All mutations through domain events with full audit trail
- **Cross-org analytics**: Cube.js conforming dimensions for demographics, outcomes, and placement types
- **Diverse provider business types**: Residential treatment, group homes, therapeutic foster care, outpatient — not all clients are in residential placement

### Scope

| In Scope | Deferred |
|----------|----------|
| Client intake schema (~50 typed columns + JSONB) | Discharge management applet (reporting flags, compliance actions) |
| Configurable field registry + categories | Behavioral health assessments (longitudinal) |
| 4NF contact-designation model (12 designations) | Consents & authorizations |
| Insurance policies + funding sources | Document management |
| Placement history backend (table + events) | Billing / payment plans |
| Discharge three-field decomposition | Medication cross-reference (existing applet) |
| 10-step intake wizard structure | Placement transition UI (backend only ships now) |
| Client-owned contact tables (phone, email, address) | Guardian person data (contact management applet) |

## Decision: Schema Architecture

The design is organized into 7 architectural themes spanning 84 individual decisions.

### Theme A: Field Storage Strategy

**Core approach**: Universal and regulatory fields as **typed columns** (~50 on `clients_projection`), org-specific fields in **`custom_fields` JSONB** with GIN indexes.

**Why not alternatives?**

| Approach | Rejection Reason |
|----------|-----------------|
| EAV (entity-attribute-value) | Row explosion, no type safety, terrible join performance |
| Per-tenant schemas | Operationally unmanageable at 300+ orgs |
| Wide-table (`custom_text_1`, `custom_int_1`) | Destroys semantic meaning; every layer needs a lookup |

**Supporting tables**:
- **`client_field_definitions_projection`** — Event-sourced field registry (stream type: `client_field_definition`). Stores structural metadata per org: field name, type, validation rules, analytical role, `is_required`, `configurable_label`, `conforming_dimension_mapping`. Drives UI form generation, validation, and Cube.js dynamic schema.
- **`client_field_categories`** — Fixed + org-defined categories (`clinical`, `administrative`, `education`, `insurance`, `legal`). Drives UI section grouping. Not event-sourced (config data).
- **`client_reference_values`** — App-owner value sets: OMB race/ethnicity, ISO 639 languages. Global (no `org_id`). Read-only for tenants.

**Key design rule**: Field keys are always semantic (`placement_type`, never `custom_field_1`). `is_required` is a per-org business rule enforced at the API layer, not a schema constraint — database columns stay nullable.

### Theme B: Table Decomposition

12 new tables, each with a clear rationale:

| Table | Type | Rationale |
|-------|------|-----------|
| `clients_projection` | CQRS projection | Core record — ~50 typed columns + `custom_fields` JSONB. Stream type: `client`. |
| `client_phones` | Sub-entity | Client's own phone numbers (not shared). Standalone table, not junction to `phones_projection`. |
| `client_emails` | Sub-entity | Client's own email addresses. Same rationale as phones. |
| `client_addresses` | Sub-entity | Client's own addresses. Same rationale as phones. |
| `client_insurance_policies_projection` | CQRS sub-entity | Normalized insurance records. Supports primary + secondary + Medicaid + Medicare rows. |
| `client_funding_sources_projection` | CQRS sub-entity | Dynamic external funding sources (state programs, grants). Replaces removed `state` payer type. Includes `custom_fields` JSONB for non-standard fields. |
| `client_placement_history` | CQRS sub-entity | Placement trajectory with date ranges. Enables length-of-stay analytics, step-down tracking, point-in-time incident correlation. Frontend for transitions deferred. |
| `contact_designations_projection` | CQRS projection | Clinical designation per contact per org (e.g., "therapist at Org A"). 12 designations via CHECK constraint. |
| `client_contact_assignments` | CQRS sub-entity | 4NF junction: client + contact + designation. Atomic fact for clinical assignment. |
| `client_field_definitions_projection` | CQRS projection | Per-org field registry. Stream type: `client_field_definition`. |
| `client_field_categories` | Config | Fixed + org-defined field categories for UI grouping. Not event-sourced. |
| `client_reference_values` | Config (global) | App-owner value sets (OMB, ISO 639). No `org_id`. |

**Why client-owned contact tables instead of junctions?** Client phone/email/address data is owned by the client record — it's not a shared reference. Junctions to `phones_projection` would create false sharing semantics and complicate RLS. Client contacts are sub-entities of the `client` stream type with their own events (`client.phone.added/updated/removed`).

**Why a separate placement history table?** A single `placement_arrangement` column on `clients_projection` (Option A) would lose point-in-time data when placement changes. The history table (Option C backend) stores the full trajectory with `start_date`/`end_date` ranges. The denormalized `placement_arrangement` on `clients_projection` provides current-state queries. Intake captures the initial placement; transition UI is deferred.

### Theme C: Event Architecture

**2 stream types**:
- `client` — Lifecycle events (registered, updated, admitted, discharged, etc.) + sub-entity events (phone, email, address, insurance, funding source, placement, contact assignment)
- `client_field_definition` — Field registry events (created, updated, deactivated)

**2 new routers**: `process_client_event()` and `process_client_field_definition_event()`. Added as CASE branches in the existing `process_domain_event_trigger` dispatcher.

**Sub-entity event pattern**: Follows existing convention — `{stream_type}.{sub_entity}.{past_tense_verb}`. Examples:
- `client.phone.added`, `client.phone.updated`, `client.phone.removed`
- `client.insurance_policy.added`, `client.insurance_policy.updated`, `client.insurance_policy.removed`
- `client.placement.changed`, `client.placement.ended`
- `client.contact.assigned`, `client.contact.unassigned`

**Total event types**: 110 (93 existing + 17 new client/field-definition events).

### Theme D: Clinical Contact Model

**4NF decomposition** replaces the original flat `assigned_clinician_id` FK:

```
contacts_projection (people)
    └── contact_designations_projection (designation per contact per org)
            └── client_contact_assignments (client + contact + designation)
```

**12 designations** via CHECK constraint on `contact_designations_projection`:

```
clinician, therapist, psychiatrist, behavioral_analyst, case_worker,
guardian, emergency_contact, program_manager, primary_care_physician,
prescriber, probation_officer, caseworker
```

No org-defined custom designations. Orgs can relabel display names (e.g., "Clinician" → "Primary Counselor") via `configurable_label` in `client_field_definitions_projection`. Canonical keys stay unchanged for cross-org Cube.js analytics via `conforming_dimension_mapping`.

**Search UX**: Client-side Jaro-Winkler fuzzy search (threshold ≥ 0.85) over preloaded org contacts. Chosen over Fuse.js (Bitap algorithm penalizes transpositions too harshly for short names) and server-side `pg_trgm` (unnecessary round trips for 50-500 person pools).

**API pattern**: `api.assign_client_clinician()` wrapper orchestrates `api.create_organization_contact()` + `api.create_contact_designation()` + `api.assign_client_contact()` in a single PostgreSQL transaction. Each inner function is independently callable for future applets.

### Theme E: Discharge Decomposition

A single `discharge_type` enum was replaced by **three orthogonal fields** capturing independent dimensions:

| Field | Values | Count | Mandatory | Reporting Dimension |
|-------|--------|-------|-----------|-------------------|
| `discharge_outcome` | `successful`, `unsuccessful` | 2 | At discharge | Yes — program success rates |
| `discharge_reason` | `graduated_program`, `achieved_treatment_goals`, `awol`, `ama`, `administrative`, `hospitalization_medical`, `insufficient_progress`, `intermediate_secure_care`, `secure_care`, `ten_day_notice`, `court_ordered`, `deceased`, `transfer`, `medical` | 14 | At discharge | Yes |
| `discharge_placement` | `home`, `lower_level_of_care`, `higher_level_of_care`, `secure_care`, `intermediate_secure_care`, `other_program`, `hospitalization`, `incarceration`, `other` | 9 | No (configurable) | Yes |

**Why decompose?** Real-world discharge classifications (e.g., "Successful - Graduated Program / Achieved Treatment Goals - Home") encode three independent dimensions. A single composite enum creates combinatorial explosion. Three fields enable clean Cube.js slicing by outcome × reason × placement independently.

Full 4NF discharge management (reporting flags, compliance actions, notifications, follow-up tasks) is deferred to a future discharge management applet. The three-field decomposition is the foundation.

### Theme F: Legal/Custody/Financial Separation

Three fields that are frequently conflated but represent **orthogonal dimensions**:

| Field | Question | Values |
|-------|----------|--------|
| `legal_custody_status` | Who has legal authority? | `parent_guardian`, `state_child_welfare`, `juvenile_justice`, `guardianship`, `emancipated_minor`, `other` |
| `placement_arrangement` | Where does the client live/receive services? | `residential_treatment`, `therapeutic_foster_care`, `group_home`, `foster_care`, `kinship_placement`, `adoptive_placement`, `independent_living`, `home_based`, `detention`, `secure_residential`, `hospital_inpatient`, `shelter`, `other` |
| `financial_guarantor_type` | Who pays? | `parent_guardian`, `state_agency`, `juvenile_justice`, `self`, `insurance_only`, `tribal_agency`, `va`, `other` |

**Why separate?** A youth can be in `parent_guardian` custody, in `residential_treatment` placement, with `state_agency` as financial guarantor — all three are independent. External LLM-generated lists initially conflated custody with placement; decomposition was validated against SAMHSA and state Medicaid standards.

`placement_arrangement` is backed by `client_placement_history` (Theme B) for trajectory analytics. `legal_custody_status` and `financial_guarantor_type` are intake snapshots on `clients_projection`.

### Theme G: Mandatory Fields & Intake Wizard

**7 mandatory fields at intake**: `first_name`, `last_name`, `date_of_birth`, `gender`, `admission_date`, `allergies`, `medical_conditions`.

**3 additional mandatory at discharge**: `discharge_date`, `discharge_outcome`, `discharge_reason`.

**Everything else**: Optional and/or `configurable_presence` (org admin toggles visibility). ~40 fields are toggleable. Org admin can also set `is_required` for any visible field.

**10-step intake wizard** with progressive disclosure:

| Step | Category |
|------|----------|
| 1 | Demographics & Identity |
| 2 | Contact Information (client-owned) |
| 3 | Guardian/Family Contact (deferred) |
| 4 | Referral & Admission |
| 5 | Admission Details |
| 6 | Insurance & Funding |
| 7 | Clinical Profile |
| 8 | Education |
| 9 | Legal & Compliance |
| 10 | Discharge (populated at discharge, not intake) |

**3 categories deferred as separate applets**: Behavioral Health Assessments, Consents & Authorizations, Documentation & Attachments — all longitudinal/ongoing data with no intake-only fields.

## Enum Reference

Complete inventory of all enum fields. All implemented as text columns with CHECK constraints or frontend-hardcoded dropdowns.

| Field | Values | Count |
|-------|--------|-------|
| `discharge_outcome` | `successful`, `unsuccessful` | 2 |
| `discharge_reason` | `graduated_program`, `achieved_treatment_goals`, `awol`, `ama`, `administrative`, `hospitalization_medical`, `insufficient_progress`, `intermediate_secure_care`, `secure_care`, `ten_day_notice`, `court_ordered`, `deceased`, `transfer`, `medical` | 14 |
| `discharge_placement` | `home`, `lower_level_of_care`, `higher_level_of_care`, `secure_care`, `intermediate_secure_care`, `other_program`, `hospitalization`, `incarceration`, `other` | 9 |
| `placement_arrangement` | `residential_treatment`, `therapeutic_foster_care`, `group_home`, `foster_care`, `kinship_placement`, `adoptive_placement`, `independent_living`, `home_based`, `detention`, `secure_residential`, `hospital_inpatient`, `shelter`, `other` | 13 |
| `legal_custody_status` | `parent_guardian`, `state_child_welfare`, `juvenile_justice`, `guardianship`, `emancipated_minor`, `other` | 6 |
| `financial_guarantor_type` | `parent_guardian`, `state_agency`, `juvenile_justice`, `self`, `insurance_only`, `tribal_agency`, `va`, `other` | 8 |
| `marital_status` | `single`, `married`, `divorced`, `separated`, `widowed`, `domestic_partnership` | 6 |
| `suicide_risk_status` | `low_risk`, `moderate_risk`, `high_risk` | 3 |
| `violence_risk_status` | `low_risk`, `moderate_risk`, `high_risk` | 3 |
| `initial_risk_level` | `Low Risk`, `Moderate Risk`, `High Risk`, `Critical/Imminent Risk` | 4 |
| `referral_source_type` | `self`, `parent_guardian`, `therapist`, `school`, `court`, `hospital`, `agency`, `insurance`, `other` | 9 |
| `admission_type` | `planned`, `emergency`, `transfer`, `readmission` | 4 |
| `gender` | `Male`, `Female` | 2 |
| `education_status` | `enrolled`, `not_enrolled`, `homeschool`, `ged_program`, `ged_completed`, `graduated`, `pre_school`, `suspended`, `expelled`, `vocational` | 10 |
| `citizenship_status` | `U.S. Citizen`, `Lawful Permanent Resident (Green Card Holder)`, `Nonimmigrant Visa Holder (Temporary Status)`, `Refugee or Asylee`, `Other Immigration Status`, `Prefer not to answer` | 6 |
| `policy_type` | `primary`, `secondary`, `medicaid`, `medicare` | 4 |
| `designation` | `clinician`, `therapist`, `psychiatrist`, `behavioral_analyst`, `case_worker`, `guardian`, `emergency_contact`, `program_manager`, `primary_care_physician`, `prescriber`, `probation_officer`, `caseworker` | 12 |
| `data_source` | `manual`, `api`, `import` | 3 |
| `status` | `active`, `inactive` | 2 |
| `discharge_plan_status` | `not_started`, `in_progress`, `complete` | 3 |
| `allergy_type` | `medication`, `food`, `environmental` | 3 |
| `severity` (allergy) | `life_threatening`, `controlled_by_medication` | 2 |
| Phone `type` | `mobile`, `home`, `work`, `other` | 4 |
| Email `type` | `personal`, `school`, `work`, `other` | 4 |
| Address `type` | `home`, `mailing`, `previous`, `other` | 4 |

## Alternatives Considered

### EAV (Entity-Attribute-Value) Model
Store all client fields as rows in an attribute table. **Rejected**: Row explosion (50 fields × N clients = 50N rows), no column-level type safety, terrible join performance for queries that need multiple attributes. Standard criticism applies.

### Per-Tenant Database Schemas
Each organization gets its own PostgreSQL schema with custom table definitions. **Rejected**: Operationally unmanageable at 300+ orgs. Migration deployment becomes O(N) per schema change. RLS-based multi-tenancy with a single shared schema is the established A4C pattern.

### Wide-Table with Opaque Columns
Pre-allocate `custom_text_1` through `custom_text_50`, `custom_int_1` through `custom_int_10`, etc. **Rejected**: Destroys semantic meaning. Every layer (UI, API, analytics) needs a metadata lookup to translate opaque column names. This is the metadata-as-data antipattern.

### Single Composite `discharge_type` Enum
Encode outcome + reason + placement as a single value (e.g., `successful_graduated_home`). **Rejected**: Combinatorial explosion. 2 outcomes × 14 reasons × 9 placements = 252 potential values. Three independent fields give clean analytics slicing.

### Conflated Custody/Placement/Guarantor Field
Single `legal_status` capturing custody, placement, and financial responsibility. **Rejected**: Three orthogonal dimensions. A youth can be in parent custody, residential placement, with state funding. Conflation prevents independent analytical slicing.

### Junction Tables to Shared Contact Projections
Client phones/emails/addresses as junctions to the existing `phones_projection`/`addresses_projection` tables. **Rejected**: Client contact data is owned data, not shared references. Junctions create false sharing semantics, complicate RLS, and prevent sub-entity event patterns.

### Snapshot-Only Placement (Option A)
Capture `placement_arrangement` at intake, never update. **Rejected**: Prevents trajectory analytics (length-of-stay per placement, step-down success rates). History table with date ranges was selected as Option C backend with deferred frontend.

## Consequences

### Positive
- **CQRS compliance**: All 12 tables are event-sourced projections (except 2 config tables). Full audit trail from day one.
- **Configurable per-org**: ~40 fields toggleable, labels customizable, `is_required` per-field — without schema changes per tenant.
- **Analytics-ready**: Conforming dimensions (demographics, risk levels, placement, discharge outcome) enable cross-org Cube.js reporting without value mapping.
- **HIPAA tiered**: PHI-critical (SSN last-4, diagnoses), PHI-standard (name, DOB), and administrative fields have distinct handling tiers.
- **Future-proof decomposition**: Placement history table, discharge three-field split, and 4NF contact model all provide foundations for future applets without schema migrations.

### Negative
- **12 new tables** is significant schema surface area — more to maintain, more RLS policies, more handlers.
- **5 migrations needed** for Phase 2 implementation — substantial review and testing effort.
- **Placement history table** adds complexity for a feature whose frontend is deferred — the table and events ship before the UI that records transitions.
- **84 decisions** accumulated over 7 weeks of design — high context load for new contributors (mitigated by this ADR's thematic grouping).

### Risks Mitigated

| Risk | Mitigation |
|------|-----------|
| Cross-org analytics drift | Conforming dimensions with canonical keys; org relabeling doesn't affect analytical joins |
| HIPAA audit failure | Full event sourcing provides complete audit trail; `created_by`/`updated_by` on all records |
| Schema migration when placement UI ships | History table + events already exist; frontend connects to existing backend |
| Org customization breaking analytics | Typed columns for analytical fields; JSONB for org-specific non-analytical fields |
| Contact model rigidity | 4NF decomposition supports internal + external contacts, per-client designation, clean analytics joins |

## Implementation Plan

Implementation spans 5 migrations (Phase 2) plus handlers, API functions, and frontend (Phases 3-5):

- **Task checklist**: `dev/active/client-management-applet-tasks.md`
- **Schema diagrams**: `dev/active/client-management-applet-schema-diagrams.md`
- **Column inventory**: `dev/active/client-management-applet-column-review.md`
- **UX decisions**: `dev/active/client-management-applet-user-notes.md`

## Related Documents

- [Event Sourcing Overview](../data/event-sourcing-overview.md) — CQRS pattern and domain events
- [Event Handler Pattern](../../infrastructure/patterns/event-handler-pattern.md) — How to add new event types and handlers
- [Multi-Tenancy Architecture](../data/multi-tenancy-architecture.md) — RLS-based org isolation
- [RBAC Architecture](../authorization/rbac-architecture.md) — Permission model (`client.create/update/delete/view`)
- [Event Processing Patterns](../../infrastructure/patterns/event-processing-patterns.md) — Sync handler vs async workflow
- [SQL Idempotency](../../infrastructure/guides/supabase/SQL_IDEMPOTENCY_AUDIT.md) — Migration patterns
- [Handler Reference Files](../../infrastructure/supabase/handlers/README.md) — Handler conventions
- [Event Observability](../../infrastructure/guides/event-observability.md) — Correlation IDs, read-back guards
- [ADR: CQRS Dual-Write Remediation](adr-cqrs-dual-write-remediation.md) — Related CQRS compliance work
- [ADR: Multi-Role Effective Permissions](../authorization/adr-multi-role-effective-permissions.md) — JWT claims used by client RLS
