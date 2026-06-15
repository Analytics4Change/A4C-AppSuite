# Seed `emergency_default` template for `emergency_access` authorization_type (or make template optional)

**Status**: seed (not yet planned)
**Priority**: Medium-High (production-functional gap; `emergency_access` authorization type is currently unreachable end-to-end despite being a first-class enum value)
**Origin**: Phase 2 UAT execution 2026-06-09 probe L6 (claude during UAT card execution)

## Problem

`api.create_access_grant` requires `p_grant_role_template_name` to be non-NULL — the pre-emit validator raises `SQLSTATE 22004` with message `"grant_role_template_name is required"`. The system seeds exactly ONE template on dev:

```
template_name='var_default', authorization_type='var_contract' (4 partner.* permissions)
```

There is NO template registered for `authorization_type='emergency_access'`. Attempting to call `create_access_grant` with `p_authorization_type='emergency_access'` therefore fails:

- Pass `p_grant_role_template_name='var_default'` → `TEMPLATE_NOT_FOUND` envelope (the template's `authorization_type` is `var_contract`, not `emergency_access`)
- Pass `p_grant_role_template_name=NULL` → `RAISE EXCEPTION` from the pre-emit validator

This means the **entire `emergency_access` authorization type is unreachable end-to-end** despite:
- Being a first-class enum value in `permissions_projection` validation (`var_contract`, `court_order`, `family_participation`, `social_services_assignment`, `emergency_access`)
- The CHECK constraint on `cross_tenant_access_grants_projection` explicitly allowing `authorization_reference IS NULL` when `authorization_type = 'emergency_access'` (Step 8 architect Chunk 4 fold-in documented this carve-out as load-bearing for emergency workflows)
- The Phase 0.4 ADR Decision C.1 documenting emergency as one of 5 authorization types

## Why this matters

1. **Production-functional gap**: emergency access workflows can't be set up via the canonical RPC. The architectural carve-out for NULL `authorization_reference` (a HIPAA-load-bearing concession for time-critical emergencies) is unreachable because the template requirement gates it.

2. **F5 HIPAA pattern doesn't apply uniformly**: the `var_default` template enforces 4-literal-perm + `phi_restricted=true` defaults as the HIPAA least-authority guarantee. Emergency grants by design need DIFFERENT permission semantics (likely broader read access to PHI in a time-bounded window) — there's no template that captures this.

3. **Phase 2 UAT can't validate L6 path**: the UAT card's L6 probe ("emergency_access with NULL authorization_reference") can't run because the RPC fails at the template-lookup step before reaching the CHECK constraint test. This forecloses validation of an architectural carve-out that the Phase 2 architect explicitly verified as HIPAA-load-bearing.

## Options

### Option A — Make `p_grant_role_template_name` optional when `p_authorization_type='emergency_access'`

Modify `api.create_access_grant` to skip the template-required validator when `authorization_type='emergency_access'`. In that case, REQUIRE `p_permission_overrides` to be non-empty (emergency grants must spell out the permissions explicitly — no implicit defaults).

**Pro**: matches architectural intent (emergency = bespoke, time-bounded, audited; not a templated profile). Minimal migration surface.
**Con**: adds a conditional branch in the RPC body; if the architect intended templates as the canonical permission-source mechanism, this departs from that convention.

### Option B — Seed an `emergency_default` template with HIPAA-safe defaults

Add 1 or more rows to `grant_role_templates`:

```sql
INSERT INTO grant_role_templates (template_name, authorization_type, permission_name, default_terms) VALUES
  ('emergency_default', 'emergency_access', 'client.view_emergency_only', '{"phi_restricted": true, "time_limited_max_hours": 4}'::jsonb),
  ('emergency_default', 'emergency_access', 'medication.view',            '{"phi_restricted": true, "time_limited_max_hours": 4}'::jsonb)
  -- + others as architecturally determined
;
```

**Pro**: keeps the template-driven convention uniform across all authorization types.
**Con**: requires architectural decision on what `emergency_default` permissions SHOULD include. The 4 permissions for `var_default` were locked at Phase 0.4 Decision C.2 specifically for VAR partnerships; emergency permissions are a separate decision-shaped item.

### Option C — Hybrid: require template name BUT auto-create an emergency_default seed at deploy time

Seed `emergency_default` (Option B) AND keep the template-required validator. Document the canonical permissions for emergency in the seed.

**Pro**: most defensive; preserves the template convention.
**Con**: still requires the Option B architectural decision; doesn't add value over Option B alone.

### Recommendation

**Option B** with a dedicated architect decision on what permissions emergency_default should include. The CHECK constraint allowing NULL `authorization_reference` is the architecture's signal that emergency grants ARE first-class — they should have a first-class template, not a special-case carve-out in the RPC body (Option A). Option C is overkill.

The architect decision for emergency_default permissions is the gating item — defer until that's locked. The seed card itself is straightforward once permissions are decided.

## Steps (Option B)

1. **Architect review**: lock the emergency_default permission set + default_terms. Reference points:
   - Phase 0.4 ADR Decision C.2 (`var_default` template seed pattern)
   - The CHECK constraint at `cross_tenant_access_grants_projection.authorization_reference IS NULL OR authorization_type = 'emergency_access'`
   - The architectural intent doc at `documentation/architecture/data/provider-partners-architecture.md` § Authorization Type Patterns "Emergency Access" (if such section exists; if not, write it as part of this card)
2. **Create migration**: `supabase migration new seed_emergency_default_template`. Migration body:
   - `INSERT INTO grant_role_templates ...` (idempotent via `ON CONFLICT DO NOTHING`)
   - Optional: backfill access grants currently bypassing the template via permission_overrides (none expected to exist since the RPC is currently unreachable)
3. **Stage E re-probe**: re-run Phase 2 UAT L6 probe — expect `success: true` with permission_overrides specifying any additional emergency-specific permissions on top of the template defaults.

## Out of scope

- Phase 3/4/N rollout work.
- Frontend integration UI for emergency grant creation (separate concern).
- Permission registry additions (if the architect decision adds new `*.view_emergency_only` style permissions, those go through the `permission.defined` event flow as in PR #70/#71/#73 precedent — separate seed under the parent card).

## Files involved

- `infrastructure/supabase/supabase/migrations/20260604210910_cross_tenant_grant_phase_2_write_side.sql` — the failing RPC body (Phase 2 Step 8 `api.create_access_grant`)
- `documentation/architecture/decisions/adr-cross-tenant-access-grant-jwt-shape.md` § Decision C.2 (var_default precedent) + § Decision C.1 (authorization_type enum)
- `documentation/architecture/data/provider-partners-architecture.md` — Authorization Type Patterns section
- `dev/active/phase-2-uat-var-partnership-lifecycle-seed.md` — UAT card that surfaced this; L6 probe blocked
