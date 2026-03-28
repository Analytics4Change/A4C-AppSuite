---
status: current
last_updated: 2026-03-28
---

<!-- TL;DR-START -->
## TL;DR

**Summary**: Global reference data table for client fields — currently seeds 40 ISO 639 languages ranked by US healthcare relevance. Not org-scoped; shared across all organizations.

**When to read**:
- Looking up language codes for primary/secondary language fields
- Adding new reference data categories
- Understanding the runtime search pattern for language selection

**Key topics**: `reference-values`, `iso-639`, `language`, `lookup-table`

**Estimated read time**: 3 minutes
<!-- TL;DR-END -->

# client_reference_values

## Overview

Global reference data table shared across all organizations. Currently contains ISO 639 language codes used by the `primary_language` and `secondary_language` fields on `clients_projection`. Languages are selected at runtime via search (not a static dropdown), so this table provides the candidate set.

Key characteristics:
- **Not org-scoped**: No `organization_id` column — data is global
- **Read-only for tenants**: Only platform admins can write
- **Category-based**: Extensible to future reference data types via `category` column
- **40 languages seeded**: Top languages by US healthcare encounter frequency

## Table Schema

| Column | Type | Nullable | Default | Description |
|--------|------|----------|---------|-------------|
| id | uuid | NO | gen_random_uuid() | Primary key |
| category | text | NO | - | Reference data category (e.g., "language") |
| code | text | NO | - | Canonical code stored in clients_projection (e.g., ISO 639-1 "en") |
| display_name | text | NO | - | Human-readable label (e.g., "English") |
| sort_order | integer | YES | - | Display order within category |
| is_active | boolean | NO | true | Soft-delete flag |

## Constraints

| Constraint | Type | Definition |
|-----------|------|------------|
| `client_reference_values_pkey` | PRIMARY KEY | `(id)` |
| `client_reference_values_category_code_unique` | UNIQUE | `(category, code)` |

## Indexes

| Index | Definition |
|-------|-----------|
| `client_reference_values_pkey` | `UNIQUE (id)` |
| `idx_client_reference_values_category` | `(category) WHERE is_active = true` |

## RLS Policies

| Policy | Command | Condition |
|--------|---------|-----------|
| `client_reference_values_select` | SELECT | `true` (any authenticated user) |
| `client_reference_values_platform_admin` | ALL | `has_platform_privilege()` |

## Seeded Data

### Languages (category: "language")

40 ISO 639 language codes ranked by US healthcare encounter frequency. Top entries:

| Sort | Code | Display Name |
|------|------|-------------|
| 1 | en | English |
| 2 | es | Spanish |
| 3 | zh | Chinese (Mandarin) |
| 4 | vi | Vietnamese |
| 5 | tl | Tagalog |
| 6 | ko | Korean |
| 7 | ar | Arabic |
| ... | ... | ... (40 total) |

Includes indigenous languages: Navajo (`nav`, sort 39), Cherokee (`chr`, sort 40).

## Migration History

| Date | Migration | Changes |
|------|-----------|---------|
| 2026-03-27 | `20260327210520_client_field_registry.sql` | Initial creation with 40 ISO 639 language seeds |

## See Also

- [clients_projection](./clients_projection.md) — Client records using reference codes in language fields
- [client_field_definitions_projection](./client_field_definitions_projection.md) — Field definitions referencing this data

## Related Documentation

- [Client Data Model](../../../../documentation/architecture/data/client-data-model.md) — Architecture overview
