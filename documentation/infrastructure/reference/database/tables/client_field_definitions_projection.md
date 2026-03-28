---
status: current
last_updated: 2026-03-28
---

<!-- TL;DR-START -->
## TL;DR

**Summary**: CQRS projection for per-org field configuration — controls visibility, required flags, display labels, and analytics exposure for client intake/discharge form fields.

**When to read**:
- Building the client field configuration settings page
- Understanding how org-configurable field visibility works
- Querying which fields are visible/required for an organization
- Implementing the field definition CRUD API

**Prerequisites**: [client_field_categories](./client_field_categories.md), [organizations_projection](./organizations_projection.md)

**Key topics**: `field-definition`, `field-registry`, `configurable-field`, `client-field-config`, `cqrs-projection`

**Estimated read time**: 8 minutes
<!-- TL;DR-END -->

# client_field_definitions_projection

## Overview

CQRS projection table that stores per-organization field configuration for client records. Each row defines a field's visibility, required status, display label, and analytics properties for a specific organization. The source of truth is `client_field_definition.*` events in the `domain_events` table, processed by `process_client_field_definition_event()` router.

Key characteristics:
- **Per-org configuration**: Each org gets its own copy of field definitions (seeded from templates at bootstrap)
- **Configurable presence**: Org admins toggle field visibility and required flags via `/settings/client-fields`
- **Locked fields**: 10 fields cannot be hidden — 7 mandatory at intake (`first_name`, `last_name`, `date_of_birth`, `gender`, `admission_date`, `allergies`, `medical_conditions`) + 3 mandatory at discharge (`discharge_date`, `discharge_outcome`, `discharge_reason`)
- **Configurable labels**: Org can rename field display names (e.g., "Clinician" → "Primary Counselor")
- **Conforming dimension mapping**: Canonical key stays consistent for cross-org Cube.js analytics even when labels are renamed
- **Custom fields**: Org-defined fields with `field_type` metadata — values stored in `clients_projection.custom_fields` JSONB

## Table Schema

| Column | Type | Nullable | Default | Description |
|--------|------|----------|---------|-------------|
| id | uuid | NO | gen_random_uuid() | Primary key |
| organization_id | uuid | NO | - | FK to organizations_projection |
| category_id | uuid | NO | - | FK to client_field_categories |
| field_key | text | NO | - | Semantic key matching column on clients_projection |
| display_name | text | NO | - | Default display label |
| field_type | text | NO | 'text' | Data type: `text`, `number`, `date`, `enum`, `multi_enum`, `boolean`, `jsonb` |
| is_visible | boolean | NO | true | Whether field appears in forms for this org |
| is_required | boolean | NO | false | "Required when visible" (Decision 69) |
| validation_rules | jsonb | YES | - | Optional validation constraints |
| is_dimension | boolean | NO | false | Exposed as Cube.js dimension |
| sort_order | integer | NO | 0 | Display order within category |
| configurable_label | text | YES | - | Org-level label override (NULL = use display_name) |
| conforming_dimension_mapping | text | YES | - | Canonical key for cross-org analytics |
| is_active | boolean | NO | true | Soft-delete flag |
| created_at | timestamptz | NO | now() | Record creation timestamp |
| updated_at | timestamptz | NO | now() | Record update timestamp |
| last_event_id | uuid | YES | - | Last domain event that modified this row |

## Constraints

| Constraint | Type | Definition |
|-----------|------|------------|
| `client_field_definitions_projection_pkey` | PRIMARY KEY | `(id)` |
| `client_field_definitions_org_key_unique` | UNIQUE | `(organization_id, field_key)` |
| `client_field_definitions_field_type_check` | CHECK | `field_type IN ('text', 'number', 'date', 'enum', 'multi_enum', 'boolean', 'jsonb')` |
| `client_field_definitions_projection_organization_id_fkey` | FOREIGN KEY | `organization_id -> organizations_projection(id)` |
| `client_field_definitions_projection_category_id_fkey` | FOREIGN KEY | `category_id -> client_field_categories(id)` |

## Indexes

| Index | Definition |
|-------|-----------|
| `client_field_definitions_projection_pkey` | `UNIQUE (id)` |
| `idx_client_field_definitions_org` | `(organization_id)` |
| `idx_client_field_definitions_org_category` | `(organization_id, category_id)` |
| `idx_client_field_definitions_org_active` | `(organization_id) WHERE is_active = true` |

## RLS Policies

| Policy | Command | Condition |
|--------|---------|-----------|
| `client_field_definitions_select` | SELECT | `organization_id = get_current_org_id()` |
| `client_field_definitions_platform_admin` | ALL | `has_platform_privilege()` |

Read access relaxed to org-member only (no permission check, Decision 89). Writes via event handlers as `service_role`. Write permission (`organization.update`) enforced at API function layer.

## API RPCs

| Function | Purpose | Event Emitted |
|----------|---------|--------------|
| `api.create_field_definition(...)` | Create custom field definition | `client_field_definition.created` |
| `api.update_field_definition(...)` | Update visibility, required, label | `client_field_definition.updated` |
| `api.deactivate_field_definition(...)` | Soft-deactivate a field | `client_field_definition.deactivated` |
| `api.list_field_definitions(p_org_id, p_include_inactive)` | List all field definitions for org | - |
| `api.batch_update_field_definitions(p_org_id, p_updates, p_correlation_id)` | Batch update in single network call | `client_field_definition.updated` per field |

All write RPCs require `organization.update` permission and accept `p_correlation_id` for audit tracing.

## Domain Events

- `client_field_definition.created` — Field definition created (stream_type: `client_field_definition`)
- `client_field_definition.updated` — Visibility, required, label, or other properties changed
- `client_field_definition.deactivated` — Field definition soft-deactivated

## Frontend Integration

Configuration UI at `/settings/client-fields`:
- **FieldDefinitionTab**: Toggle visibility/required per category
- **CustomFieldsTab**: Create/manage org-defined custom fields
- **CategoriesTab**: View system categories, create org categories
- **Batch save**: All changes submitted via `api.batch_update_field_definitions()`

## Migration History

| Date | Migration | Changes |
|------|-----------|---------|
| 2026-03-27 | `20260327210520_client_field_registry.sql` | Initial creation with indexes, RLS, FKs |
| 2026-03-27 | `20260327211210_client_field_definition_events.sql` | Event handlers (created, updated, deactivated) |
| 2026-03-27 | `20260327212247_client_field_api_functions.sql` | 5 API RPC functions |

## See Also

- [client_field_categories](./client_field_categories.md) — Field grouping categories
- [client_field_definition_templates](./client_field_definition_templates.md) — Bootstrap seed templates
- [clients_projection](./clients_projection.md) — Client records using these field definitions
- [client_reference_values](./client_reference_values.md) — Reference data for field values

## Related Documentation

- [Client Data Model](../../../../documentation/architecture/data/client-data-model.md) — Architecture overview
- [Event Handler Pattern](../../../patterns/event-handler-pattern.md) — Event processing architecture
