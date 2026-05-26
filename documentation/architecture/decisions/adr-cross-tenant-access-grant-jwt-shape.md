---
status: current
last_updated: 2026-05-26
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

The full 15-step Phase 1 manifest (steps 1-12 from JWT-shape work + steps 13-15 from Phase 0.3) is enumerated in **Consequences → Phase 1 migration manifest** below — single canonical location to avoid drift.

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

The following changes MUST ship in a single transactional migration. Step 5 (backfill) may run as a `DO $$ ... $$;` block within the same migration file. Steps 1, 7, 8, 9 are the operational-tripwire must-pair set — split them and multi-scope users hit intermittent permission failures because `get_permission_scope` does `LIMIT 1` and picks arbitrarily from the relaxed multi-entry permission set.

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

8. *(merged into step 7 above)*
9. `COMMENT ON FUNCTION ... IS '... @a4c-rpc-shape: envelope|read ...'` re-tags for ALL 10 RPCs normalized in step 7 — `CREATE OR REPLACE` invalidates `pg_description` only if the signature changes; M3 DROP+CREATE rule says re-issue the comment in the migration to be safe (see [infrastructure/supabase/CLAUDE.md](../../../infrastructure/supabase/CLAUDE.md) § RPC Shape Registry).
10. `ALTER TABLE public.cross_tenant_access_grants_projection ADD CONSTRAINT cross_tenant_access_grants_projection_authorization_type_check CHECK (authorization_type IN ('var_contract', 'court_order', 'family_participation', 'social_services_assignment', 'emergency_access'));` — closes the schema-open hole. Must be paired with documentation reconciliation (see "Documentation reconciliation" below).
11. `CREATE TABLE public.grant_role_templates (...)` — per Decision B.1. Schema details deferred to Phase 0.4; Phase 1 may stub with a minimal column set.
12. Add the `access_grant.policy_override_applied` event handler to `process_access_grant_event()` (handler-only; no emit RPC yet — per Decision B.3, the full emitter ships in Phase 2).
13. **Backfill `COMMENT ON FUNCTION` tags** for all 104 `api.*` RPCs with `@a4c-bucket` + `@a4c-consultant-callable` + `@a4c-consultant-callable-reason` (when applicable) + `@a4c-phase-target` per the Phase 0.3 matrix. Must happen BEFORE steps 14-15 so codegen has deterministic input. Note: step 7's normalization of 10 C-legacy RPCs flips their bucket from `C-legacy` to `C` (post-normalization), so the backfill tag for those 10 is `@a4c-bucket: C` reflecting their post-step-7 state.
14. **Ship codegen script** `frontend/scripts/gen-rpc-reachability-matrix.cjs` (mirrors `frontend/scripts/gen-rpc-registry.cjs`). Reads `pg_description` from a local Supabase container, parses the tag set, emits the markdown matrix table + per-bucket count tables + Phase 3 / Phase 1 / Phase 4 target subset tables to `documentation/architecture/authorization/cross-tenant-access-grant-rpc-reachability-matrix.md`. Hard-fails on missing required tag.
15. **Ship CI workflow** `.github/workflows/rpc-reachability-matrix-sync.yml` (mirrors `.github/workflows/rpc-registry-sync.yml`). Triggers on changes to `infrastructure/supabase/supabase/migrations/`, the codegen, or the matrix doc. Spins up local container, applies migrations, regenerates, diffs against committed matrix. Failing tags → CI red. Matrix doc transitions from hand-edited to generated artifact at this point.

### Post-migration deliverables (same Phase 1 PR)

- Regenerate `frontend/src/types/database.types.ts` AND `workflows/src/types/database.types.ts` — `compute_effective_permissions` is in the typed public surface (see [infrastructure/supabase/CLAUDE.md](../../../infrastructure/supabase/CLAUDE.md) § Supabase-Generated TS Types).
- Run the five-tier JWT consumer audit (next section). Any tier that materializes the claim array via map-by-key (`{p1: s1}` shape) breaks under multi-entry-per-permission.

### Documentation reconciliation

Three sources disagree on `authorization_type` values today:

| Source | Values | After Phase 1 |
|---|---|---|
| Projection COMMENT (baseline_v4:12516) | 5 values (includes `emergency_access`) | unchanged — already correct |
| [provider-partners-architecture.md](../data/provider-partners-architecture.md) L324 | 4 values (no `emergency_access`) | updated to 5 |
| Schema CHECK constraint | absent | added (per migration step 10), 5 values |

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
