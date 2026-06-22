---
status: current
last_updated: 2026-06-22
---

<!-- TL;DR-START -->
## TL;DR

**Summary**: Cross-tenant access grants (consultants from a `provider_partner` org acting at a `provider` org) extend the JWT via `compute_effective_permissions` rather than running on a parallel RLS-only enforcement layer; grant permissions are snapshotted into `cross_tenant_access_grants_projection.permissions` at write time, with no template join at JWT issuance.

**When to read**:
- Designing an RPC that may be called by a partner consultant (anyone with a grant into the target org)
- Modifying `compute_effective_permissions`, the auth hook (`custom_access_token_hook`), or anything that reads `effective_permissions` from the JWT
- Building the grant write-side (Phase 2 of `cross-tenant-access-grant-rollout`) and need the snapshot semantics
- Adding RLS policies on data tables that must extend visibility to grant-bearing consultants
- Auditing the `compute_effective_permissions` `DISTINCT ON` behavior — this ADR is why it became asymmetric

**Prerequisites** (recommended): [provider-partners-architecture.md](../data/provider-partners-architecture.md), [adr-multi-role-effective-permissions.md](../authorization/adr-multi-role-effective-permissions.md), [adr-rpc-readback-pattern.md](./adr-rpc-readback-pattern.md)

**Key topics**: `adr`, `cross-tenant-grant`, `jwt-claim-shape`, `compute-effective-permissions`, `provider-partner`, `accessible-organizations`, `hybrid-snapshot`

**Estimated read time**: 18 minutes
<!-- TL;DR-END -->

# ADR: Cross-Tenant Access Grant — JWT Claim Shape and Permission Source

**Date**: 2026-05-26
**Status**: Current (Phase 0 design; Phase 1 implementation pending)
**Deciders**: Lars (architect), software-architect-dbc (independent verification pass), Claude (drafting)

## Context

A4C-AppSuite supports four user populations under its current multi-tenancy model: platform users (super_admin), single-tenant members, multi-org members by direct role assignment (legal today; `dakaratekid@gmail.com` is the canonical fixture from PR #63 UAT), and — proposed by `provider-partners-architecture.md` — grant-bearing consultants whose home org is a `provider_partner` and who act at one or more `provider` orgs via mediated grants.

The fourth population is the topic of this ADR. Infrastructure for it is ~80% wired:

- `cross_tenant_access_grants_projection` is fully schemed (`infrastructure/supabase/supabase/migrations/20260212010625_baseline_v4.sql:12456-12486`) including 27 columns covering grant identity, scope, authorization-type metadata, grant lifecycle (active/revoked/expired/suspended), and a `permissions jsonb DEFAULT '[]'::jsonb` column.
- The event router `process_access_grant_event()` (baseline_v4:10405-10532) handles `access_grant.created/revoked/expired/suspended/reactivated`.
- `public.has_cross_tenant_access(...)` exists as a stub (baseline_v4:9807-9817) — returns `FALSE` unconditionally; zero callers.
- `organizations_projection.type` accepts `'provider_partner'` (CHECK at baseline_v4:13111); `partner_type` enum at baseline_v4:158-169 ∈ `{var, family, court, other}`; subdomain conditional provisioning gates DNS to VAR partners only.

What does NOT yet exist:

- Authorization-type backing tables (VAR partnerships, court orders, agency assignments, family consents) — documented in `provider-partners-architecture.md` L475-580 but unmigrated.
- A grant-creation RPC.
- A `CHECK` constraint on `authorization_type` — values are documented in the projection COMMENT (baseline_v4:12516) and in `provider-partners-architecture.md` (L324), but the schema is OPEN. The two documentation sources also disagree: COMMENT lists 5 values (`var_contract, court_order, family_participation, social_services_assignment, emergency_access`); the architecture doc lists 4 (`emergency_access` is doc-absent).
- Any RLS policy that consults `cross_tenant_access_grants_projection` for cross-tenant data access. The grant projection itself has only two SELECT policies — `cross_tenant_grants_org_admin_select` (baseline_v4:15252-15259) and `platform_admin_all` (L15625) — and NO insert/update/delete policy; grant writes are exclusively event-sourced via SECURITY DEFINER handlers.

This ADR commits the JWT-claim-shape architecture and grant-permission-source mechanism. It does NOT commit the grant write-side RPC body, the type-specific backing tables, the Bucket D RLS audit, or the grant-creation UI; those are Phase 0.4+, Phase 2, Phase 4, and Phase N respectively in [the cross-tenant-access-grant-rollout card](../../../dev/active/cross-tenant-access-grant-rollout/plan.md).

> **As-built update (2026-06-22)**: This ADR is point-in-time (decision authored 2026-05-26). Subsequent state: the grant **write-side SHIPPED** in Phase 2 (`api.create_access_grant`, VAR partnership RPCs, `var_partnerships_projection`, `grant_role_templates`; PR #71, 2026-06-04), `emergency_access` became reachable (PR #79), and Phase 3 made `api.list_users` grant-aware via the Model M membership-oracle guard (PR #80). The Bucket D RLS audit (Phase 4) and grant UI (Phase N) remain open. "to be built" language below is original-decision context. See [cross-tenant-access-grant-rpc-reachability-matrix.md](../authorization/cross-tenant-access-grant-rpc-reachability-matrix.md) for current per-RPC status.

### Why this ADR exists now

PR #67 (`feat/list-users-sister-functions-membership-gating`, merged 2026-05-21) refactored three sister RPCs (`api.list_users_for_role_management/bulk_assignment/schedule_management`) to a three-step skeleton (permission gate via `has_effective_permission(perm, p_scope_path)` → org derivation from scope → `accessible_organizations @>` membership predicate). That skeleton implicitly assumes the JWT carries grant-derived permissions at the grant's scope — but the JWT today does not, because grants are stubbed. PR #67 also surfaced an **operational tripwire** (memorialized in `~/.claude/projects/-home-lars-dev-A4C-AppSuite/memory/pr-67-close-out.md`): two RPCs (`api.bulk_assign_role`, `api.sync_role_assignments`) still use the legacy `get_permission_scope() + manual ltree @>` two-step pattern, which depends on `compute_effective_permissions`'s `DISTINCT ON (permission_name)` collapsing each permission to a single scope. Any JWT-shape change that produces multi-entry-per-permission breaks those two RPCs.

This ADR is the design decision PR #67 deferred.

### Current JWT pipeline (as deployed, not as in baseline)

The auth hook function `public.custom_access_token_hook(event jsonb)` was last replaced by `infrastructure/supabase/supabase/migrations/20260226002002_organization_manage_page_phase1.sql` (which adds an org-is-active gate and `access_blocked` claim). **Phase 1's `CREATE OR REPLACE custom_access_token_hook(...)` must rebase on the 20260226002002 body, not the baseline_v4 body** — otherwise the org-is-active gate is silently reverted.

JWT claims emitted on the happy path: `org_id`, `org_type`, `access_blocked`, `claims_version` (currently 4), `effective_permissions`, `current_org_unit_id`, `current_org_unit_path`. **`accessible_organizations` is NOT a JWT claim**; it is a column on `public.users` synced via `sync_accessible_organizations()` (baseline_v4:11767-11793) wired to `trg_sync_accessible_orgs` (baseline_v4:14864) AFTER INSERT/UPDATE/DELETE on `user_organizations_projection`. RPCs read it directly from the users row.

Error/blocked branches emit a different claim set (`access_block_reason` at baseline_v4:7060-7071, `claims_error` at L7167-7184). Phase 1 must preserve both branches when extending the hook.

`compute_effective_permissions` is the function this ADR most directly modifies. Verified consumer footprint: **only the auth hook calls it** (grep across migrations, Edge Functions, frontend, workflows). The frontend `database.types.ts` exposes the symbol but no `.rpc()` call site exists. Path B's blast radius is therefore bounded to the auth hook and JWT readers — covered by the five-tier consumer audit in Consequences below.

## Threat model

A user can read or write data whose `organization_id` falls within the ltree subtree rooted at one of their *legitimate access points*. A user's legitimate access points are the UNION of: **(a)** every organization in `public.users.accessible_organizations` (direct role membership maintained by `sync_accessible_organizations` triggers off `user_organizations_projection` and — under this ADR — off `cross_tenant_access_grants_projection`); and **(b)** every `provider_org_id` referenced by an `active`, in-window row in `cross_tenant_access_grants_projection` where the user is the `consultant_user_id` (or `consultant_user_id IS NULL` AND the user's home org matches `consultant_org_id`), bounded by the grant's `scope` and `scope_id`. Cross-tenant access at the data tier is enforced by RLS policies consulting `public.has_cross_tenant_access(...)` (the canonical predicate; currently a stub returning FALSE, made real in Phase 1). Super_admin (`has_platform_privilege() = TRUE`) cross-tenant access is unrestricted by this rule; **impersonation sessions** (`impersonation_sessions_projection`, baseline_v4:7527-7546 + helpers L7858-7872) are a SEPARATE time-bound, justification-required, audited cross-tenant pathway used by super_admins to act-as a tenant-scoped user — they are NOT super_admin access. All other cross-tenant reads are denied at the RLS layer.

**Corollary** (for RPC headers): cross-tenant data access requires an active, in-scope row in `cross_tenant_access_grants_projection` linking the caller's home org to the target org with the resolved permission snapshot at grant-creation time; mediation is enforced at the RLS layer (`public.has_cross_tenant_access(...)` is the canonical predicate).

What this formalizes:

- **Preserved**: super_admin global access; native multi-org membership via `accessible_organizations`; time-bound impersonation as a distinct audited pathway.
- **Prevented**: any read of an org's data by a user not in `accessible_organizations` and without a valid grant.
- **Boundary location**: RLS policies on data tables consulting `has_cross_tenant_access()`. The Phase 1 migration makes the stub real.
- **Multi-channel access**: a user who is BOTH a partner consultant AND a direct provider-org member by legacy role assignment is allowed both pathways; their legitimate-access set is the UNION (not an XOR).
- **User-visibility consequence (Phase 3/4 UI implication)**: the Phase 1 `sync_accessible_organizations_from_grants` trigger adds grant-target orgs to `public.users.accessible_organizations`. Combined with the PR #67 `accessible_organizations @>` membership predicate in `list_users_for_*`, a consultant with a grant into provider org X appears in X's admin user lists as a "member" even with zero `user_organizations_projection` rows there. This is intentional per the UNION-not-XOR rule above, but Phase 3/4 user-list UIs may need a second-axis filter (an `EXISTS`-against-grant-projection predicate keyed by `(consultant_user_id, provider_org_id)`) to distinguish direct members from grant-bearers. Downstream consumers affected: `api.list_users_for_*` (Phase 3 refactor target), `api.list_user_org_access`, `api.get_user_org_details`, `api.list_user_organizations` (E-variant), `api.list_invitations` (Phase 3 A-variant refactor target). Phase 3/4 cards inherit this requirement.

## Two flows — consultant identity vs. grant write-side

Consultants do NOT receive cross-tenant access via the normal invite-user / role-assignment mechanism. The repository's documentation must be unambiguous about this because the two flows superficially look similar:

| Flow | Mechanism | What it creates |
|---|---|---|
| **Consultant's home-org identity** | Normal invite-user → `user.invited` → `accept-invitation` → `user.created` + `user.role.assigned` | `auth.users` row, `public.users` row, `user_roles_projection` row in the partner org, `accessible_organizations = [partner_org]` |
| **Grant write-side** (Phase 0.4 + Phase 2) | Emit-grant RPC (to be built; resolves a `grant_role_templates` row + admin overrides to a permission snapshot at write time) → `access_grant.created` event → `process_access_grant_event` handler | `cross_tenant_access_grants_projection` row with `permissions jsonb` populated. **No `user_roles_projection` row at the provider org.** |

The grant projection IS the source of truth for cross-tenant access. RLS clauses on data tables consult it via `has_cross_tenant_access(...)`. The consultant's JWT — refreshed after grant creation — carries the snapshotted permissions at the grant's scope per the decisions below.

## Phase 0.3 — RPC Reachability Matrix

The companion artifact [cross-tenant-access-grant-rpc-reachability-matrix.md](../authorization/cross-tenant-access-grant-rpc-reachability-matrix.md) classifies all 104 `api.*` SQL RPCs into five buckets and records the consultant-callability decision per RPC. This section captures the per-bucket decisions and the freshness mechanism design that govern the matrix.

### Five-bucket taxonomy (strict definitions)

| Bucket | Defining behavior | Count |
|---|---|---:|
| **A** | Early-return tenancy guard: `IF NOT (has_platform_privilege() OR p_org_id = get_current_org_id()) THEN RETURN; END IF;`. Canonical exemplar: `api.list_users` (PR #66). | 1 |
| **A-variant** | Same `p_org_id = get_current_org_id()` equality check but RAISEs instead of RETURNs and/or adds permission-gate. Treated as Phase 3 refactor target alongside strict A. | 1 |
| **B** | Derives target org from JWT (`v_org_id := public.get_current_org_id();`); no `p_org_id` parameter. | 15 |
| **C** | Scope-path signature; gates via `has_effective_permission(perm, p_scope_path)`. Only PR #67's three sister RPCs. | 3 |
| **C-legacy** | Variant of C using the legacy `get_permission_scope() + manual ltree @>` two-step pattern. `LIMIT 1` semantics break under multi-entry-per-permission JWTs. **Architect-review found 10 RPCs, not 2**: 2 role-management mutation siblings + 5 OU mutators + 3 OU readers. | 10 |
| **D** | Entity-lookup signature; no inline tenancy guard; RLS-enforced. Includes RPCs with `p_org_id` but no early-return guard. | 34 |
| **D-variant** | D with an explicit permission-gate (e.g., `has_platform_privilege()`) in addition to RLS. | 1 |
| **E** | No org/scope context; platform reference data, user-as-identity surface, or session-bound writes. | 38 |
| **E-variant** | Sui generis (mixed self-context + org-admin predicate). | 1 |
| **Total** | | **104** |

See [cross-tenant-access-grant-rpc-reachability-matrix.md](../authorization/cross-tenant-access-grant-rpc-reachability-matrix.md) for the per-RPC table.

### Per-bucket consultant-callability decisions

| Bucket | Decision | Rationale |
|---|---|---|
| A + A-variant | **NOT consultant-callable; Phase 3 refactor target (2 RPCs)** | Forward-incompatible by definition. Early-return/early-raise guard rejects non-home-org callers. Phase 3 refactor replaces guard with PR #67 three-step skeleton. |
| B | **NOT consultant-callable; case-by-case parameterization in subsequent cards** | `get_current_org_id()` returns home org; no parameter to target grant org. Per-RPC variant design out of Phase 0.3 scope. |
| C | **Consultant-callable natively under Path B; no work needed** | Scope-bound permission check evaluates grant-derived permissions automatically (the snapshot in `cross_tenant_access_grants_projection.permissions` is read by `compute_effective_permissions` and surfaces in the JWT at the grant's scope). |
| C-legacy | **NOT consultant-callable without Phase 1 fix; normalize in same migration as DISTINCT ON tightening (10 RPCs)** | LIMIT-1 semantics break under multi-entry-per-permission JWTs. **All 10 RPCs MUST ship the normalization in the same transactional migration as the `compute_effective_permissions` extension** (operational tripwire from PR #67 close-out; expanded scope per Phase 0.3 architect review). |
| D + D-variant | **Consultant-callable IFF Phase 4 RLS extension lands per-table** | RLS is the enforcement mechanism; per-table audit decides per-RPC. Phase 4 extends RLS clauses to consult `has_cross_tenant_access(...)`. |
| E + E-variant | **Consultant-callable by default; case-by-case for any RPC with implicit org context** | Grant-irrelevant; permission-gated RPCs benefit from JWT extension automatically. |

### Comment vocabulary (Phase 1 codegen contract)

To prevent matrix drift, every `api.*` RPC's `COMMENT ON FUNCTION` declares its bucket, consultant-callability, reason, and phase-target via tags (extending the existing M3 `@a4c-rpc-shape` vocabulary from [adr-rpc-readback-pattern.md](./adr-rpc-readback-pattern.md) § "Type-level enforcement (M3)"):

```sql
COMMENT ON FUNCTION api.list_users(uuid, ...) IS $cmt$Lists users in an org with role assignments.

@a4c-rpc-shape: read
@a4c-bucket: A
@a4c-consultant-callable: pending-phase3-refactor
@a4c-consultant-callable-reason: early-return tenancy guard; PR #66 pattern; forward-incompatible with grant-bearers
@a4c-phase-target: 3
$cmt$;
```

**Grammar summary** (full grammar in [matrix doc](../authorization/cross-tenant-access-grant-rpc-reachability-matrix.md) § "Comment vocabulary specification"):

| Tag | Values | Required |
|---|---|---|
| `@a4c-rpc-shape:` | `envelope` \| `read` | pre-existing (M3) |
| `@a4c-bucket:` | `A` \| `B` \| `C` \| `C-legacy` \| `D` \| `E` | new |
| `@a4c-consultant-callable:` | `yes` \| `no` \| `pending-phase3-refactor` \| `pending-phase4-rls` | new |
| `@a4c-consultant-callable-reason:` | free text | required for `no` / `pending-*`; codegen+CI enforce |
| `@a4c-phase-target:` | `1` \| `3` \| `4` \| `none` | new — single grep finds all RPCs needing work in a given phase |

> **Addendum (Phase 2 clarification — `@a4c-phase-target` convention for bucket-B RPCs)** — Phase 2 Chunk 7 F1+F2 architect fold-in (2026-06-08) corrected an early-Phase-2 misreading of this tag's meaning. The convention: `@a4c-phase-target` names the phase at which the RPC needs **further work** (rewrite, RLS audit, refactor). For bucket-B RPCs (provider-admin-only writes, no JWT-tenancy binding to a consultant), the correct value is `none` once the RPC ships — bucket B does NOT have a Phase 3/4 consultant-readability gate. Phase 2 shipped 8 emit RPCs initially tagged `@a4c-phase-target: 2` (the phase that built them) and 1 read RPC initially tagged similarly; Chunk 7 F2 corrected all 9 to `@a4c-phase-target: none` per the bucket-B convention established in Phase 1 (which set `none` on 36 of 36 bucket-B RPCs). Phase 2 Chunk 7 F1 separately corrected `api.revoke_permission_across_grants` from bucket `B` to bucket `E` (no JWT-tenancy binding — platform-only authority). The codegen `gen-rpc-reachability-matrix.cjs` does not enforce `@a4c-phase-target = none` for bucket B (cardinality varies per bucket); architect review is the gating check.

The full 15-step Phase 1 manifest (steps 1-10 from JWT-shape work + steps 11-13 from Phase 0.3 + steps 14-15 from Phase 0.4; post-PR-#68-cohesion-fix renumber) is enumerated in **Consequences → Phase 1 migration manifest** below — single canonical location to avoid drift.

## Phase 0.4 — Grant Write-Side

The grant-creation emit RPC, `grant_role_templates` schema, `var_partnerships_projection` + event family, `authorization_reference` column add, and revocation flow. Architect-reviewed pre-write (2026-05-26 REQUEST CHANGES verdict; 14 decisions locked, including 2 blocker corrections + 4 important findings folded in).

### Decisions locked at 0.4

**User-confirmed via AskUserQuestion**:

- **v1 scope** = VAR partnerships only. Court orders, agency assignments, family consents deferred to Phase N or v1.1+ subsequent cards. Rationale: VARs have organizational precedent (`partner_type='var'` enum, `is_subdomain_required()` gates DNS, bootstrap workflow handles partner orgs); the other 3 types are zero-infrastructure and would triple Phase 2 surface.
- **`authorization_reference uuid` column** added to `cross_tenant_access_grants_projection` in Phase 1. Architecture doc (`provider-partners-architecture.md` L343) documents the intent; baseline_v4 schema didn't have the column.
- **Event-sourced backing tables**. `var_partnerships_projection` is fed by a new `var_partnership.*` event family with its own router branch.

**Architect-promoted to "locked at 0.4"** (analogous to Phase 0.1+0.2's "4 promotions"; 2026-05-26 review):

- **Permission-gate direction**: caller holds `grant.create` at `p_provider_org_id` path (NOT `p_consultant_org_id` path). **Provider authorizes disclosure — they own the PHI**. Consultant org admin cannot self-issue grants pulling PHI from any provider.
- **Stream_id resolution**: `v_grant_id := gen_random_uuid()` at top of `api.create_access_grant` body; passed as `p_stream_id`; readback uses `WHERE id = v_grant_id`.
- **Template identifier**: `p_grant_role_template_name text NOT NULL` (NOT `_id uuid`). Mirrors `api.get_role_permission_templates(p_role_name text)` precedent.
- **`var_default` template seed permission list**: `{partner.view_analytics, partner.view_support_tickets, partner.view_billing_reports, partner.export_reports}` with `default_terms: {phi_restricted: true}` per arch doc L375-376.
- **`default_terms jsonb` column on `grant_role_templates`**: HIPAA-defaults snapshot at template level; emit RPC merges `template.default_terms || p_terms`.
- **Grant immutability**: NO `api.modify_access_grant`. Modifications via revoke + reissue. Preserves audit trail per hybrid-snapshot invariant.
- **`var_partnerships_projection.status` CHECK**: 4-value superset `('active', 'expired', 'terminated', 'suspended')`.
- **`authorization_reference` CHECK**: `IS NOT NULL OR authorization_type = 'emergency_access'`. Emergency access is in-band override per arch doc L313.
- **`permissions` key shape in event payload**: top-level `event_data->'permissions'` (matches deployed handler at baseline_v4:10446). Arch doc L325-365's `data.scope.permissions` nested form is **INCORRECT**; this ADR fixes the doc.
- **`grant.create` + `grant.view` + `grant.revoke` permission seeding**: Phase 1 manifest step 10 emits `permission.defined` events (current registry has none of them; verified by architect grep). Post-PR-#68-cohesion-fix this step was renumbered from 12 → 10 after Step 9 absorption + Step 11 stub deletion.
- **Phase 1 manifest cleanup history**: original Phase 0.4 draft proposed a duplicative step 18; that pass resolved by EXPANDING step 12 (single handler addition for `access_grant.policy_override_applied` + permission seeding) and adding net new steps 16-17. PR #68 cohesion review then surfaced a SECOND collision (Step 11 stub vs Step 17 full spec for `grant_role_templates`); resolved by deleting Step 11, absorbing Step 9 into Step 8, and renumbering. **Final = 15 ordered steps**.

### Decision C.1 — `api.create_access_grant` (emit-grant RPC)

Single RPC, NOT per-type. The `authorization_type` parameter discriminates; the RPC validates the backing record exists via per-type private helpers (scalable to court/agency/family in Phase N).

Signature (locked):

```sql
CREATE OR REPLACE FUNCTION api.create_access_grant(
    p_consultant_org_id        uuid NOT NULL,
    p_provider_org_id          uuid NOT NULL,
    p_consultant_user_id       uuid DEFAULT NULL,         -- NULL = org-wide grant
    p_scope                    text NOT NULL,             -- 'organization_unit' | 'client_specific'
    p_scope_id                 uuid NOT NULL,
    p_authorization_type       text NOT NULL,             -- 5-value CHECK enforced
    p_authorization_reference  uuid DEFAULT NULL,         -- NULL only for emergency_access (CHECK)
    p_legal_reference          text DEFAULT NULL,
    p_grant_role_template_name text NOT NULL,             -- resolves against grant_role_templates
    p_permission_overrides     text[] DEFAULT NULL,       -- narrowing only via INTERSECT, never widening
    p_terms                    jsonb DEFAULT '{}'::jsonb, -- merged on top of template.default_terms
    p_expires_at               timestamptz DEFAULT NULL,
    p_reason                   text DEFAULT 'Grant created via cross-tenant grant flow'
) RETURNS jsonb
```

Body skeleton:

1. `v_grant_id := gen_random_uuid();` (Decision-locked stream_id resolution).
2. **HIPAA permission gate**: `has_platform_privilege()` OR `has_effective_permission('grant.create', <provider_org_path>)`. Provider-admin authority is load-bearing.
3. **Per-type validation** via `public._validate_authorization_<type>(p_reference uuid, p_consultant_org_id uuid, p_provider_org_id uuid) RETURNS boolean` helpers. v1 implements `_validate_authorization_var_contract` (queries `var_partnerships_projection` for active row matching all three IDs) and `_validate_authorization_emergency_access` (accepts NULL reference). Phase N adds court/agency/family helpers.
4. **Permission snapshot resolution**:
   - `SELECT permission_name, default_terms FROM grant_role_templates WHERE template_name = p_grant_role_template_name AND is_active = TRUE`
   - `v_permissions := ARRAY(SELECT unnest(v_template_perms) INTERSECT SELECT unnest(p_permission_overrides))` (when overrides non-null; INTERSECT = narrowing only)
   - `v_terms := v_template_default_terms || p_terms` (right-hand wins)
5. **Emit `access_grant.created`** with `p_stream_id := v_grant_id`. Event_data carries the resolved `permissions` jsonb array at TOP LEVEL (matches handler at baseline_v4:10446), plus `authorization_reference`, all 12 other handler-read keys.
6. **Pattern A v2 readback**: SELECT FROM `cross_tenant_access_grants_projection WHERE id = v_grant_id`; check `processing_error` on captured `v_event_id`; envelope on either failure.
7. Success envelope: `{success: true, grant: {id: v_grant_id, consultant_org_id, provider_org_id, expires_at, ...}}`.
8. `COMMENT ON FUNCTION ... @a4c-rpc-shape: envelope @a4c-bucket: B @a4c-consultant-callable: no @a4c-consultant-callable-reason: provider-admin only @a4c-phase-target: 2`.

Single-event Pattern A (no per-event loop). Forward-compat note: future grant-creation may also emit separate `notification.sent` or `audit.high_risk_action.logged` events on different streams — single-event-per-grant invariant on `access_grant` stream is preserved.

### Decision C.2 — `grant_role_templates` schema

Mirrors `role_permission_templates` flat structure with architect-recommended additions (explicit UNIQUE constraint, `default_terms jsonb`):

```sql
CREATE TABLE public.grant_role_templates (
    id                  uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    template_name       text NOT NULL,                 -- e.g., 'var_default'
    authorization_type  text NOT NULL,                 -- same 5-value CHECK as grant projection
    permission_name     text NOT NULL,
    default_terms       jsonb DEFAULT '{}'::jsonb,     -- HIPAA defaults snapshot
    is_active           boolean DEFAULT true NOT NULL,
    created_at          timestamptz DEFAULT now() NOT NULL,
    updated_at          timestamptz DEFAULT now() NOT NULL,
    created_by          uuid,
    UNIQUE (template_name, permission_name)
);

CREATE INDEX idx_grant_role_templates_active
    ON grant_role_templates (template_name) WHERE is_active = true;
CREATE INDEX idx_grant_role_templates_authtype
    ON grant_role_templates (authorization_type) WHERE is_active = true;
```

> **Addendum (Phase 1 deployed shape; supersedes 2-column UNIQUE above)** — Phase 1 architect N2 fold-in (2026-06-02) tightened the UNIQUE to a 3-column form `(template_name, authorization_type, permission_name)` to allow the same `permission_name` under distinct `authorization_type` values within the same template (e.g., a future `family_default` template carrying both `client.view` under `family_participation` and `partner.view_analytics` under `var_contract`). The 2-column form above is the original ADR snapshot; the deployed form is 3-column. Phase 2 `api.get_grant_role_templates` returns `template_name` in its TABLE shape (Step 16) to disambiguate consumer rows under the 3-column key. (Forward note: a future ADR revision may rewrite this section directly; the addendum form preserves the original architect decision provenance.)

RLS mirrors `role_permission_templates`: public read; service_role read; super_admin-only write.

Phase 1 seed (v1 = VAR only):

```sql
INSERT INTO grant_role_templates (template_name, authorization_type, permission_name, default_terms) VALUES
  ('var_default', 'var_contract', 'partner.view_analytics',       '{"phi_restricted": true}'::jsonb),
  ('var_default', 'var_contract', 'partner.view_support_tickets', '{"phi_restricted": true}'::jsonb),
  ('var_default', 'var_contract', 'partner.view_billing_reports', '{"phi_restricted": true}'::jsonb),
  ('var_default', 'var_contract', 'partner.export_reports',       '{"phi_restricted": true}'::jsonb);
```

If any of the four `partner.*` permissions don't yet exist in the registry, Phase 1 manifest step 10 emits `permission.defined` events to create them (alongside `grant.create/view/revoke`).

Read RPC (Phase 2): `api.get_grant_role_templates(p_authorization_type text)` mirroring `api.get_role_permission_templates`. Returns `TABLE("template_name" text, "permission_name" text, "default_terms" jsonb)`.

### Decision C.3 — `var_partnerships_projection` + `var_partnership.*` event family

New projection (v1 scope; status CHECK locked at 4-value superset; denormalized name columns retained per existing doc):

```sql
CREATE TABLE public.var_partnerships_projection (
    id                       uuid PRIMARY KEY,
    partner_org_id           uuid NOT NULL REFERENCES organizations_projection(id),
    partner_org_name         text NOT NULL,
    provider_org_id          uuid NOT NULL REFERENCES organizations_projection(id),
    provider_org_name        text NOT NULL,
    partnership_type         text NOT NULL CHECK (partnership_type IN ('standard', 'white_label')),
    contract_number          text,
    contract_start_date      date NOT NULL,
    contract_end_date        date,
    revenue_share_percentage numeric(5,2),
    support_level            text CHECK (support_level IN ('tier1', 'tier1_tier2', 'full')),
    terms                    jsonb DEFAULT '{}'::jsonb,
    status                   text NOT NULL DEFAULT 'active'
                             CHECK (status IN ('active', 'expired', 'terminated', 'suspended')),
    created_at               timestamptz NOT NULL DEFAULT now(),
    updated_at               timestamptz NOT NULL DEFAULT now(),
    terminated_at            timestamptz,
    terminated_by            uuid,
    termination_reason       text,
    suspended_at             timestamptz,
    suspended_by             uuid,
    suspension_reason        text,
    UNIQUE (partner_org_id, provider_org_id)
);
```

> **Addendum (Phase 2 deployed shape; supersedes full UNIQUE above)** — Phase 2 sub-decision G (2026-06-04) tightened the UNIQUE to a **partial form** `UNIQUE (partner_org_id, provider_org_id) WHERE status IN ('active', 'suspended')` mirroring the `idx_grant_role_templates_active` partial-index precedent. The full UNIQUE shown above is the original ADR snapshot; the deployed form is partial. **Why partial**: allows re-establishment of a terminated/expired partnership between the same two orgs via a new row (new contract cycle) while preserving the audit trail of the prior terminated row. The full UNIQUE would have blocked re-creation entirely. The `api.create_var_partnership` emit RPC enforces a pre-emit guard against `('active', 'suspended')` rows; the projection-layer partial UNIQUE is the belt-and-suspenders defense.

Doc reconciliation: arch doc L498-514 already has the denormalized name columns; needs `contract_number`, 4-value status CHECK, and suspension/termination audit columns added in lockstep with this ADR addendum.

Event family (added to `stream_type` allowed values; new router branch):

| event_type | Handler action |
|---|---|
| `var_partnership.created` | INSERT row |
| `var_partnership.updated` | UPDATE non-immutable fields; also sync denormalized names on `org.updated` cross-events |
| `var_partnership.terminated` | status='terminated' + audit columns |
| `var_partnership.suspended` | status='suspended' + audit columns |
| `var_partnership.reactivated` | status='active'; clear suspension fields |
| `var_partnership.expired` | status='expired'. Emitter shape decided in Phase 0.5 (scheduled job vs RPC) |

`contract_renewed` is NOT a separate event — it's `var_partnership.updated` with `contract_end_date` extension. Business label, not event-sourcing distinction.

New router: `process_var_partnership_event(p_event record)` with strict ELSE `RAISE EXCEPTION` per CLAUDE.md guard rails. Dispatcher gains `WHEN 'var_partnership' THEN PERFORM process_var_partnership_event(NEW);` at baseline_v4:10789-area CASE.

Phase 2 emit RPCs: `api.create_var_partnership`, `api.update_var_partnership`, `api.terminate_var_partnership`. All Pattern A v2 envelope.

RLS posture (locked):
- `var_partnerships_read_admin` — SELECT WHERE caller has org_admin in `partner_org_id` OR `provider_org_id`
- `var_partnerships_platform_admin` — SELECT for platform admins (global)
- `var_partnerships_service_role` — SELECT for handlers
- **NO consultant-direct table access** — consultants read partnership context only through their grant via Phase N `api.list_my_active_grants_with_partnership_context()` RPC
- NO INSERT/UPDATE/DELETE policy — event-sourced via SECURITY DEFINER handler

**Pattern transferability**: the `authorization_reference uuid` indirection works uniformly for court/agency/family. The grant's `scope='client_specific' + scope_id=client_uuid` handles client-level enforcement; the type-specific projection handles legal-instrument metadata via `authorization_reference`. Pattern transfers without modification when Phase N adds the remaining authorization types.

AsyncAPI contract sketch (Phase 2 deliverable; PR expands payloads):

```yaml
channels:
  var_partnership:
    description: VAR partnership lifecycle events
    messages:
      VarPartnershipCreated:       { title: VarPartnershipCreated,       payload: {...} }
      VarPartnershipUpdated:       { title: VarPartnershipUpdated,       payload: {...} }
      VarPartnershipTerminated:    { title: VarPartnershipTerminated,    payload: {...} }
      VarPartnershipSuspended:     { title: VarPartnershipSuspended,     payload: {...} }
      VarPartnershipReactivated:   { title: VarPartnershipReactivated,   payload: {...} }
      VarPartnershipExpired:       { title: VarPartnershipExpired,       payload: {...} }
```

Each message MUST carry a `title` property (avoid AnonymousSchema generation per `infrastructure/supabase/CLAUDE.md` AsyncAPI rules).

### Decision C.4 — `authorization_reference` column addition (Phase 1)

```sql
ALTER TABLE public.cross_tenant_access_grants_projection
    ADD COLUMN authorization_reference uuid;

ALTER TABLE public.cross_tenant_access_grants_projection
    ADD CONSTRAINT cross_tenant_access_grants_authorization_reference_check
    CHECK (authorization_reference IS NOT NULL OR authorization_type = 'emergency_access');

CREATE INDEX idx_access_grants_authorization_reference
    ON cross_tenant_access_grants_projection (authorization_reference)
    WHERE authorization_reference IS NOT NULL;
```

Extend `process_access_grant_event.access_grant.created` branch (baseline_v4:10417-10451) to populate from `(p_event.event_data->>'authorization_reference')::uuid`.

Pre-flight: re-verify `SELECT COUNT(*) FROM cross_tenant_access_grants_projection;` returns 0 before Phase 1 ships. (Existing zero rows assumed; UAT may have populated dev rows.)

### Decision C.5 — Revocation flow

**Single-grant revocation**: `api.revoke_access_grant(p_grant_id uuid, p_reason text, p_revocation_details text DEFAULT NULL)` emits `access_grant.revoked` (handler at baseline_v4:10454 reads `revocation_details` from event_data). Pattern A v2 envelope.

**Policy-override revocation** (per Decision B.3): `api.revoke_permission_across_grants(p_permission_name text)` is the Phase 2 emitter; Phase 1 ships handler-only for `access_grant.policy_override_applied` event type (Phase 1 manifest step 10 — single handler addition; collision-free per Decision-locked manifest cleanup).

**Immutability invariant**: NO `api.modify_access_grant`. Permission narrowing post-creation is via revoke + reissue. Preserves hybrid-snapshot audit trail.

**JWT staleness window** (explicit ADR documentation):

> Revocation does NOT terminate active sessions; in-flight requests during the staleness window remain authorized. The window is bounded by the configured `access_token_expiry_seconds` (Supabase project setting; default 3600s, typically tightened in production). Refresh-token revocation alone does not invalidate an in-flight access token. For emergency revocation (HIPAA breach detected), pair the standard revocation with `auth.admin.signOut(consultant_user_id)` to force re-authentication. Phase 2 may expose `api.revoke_access_grant_with_session_termination(p_grant_id uuid, p_emergency boolean)` for this combined flow.
>
> **Operational SLA**: cold-revoke (non-emergency policy lifecycle) is effective within `access_token_expiry_seconds`. Emergency-revoke MUST be paired with `auth.admin.signOut` for sub-second effectiveness. Phase 2's grant-write-side card MUST capture this SLA explicitly in the emergency-revoke RPC contract.

Documented residual HIPAA risk that operational mitigation (immediate audit logging + notification) handles. Phase 2's grant-write-side design must include the emergency-revoke variant.

## Phase 0.5 — Phasing Decision

Sequencing of the multi-phase rollout against the now-finalized Phase 1 manifest (15 ordered steps, post-PR-#68-cohesion-fix), Phase 2 manifest sketch, Phase 3 scope (2 RPCs from the 0.3 matrix), Phase 4 scope (35 RPCs from the 0.3 matrix), and Phase N scope (court/agency/family — deferred per 0.4 v1 scope decision).

### Card structure (user-confirmed)

**Multi-card** — each phase is its own `dev/active/` card. Phase 0 closes on this card; downstream phases get their own cards with their own plan.md / tasks.md / branches / architect-review cycles / PRs.

Card naming convention:

| Phase | Card slug | Branch name |
|---|---|---|
| 0 | `cross-tenant-access-grant-rollout/` (this card; closes after 0.5) | `feat/cross-tenant-access-grant-phase-0-design` (this branch) |
| 1 | `cross-tenant-grant-phase-1-jwt-shape/` | `feat/cross-tenant-grant-phase-1-jwt-shape` |
| 2 | `cross-tenant-grant-phase-2-write-side/` | `feat/cross-tenant-grant-phase-2-write-side` |
| 3 | `cross-tenant-grant-phase-3-list-users-refactor/` | `feat/cross-tenant-grant-phase-3-list-users-refactor` |
| 4 | `cross-tenant-grant-phase-4-rls-audit/` | `feat/cross-tenant-grant-phase-4-rls-audit` |
| N — court | `cross-tenant-grant-court-orders/` | `feat/cross-tenant-grant-court-orders` |
| N — agency | `cross-tenant-grant-agency-assignments/` | `feat/cross-tenant-grant-agency-assignments` |
| N — family | `cross-tenant-grant-family-consents/` | `feat/cross-tenant-grant-family-consents` |

Card seeding happens on-demand per branch-on-decision rule — only Phase 1's card seeds immediately after Phase 0 closes; Phases 2-N seed when work on each begins.

### Phase 4 partitioning (user-confirmed)

**Omnibus Phase 4 card** with internal sub-sections per underlying RLS-protected table cluster (~12 sub-sections per the 0.3 matrix's Phase 4 handoff). Architect reviews one cohesive RLS-extension strategy across all tables. If any sub-cluster grows unexpectedly, it can be extracted to a separate card later.

### Phase N partitioning (user-confirmed)

**One card per authorization-type**:

- `cross-tenant-grant-court-orders/` — court_authorizations_projection + event family + emit RPCs + RLS extensions. Legal review for court systems.
- `cross-tenant-grant-agency-assignments/` — agency_assignments_projection + family + RPCs + RLS. CPS/social services coordination.
- `cross-tenant-grant-family-consents/` — family_consents_projection + family + RPCs + RLS. Family-trust review.

Each card uses the VAR Phase 2 pattern as template. Independent timelines per stakeholder coordination requirements.

### Inter-phase dependency graph (derived)

```
                    ┌────────────────┐
                    │ Phase 0 (this) │
                    │   DESIGN ONLY  │
                    └────────┬───────┘
                             │ unblocks
                             ▼
                    ┌────────────────┐
                    │ Phase 1        │ 15-step migration: JWT shape +
                    │ JWT SHAPE +    │ has_cross_tenant_access() real +
                    │ FOUNDATION     │ grant_role_templates table +
                    └────┬───┬───┬───┘ authorization_reference column
                         │   │   │
                  ┌──────┘   │   └──────┐
                  │          │          │
                  ▼          ▼          ▼
            ┌─────────┐ ┌─────────┐ ┌─────────┐
            │ Phase 2 │ │ Phase 3 │ │ Phase 4 │  Phase 2/3/4 are PARALLELABLE
            │ WRITE-  │ │ LIST_-  │ │ RLS     │  (no inter-dependencies)
            │ SIDE    │ │ USERS+  │ │ AUDIT   │
            │ (VAR)   │ │ LIST_-  │ │ (35     │
            └────┬────┘ │ INVITE  │ │ RPCs)   │
                 │      │ REFACTOR│ └─────────┘
                 │ unblocks  └─────┘
                 ▼
    ┌────────────┴─────────────────────────┐
    │                │                     │
    ▼                ▼                     ▼
┌─────────┐    ┌─────────┐          ┌─────────┐
│ Phase N │    │ Phase N │          │ Phase N │  Phase N types are PARALLELABLE
│ COURT   │    │ AGENCY  │          │ FAMILY  │  (independent stakeholder timelines)
└─────────┘    └─────────┘          └─────────┘
```

**Hard prerequisites**:

- **Phase 1 ships first**. It makes `has_cross_tenant_access()` real, deploys `grant_role_templates`, adds `authorization_reference` column, ships the JWT-shape extension. Every downstream phase depends on at least one of these.
- **Phase 2 depends on Phase 1** for `grant_role_templates` + `authorization_reference` + `permission.defined` seeding of `grant.create/view/revoke` permissions.
- **Phase 3 depends on Phase 1** functionally — the `list_users` + `list_invitations` refactor only benefits consultants when Path B's JWT shape is deployed. Phase 3 CAN technically ship before Phase 1 (the refactor itself is a code-only change, no runtime dependency on Path B), but there's no point until Path B lands.
- **Phase 4 depends on Phase 1** structurally — RLS clauses extend by calling `has_cross_tenant_access()`, which is a stub before Phase 1.
- **Phase N depends on Phase 2** — court/agency/family use the VAR Phase 2 pattern as template (per-type validation helpers, emit RPCs, RLS clauses, AsyncAPI channels).
- **Phase 2/3/4 are parallelable** post-Phase-1 — no inter-dependencies.
- **Phase N types are parallelable** post-Phase-2 — no inter-dependencies between court/agency/family.

### Phase 1 next-step pointer

After Phase 0 closes (this commit), the next work is **Phase 1 card seed**: create `dev/active/cross-tenant-grant-phase-1-jwt-shape/` with plan.md + tasks.md tracking the 15-step migration manifest from Consequences below. Phase 1 branch (`feat/cross-tenant-grant-phase-1-jwt-shape`) branches from `main` per branch-on-decision rule.

## Decisions

### Decision A — JWT shape: extend `compute_effective_permissions` (Path B)

Extend `compute_effective_permissions` (currently at baseline_v4:6932-6985 in original form, replaced in `20260226002002_organization_manage_page_phase1.sql`) to emit grant-derived permissions at the grant's scope. **Tighten** the outer `DISTINCT ON (permission_name)` at L6977 to `DISTINCT ON (permission_name, scope_path)` — allows multi-scope-per-permission while still de-duping exact duplicates. Add a sync trigger so `public.users.accessible_organizations` includes active grant-target orgs (single membership oracle preserved). Pair with a one-time backfill at deploy.

**Rationale**: PR #67's three sister RPCs already use the three-step pattern (`has_effective_permission` → org derivation → `accessible_organizations @>`) and serve consultants under Path B with zero modification. Path A (RLS-only) would require a parallel consultant-side RPC family — every future RPC would need two shapes, and `accessible_organizations @>` would cease to be the single membership oracle. Path C (a separate `active_grants` JWT claim alongside `effective_permissions`) avoids the tripwire but creates the widest blast radius: every consumer of `effective_permissions` would become grant-aware.

**Asymmetric DISTINCT ON** — role-source permissions are widened by `nlevel(scope_path) ASC` (widest wins per permission; today's behavior preserved); grant-source permissions are NOT widened (each grant gets its own entry at its own scope). Worked examples:

- A `provider_admin` at OU `acme.pediatrics` AND `provider_admin` at OU `acme.psychiatry` collapses to ONE entry (widest wins by `nlevel`; ties broken arbitrarily — pre-existing behavior).
- A partner consultant with grants to providers A and B gets TWO entries — `client.view_phi @ A.path` and `client.view_phi @ B.path`. Non-overlapping subtrees; both retained.
- A role at OU `acme` and a grant landing on identical `(client.view_phi, acme)` collapse to ONE entry via the tightened DISTINCT (no JWT bloat).

### Decision B — Grant permission source: hybrid snapshot

Grants reference a role template (keyed by `authorization_type`'s default policy bundle, with admin override permitted at grant creation). At grant-creation time, the resolved permission set is **snapshotted** into `cross_tenant_access_grants_projection.permissions` (jsonb). `compute_effective_permissions` reads `permissions` directly from the grant row — **no template join at JWT issuance**.

**Rationale**: matches the existing schema shape (`permissions jsonb DEFAULT '[]'::jsonb` at baseline_v4:12468). Audit-clean — a grant row is an immutable instance of a policy at a moment in time, satisfying HIPAA-grade audit requirements for "who was authorized to see what, on what date, by what authority." Template changes do NOT retroactively widen existing grants — re-granting with the new template is an explicit policy action that emits its own event. The JWT-issuance read path stays a single table lookup (no join), preserving auth-hook latency.

### Decision B.1 — Template ownership: separate `grant_role_templates` table

Grant templates live in a **NEW** table `grant_role_templates`, NOT as a boolean flag on `role_permission_templates`. Rationale (architect-driven): a flag-on-existing-table forces every call site of `api.get_role_permission_templates` (baseline_v4:3492) and related RPCs to add an `is_grant_role` filter — wider audit surface, higher regression risk on every future RPC that lists or selects templates. Separate table → single-responsibility, clearer ownership boundary, easier rollback if grant-write-side design needs revision in Phase 0.4.

Schema details (column list, FK to `cross_tenant_access_grants_projection`, RLS) are deferred to Phase 0.4. Phase 1 may stub the table with a minimal `(id, authorization_type, default_permissions jsonb, created_at)` to unblock the auth-hook read path.

### Decision B.2 — Implication propagation for grants: NO by default, opt-in only

Grant-derived permissions do NOT propagate via `permission_implications` by default. Implications were designed for policy-level role widening (e.g., `client.view_phi → client.view_basic_info` for org admins) and silently widening a court-order grant of `client.view_phi` to also grant `client.view_records` violates HIPAA least-authority.

Implementation: add `permission_implications.propagate_through_grants boolean DEFAULT false`; only implications with that flag set propagate at grant scope. This decision affects `compute_effective_permissions`'s CTE structure and is therefore locked at 0.2, not deferred to Phase 1.

### Decision B.3 — Snapshot policy-override mechanism: event-sourced

When policy requires retroactive change across active grants (e.g., a CMS rule revokes a permission), the mechanism is an admin RPC `api.revoke_permission_across_grants(p_permission_name)` that emits one `access_grant.policy_override_applied` event per affected grant; the event handler updates `permissions jsonb` on each matching grant row.

Rationale: operationally lighter than revoke-and-reissue, audit-trail-complete (each affected grant carries an event reference), preserves the "policy at grant date" semantics for unaffected permissions. Phase 1 may stub the event type with handler-only-no-emitter; the full RPC ships in Phase 2 alongside the grant write-side.

## Consequences

### Phase 1 migration manifest

The following changes MUST ship in a single transactional migration. Step 5 (backfill) may run as a `DO $$ ... $$;` block within the same migration file. Steps 1, 7, 8 are the operational-tripwire must-pair set — split them and multi-scope users hit intermittent permission failures because `get_permission_scope` does `LIMIT 1` and picks arbitrarily from the relaxed multi-entry permission set. (Step 8 covers BOTH the M3 re-tag for the 10 normalized RPCs AND the post-migration `UncategorizedRpcs = never` assertion; pre-PR-#68-cohesion-fix this was split across steps 8 and 9.)

1. `CREATE OR REPLACE FUNCTION public.compute_effective_permissions(...)` — tightened `DISTINCT ON (permission_name, scope_path)` in the outer CTE; new `grant_derived_perms` CTE selecting from `cross_tenant_access_grants_projection` filtered by `status='active' AND (expires_at IS NULL OR expires_at > now())`; implication propagation gated on the new `propagate_through_grants` flag.
2. `ALTER TABLE public.permission_implications ADD COLUMN propagate_through_grants boolean NOT NULL DEFAULT false` (per Decision B.2).
3. `CREATE OR REPLACE FUNCTION public.custom_access_token_hook(...)` — rebase on the `20260226002002_organization_manage_page_phase1.sql` body, preserving the org-is-active gate, the `access_blocked` branch (baseline_v4:7060-7071 claim shape), and the exception branch (baseline_v4:7167-7184). Bump `claims_version` to 5 on the happy path.
4. `CREATE OR REPLACE FUNCTION public.sync_accessible_organizations_from_grants() RETURNS trigger` + `CREATE TRIGGER trg_sync_accessible_orgs_from_grants AFTER INSERT OR UPDATE OR DELETE ON public.cross_tenant_access_grants_projection ...`. Predicate filters on `status='active' AND (expires_at IS NULL OR expires_at > now())`. Note: expiration is event-driven (`access_grant.expired` emitted by a scheduled workflow), not lazy — the trigger fires when status flips, not when the timestamp passes.
5. **One-time backfill** of existing active grants into `public.users.accessible_organizations`. Sketch:
   ```sql
   DO $$
   DECLARE r record;
   BEGIN
     FOR r IN
       SELECT u.id AS user_id,
              array_agg(DISTINCT g.provider_org_id) AS grant_orgs
       FROM public.users u
       JOIN public.cross_tenant_access_grants_projection g
         ON (g.consultant_user_id = u.id
             OR (g.consultant_user_id IS NULL
                 AND g.consultant_org_id = u.current_organization_id))
       WHERE g.status = 'active'
         AND (g.expires_at IS NULL OR g.expires_at > now())
       GROUP BY u.id
     LOOP
       UPDATE public.users
       SET accessible_organizations = ARRAY(
             SELECT DISTINCT unnest(accessible_organizations || r.grant_orgs)
           )
       WHERE id = r.user_id;
     END LOOP;
   END $$;
   ```
   Idempotent: dedupes via `DISTINCT unnest()` so re-run is safe.
6. `CREATE INDEX idx_access_grants_consultant_user_status_partial ON public.cross_tenant_access_grants_projection (consultant_user_id, status) WHERE status='active';` — closes the auth-hook query gap. The existing `idx_access_grants_consultant_user` is single-column partial WHERE NOT NULL; it does not cover the `status='active'` filter the auth hook will run.
7. **Normalize 10 C-legacy RPCs** (expanded scope per Phase 0.3 architect review — see [matrix doc](../authorization/cross-tenant-access-grant-rpc-reachability-matrix.md) § Phase 1 must-pair normalization):
   - **Role-management mutations** (2): `api.bulk_assign_role` (`20260430002824_*.sql:260`), `api.sync_role_assignments` (`20260430002824_*.sql:417`)
   - **OU mutators** (5): `api.create_organization_unit`, `api.update_organization_unit`, `api.delete_organization_unit`, `api.deactivate_organization_unit`, `api.reactivate_organization_unit`
   - **OU readers** (3): `api.get_organization_unit_by_id`, `api.get_organization_unit_descendants`, `api.get_organization_units`
   
   Each: replace `v_scope_path := get_permission_scope('<perm>')` + manual `@>` check with single `IF NOT has_effective_permission('<perm>', <scope_path>) THEN RAISE EXCEPTION ... END IF;` (or scope-bound query predicate for the readers).

8. **M3 RPC Shape Registry re-tag** for ALL 10 C-legacy RPCs normalized in step 7: re-issue `COMMENT ON FUNCTION ... IS '... @a4c-rpc-shape: envelope|read ...'` in the migration body. `CREATE OR REPLACE` preserves the comment only if the signature is unchanged; the M3 DROP+CREATE rule says re-issue the comment defensively (see [infrastructure/supabase/CLAUDE.md](../../../infrastructure/supabase/CLAUDE.md) § RPC Shape Registry). Plus post-migration assertion: regenerate `frontend/src/services/api/rpc-registry.generated.ts` and verify `UncategorizedRpcs = never` (no untagged `api.*` functions). Same M3 check the existing `rpc-registry-sync.yml` enforces in CI.
9. `ALTER TABLE public.cross_tenant_access_grants_projection ADD CONSTRAINT cross_tenant_access_grants_projection_authorization_type_check CHECK (authorization_type IN ('var_contract', 'court_order', 'family_participation', 'social_services_assignment', 'emergency_access'));` — closes the schema-open hole. Must be paired with documentation reconciliation (see "Documentation reconciliation" below).
10. Add the `access_grant.policy_override_applied` event handler to `process_access_grant_event()` (handler-only; no emit RPC yet — per Decision B.3, the full emitter ships in Phase 2). **Also emit `permission.defined` events for `grant.create`, `grant.view`, `grant.revoke` and the 4 `partner.*` permissions seeded by `var_default`** (none of these exist in the current permission registry; verified by architect grep). Per the PR #43 permission-projection rollout pattern.
11. **Backfill `COMMENT ON FUNCTION` tags** for all 104 `api.*` RPCs with `@a4c-bucket` + `@a4c-consultant-callable` + `@a4c-consultant-callable-reason` (when applicable) + `@a4c-phase-target` per the Phase 0.3 matrix. Must happen BEFORE steps 12-13 so codegen has deterministic input. Note: step 7's normalization of 10 C-legacy RPCs flips their bucket from `C-legacy` to `C` (post-normalization), so the backfill tag for those 10 is `@a4c-bucket: C` reflecting their post-step-7 state.
12. **Ship codegen script** `frontend/scripts/gen-rpc-reachability-matrix.cjs` (mirrors `frontend/scripts/gen-rpc-registry.cjs`). Reads `pg_description` from a local Supabase container, parses the tag set, emits the markdown matrix table + per-bucket count tables + Phase 3 / Phase 1 / Phase 4 target subset tables to `documentation/architecture/authorization/cross-tenant-access-grant-rpc-reachability-matrix.md`. Hard-fails on missing required tag.
13. **Ship CI workflow** `.github/workflows/rpc-reachability-matrix-sync.yml` (mirrors `.github/workflows/rpc-registry-sync.yml`). Triggers on changes to `infrastructure/supabase/supabase/migrations/`, the codegen, or the matrix doc. Spins up local container, applies migrations, regenerates, diffs against committed matrix. Failing tags → CI red. Matrix doc transitions from hand-edited to generated artifact at this point.
14. **Add `authorization_reference uuid` column to `cross_tenant_access_grants_projection`** + CHECK constraint (`IS NOT NULL OR authorization_type = 'emergency_access'`) + partial index `WHERE authorization_reference IS NOT NULL`. Extend `process_access_grant_event.access_grant.created` branch (baseline_v4:10417-10451) to populate from `(p_event.event_data->>'authorization_reference')::uuid`. Per Phase 0.4 Decision C.4. **Pre-flight**: re-verify `SELECT COUNT(*) FROM cross_tenant_access_grants_projection;` returns 0 before deploy (existing zero rows assumed; UAT may have populated dev rows).
15. **`CREATE TABLE public.grant_role_templates (...)`** + RLS policies (mirror `role_permission_templates`: public read; service_role read; super_admin-only write) + indexes (`idx_grant_role_templates_active`, `idx_grant_role_templates_authtype`). Seed `var_default` template (4 rows × `partner.*` permissions × `{"phi_restricted": true}` default_terms) per Phase 0.4 Decision C.2. **Phase 1 manifest step count is final at 15** (Step 9 absorbed into Step 8 per PR #68 cohesion-fix; Step 11 stub deleted per same review).

### Post-migration deliverables (same Phase 1 PR)

- Regenerate `frontend/src/types/database.types.ts` AND `workflows/src/types/database.types.ts` — `compute_effective_permissions` is in the typed public surface (see [infrastructure/supabase/CLAUDE.md](../../../infrastructure/supabase/CLAUDE.md) § Supabase-Generated TS Types).
- Run the five-tier JWT consumer audit (next section). Any tier that materializes the claim array via map-by-key (`{p1: s1}` shape) breaks under multi-entry-per-permission.

### Documentation reconciliation

Three sources disagree on `authorization_type` values today:

| Source | Values | After Phase 1 |
|---|---|---|
| Projection COMMENT (baseline_v4:12516) | 5 values (includes `emergency_access`) | unchanged — already correct |
| [provider-partners-architecture.md](../data/provider-partners-architecture.md) L324 | 4 values (no `emergency_access`) | updated to 5 |
| Schema CHECK constraint | absent | added (per migration step 9), 5 values |

The Phase 1 PR updates the doc in lockstep with the constraint.

### JWT consumer audit — five tiers

Every reader of `effective_permissions` must tolerate duplicate `p` entries with distinct `s` values (the new shape under the tightened DISTINCT ON). Audit BEFORE Phase 1 ships:

| Tier | Locations | Duplicate-safe? |
|---|---|---|
| **PL/pgSQL helpers** | `public.has_permission`, `public.has_effective_permission`, `public.get_permission_scope` | `has_*` use EXISTS/ANY → safe. `get_permission_scope` does `LIMIT 1` → **NOT SAFE** under multi-entry; this is the operational tripwire. The two callers (`api.bulk_assign_role`, `api.sync_role_assignments`) are normalized in migration steps 7-8. |
| **Frontend** | `frontend/src/services/auth/` claim parsing; any code that materializes claims into a `{perm: scope}` map | Audit needed. The MEMORY.md "Phase 5B audit gap pattern" notes this surface is easy to miss. |
| **Edge Functions** | `_shared/` claim helpers; per-EF claim reads | Audit shape: `grep -rn "'effective_permissions'\\|\"effective_permissions\"" infrastructure/supabase/supabase/functions/` |
| **Workflows** | Temporal activity claim parsing (workflows that read JWT or service-role context) | Audit needed. `workflows/src/types/database.types.ts` consumes the generated type. |
| **RLS** | Policy bodies invoking `has_permission` / `has_effective_permission` | Safe by delegation (the PL/pgSQL helpers above are duplicate-safe). |

### Deferred to subsequent phases

- **Bucket D RLS audit** (~88 entity-lookup RPCs that rely on RLS): policies need an EXISTS check against `cross_tenant_access_grants_projection` or a `has_cross_tenant_access(...)` call. Phase 4 work; this ADR enumerates the audit-query shape but does not commit the implementation.
- **PR #66 `api.list_users` guard refactor**: the early-return tenancy guard `IF NOT (has_platform_privilege() OR p_org_id = get_current_org_id())` (in `infrastructure/supabase/supabase/migrations/20260519233323_fix_list_users_include_roleless.sql:132-140`) is forward-incompatible with consultants. Phase 3 refactor — replace with the PR #67 three-step skeleton. Cleanest delayed until Path B + Decision B ship, because then consultants automatically gain provider-scoped permissions in JWT.
- **Grant revocation propagation**: revoking a grant (`status='revoked'`) excludes it from `compute_effective_permissions` immediately, but the consultant's existing JWT remains valid until refresh. Operational expectation: grant revocation should be paired with a session-invalidation signal (Supabase Auth refresh-token revocation? per-grant ban?) — Phase 2 grant-write-side design.
- **`grant_role_templates` schema** (column list, FKs, RLS policies) — Phase 0.4.
- **Full `api.revoke_permission_across_grants` RPC body** — Phase 1 ships handler-only; emitter ships Phase 2.

### Performance and JWT-size considerations

Auth-hook runtime grows with grant count. The composite index added in migration step 6 closes the auth-hook query gap; re-measure hook latency in Phase 1 UAT before declaring Phase 1 done.

JWT size: grants are narrow-scoped; per-grant permission lists are small (typically 5-20 perms). Upper bound: 10 active grants × 20 perms = 200 entries vs. today's typical 40-60 for org admin. Acceptable.

### Non-negotiable invariant: grant projection has no consultant-write path

The `cross_tenant_access_grants_projection` table has only SELECT policies (`cross_tenant_grants_org_admin_select` baseline_v4:15252-15259 + `platform_admin_all` L15625). No INSERT/UPDATE/DELETE policy exists. Grant writes are exclusively event-sourced via SECURITY DEFINER handlers triggered by `access_grant.*` events. Phase 2 grant-write design must preserve this — no consultant-direct write path under any circumstances.

### Non-negotiable invariant: `permissions jsonb` shape is part of the JWT contract

`cross_tenant_access_grants_projection.permissions` is read by THREE independent enforcement paths: (a) JWT issuance via `compute_effective_permissions`; (b) RLS predicates via `has_cross_tenant_access(...)`; (c) the `sync_accessible_organizations_from_grants` trigger. Any future migration that reshapes this column MUST pair with a `claims_version` bump and the five-tier consumer audit (PL/pgSQL helpers + frontend claim parsing + Edge Functions + workflows + RLS policy bodies). Treating the jsonb shape as schema-internal is incorrect — it is the wire contract between the grant write-side and three downstream enforcement layers. Cheap insurance against the Rule 12 staleness class.

## Alternatives considered

### Decision A alternatives

**Path A — RLS-only** (the shape sketched in `provider-partners-architecture.md` L305-411). JWT stays single-tenant. Cross-tenant access enforced ENTIRELY by RLS clauses that EXISTS-check `cross_tenant_access_grants_projection`. Pros: zero changes to `compute_effective_permissions`; the operational tripwire does NOT fire; the two legacy mutation RPCs stay untouched. Cons: consultants cannot call the PR #67 sister RPCs (`list_users_for_*`) for provider orgs — their JWT lacks permissions at the provider's scope; would require a parallel consultant-side RPC family. The `accessible_organizations @>` convention is no longer the single membership truth; two oracles, two predicates. **Rejected**: parallel RPC families have multiplicative cost over the whole `api.*` surface.

**Path C — Hybrid (new `active_grants` claim)**. Keep `effective_permissions` as home-org only; add a NEW JWT claim `active_grants: [{grant_id, provider_org_id, scope_path, authorization_type, permissions[]}]`. RLS policies and RPCs consult both claims. Pros: doesn't touch `compute_effective_permissions` or DISTINCT ON; per-grant context preserved in the JWT. Cons: every existing consumer of `effective_permissions` (RLS policies, scope-bound permission checks, the PR #67 sister RPCs) now needs to be grant-aware — the widest blast radius across the codebase. **Rejected**: blast radius outweighs the per-grant-context benefit.

### Decision B alternatives

**(i) Explicit per-grant permissions** — grant creator lists permissions directly in `permissions jsonb` with no template indirection. Per-grant flexibility; but the granting UX must enumerate perms; risk of inconsistent grants for the same `authorization_type`. **Rejected**: gives up consistency for flexibility that grant creators rarely need.

**(ii) Template-by-reference (live join at JWT issuance)** — grant carries `grant_role_template_id` only; `compute_effective_permissions` joins the template at JWT issuance. Template changes retroactively widen all active grants. **Rejected**: violates HIPAA-grade audit requirements (a grant must be a stable snapshot of policy at a point in time). The hybrid snapshot retains template-reference for auditability and authorship while preventing retroactive widening.

## Risk mitigation

The principal risk under Path B is that `compute_effective_permissions`'s extended body breaks an existing consumer. Verified containment:

- **Single PL/pgSQL caller**: `compute_effective_permissions` is invoked only from `public.custom_access_token_hook` (grep across all migrations confirms zero other callers). The frontend `database.types.ts` exposes the symbol but no `supabase.rpc('compute_effective_permissions', ...)` call site exists in `frontend/`, `workflows/`, `infrastructure/supabase/supabase/functions/`, or the Backend API.
- **Indirect consumers** are downstream readers of `effective_permissions` in JWT, covered by the five-tier audit (Consequences section). The duplicate-`p` invariant change is the only contract delta.
- **Hot-path performance**: the new `grant_derived_perms` CTE adds one indexed lookup (post-migration-step-6 composite). For a user with zero grants, it costs an index-scan-with-zero-rows; for a user with N grants, N indexed lookups. Budget: well within the existing hook's tens-of-milliseconds envelope.

## Related Documentation

- [cross-tenant-access-grant-rpc-reachability-matrix.md](../authorization/cross-tenant-access-grant-rpc-reachability-matrix.md) — Phase 0.3 deliverable; per-RPC classification of all 104 `api.*` functions plus per-bucket consultant-callability decisions plus comment vocabulary spec for the Phase 1 codegen.
- [provider-partners-architecture.md](../data/provider-partners-architecture.md) — Canonical narrative on `provider_partner` org type, four authorization-type patterns, RLS-with-grants sketch (L305-411). This ADR's Path B + hybrid snapshot is the data-tier enforcement mechanism that narrative depends on.
- [adr-multi-role-effective-permissions.md](../authorization/adr-multi-role-effective-permissions.md) — RBAC + Effective Permissions over ReBAC; defines the `compute_effective_permissions` semantics this ADR extends.
- [adr-rpc-readback-pattern.md](./adr-rpc-readback-pattern.md) — Pattern A v2 read-back contract that `api.revoke_permission_across_grants` (and the grant-write-side emit RPC) will conform to in Phase 2.
- [adr-edge-function-vs-sql-rpc.md](./adr-edge-function-vs-sql-rpc.md) — Determines whether the grant-write-side surface lands as a SQL RPC or Edge Function (Phase 0.4 input).
- [event-handler-pattern.md](../../infrastructure/patterns/event-handler-pattern.md) — Router + handler architecture; `process_access_grant_event` follows it.
- [event-sourcing-overview.md](../data/event-sourcing-overview.md) — CQRS architecture; the grant projection is a CQRS read model fed by `access_grant.*` events.
- [infrastructure/supabase/CLAUDE.md](../../../infrastructure/supabase/CLAUDE.md) — RPC Shape Registry (M3), Supabase-Generated TS Types, `list_users*` family pattern (PR #67).
- [cross-tenant-access-grant-rollout/plan.md](../../../dev/active/cross-tenant-access-grant-rollout/plan.md) — Multi-phase rollout card this ADR is Phase 0.2 of.
