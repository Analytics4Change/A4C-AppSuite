---
status: current
last_updated: 2026-06-22
---

<!-- TL;DR-START -->
## TL;DR

**Summary**: CQRS projection of VAR (value-added reseller) partnership contracts — the first provider-partner authorization type, backing `var_contract` access grants. Fed by the `var_partnership.*` event family; one row per partner↔provider contract.

**When to read**:
- Implementing or debugging VAR partnership lifecycle (`create/update/reactivate/terminate_var_partnership`)
- Tracing why a `var_contract` access grant's `authorization_reference` resolves (or doesn't)
- Adding a new provider-partner authorization type using VAR as the template

**Key topics**: `var-partnership-projection`, `provider-partner`, `cross-tenant-grant`, `cqrs`

**Estimated read time**: 5 minutes
<!-- TL;DR-END -->

# `var_partnerships_projection`

CQRS projection of VAR partnership contracts. Shipped in cross-tenant grant **Phase 2** (PR #71, 2026-06-04). A `var_contract`-type row in `cross_tenant_access_grants_projection` references a row here via `authorization_reference` (validated by `_validate_authorization_var_contract`).

> **Regenerate the live schema** rather than trusting this snapshot:
> `\d+ public.var_partnerships_projection` or
> `SELECT column_name, data_type, is_nullable FROM information_schema.columns WHERE table_schema='public' AND table_name='var_partnerships_projection' ORDER BY ordinal_position;`

## Columns (as of 2026-06-22)

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid PK | Partnership id; `authorization_reference` target for `var_contract` grants |
| `partner_org_id` | uuid NOT NULL | FK → `organizations_projection(id)` ON DELETE CASCADE (the VAR/partner org) |
| `partner_org_name` | text NOT NULL | Denormalized name snapshot |
| `provider_org_id` | uuid NOT NULL | FK → `organizations_projection(id)` ON DELETE CASCADE (the provider org) |
| `provider_org_name` | text NOT NULL | Denormalized name snapshot |
| `partnership_type` | text NOT NULL | CHECK ∈ {`standard`, `white_label`} |
| `contract_number` | text | Optional external reference |
| `contract_start_date` | date NOT NULL | |
| `contract_end_date` | date | NULL = open-ended |
| `revenue_share_percentage` | numeric | Business metadata (tracking UI not built) |
| `support_level` | text | CHECK ∈ {`tier1`, `tier1_tier2`, `full`} |
| `terms` | jsonb | Default `{}` |
| `status` | text NOT NULL | CHECK ∈ {`active`, `expired`, `terminated`, `suspended`}; default `active` |
| `created_at` / `updated_at` | timestamptz NOT NULL | |
| `terminated_at` / `terminated_by` / `termination_reason` | — | Termination audit (audit-reference cols) |
| `suspended_at` / `suspended_by` / `suspension_reason` | — | Suspension audit (audit-reference cols) |

**Key constraints**: PK `id`; FKs to `organizations_projection` (both sides, CASCADE); the three CHECKs above.

## Event family

Fed by `var_partnership.*` events routed through `process_var_partnership_event` (added in Phase 2). Lifecycle RPCs: `api.create_var_partnership`, `api.update_var_partnership`, `api.reactivate_var_partnership`, `api.terminate_var_partnership` (terminate cascade-revokes dependent grants). See the migration and the parent ADR for the per-event payloads — do not duplicate them here.

## Row-Level Security

RLS enabled. Live policies: `var_partnerships_projection_platform_admin_select`, `var_partnerships_projection_org_admin_select`, `var_partnerships_projection_service_role_select`. Regenerate with `SELECT polname FROM pg_policy WHERE polrelid='public.var_partnerships_projection'::regclass;`. Frontend reads via `api.*` RPCs (CQRS rule), not direct table access.

## Related Documentation

- [provider-partners-architecture.md](../../../../architecture/data/provider-partners-architecture.md) — partner-type model + Phase 2 status
- [var-partnerships.md](../../../../architecture/data/var-partnerships.md) — VAR vision + delivered/deferred breakdown
- [cross_tenant_access_grants_projection.md](./cross_tenant_access_grants_projection.md) — the grants that reference this table
- [adr-cross-tenant-access-grant-jwt-shape.md](../../../../architecture/decisions/adr-cross-tenant-access-grant-jwt-shape.md) — Decision C.3 (VAR projection) + C.2 (`var_default` template)
