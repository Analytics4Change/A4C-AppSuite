-- =============================================================================
-- Phase 1 — Cross-Tenant Access Grant: JWT shape migration (Path B)
-- =============================================================================
--
-- This migration ships the 15-step Phase 1 manifest from the canonical ADR
-- (documentation/architecture/decisions/adr-cross-tenant-access-grant-jwt-shape.md)
-- as a SINGLE TRANSACTIONAL migration. Steps 1, 7, 8 are the must-pair set:
-- splitting them produces intermittent permission failures for multi-scope
-- users because `get_permission_scope` does `LIMIT 1` and picks arbitrarily
-- from the relaxed multi-entry permission set.
--
-- Drafting order (this file accumulates as drafting progresses):
--   [x] Step 2  — permission_implications.propagate_through_grants column
--   [x] Step 1  — compute_effective_permissions extension (grant_derived_perms
--                  CTE + asymmetric DISTINCT ON + implication flag gating)
--   [ ] Step 3  — custom_access_token_hook rebase + claims_version=5
--   [ ] Step 4  — sync_accessible_organizations_from_grants function + trigger
--   [ ] Step 5  — one-time backfill DO-block
--   [ ] Step 6  — composite partial index on cross_tenant_access_grants_projection
--   [ ] Step 7  — 10 C-legacy RPC normalizations
--   [ ] Step 8  — M3 RPC Shape Registry re-tag for the 10 normalized RPCs
--   [ ] Step 9  — authorization_type CHECK constraint
--   [ ] Step 10 — access_grant.policy_override_applied handler + perm-defined events
--   [ ] Step 11 — 170-RPC @a4c-bucket tag backfill
--   [ ] Step 14 — authorization_reference column + CHECK + index + handler ext
--   [ ] Step 15 — grant_role_templates table + RLS + seed
--
-- Step 12 (codegen) and Step 13 (CI workflow) ship as file additions, not SQL.
--
-- Drafting tracker: dev/active/cross-tenant-grant-phase-1-jwt-shape/tasks.md
-- DBC contracts: dev/active/cross-tenant-grant-phase-1-jwt-shape/plan.md
--                § Function contracts (DBC)
-- =============================================================================

-- Migration-session search_path — mandatory under the PR #67 codified rule for
-- any migration that uses extension-typed parameters or return types in
-- function signatures. Function-attribute `SET search_path` applies INSIDE the
-- body but NOT during CREATE-time signature parsing.
--
-- Step 1 alone is strictly defensive here — its `compute_effective_permissions`
-- has `ltree` only in `RETURNS TABLE(... ltree)` (not in parameters), which
-- PostgreSQL parses with the per-function `SET search_path` already in effect
-- (verified in PR #67 close-out). However, Step 7 normalizes 10 C-legacy RPCs
-- with `p_scope_path ltree` parameter signatures — those WILL fail without the
-- session-level SET. Keeping it at the top of the file is correct (the
-- migration accumulates; removing-then-re-adding is churn). N1 fold-in from
-- 2026-06-01 step-1+2 architect review.
-- See infrastructure/supabase/CLAUDE.md § Migration-session SET search_path.
SET search_path = public, extensions, pg_temp;


-- =============================================================================
-- Step 2 — permission_implications.propagate_through_grants column
-- =============================================================================
--
-- Per ADR Decision B.2 (HIPAA least-authority): grant-derived permissions
-- must NOT auto-widen through implication chains by default. Each implication
-- row opts in explicitly via this flag.
--
-- Default FALSE preserves existing behavior for role-source implications
-- (which today UNCONDITIONALLY propagate via permission_implications) — see
-- Step 1's `with_implications` CTE for the gating semantics.
--
-- Idempotent: ADD COLUMN IF NOT EXISTS skips if already present.
-- Step 1 references this column, so Step 2 MUST execute before Step 1 within
-- the transaction. DDL takes effect immediately in PostgreSQL transactions, so
-- ordering within the file is sufficient.

ALTER TABLE public.permission_implications
  ADD COLUMN IF NOT EXISTS propagate_through_grants boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.permission_implications.propagate_through_grants IS
  'When true, this implication chain propagates through cross-tenant access '
  'grants. Default false enforces HIPAA-grade least-authority for grant-derived '
  'permissions (Phase 0.4 Decision B.2 of cross-tenant-access-grant-rollout). '
  'Role-source implications propagate unconditionally regardless of this flag; '
  'this column gates ONLY the grant-source implication arm of '
  'public.compute_effective_permissions.';


-- =============================================================================
-- Step 1 — compute_effective_permissions extension (Path B)
-- =============================================================================
--
-- Extends the function (baseline_v4:6932-6985) to emit grant-derived permissions
-- alongside role-derived permissions, with three behavioral changes:
--
-- (1) New `grant_derived_perms` CTE reads
--     cross_tenant_access_grants_projection.permissions jsonb directly (per
--     ADR hybrid-snapshot decision B; NO template join at issuance) and
--     filters by `status='active' AND (expires_at IS NULL OR expires_at > now())`.
--     Both grant-keying shapes are honored:
--       - user-specific grant: consultant_user_id = p_user_id
--       - org-wide grant:      consultant_user_id IS NULL AND
--                              consultant_org_id = <p_user_id's home org>
--
-- (2) Outer DISTINCT ON tightened from `(permission_name)` to
--     `(permission_name, scope_path)`. This preserves multi-scope entries for
--     the same permission name (canonical Path B requirement) while still
--     deduplicating exact duplicates. Role-source rows continue to widen by
--     `nlevel(scope_path) ASC` via the inner `widest_explicit_role` CTE; grant-
--     source rows are emitted at their grant scope WITHOUT widening.
--
-- (3) Implication propagation is split:
--       - role-source implications:  UNCONDITIONAL (existing behavior preserved)
--       - grant-source implications: gated by
--         `permission_implications.propagate_through_grants = true`
--     Default FALSE → grant-derived permissions DO NOT implicitly widen
--     (HIPAA least-authority per Decision B.2).
--
-- Function attributes preserved from baseline:
--   LANGUAGE sql STABLE SECURITY DEFINER
--   SET search_path TO 'public', 'extensions'
--
-- Signature unchanged → CREATE OR REPLACE preserves the existing
-- `COMMENT ON FUNCTION` (per M3 OID-keyed comment rule); we re-issue a
-- richer comment defensively in case a future signature change drops it.
--
-- DBC contract: see dev/active/cross-tenant-grant-phase-1-jwt-shape/plan.md
-- § Function contracts (DBC) → `compute_effective_permissions(...)` — extended.
--
-- Containment verification (architect 2026-05-29; re-verified 2026-06-01 per
-- step-1+2 architect review F2 fold-in):
--   - Only PL/pgSQL caller: public.custom_access_token_hook
--     (sole call site: `20260226002002_organization_manage_page_phase1.sql:168`)
--   - Zero supabase.rpc('compute_effective_permissions', ...) call sites in
--     frontend/, workflows/, edge functions, or backend API
--   - TypeScript type surface: `frontend/src/types/database.types.ts:4683` and
--     `workflows/src/types/database.types.ts:4683` (signature unchanged →
--     regen optional but recommended per Definition of Done; the row-shape
--     contract changes — multi-entry-per-permission — even though the column
--     types do not, so downstream callers should re-read documentation)
--   - Indirect consumers (JWT readers) covered by the five-tier audit:
--     PL/pgSQL helpers (has_*, get_permission_scope), frontend, edge functions,
--     workflows, RLS policy bodies — all duplicate-safe today (confirmed by
--     architect prior to Phase 1 work) EXCEPT get_permission_scope (LIMIT 1)
--     whose two remaining callers ship as Step 7's normalization.

CREATE OR REPLACE FUNCTION public.compute_effective_permissions(
  p_user_id uuid,
  p_org_id  uuid
) RETURNS TABLE(
  permission_name  text,
  effective_scope  extensions.ltree
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $$

WITH
-- Pre-resolve the caller user's home org once. Used by the org-wide grant
-- branch below. Returns zero rows when the user is missing or soft-deleted;
-- the org-wide branch then never matches because `org_id = NULL` is NULL/false.
-- The `deleted_at IS NULL` filter is defensive (N2 fold-in 2026-06-01 — the
-- JWT hook only fires for live login today so the gap is academic, but
-- hardens against future paths that call compute_effective_permissions outside
-- custom_access_token_hook).
user_home_org AS (
  SELECT u.current_organization_id AS home_org_id
  FROM public.users u
  WHERE u.id = p_user_id
    AND u.deleted_at IS NULL
),

-- Role-source explicit permissions for the requested active org (or org-
-- agnostic platform-level roles). Renamed from baseline's `explicit_grants`
-- to disambiguate from cross-tenant `access grants` introduced in this phase.
-- Temporal validity (role_valid_from/until) preserved verbatim from baseline.
explicit_role_perms AS (
  SELECT DISTINCT
    p.name      AS permission_name,
    p.id        AS permission_id,
    ur.scope_path
  FROM public.user_roles_projection ur
  JOIN public.role_permissions_projection rp ON rp.role_id = ur.role_id
  JOIN public.permissions_projection p ON p.id = rp.permission_id
  WHERE ur.user_id = p_user_id
    AND (ur.organization_id = p_org_id OR ur.organization_id IS NULL)
    AND (ur.role_valid_from  IS NULL OR ur.role_valid_from  <= CURRENT_DATE)
    AND (ur.role_valid_until IS NULL OR ur.role_valid_until >= CURRENT_DATE)
),

-- Role-source widening: pick the widest (shortest path) scope per permission
-- name. Existing semantics preserved verbatim. Ties broken arbitrarily (pre-
-- existing behavior; no consumer depends on the tiebreaker).
widest_explicit_role AS (
  SELECT DISTINCT ON (permission_name)
    permission_name,
    permission_id,
    scope_path
  FROM explicit_role_perms
  ORDER BY permission_name, extensions.nlevel(scope_path) ASC
),

-- NEW (Step 1) — Grant-source permissions, emitted at the grant scope WITHOUT
-- widening. Reads `permissions jsonb` directly per Decision B's hybrid snapshot
-- contract: each element is `{p: "<perm.name>", s: "<scope.ltree.path>"}`.
--
-- Filters:
--   - status = 'active' AND (expires_at IS NULL OR expires_at > now())
--     (revoked/expired/suspended grants drop out at JWT issuance)
--   - Grant addressed to this user, EITHER:
--       (a) user-specific: consultant_user_id = p_user_id, OR
--       (b) org-wide:      consultant_user_id IS NULL AND
--                          consultant_org_id = <user's home org>
--
-- Permission-name lookup against permissions_projection.name; rows whose
-- `p` field doesn't resolve to a known permission are silently dropped (data-
-- quality issue, not a runtime error). Ltree cast failure on `s` raises an
-- exception caught by custom_access_token_hook's exception branch
-- (baseline_v4:7167-7184) → access_blocked claim shape returned to caller.
grant_derived_perms AS (
  SELECT
    p.id   AS permission_id,
    p.name AS permission_name,
    (perm_entry->>'s')::extensions.ltree AS scope_path
  FROM public.cross_tenant_access_grants_projection g
  CROSS JOIN LATERAL jsonb_array_elements(g.permissions) AS perm_entry
  JOIN public.permissions_projection p
    ON p.name = perm_entry->>'p'
  WHERE g.status = 'active'
    AND (g.expires_at IS NULL OR g.expires_at > now())
    AND (
      g.consultant_user_id = p_user_id
      OR (
        g.consultant_user_id IS NULL
        AND g.consultant_org_id = (SELECT home_org_id FROM user_home_org)
      )
    )
),

-- Combined permission set with implications applied.
--
-- Four UNION arms; UNION dedupes by ALL projected columns. We project only
-- `(permission_name, scope_path)` — NOT `permission_id` — so the dedupe is
-- defensively robust against a future non-unique `permissions_projection.name`
-- (today the column is uniquely-named per the seed contract, but the function
-- should not rely on that out-of-band invariant). F1 fold-in from Stage R-6
-- step-1+2 architect review 2026-06-01.
--
--   1. Role-source explicit (widest per perm name via inner widest_explicit_role)
--   2. Role-source implications (inheriting the role's widest scope) —
--      UNCONDITIONAL; preserves existing behavior. The default FALSE on
--      permission_implications.propagate_through_grants does NOT gate this
--      arm (gating is grant-scoped only, per Decision B.2).
--   3. Grant-source explicit (at the grant's scope, no widening)
--   4. Grant-source implications (inheriting the grant's scope) — GATED by
--      `pi.propagate_through_grants = true`. Default FALSE → blocks
--      implication-widening for grant-derived permissions (HIPAA least-
--      authority). Each implication row opts in explicitly.
with_implications AS (
  SELECT permission_name, scope_path
  FROM widest_explicit_role

  UNION

  SELECT p2.name, we.scope_path
  FROM widest_explicit_role we
  JOIN public.permission_implications pi ON pi.permission_id = we.permission_id
  JOIN public.permissions_projection p2 ON p2.id = pi.implies_permission_id

  UNION

  SELECT permission_name, scope_path
  FROM grant_derived_perms

  UNION

  SELECT p2.name, gd.scope_path
  FROM grant_derived_perms gd
  JOIN public.permission_implications pi ON pi.permission_id = gd.permission_id
  JOIN public.permissions_projection p2 ON p2.id = pi.implies_permission_id
  WHERE pi.propagate_through_grants = true
),

-- Final deduplication: at-most-one row per (permission_name, scope_path) tuple.
-- This is the load-bearing tightening: pre-Phase-1 the DISTINCT ON was
-- `(permission_name)` only, which collapsed multi-scope entries via LIMIT-1.
-- Post-Phase-1 distinct scope_paths for the same permission name survive,
-- enabling consultant grants to coexist with home-org role assignments at
-- different scopes for the same permission.
--
-- Plain `SELECT DISTINCT` (rather than `DISTINCT ON (...) ORDER BY ...`) is
-- used because both projected columns participate in the dedupe; `DISTINCT`
-- on (name, scope) is exactly the contract the DBC specifies, and avoids
-- the subtle reliance on `permission_id` being uniquely keyed by name that
-- `DISTINCT ON` + arbitrary-tiebreak would otherwise carry (F1 fold-in
-- 2026-06-01).
--
-- Source-tier (role vs grant) is intentionally NOT emitted: the function
-- contract returns (permission_name, effective_scope) only, and downstream
-- JWT consumers tolerate the multi-entry shape via EXISTS/`.some()` checks.
-- See ADR § Non-negotiable invariant: `permissions jsonb` shape and
-- § JWT consumer audit for the duplicate-safe verification across all 5 tiers.
final_effective AS (
  SELECT DISTINCT
    permission_name,
    scope_path AS effective_scope
  FROM with_implications
)

SELECT * FROM final_effective;

$$;

ALTER FUNCTION public.compute_effective_permissions(uuid, uuid) OWNER TO postgres;

COMMENT ON FUNCTION public.compute_effective_permissions(uuid, uuid) IS
  'Computes effective permissions for a user within an organization. '
  'Path B (Phase 1 of cross-tenant-access-grant-rollout): emits role-derived '
  'AND grant-derived permissions in a unified multi-entry-per-permission shape '
  '(distinct scope_paths for the same permission name survive). '
  'Role-source rows widen by nlevel ASC; grant-source rows emit at grant scope '
  'without widening. Implication propagation is unconditional for role-source '
  'rows and gated by permission_implications.propagate_through_grants for '
  'grant-source rows (default false → HIPAA least-authority). '
  'Read path: cross_tenant_access_grants_projection.permissions jsonb directly '
  '(no template join at issuance, per Decision B hybrid snapshot). '
  'Sole caller: public.custom_access_token_hook.';


-- =============================================================================
-- End of Phase 1 migration (drafting in progress — Steps 3-15 pending)
-- =============================================================================
