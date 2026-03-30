---
status: current
last_updated: 2026-03-28
---

<!-- TL;DR-START -->
## TL;DR

**Summary**: Bootstrap seed templates for client field definitions — 66 rows copied to `client_field_definitions_projection` during org bootstrap. Analogous to `role_permission_templates`.

**When to read**:
- Understanding which fields are seeded for new organizations
- Modifying the default field set for future bootstraps
- Working with the `seedFieldDefinitions` bootstrap activity

**Prerequisites**: [client_field_definitions_projection](./client_field_definitions_projection.md), [client_field_categories](./client_field_categories.md)

**Key topics**: `field-template`, `bootstrap-seed`, `field-definition-template`, `org-bootstrap`

**Estimated read time**: 5 minutes
<!-- TL;DR-END -->

# client_field_definition_templates

## Overview

Platform-managed seed templates for client field definitions. During organization bootstrap, the `seedFieldDefinitions` Temporal activity reads these templates, resolves `category_slug` to `category_id`, and emits `client_field_definition.created` events to populate `client_field_definitions_projection` for the new org.

Key characteristics:
- **66 templates**: Covering all 11 wizard categories (demographics through education)
- **10 locked fields**: 7 mandatory at intake (`first_name`, `last_name`, `date_of_birth`, `gender`, `admission_date`, `allergies`, `medical_conditions`) + 3 mandatory at discharge (`discharge_date`, `discharge_outcome`, `discharge_reason`) — cannot be hidden by org admin
- **All visible by default**: Every field starts visible; orgs toggle off what they don't need
- **Category by slug**: References `client_field_categories.slug` (not UUID) for portability
- **Platform-managed**: Changes affect future bootstraps only — existing orgs keep their current config
- **Analogous to `role_permission_templates`**: Same bootstrap-copy pattern

## Table Schema

| Column | Type | Nullable | Default | Description |
|--------|------|----------|---------|-------------|
| id | uuid | NO | gen_random_uuid() | Primary key |
| field_key | text | NO | - | Semantic key matching column on clients_projection |
| category_slug | text | NO | - | Maps to client_field_categories.slug |
| display_name | text | NO | - | Default display label |
| field_type | text | NO | 'text' | Data type: text, number, date, enum, multi_enum, boolean, jsonb |
| is_visible | boolean | NO | true | Default visibility |
| is_required | boolean | NO | false | Default required status |
| is_locked | boolean | NO | false | If true, org admin cannot toggle visibility |
| validation_rules | jsonb | YES | - | Optional validation constraints |
| is_dimension | boolean | NO | false | Default Cube.js dimension exposure |
| sort_order | integer | NO | 0 | Display order within category |
| configurable_label | text | YES | - | Default label override |
| conforming_dimension_mapping | text | YES | - | Canonical key for cross-org analytics |
| is_active | boolean | NO | true | Active flag |
| created_at | timestamptz | NO | now() | Seed creation timestamp |

## Template Summary by Category

| Category | Count | Locked Fields |
|----------|-------|--------------|
| Demographics | 19 | first_name, last_name, date_of_birth, gender |
| Contact Information | 3 | - |
| Guardian | 3 | - |
| Referral | 4 | - |
| Admission | 6 | admission_date |
| Insurance | 2 | - |
| Clinical Profile | 10 | - |
| Medical | 5 | allergies, medical_conditions |
| Legal & Compliance | 6 | - |
| Discharge | 5 | discharge_date, discharge_outcome, discharge_reason |
| Education | 3 | - |
| **Total** | **66** | **10** |

## Constraints

| Constraint | Type | Definition |
|-----------|------|------------|
| `client_field_definition_templates_pkey` | PRIMARY KEY | `(id)` |
| `client_field_definition_templates_key_unique` | UNIQUE | `(field_key)` |

## RLS Policies

| Policy | Command | Condition |
|--------|---------|-----------|
| `client_field_definition_templates_read` | SELECT | `true` (any authenticated user) |
| `client_field_definition_templates_write` | ALL | `has_platform_privilege()` |

## Migration History

| Date | Migration | Changes |
|------|-----------|---------|
| 2026-03-27 | `20260327210520_client_field_registry.sql` | Initial creation with 67 template seeds (66 active after discharge_plan_status removed) |

## See Also

- [client_field_definitions_projection](./client_field_definitions_projection.md) — Per-org field definitions (populated from these templates)
- [client_field_categories](./client_field_categories.md) — Categories referenced by `category_slug`
- [clients_projection](./clients_projection.md) — Client records using fields defined by these templates

## Related Documentation

- [Client Data Model](../../../../documentation/architecture/data/client-data-model.md) — Architecture overview
