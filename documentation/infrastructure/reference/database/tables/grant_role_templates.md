---
status: current
last_updated: 2026-06-22
---

<!-- TL;DR-START -->
## TL;DR

**Summary**: Seed/config table mapping a `(template_name, authorization_type)` to the set of permission names a cross-tenant access grant of that type confers. `api.create_access_grant` snapshots the matching rows into the grant's permission set at write time.

**When to read**:
- Adding a new grant role template (e.g. a new emergency or authorization-type default)
- Debugging `TEMPLATE_NOT_FOUND` / `EMPTY_PERMISSION_SET` from `api.create_access_grant`
- Understanding which permissions a `var_contract` or `emergency_access` grant confers

**Key topics**: `grant-role-templates`, `cross-tenant-grant`, `emergency-default`, `var-default`

**Estimated read time**: 4 minutes
<!-- TL;DR-END -->

# `grant_role_templates`

Config table for cross-tenant grant permission sets. Shipped in Phase 1 (PR #70/#71). `api.create_access_grant` looks up rows by `(template_name, authorization_type, is_active)`, snapshots the literal `permission_name`s (INTERSECT-narrowed by any `p_permission_overrides`) into the grant's `permissions` jsonb, and merges `default_terms`. Implications are NOT expanded here (HIPAA least-authority).

> **Regenerate** rather than trusting this snapshot: `\d+ public.grant_role_templates`.

## Columns (as of 2026-06-22)

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid PK | Default `gen_random_uuid()` |
| `template_name` | text NOT NULL | e.g. `var_default`, `emergency_default` |
| `authorization_type` | text NOT NULL | CHECK ∈ {`var_contract`, `court_order`, `family_participation`, `social_services_assignment`, `emergency_access`} |
| `permission_name` | text NOT NULL | One row per permission in the template (text name, no FK to `permissions_projection`) |
| `default_terms` | jsonb NOT NULL | Default `{}`; merged into the grant's `terms` (e.g. `{"phi_restricted": true}`) |
| `is_active` | boolean NOT NULL | Default `true` |
| `created_at` / `updated_at` | timestamptz NOT NULL | |
| `created_by` | uuid | Audit reference |

**Key constraints**: PK `id`; **UNIQUE `(template_name, authorization_type, permission_name)`** (`grant_role_templates_unique` — the `ON CONFLICT` target for idempotent seeds); the authorization_type CHECK.

> **Note**: `permission_name` is a text value with NO foreign key to `permissions_projection`. A template referencing a permission absent from `permissions_projection` lands in the grant row but is **silently dropped from the JWT** by the inner JOIN in `compute_effective_permissions.grant_derived_perms`. Seed migrations MUST assert each referenced permission exists (migration-time analog of pitfall #8).

## Seeded templates (as of 2026-06-22)

| template_name | authorization_type | permission_name(s) | default_terms | Origin |
|---------------|--------------------|--------------------|---------------|--------|
| `var_default` | `var_contract` | `partner.view_analytics`, `partner.view_billing_reports`, `partner.view_support_tickets`, `partner.export_reports` | `{"phi_restricted": true}` | Phase 1 (ADR Decision C.2) |
| `emergency_default` | `emergency_access` | `client.view`, `medication.view` | `{"phi_restricted": true}` | PR #79 (read-only clinical leaf perms; expiry capped at 72h in `api.create_access_grant`) |

Regenerate: `SELECT template_name, authorization_type, permission_name FROM public.grant_role_templates WHERE is_active ORDER BY 1,3;`.

## Row-Level Security

RLS enabled. Policies: `grant_role_templates_read`, `grant_role_templates_write`, `grant_role_templates_service_role_select`.

## Related Documentation

- [adr-cross-tenant-access-grant-jwt-shape.md](../../../../architecture/decisions/adr-cross-tenant-access-grant-jwt-shape.md) — Decisions C.2 (`var_default`) + hybrid-snapshot permission resolution
- [cross_tenant_access_grants_projection.md](./cross_tenant_access_grants_projection.md) — the grants these templates configure
- [provider-partners-architecture.md](../../../../architecture/data/provider-partners-architecture.md) — authorization-type model (incl. `emergency_access`)
