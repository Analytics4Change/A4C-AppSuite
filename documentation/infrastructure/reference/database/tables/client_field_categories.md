---
status: current
last_updated: 2026-03-28
---

<!-- TL;DR-START -->
## TL;DR

**Summary**: Event-sourced field category table — 11 system categories (demographics through education) plus org-defined custom categories for grouping client field definitions.

**When to read**:
- Understanding how fields are grouped in the configuration UI
- Adding or modifying field categories
- Working with the category tab bar in `/settings/client-fields`

**Prerequisites**: [client_field_definitions_projection](./client_field_definitions_projection.md)

**Key topics**: `field-category`, `client-field-config`, `system-category`, `intake-wizard`

**Estimated read time**: 5 minutes
<!-- TL;DR-END -->

# client_field_categories

## Overview

Event-sourced table that groups client field definitions into categories for the configuration UI and intake wizard. System categories (`organization_id IS NULL`) are seeded and shared across all organizations. Orgs can create custom categories via `client_field_category.created` events (Decision 87).

Key characteristics:
- **11 system categories**: Demographics, Contact Information, Guardian, Referral, Admission, Insurance, Clinical Profile, Medical, Legal & Compliance, Discharge, Education
- **Sort order**: Matches intake wizard step ordering (1-11)
- **Org-defined categories**: Custom categories scoped to a single organization
- **Slug-based identity**: UNIQUE on `(organization_id, slug)` — URL-safe identifier used as tab key
- **Event-sourced**: Stream type `client_field_category` with created/deactivated events

## Table Schema

| Column | Type | Nullable | Default | Description |
|--------|------|----------|---------|-------------|
| id | uuid | NO | gen_random_uuid() | Primary key |
| organization_id | uuid | YES | - | NULL = system category (shared). Non-NULL = org-defined |
| name | text | NO | - | Display name (e.g., "Demographics") |
| slug | text | NO | - | URL-safe identifier (e.g., "demographics") |
| sort_order | integer | NO | 0 | Display order in UI |
| is_active | boolean | NO | true | Soft-delete flag |
| created_at | timestamptz | NO | now() | Record creation timestamp |
| updated_at | timestamptz | NO | now() | Record update timestamp |
| last_event_id | uuid | YES | - | Last domain event that modified this row |

## System Categories (Seeded)

| ID Suffix | Name | Slug | Sort Order |
|-----------|------|------|------------|
| ...0001 | Demographics | demographics | 1 |
| ...0002 | Contact Information | contact_info | 2 |
| ...0003 | Guardian | guardian | 3 |
| ...0004 | Referral | referral | 4 |
| ...0005 | Admission | admission | 5 |
| ...0006 | Insurance | insurance | 6 |
| ...0007 | Clinical Profile | clinical | 7 |
| ...0008 | Medical | medical | 8 |
| ...0009 | Legal & Compliance | legal | 9 |
| ...000a | Discharge | discharge | 10 |
| ...000b | Education | education | 11 |

System category UUIDs use the prefix `a0000000-0000-0000-0000-0000000000xx` for deterministic seeding.

## Constraints

| Constraint | Type | Definition |
|-----------|------|------------|
| `client_field_categories_pkey` | PRIMARY KEY | `(id)` |
| `client_field_categories_slug_org_unique` | UNIQUE | `(organization_id, slug)` |
| `client_field_categories_organization_id_fkey` | FOREIGN KEY | `organization_id -> organizations_projection(id)` |

## Indexes

| Index | Definition |
|-------|-----------|
| `client_field_categories_pkey` | `UNIQUE (id)` |
| `idx_client_field_categories_org` | `(organization_id)` |

## RLS Policies

| Policy | Command | Condition |
|--------|---------|-----------|
| `client_field_categories_select` | SELECT | `organization_id IS NULL OR organization_id = get_current_org_id()` |
| `client_field_categories_platform_admin` | ALL | `has_platform_privilege()` |

System categories (`organization_id IS NULL`) are visible to all authenticated users. Org-defined categories only visible to members of that org.

## API RPCs

| Function | Purpose | Event Emitted |
|----------|---------|--------------|
| `api.create_field_category(p_org_id, p_name, p_slug, p_sort_order, p_correlation_id)` | Create org-defined category | `client_field_category.created` |
| `api.deactivate_field_category(p_category_id, p_correlation_id)` | Deactivate a category | `client_field_category.deactivated` |
| `api.list_field_categories(p_org_id)` | List system + org categories | - |

## Domain Events

- `client_field_category.created` — Category created (stream_type: `client_field_category`)
- `client_field_category.deactivated` — Category soft-deactivated

## Migration History

| Date | Migration | Changes |
|------|-----------|---------|
| 2026-03-27 | `20260327210520_client_field_registry.sql` | Initial creation with 11 system seeds |
| 2026-03-27 | `20260327211636_client_field_category_events.sql` | Event handlers (created, deactivated) |
| 2026-03-27 | `20260327212247_client_field_api_functions.sql` | 3 API RPC functions |

## See Also

- [client_field_definitions_projection](./client_field_definitions_projection.md) — Field definitions grouped by category
- [client_field_definition_templates](./client_field_definition_templates.md) — Bootstrap seed templates (reference category by slug)
- [clients_projection](./clients_projection.md) — Client records using categorized fields

## Related Documentation

- [Client Data Model](../../../../documentation/architecture/data/client-data-model.md) — Architecture overview
- [Event Handler Pattern](../../../patterns/event-handler-pattern.md) — Event processing architecture
