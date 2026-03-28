---
status: current
last_updated: 2026-03-28
---

<!-- TL;DR-START -->
## TL;DR

**Summary**: Architecture of the client (patient) data model — CQRS projections, org-configurable field registry, contact-designation model, and planned sub-entity tables for the Client Management Applet.

**When to read**:
- Understanding the overall client data architecture
- Planning changes to client-related tables
- Working on client intake, discharge, or field configuration features
- Designing Cube.js dimensions from client data

**Prerequisites**: [Event Sourcing Overview](./event-sourcing-overview.md), [Multi-Tenancy Architecture](./multi-tenancy-architecture.md)

**Key topics**: `client-data-model`, `client`, `field-registry`, `contact-designation`, `intake`, `discharge`, `placement`, `custom-fields`

**Estimated read time**: 10 minutes
<!-- TL;DR-END -->

# Client Data Model Architecture

## Overview

The client data model supports residential behavioral healthcare organizations managing at-risk youth in habilitative care. It must handle org-configurable intake fields while producing conforming dimensional attributes for cross-org Cube.js analytics.

All client data follows the CQRS event-sourcing pattern: API functions emit domain events, event handlers update projection tables, and the frontend queries projections via `api.*` RPC functions.

## Table Relationships

```
organizations_projection
├── clients_projection (1:N — core client records)
│   ├── custom_fields JSONB (org-defined fields)
│   └── user_client_assignments_projection (N:M — staff ↔ client)
├── client_field_definitions_projection (1:N — per-org field config)
│   └── client_field_categories (N:1 — field grouping)
├── contact_designations_projection (N:M — contacts ↔ designations)
│   └── contacts_projection (parent contact records)
├── client_field_definition_templates (global — bootstrap seeds)
└── client_reference_values (global — ISO 639 languages)
```

## Core Tables

### clients_projection

The central client record with ~50 typed columns organized by intake wizard step:

| Section | Step | Key Columns | Notes |
|---------|------|-------------|-------|
| Demographics | 1 | first_name, last_name, date_of_birth, gender, race, ethnicity, primary_language | 7 mandatory at intake |
| Contact Info | 2 | _(sub-entity tables, deferred)_ | Client phones/emails/addresses |
| Guardian | 3 | legal_custody_status, court_ordered_placement, financial_guarantor_type | Separated from placement (Decision 82) |
| Referral | 4 | referral_source_type, referral_organization, referral_date, reason_for_referral | Structured fields (not plain text) |
| Admission | 5 | admission_date, admission_type, level_of_care, placement_arrangement | Placement denormalized from history |
| Insurance | 6 | medicaid_id, medicare_id | Full policy table deferred |
| Clinical Profile | 7 | primary_diagnosis, dsm5_diagnoses, suicide_risk_status, violence_risk_status | Intake snapshot (longitudinal tracking deferred) |
| Medical | 8 | allergies, medical_conditions, immunization_status | JSONB with NKA/NKMC defaults |
| Legal | 9 | legal_custody_status, court_case_number, state_agency, safety_plan_required | 6 boolean + text fields |
| Discharge | 10 | discharge_date, discharge_outcome, discharge_reason, discharge_placement | Three-field decomposition (Decision 78) |
| Education | - | education_status, grade_level, iep_status | 3 fields |

**Stream type**: `client`
**Status lifecycle**: `active` → `inactive` → `discharged`
**Custom fields**: Org-defined via `custom_fields` JSONB with semantic keys

### Field Registry (3 tables)

The field registry enables per-org configuration of which fields appear in intake/discharge forms:

1. **`client_field_definitions_projection`** — Per-org field config (visibility, required, labels). Seeded from templates at bootstrap. Stream type: `client_field_definition`.
2. **`client_field_categories`** — 11 system categories + org-defined custom categories. Matches wizard step ordering. Stream type: `client_field_category`.
3. **`client_field_definition_templates`** — 67 seed templates copied to each new org. 10 locked fields (7 mandatory at intake + 3 mandatory at discharge).

**Configuration UI**: `/settings/client-fields` — tabbed by category, toggle switches for visibility/required.

### Contact Designations

**`contact_designations_projection`** — 4NF model linking contacts to 12 fixed clinical/administrative designations. A contact can hold multiple designations. Orgs cannot add custom designations but can rename display labels via `configurable_label`.

### Reference Data

**`client_reference_values`** — Global lookup table (not org-scoped). Currently seeds 40 ISO 639 languages. Extensible via `category` column.

## Key Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| 57 | Client-owned contact tables (not junctions) | Client phones/emails/addresses are standalone sub-entities, not shared with org contacts |
| 69 | "Required when visible" pattern | Org admin toggles; DB columns stay nullable (required-ness is per-org business rule) |
| 78 | Three-field discharge decomposition | `discharge_outcome` (binary) + `discharge_reason` (14 values) + `discharge_placement` (9 values) |
| 82 | Legal custody separated from placement | Legal authority (who has custody) is orthogonal to physical placement (where they live) |
| 83 | Denormalized placement + history table | `placement_arrangement` on clients_projection + `client_placement_history` for trajectory |
| 87 | Event-sourced categories | Categories are first-class entities with stream_type, not static reference data |
| 89 | Relaxed read RLS | No permission check on field definition SELECT — all org members need field visibility info |

## Deferred Tables (Client Intake Project)

These tables are designed but not yet created:

| Table | Purpose |
|-------|---------|
| `client_phones` | Client-owned phone numbers (sub-entity, not junction) |
| `client_emails` | Client-owned email addresses |
| `client_addresses` | Client-owned physical addresses |
| `client_insurance_policies_projection` | Insurance policies (primary, secondary, Medicaid) |
| `client_funding_sources_projection` | External funding sources |
| `client_placement_history` | Placement trajectory with date ranges (Decision 83) |
| `client_contact_assignments` | Which designated contacts serve which clients |

## Analytics Integration (Phase 4)

Client data feeds Cube.js via conforming dimensions:

- **Always dimensions**: `gender`, `race`, `ethnicity`, `admission_date`, `discharge_outcome`, `discharge_reason`, `discharge_placement`, `placement_arrangement`, `initial_risk_level`
- **Org-promoted dimensions**: Any field with `is_dimension = true` in field definitions
- **Computed dimensions**: `age_group` (from DOB), `length_of_stay` (admission to discharge), `admission_cohort` (quarterly)
- **Custom field dimensions**: Org-defined fields promoted via field registry

The `conforming_dimension_mapping` column ensures cross-org analytics remain consistent even when orgs rename field labels.

## Related Documentation

- [Event Sourcing Overview](./event-sourcing-overview.md) — CQRS pattern and domain events
- [Multi-Tenancy Architecture](./multi-tenancy-architecture.md) — Org isolation with RLS
- [Event Handler Pattern](../../infrastructure/patterns/event-handler-pattern.md) — Handler implementation guide

### Table Reference

- [clients_projection](../../infrastructure/reference/database/tables/clients_projection.md)
- [client_field_definitions_projection](../../infrastructure/reference/database/tables/client_field_definitions_projection.md)
- [client_field_categories](../../infrastructure/reference/database/tables/client_field_categories.md)
- [client_field_definition_templates](../../infrastructure/reference/database/tables/client_field_definition_templates.md)
- [client_reference_values](../../infrastructure/reference/database/tables/client_reference_values.md)
- [contact_designations_projection](../../infrastructure/reference/database/tables/contact_designations_projection.md)
- [user_client_assignments_projection](../../infrastructure/reference/database/tables/user_client_assignments_projection.md)
