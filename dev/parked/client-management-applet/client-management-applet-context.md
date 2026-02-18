# Context: Client Management Applet

## Decision Record

**Date**: 2026-02-12
**Feature**: Client Management Applet
**Goal**: Design and build the foundational schema, event architecture, and API layer for client (patient) management in residential behavioral healthcare for at-risk youth.

### Key Decisions

1. **Field storage strategy**: Universal fields as typed columns + org-configurable fields in `custom_fields JSONB`. Avoids per-tenant star schemas and hacky static-to-dynamic field mapping. JSONB with GIN indexes provides queryability without EAV row explosion.

2. **Field registry design**: `client_field_definitions_projection` table (event-sourced, stream_type: `client_field_definition`) stores structural metadata (field name, type, validation, analytical role) per org. This drives: UI form generation, validation, and Cube.js dynamic schema generation. Field keys are always semantic (`placement_type`, never `custom_field_1`).

3. **Value set ownership model**: Three categories identified:
   - **App-owner-defined**: Race (OMB), ethnicity (OMB), language (ISO 639), gender, ICD-10 diagnoses, state/county (FIPS). Inherently conforming across orgs. No mapping needed.
   - **Tenant-defined**: Org units, staff assignments, case numbering. Only meaningful within single org analytics. No cross-org mapping needed.
   - **Narrow middle ground**: Placement type/care level — could use optional `conforming_dimension_value_mappings` table, but push toward app-owner-defined standard value sets to minimize this.

4. **Conforming dimensions for Cube.js**: Core typed columns (age_group computed from DOB, gender, race, ethnicity, language) are the primary conforming dimensions. These feed the `PatientDimension` cube that links fact tables (medication adherence, behavioral incidents). Org-specific JSONB fields are dimensions within that org's analytics only.

5. **CQRS compliance — `clients_projection` as full CQRS projection** (decided 2026-02-12): Stream type is `client` (NOT `clinical` as originally discussed). Table is `clients_projection`. No legacy `clients` table exists in v4 baseline — this is greenfield. API functions emit domain events, event handlers update projection. No direct table writes from frontend.

6. **Race/ethnicity capture**: Federally mandated by CMS, SAMHSA, and state licensing. OMB two-question format: ethnicity first (Hispanic/Latino or not), then race as multi-select. Required for health disparity analysis — a core analytical use case.

7. **Pronouns**: Free text field, not enum. LGBTQ+ youth overrepresented in residential care (30%+ of foster care population). Clinical relevance and state regulatory requirements (CA, NY, IL).

8. **SSN handling**: Capture last 4 digits only (or skip entirely). Use Medicaid ID as primary insurance identifier. Full SSN creates liability under HIPAA breach notification.

9. **Junction tables for contact/phone/address** (decided 2026-02-12): Reuse existing `contacts_projection`, `phones_projection`, `addresses_projection` via junction tables (`client_contacts`, `client_phones`, `client_addresses`). Same pattern as organizations. Junction events auto-routed by `process_domain_event()` via `LIKE '%.linked' OR LIKE '%.unlinked'` suffix check — no dispatcher CASE change needed.

10. **Value set reference table** (decided 2026-02-12): Single `client_reference_values` table with `category` column (race, ethnicity, language, gender). App-owner-managed via migrations/seeds. Read-only for tenants. Seeded with OMB + ISO 639 standards.

11. **Two stream types, not one** (decided 2026-02-12): `client` for client lifecycle events (8 event types) + `client_field_definition` for field definition lifecycle (3 event types). Separate routers: `process_client_event()` and `process_client_field_definition_event()`.

12. **Comprehensive event_types seed** (decided 2026-02-12): Seed ALL 110 event types (93 existing + 17 new) in `event_types` catalog table. Table is not used for runtime validation — serves as registry for admin dashboard and documentation.

## Technical Context

### Architecture

The client management applet is the central entity in the A4C data model. It sits at the intersection of:
- **Medication management** (existing): `medication_history` and `dosage_info` tables reference `clients.id`
- **Staff assignments** (existing): `user_client_assignments_projection` references `client_id` (currently no FK)
- **Behavioral incidents** (future): Will reference clients for outcome correlation
- **Analytics pipeline** (future): Client demographics become the `PatientDimension` conforming dimension in Cube.js

```
                      ┌─────────────────────┐
                      │   Cube.js Semantic   │
                      │      Layer           │
                      └─────────┬───────────┘
                                │
              ┌─────────────────┼─────────────────┐
              │                 │                  │
    ┌─────────▼──────┐ ┌───────▼────────┐ ┌──────▼──────────┐
    │  Medication    │ │  Behavioral    │ │  Other Future   │
    │  Adherence     │ │  Incidents     │ │  Fact Tables    │
    │  (fact)        │ │  (fact)        │ │                 │
    └────────┬───────┘ └───────┬────────┘ └──────┬──────────┘
             │                 │                  │
             └─────────────────┼──────────────────┘
                               │
                    ┌──────────▼──────────┐
                    │   Client / Patient  │  ← THIS APPLET
                    │   (dimension)       │
                    │   - Core fields     │
                    │   - Custom JSONB    │
                    │   - Field registry  │
                    └─────────────────────┘
```

### Tech Stack
- **Database**: PostgreSQL via Supabase (existing)
- **Event sourcing**: `domain_events` table with `process_domain_event_trigger` (existing)
- **API layer**: `api.*` schema RPC functions (CQRS pattern, existing)
- **Auth**: JWT custom claims v4 with `org_id`, `org_type`, `effective_permissions` (existing)
- **Future analytics**: Cube.js semantic layer, Observable Plot + D3 visualization

### Dependencies
- `organizations_projection` — parent org for multi-tenancy
- `organization_units_projection` — org hierarchy for client placement
- `users` — staff assignments, created_by/updated_by audit
- `domain_events` + `process_domain_event_trigger` — event sourcing infrastructure
- `permissions_projection` — RBAC permissions for client operations
- `contacts_projection`, `phones_projection`, `addresses_projection` — reused via junction tables

## Current State

### Existing Files
- `documentation/infrastructure/reference/database/tables/clients.md` — Current table docs (v1 schema, pre-CQRS)
- `documentation/infrastructure/reference/database/tables/user_client_assignments_projection.md` — Staff-client mapping
- No client event handlers exist (`infrastructure/supabase/handlers/` has no `client` files)
- No `api.*` RPC functions for client CRUD exist
- No AsyncAPI contract for client domain exists (archived v1 at `contracts/asyncapi/domains.archived/client.yaml`)

### Detailed Implementation Plan
- **Primary plan file**: `.claude/plans/spicy-bubbling-quail.md` — ~1,150 lines, covers all 5 migrations, cross-correlation audit, handler specs, API signatures, AsyncAPI contracts, verification plan
- **Status**: Plan complete, awaiting user approval before implementation begins

### Cross-Correlation Audit (completed 2026-02-12)
Full audit of all event types across 12 routers + dispatcher vs 14 AsyncAPI domain files. Findings:
- **2 naming mismatches**: AsyncAPI has wrong names vs deployed routers (router is source of truth)
  - `user.access_dates.updated` → should be `user.access_dates_updated` (underscore)
  - `organization.subdomain.verification_failed` → should be `organization.subdomain.failed`
- **3 events in router but NOT in AsyncAPI**: `user.schedule.reactivated`, `user.schedule.deleted`, `organization.subdomain_status.changed`
- **11 events in AsyncAPI but NOT in router**: aspirational/future features (keep, mark aspirational)
- **9 of 12 routers use RAISE WARNING instead of RAISE EXCEPTION**: coding convention violation, fix planned in Migration 3
- **3 dual-routed events**: `user.invited`, `user.role.assigned`, `user.role.revoked` — intentional, correct (different stream_types)
- **Total event count**: 93 existing deployed + 17 new client = 110

### Schema Gaps (Current vs. Required)
| What's Missing | Priority |
|---------------|----------|
| middle_name, preferred_name | High |
| pronouns (free text) | High |
| race (text[], OMB multi-select) | High |
| ethnicity (text, OMB two-question) | High |
| primary_language, interpreter_needed | High |
| case_number | High |
| organization_unit_id (FK) | High |
| referral_source | Medium |
| legal_status, custody_info (JSONB) | Medium |
| insurance/medicaid_id | Medium |
| ssn_last_four | Low |
| education_status, grade_level, iep_status | Medium |
| assigned_clinician_id, program_manager_id | High |
| custom_fields (JSONB) | High |
| photo_url | Low |
| height_cm, weight_kg | Medium |
| RLS policies (zero currently) | Critical |
| Domain event integration | Critical |
| API RPC functions | Critical |

## Key Patterns and Conventions

- **CQRS**: All writes through `api.*` functions that emit domain events. Never direct table mutations from frontend.
- **Event handlers**: Single trigger pattern (`process_domain_event_trigger`), routes by `stream_type` to router functions, then individual handlers.
- **Handler reference files**: Always read `infrastructure/supabase/handlers/` reference file before modifying a handler.
- **Projections**: Read models derived from event stream. Updated by event handler functions.
- **RLS**: JWT claims-based. `org_id` from `get_current_org_id()` for tenant isolation.
- **Naming**: Event types follow `{stream_type}.{past_tense_verb}` or `{stream_type}.{sub_entity}.{past_tense_verb}` pattern (e.g., `client.registered`, `client.custom_fields_updated`).
- **Router ELSE**: Must use `RAISE EXCEPTION ... USING ERRCODE = 'P9001'`, never `RAISE WARNING`.
- **Junction events**: Auto-routed by dispatcher via `LIKE '%.linked' OR LIKE '%.unlinked'` — bypass stream_type CASE.

## Reference Materials

### Conversations Loaded Into Context
1. **Analytics Architecture Discussion** (2026-02-12) — Cube.js semantic layer, conforming dimensions, self-service BI with Observable Plot, PostgreSQL as analytics foundation
2. **Client Intake Form Design** (2026-02) — Field catalog, regulatory requirements (OMB race/ethnicity, HIPAA), clinical role assignments, configurable schema per org

### Key Documentation
- [Event Handler Pattern](../../documentation/infrastructure/patterns/event-handler-pattern.md) — How to add new event types and handlers
- [Event Processing Patterns](../../documentation/infrastructure/patterns/event-processing-patterns.md) — Sync handler vs async workflow decision
- [Event Sourcing Overview](../../documentation/architecture/data/event-sourcing-overview.md) — CQRS pattern
- [RBAC Architecture](../../documentation/architecture/authorization/rbac-architecture.md) — Permission model
- [SQL Idempotency](../../documentation/infrastructure/guides/supabase/SQL_IDEMPOTENCY_AUDIT.md) — Migration patterns
- [Handler README](../../infrastructure/supabase/handlers/README.md) — Handler reference file conventions

### Plan File
- `.claude/plans/spicy-bubbling-quail.md` — Complete implementation plan with 5 migrations, cross-correlation audit, all SQL schemas, handler specs, API function signatures, AsyncAPI contract updates, verification plan, and implementation order

## Important Constraints

1. **CQRS compliance**: No direct table writes. All mutations via `api.*` RPC → domain event → handler.
2. **Event handler architecture**: Single trigger, router pattern. NEVER create per-event-type triggers.
3. **RLS before production**: `clients_projection` will need RLS policies from day 1. No zero-policy state.
4. **Greenfield table**: No legacy `clients` table in v4 baseline. This is a fresh `clients_projection` creation.
5. **Field keys are semantic**: Never `custom_field_1`. Always `placement_type`, `care_level`, etc.
6. **App-owner value sets preferred**: Push regulatory/clinical standards as app-defined enums. Minimize `conforming_dimension_value_mappings`.
7. **Client permissions already seeded**: `client.create`, `client.update`, `client.delete`, `client.view` exist in baseline seed. Role templates already include them (viewer: view, clinician: view+update, provider_admin: all).
8. **Existing helper functions to reuse**: `api.emit_domain_event()`, `get_current_org_id()`, `get_current_user_id()`, `has_effective_permission()`, `safe_jsonb_extract_text()`, `safe_jsonb_extract_uuid()`.
9. **`event_types` table has unique constraint on `event_type`**: Dual-routed events (e.g., `user.invited` with stream_type `user` AND `invitation`) can only have ONE row. The seed uses `ON CONFLICT (event_type) DO NOTHING`.

## Why This Approach?

**Why JSONB + field registry instead of per-tenant schemas?**
Single table, single schema, operationally manageable at 300+ orgs. JSONB with GIN indexes provides queryable flexible storage without EAV performance issues. Cube.js dynamic schema generation bridges the gap between flexible storage and typed analytics dimensions.

**Why not EAV?**
Row explosion, terrible query performance, no type safety. JSONB stores a single document per row — no joins needed to reconstruct a client record.

**Why not wide-table (`custom_text_1`, `custom_int_1`)?**
Destroys semantic meaning. Every layer (UI, API, analytics) needs a lookup to translate opaque column names to meaningful field labels. This IS the metadata-as-data antipattern.

**Why app-owner value sets over tenant-defined for analytics dimensions?**
Regulatory and clinical standards already define value sets for nearly every analytically-important field (OMB for demographics, ICD-10 for diagnoses, ISO for languages). Using these eliminates the need for cross-org value mapping for core dimensions. Tenant-specific fields are dimensions within their own analytics only.

**Why `client` stream_type instead of `clinical`?**
`clinical` is too broad — it could encompass behavioral incidents, medication events, treatment plans. `client` is specific to the client entity lifecycle. Each domain entity gets its own stream_type (consistent with existing patterns: `user`, `organization`, `role`, etc.).
