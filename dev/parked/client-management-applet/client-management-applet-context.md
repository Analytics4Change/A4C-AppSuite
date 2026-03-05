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

9. **Junction tables for contact/phone/address** (decided 2026-02-12, updated 2026-03-04): Reuse existing `phones_projection`, `addresses_projection` via junction tables (`client_phones`, `client_addresses`). Originally planned `client_contacts` junction replaced by 4NF `client_contact_assignments` model (see Decision 13). Junction events auto-routed by `process_domain_event()` via `LIKE '%.linked' OR LIKE '%.unlinked'` suffix check — no dispatcher CASE change needed.

10. **Value set reference table** (decided 2026-02-12): Single `client_reference_values` table with `category` column (race, ethnicity, language, gender). App-owner-managed via migrations/seeds. Read-only for tenants. Seeded with OMB + ISO 639 standards.

11. **Two stream types, not one** (decided 2026-02-12): `client` for client lifecycle events (8 event types) + `client_field_definition` for field definition lifecycle (3 event types). Separate routers: `process_client_event()` and `process_client_field_definition_event()`.

12. **Comprehensive event_types seed** (decided 2026-02-12): Seed ALL 110 event types (93 existing + 17 new) in `event_types` catalog table. Table is not used for runtime validation — serves as registry for admin dashboard and documentation.

13. **4NF contact-designation model for clinical assignments** (decided 2026-03-04): `assigned_clinician_id` FK dropped from `clients_projection`. Clinical staff assignment handled via 4NF decomposition: `contacts_projection` (add `user_id` FK for internal users) → `contact_designations_projection` (designation per contact per org) → `client_contact_assignments` (atomic fact: client + contact + designation). Supports internal and external clinicians uniformly, per-client designation distinction, and clean analytics join path. Uses "designation" (not "role") to avoid RBAC semantic collision. Lazy contact creation for internal users — `contacts_projection` record auto-created on first clinical assignment. See `dev/active/client-management-applet-user-notes.md` for full schemas and scenarios.

14. **Fixed designation list, expanded for behavioral analyst** (decided 2026-03-04, updated 2026-03-04): 7 designations: `clinician`, `therapist`, `psychiatrist`, `behavioral_analyst`, `case_worker`, `guardian`, `emergency_contact`. Plain text column with CHECK constraint. No org-defined custom designations. Simplifies system — no admin UI for designation management. **Note**: `behavioral_analyst` added because intake form has 4 clinical contact fields (Clinician, Therapist, Psychiatrist, Behavioral Analyst).

15. **Full event sourcing for designations** (decided 2026-03-04): `contact.designation.created` and `contact.designation.deactivated` as first-class domain events routed through `process_contact_event()`. Codebase audit confirmed 100% event-sourced pattern — zero precedent for projection rows without domain events (only exception: configuration tables like `permission_implications`). Auto-creating designation rows without events would have been the first violation.

16. **Wrapper + individual API functions for assignment** (decided 2026-03-04): `api.assign_client_clinician()` wrapper orchestrates `api.create_organization_contact()` (existing) + `api.create_contact_designation()` (new) + `api.assign_client_contact()` (new) in a single PostgreSQL transaction. Each inner function is independently callable for the future contact management applet. Wrapper provides all-or-nothing consistency; individual functions provide reusability.

17. **Reuse `client.update` permission for contact assignment** (decided 2026-03-04): No new permissions needed. Assigning/unassigning contacts is a client update operation. Keeps permission surface small.

18. **Line staff deferred — Scenario C** (decided 2026-03-04): Contact-designation model is for clinical/external contacts only. Line staff remain in `user_client_assignments_projection` (operational caseload management). The `designation` text field makes future unification possible without schema changes, but no commitment to that path now.

19. **Contact-designation model included in Phases 2-3** (decided 2026-03-04): Ships with client management migrations, not deferred to a follow-up phase. Client registration form needs clinician assignment from day one.

20. **4 clinical contact fields on intake form** (decided 2026-03-04): Separate fields for Assigned Clinician, Therapist, Psychiatrist, and Behavioral Analyst. All share the same reusable `ClinicalContactField` component parameterized by designation. All nullable.

21. **Client-side Jaro-Winkler fuzzy search for clinical contacts** (decided 2026-03-04): Preload all org staff + external contacts on form mount (one RPC call, cached). Score client-side with Jaro-Winkler (threshold ≥ 0.85) on every keystroke. Chosen over Fuse.js (Bitap algorithm penalizes transpositions as 2 edits — too harsh for short names like "Jonh"→"John"). Chosen over server-side `pg_trgm` (unnecessary round trips for 50-500 person pool). ~30 lines TypeScript, no dependency.

22. **Two-phase field UX for clinical contact assignment** (decided 2026-03-04): Each clinical contact field has 4 states: empty → search active (instant client-side results) → selected (chip display) → create-new mode (inline 4-field mini-form). "Add new contact" action always visible at bottom of results. New contact creation is deferred — no DB write until parent form submits. Existing `SearchableDropdown<T>` NOT reused (designed for async server-side search with debounce); simpler local dropdown using `DropdownPortal` + `useDropdownHighlighting`.

23. **Minimal inline contact creation form** (decided 2026-03-04): 4 fields only: First Name, Last Name, Email, Title. Full `ContactInput` (7 fields) rejected as too heavy for this context. Pre-fills name from search query (best-effort whitespace split).

24. **Shared correlation ID across multi-step intake submission** (decided 2026-03-04): Follows Pattern A from `SupabaseRoleService.bulkAssignRole()` — one `correlationId` UUID generated per form submit, passed as `p_correlation_id` flat parameter to all RPCs. All domain events traceable as single business transaction via `api.get_events_by_correlation()`. W3C Trace Context (`traceparent`, `trace_id`, `span_id`) handled automatically by existing `tracingFetch` wrapper + `postgrest_pre_request()` hook.

25. **Failed event detection via RPC read-back guard** (decided 2026-03-04): All event-emitting RPCs include projection read-back after emit. Returns `{success: false, error, correlation_id}` on failure. Frontend surfaces error with correlation ID reference for support. No polling needed — synchronous detection.

26. **data-testid on all interactive elements** (decided 2026-03-04): Designation-interpolated IDs for Playwright UAT (e.g., `clinical-contact-search-clinician`, `clinical-contact-add-new-therapist`). 15 test IDs per field instance × 4 designations.

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
- `contacts_projection` — unified "people" dimension for clinical assignments (add `user_id` FK); also reused via `client_contact_assignments`
- `phones_projection`, `addresses_projection` — reused via junction tables

### Existing Contact Infrastructure (discovered 2026-03-04)

**Contact CRUD API functions already deployed** (migration `20260226002002_organization_manage_page_phase1.sql`):
- `api.create_organization_contact(p_org_id uuid, p_data jsonb)` — emits `contact.created`, permission: `organization.update`
- `api.update_organization_contact(p_contact_id uuid, p_data jsonb)` — emits `contact.updated`
- `api.delete_organization_contact(p_contact_id uuid, p_reason text)` — emits `contact.deleted`

**Contact event pipeline fully deployed**:
- Router: `process_contact_event()` handles 5 events: `contact.created`, `contact.updated`, `contact.deleted`, `contact.user.linked`, `contact.user.unlinked`
- Junction router: `process_junction_event()` handles `organization.contact.linked/unlinked`, `contact.phone.linked/unlinked`, `contact.address.linked/unlinked`, `contact.email.linked/unlinked`
- Workflow activity: `createOrganization()` emits all contact events with full correlation during org bootstrap

**What's new for client management** (not yet deployed):
- `api.create_contact_designation()` — emits `contact.designation.created`
- `api.assign_client_contact()` — emits `client.contact.assigned`
- `api.assign_client_clinician()` — wrapper function orchestrating the above
- 2 new CASE branches in `process_contact_event()` for designation events
- 2 new CASE branches in `process_client_event()` for assignment events

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
| ~~assigned_clinician_id~~ | ~~High~~ — Replaced by 4NF contact-designation model |
| `contact_designations_projection` (new table) | High |
| `client_contact_assignments` (new table) | High |
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
3. **Clinical Contact Assignment UX Design** (2026-03-04) — ClinicalContactField component, Jaro-Winkler search strategy, observability patterns (W3C Trace Context, Pattern A correlation, read-back guards), data-testid conventions

### Key Documentation
- [Event Handler Pattern](../../documentation/infrastructure/patterns/event-handler-pattern.md) — How to add new event types and handlers
- [Event Processing Patterns](../../documentation/infrastructure/patterns/event-processing-patterns.md) — Sync handler vs async workflow decision
- [Event Sourcing Overview](../../documentation/architecture/data/event-sourcing-overview.md) — CQRS pattern
- [RBAC Architecture](../../documentation/architecture/authorization/rbac-architecture.md) — Permission model
- [SQL Idempotency](../../documentation/infrastructure/guides/supabase/SQL_IDEMPOTENCY_AUDIT.md) — Migration patterns
- [Handler README](../../infrastructure/supabase/handlers/README.md) — Handler reference file conventions
- [Event Observability](../../documentation/infrastructure/guides/event-observability.md) — W3C Trace Context, pre-request hook, correlation ID, failed event detection
- [Event Metadata Schema](../../documentation/workflows/reference/event-metadata-schema.md) — Full JSONB metadata structure

### Plan Files
- `.claude/plans/spicy-bubbling-quail.md` — Complete implementation plan with 5 migrations, cross-correlation audit, all SQL schemas, handler specs, API function signatures, AsyncAPI contract updates, verification plan, and implementation order
- `.claude/plans/woolly-beaming-teacup.md` — Clinical Contact Assignment Field UX plan: two-phase field component, Jaro-Winkler search, observability, data-testid, component architecture

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
10. **Observability — Pattern A for RPC correlation**: New RPCs accept `p_correlation_id uuid DEFAULT NULL` as flat parameter (NOT `p_event_metadata` JSONB). W3C Trace Context (`traceparent`, `trace_id`, `span_id`) injected automatically by `tracingFetch` wrapper → `postgrest_pre_request()` hook → session variables → `api.emit_domain_event()` fallback. See `frontend/src/lib/supabase-ssr.ts:87-121` and `frontend/src/utils/trace-ids.ts`.
11. **Observability — read-back guard required on all event-emitting RPCs**: After emit, read projection. If NOT FOUND, check `processing_error` from `domain_events`, return `{success: false, error, correlation_id}`. Frontend surfaces error with correlation ID for support reference.

## Data Sensitivity Tiers (HIPAA)

| Tier | Examples | Handling |
|---|---|---|
| PHI-Critical | SSN last 4 (if captured), diagnoses, medications, allergies | Field-level encryption, strict audit, minimum necessary |
| PHI-Standard | Name, DOB, race/ethnicity, contacts | Standard HIPAA protections, role-based access |
| Administrative | Case #, admission date, referral source, org unit | Standard access controls |

## Frontend Patterns to Reuse (Phase 5)

When the frontend intake form is built, these existing patterns apply:

| Pattern | File | Reuse For |
|---|---|---|
| **Settings ViewModel** | `frontend/src/viewModels/settings/DirectCareSettingsViewModel.ts` | Intake form configuration ViewModel (observable state, dirty tracking, save/reset, audit) |
| **Settings hub card** | `frontend/src/pages/settings/SettingsPage.tsx` | "Client Intake Configuration" card (glassmorphism, permission-gated, keyboard accessible) |
| **Multi-section form** | `frontend/src/viewModels/organization/OrganizationFormViewModel.ts` | Client intake form (multi-section, complex validation, draft management) |
| **Multi-select dropdown** | `frontend/src/components/ui/MultiSelectDropdown.tsx` | Race multi-select (WCAG 2.1 AA, checkbox-based, keyboard nav) |
| **JSONB org settings** | `organizations_projection.direct_care_settings` | Pattern for per-org intake config storage |

### Current Frontend State (as of 2026-02-06)
- `/clients` route: Functional page with **mock data** (card grid, search/filter, client name + DOB + med count)
- `/clients/:clientId` detail: Tabs for overview, medications, history (coming soon), documents (coming soon)
- `/settings` route: Hub page with permission-gated cards; DirectCareSettings section with toggle switches + reason-for-change audit
- Root `/` redirects to `/clients`

### Open Frontend Questions (resolve before Phase 5)
- **Navigation**: Intake form configuration under `/settings/organization` (alongside DirectCareSettings) or dedicated `/settings/intake-form` sub-route?
- **Configurability UX**: Toggle switches (like DirectCareSettings) vs. drag-and-drop field ordering vs. section-based grouping?

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
