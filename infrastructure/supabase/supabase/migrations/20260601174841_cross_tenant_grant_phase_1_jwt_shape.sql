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
--   [x] Step 3  — custom_access_token_hook rebase + claims_version=5
--   [x] Step 4  — sync_accessible_organizations_from_grants function + trigger
--                  (+ shared helper recompute_user_accessible_organizations,
--                   + modified existing sync_accessible_organizations for
--                   UNION-canonical invariant)
--   [x] Step 5  — one-time backfill DO-block (helper-based; carries M1)
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
-- Pre-resolve the caller user's accessible organizations array once. Used by
-- the org-wide grant branch below as the canonical membership oracle per
-- PR #66/#67 (post-fold-in M1 fix 2026-06-01: PRIOR DRAFT used
-- `users.current_organization_id` which is the active-session pointer, NOT a
-- membership oracle — a user switched to a different org via switch_organization
-- would be silently excluded from org-wide grants targeting their home org).
-- Returns zero rows when the user is missing or soft-deleted; the org-wide
-- branch then never matches (the ANY against NULL is NULL/false).
-- The `deleted_at IS NULL` filter remains from the prior N2 fold-in.
user_accessible_orgs AS (
  SELECT u.accessible_organizations AS accessible_orgs
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
        AND g.consultant_org_id = ANY(
          (SELECT accessible_orgs FROM user_accessible_orgs)
        )
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
-- Step 3 — custom_access_token_hook rebase + claims_version bump 4 → 5
-- =============================================================================
--
-- Per ADR Phase 1 manifest step 3: rebase the hook on the
-- `20260226002002_organization_manage_page_phase1.sql` body — preserving the
-- org-is-active gate (L113-129), the access_blocked branch shape, and the
-- EXCEPTION WHEN OTHERS branch — and bump claims_version 4 → 5.
--
-- The body is copied verbatim from `20260226002002_*.sql:12-208`. The only
-- behavioral delta is the `claims_version` literal in all four emit sites:
--   1. Access-date access_blocked branch (was L74)
--   2. Org-deactivated access_blocked branch (was L126)
--   3. Happy path (was L181)
--   4. EXCEPTION WHEN OTHERS branch (was L204)
--
-- ADR phrasing "bump claims_version to 5 on the happy path" is the principal
-- intent; this draft bumps ALL FOUR branches for shape-contract consistency.
-- Rationale: consumers cannot tell which branch produced their token; they
-- read `claims_version` to know which JWT shape they're parsing. Mixing v4
-- and v5 across branches forces consumers to handle both shapes for empty
-- arrays — confusing and reachable-by-error. The shape-contract delta is
-- uniform across branches even though only the happy-path branch's
-- effective_permissions actually exercises the new multi-entry possibility;
-- access_blocked / exception branches still emit `[]::jsonb` under the v5
-- shape (empty arrays trivially conform to multi-entry shape).
--
-- Indirect delta (no SQL change here, but consumer-relevant): under v5 the
-- `effective_permissions` array MAY contain multiple `{p, s}` entries with
-- the same `p` value at distinct `s` paths. The PR #68 architect-verified
-- five-tier consumer audit confirmed all readers tolerate this (frontend
-- `.some()`, EF `.some()`, workflows flat-array `.includes()`, PL/pgSQL
-- helpers EXISTS/ANY — all duplicate-safe). The only known unsafe consumer
-- is `public.get_permission_scope` (LIMIT 1) whose two remaining callers
-- ship as Step 7's normalization in this same migration.
--
-- Function attributes preserved verbatim from 20260226002002 body:
--   LANGUAGE plpgsql STABLE SECURITY DEFINER
--   SET search_path TO 'public', 'extensions', 'pg_temp'
--
-- Signature unchanged → CREATE OR REPLACE preserves the OID-keyed
-- COMMENT ON FUNCTION (baseline_v4:7191) and the OWNER. We re-issue a
-- richer comment defensively reflecting the v5 contract.

CREATE OR REPLACE FUNCTION public.custom_access_token_hook(event jsonb)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'extensions', 'pg_temp'
AS $$
DECLARE
  v_user_id uuid;
  v_claims jsonb;
  v_org_id uuid;
  v_org_type text;
  v_org_is_active boolean;
  v_org_access_record record;
  v_access_blocked boolean := false;
  v_access_block_reason text;
  v_effective_permissions jsonb;
  v_current_org_unit_id uuid;
  v_current_org_unit_path text;
BEGIN
  -- Extract user ID from event (Supabase Auth user UUID)
  v_user_id := (event->>'user_id')::uuid;

  -- Get user's current organization and org unit context
  SELECT u.current_organization_id, u.current_org_unit_id
  INTO v_org_id, v_current_org_unit_id
  FROM public.users u
  WHERE u.id = v_user_id;

  -- =========================================================================
  -- ACCESS DATE VALIDATION
  -- =========================================================================

  IF v_org_id IS NOT NULL THEN
    SELECT
      uop.access_start_date,
      uop.access_expiration_date
    INTO v_org_access_record
    FROM public.user_organizations_projection uop
    WHERE uop.user_id = v_user_id
      AND uop.org_id = v_org_id;

    IF v_org_access_record.access_start_date IS NOT NULL
       AND v_org_access_record.access_start_date > CURRENT_DATE THEN
      v_access_blocked := true;
      v_access_block_reason := 'access_not_started';
    END IF;

    IF v_org_access_record.access_expiration_date IS NOT NULL
       AND v_org_access_record.access_expiration_date < CURRENT_DATE THEN
      v_access_blocked := true;
      v_access_block_reason := 'access_expired';
    END IF;
  END IF;

  -- If access is blocked, return minimal claims with blocked flag
  IF v_access_blocked THEN
    RETURN jsonb_build_object(
      'claims',
      COALESCE(event->'claims', '{}'::jsonb) || jsonb_build_object(
        'org_id', v_org_id,
        'org_type', NULL,
        'effective_permissions', '[]'::jsonb,
        'access_blocked', true,
        'access_block_reason', v_access_block_reason,
        'claims_version', 5  -- Phase 1: bumped 4 → 5
      )
    );
  END IF;

  -- =========================================================================
  -- ORGANIZATION CONTEXT RESOLUTION
  -- =========================================================================

  IF v_org_id IS NULL THEN
    SELECT
      CASE
        WHEN EXISTS (
          SELECT 1
          FROM public.user_roles_projection ur
          JOIN public.roles_projection r ON r.id = ur.role_id
          WHERE ur.user_id = v_user_id
            AND r.name = 'super_admin'
            AND ur.organization_id IS NULL
            AND (ur.role_valid_from IS NULL OR ur.role_valid_from <= CURRENT_DATE)
            AND (ur.role_valid_until IS NULL OR ur.role_valid_until >= CURRENT_DATE)
        ) THEN NULL
        ELSE (
          SELECT o.id
          FROM public.organizations_projection o
          WHERE o.type = 'platform_owner'
          LIMIT 1
        )
      END
    INTO v_org_id;
  END IF;

  IF v_org_id IS NULL THEN
    v_org_type := 'platform_owner';
  ELSE
    SELECT o.type::text, o.is_active INTO v_org_type, v_org_is_active
    FROM public.organizations_projection o
    WHERE o.id = v_org_id;

    -- =======================================================================
    -- ORGANIZATION ACTIVE STATUS CHECK
    -- Block access when organization is deactivated or deleted
    -- =======================================================================
    IF NOT COALESCE(v_org_is_active, true) THEN
      RETURN jsonb_build_object(
        'claims',
        COALESCE(event->'claims', '{}'::jsonb) || jsonb_build_object(
          'org_id', v_org_id,
          'org_type', NULL,
          'effective_permissions', '[]'::jsonb,
          'access_blocked', true,
          'access_block_reason', 'organization_deactivated',
          'claims_version', 5  -- Phase 1: bumped 4 → 5
        )
      );
    END IF;
  END IF;

  -- =========================================================================
  -- ORG UNIT CONTEXT (for user-centric workflows)
  -- =========================================================================

  IF v_current_org_unit_id IS NOT NULL THEN
    SELECT ou.path::text INTO v_current_org_unit_path
    FROM public.organization_units_projection ou
    WHERE ou.id = v_current_org_unit_id;
  END IF;

  -- =========================================================================
  -- EFFECTIVE PERMISSIONS (sole permission mechanism)
  -- =========================================================================

  -- Check if user is super_admin (any role named super_admin)
  IF EXISTS (
    SELECT 1
    FROM public.user_roles_projection ur
    JOIN public.roles_projection r ON r.id = ur.role_id
    WHERE ur.user_id = v_user_id
      AND r.name = 'super_admin'
      AND (ur.role_valid_from IS NULL OR ur.role_valid_from <= CURRENT_DATE)
      AND (ur.role_valid_until IS NULL OR ur.role_valid_until >= CURRENT_DATE)
  ) THEN
    -- Super admins get all permissions at root scope (empty string = global)
    SELECT jsonb_agg(
      jsonb_build_object('p', p.name, 's', '')
    )
    INTO v_effective_permissions
    FROM public.permissions_projection p;
  ELSE
    -- Regular users get computed effective permissions with scopes.
    -- Under Phase 1 (v5), this may emit multiple entries with the same `p`
    -- value at distinct `s` paths (role + grant at different scopes, or
    -- multi-scope grants); the materialization to jsonb_agg preserves that.
    SELECT jsonb_agg(
      jsonb_build_object('p', permission_name, 's', COALESCE(effective_scope::text, ''))
    )
    INTO v_effective_permissions
    FROM compute_effective_permissions(v_user_id, v_org_id);
  END IF;

  v_effective_permissions := COALESCE(v_effective_permissions, '[]'::jsonb);

  -- =========================================================================
  -- BUILD CLAIMS (v5 - Path B: role + grant-derived effective permissions)
  -- =========================================================================

  v_claims := COALESCE(event->'claims', '{}'::jsonb) || jsonb_build_object(
    'org_id', v_org_id,
    'org_type', v_org_type,
    'access_blocked', false,
    'claims_version', 5,  -- Phase 1: bumped 4 → 5
    'effective_permissions', v_effective_permissions,
    'current_org_unit_id', v_current_org_unit_id,
    'current_org_unit_path', v_current_org_unit_path
  );

  RETURN jsonb_build_object('claims', v_claims);

EXCEPTION
  WHEN OTHERS THEN
    -- Catches any error in the body (including the new grant-projection read
    -- in compute_effective_permissions — ltree cast failure on malformed
    -- `s` field would land here). Behavior preserved from baseline.
    RAISE WARNING 'JWT hook error for user %: % %',
      v_user_id,
      SQLERRM,
      SQLSTATE;

    -- N3 fold-in 2026-06-01: claims_version placed FIRST so a downstream
    -- consumer that truncates oversized claim payloads (some JWT verifiers
    -- enforce a max-size after which the tail is dropped) still receives the
    -- version marker. claims_error (SQLERRM, unbounded length) is placed
    -- LAST. Defensive against a future truncation regression.
    RETURN jsonb_build_object(
      'claims',
      COALESCE(event->'claims', '{}'::jsonb) || jsonb_build_object(
        'claims_version', 5,  -- Phase 1: bumped 4 → 5
        'org_id', NULL,
        'org_type', NULL,
        'effective_permissions', '[]'::jsonb,
        'access_blocked', false,
        'claims_error', SQLERRM
      )
    );
END;
$$;

ALTER FUNCTION public.custom_access_token_hook(jsonb) OWNER TO postgres;

COMMENT ON FUNCTION public.custom_access_token_hook(jsonb) IS
  'JWT custom claims hook v5 - Path B (role + grant-derived effective permissions). '
  'Phase 1 of cross-tenant-access-grant-rollout: the effective_permissions claim may '
  'contain multiple {p, s} entries with the same `p` value at distinct `s` scope '
  'paths (consultant grants coexisting with home-org role assignments at different '
  'scopes). Consumers MUST use `.some(ep => ep.p === permission)` or equivalent '
  'EXISTS-style checks; never materialize claims into a `{perm: scope}` map. '
  'v5 changes from v4: claims_version bumped 4 → 5 (uniform across all four emit '
  'branches: happy-path, access-date access_blocked, org-deactivated access_blocked, '
  'EXCEPTION). '
  'Per-branch claim shape (preserved from v4; the S1 fold-in 2026-06-01 explicitly '
  'documented rather than normalized): the happy-path branch emits ALL of org_id, '
  'org_type, access_blocked:false, claims_version, effective_permissions, '
  'current_org_unit_id, current_org_unit_path. The two access_blocked branches emit '
  'a MINIMAL claim set: org_id, org_type:NULL, effective_permissions:[]::jsonb, '
  'access_blocked:true, access_block_reason, claims_version — they OMIT '
  'current_org_unit_id/current_org_unit_path because OU context is irrelevant when '
  'access is denied. The EXCEPTION branch emits claims_version, org_id:NULL, '
  'org_type:NULL, effective_permissions:[]::jsonb, access_blocked:false, '
  'claims_error:SQLERRM. Consumers MUST check access_blocked / claims_error before '
  'accessing OU fields; relying on universal field presence violates the v5 contract. '
  'Body otherwise unchanged from 20260226002002_organization_manage_page_phase1.sql '
  '(org-is-active gate, access_blocked branch shape, and exception branch all preserved). '
  'Reads compute_effective_permissions(v_user_id, v_org_id) which under Phase 1 emits '
  'grant-derived permissions alongside role-derived ones (see Step 1 in this migration). '
  'Sole hook registration: Supabase Auth → Hooks → Custom Access Token (Dashboard).';


-- =============================================================================
-- Step 4 — accessible_organizations sync (UNION-canonical: user_orgs + grants)
-- =============================================================================
--
-- Per ADR Phase 1 manifest step 4: a new trigger function
-- `sync_accessible_organizations_from_grants` plus its AFTER INSERT/UPDATE/
-- DELETE trigger on `cross_tenant_access_grants_projection`. Predicate:
-- `status='active' AND (expires_at IS NULL OR expires_at > now())`. Expiration
-- is event-driven via `access_grant.expired` (scheduled workflow), not lazy —
-- the trigger fires when status flips, not when the timestamp passes.
--
-- The DBC contract at plan.md L102-112 requires `public.users.
-- accessible_organizations` be recomputed as the UNION of:
--   (a) orgs sourced from `user_organizations_projection`, AND
--   (b) `provider_org_id`s from active in-window grant rows.
--
-- And the contract's invariant L111 says: "Idempotent: rerun on identical
-- projection state yields identical accessible_organizations".
--
-- ARCHITECTURAL GAP IN THE SPEC (drafter's note 2026-06-01):
-- The existing `public.sync_accessible_organizations` trigger
-- (baseline_v4:11767-11790, on `user_organizations_projection`) currently
-- OVERWRITES `accessible_organizations` with `user_organizations_projection`
-- contents — it does NOT UNION-merge with prior values. Pre-Phase-1 that was
-- correct (grant set was empty). Post-Phase-1 it would erase grant-sourced
-- orgs the next time `user_organizations_projection` changes for a user —
-- violating the L111 idempotency invariant.
--
-- The DBC at L107 references "the existing sync_accessible_organizations
-- trigger" providing source (a), but does not address the inverse: that the
-- existing trigger erases grant-sourced orgs. The architecturally correct fix
-- is to make BOTH triggers compute the same canonical UNION. We extract a
-- shared helper `public.recompute_user_accessible_organizations(p_user_id)`
-- and rewrite both trigger bodies to call it. This expands Step 4's footprint
-- slightly beyond the ADR minimum (adds a helper + rewrites an existing
-- trigger body) but preserves the load-bearing idempotency invariant under
-- any DML sequence.
--
-- The existing `trg_sync_accessible_orgs` trigger on
-- `user_organizations_projection` (baseline_v4:14864) is preserved verbatim
-- because triggers reference functions by name (regprocedure); CREATE OR
-- REPLACE FUNCTION updates the body in-place without re-binding the trigger.

-- -----------------------------------------------------------------------------
-- Step 4a — Shared helper: recompute_user_accessible_organizations(p_user_id)
-- -----------------------------------------------------------------------------
--
-- Recomputes `public.users.accessible_organizations` for a single user as the
-- canonical UNION of:
--   (a) `user_organizations_projection.org_id` rows for the user (membership),
--   (b) `cross_tenant_access_grants_projection.provider_org_id` for active
--       in-window grants addressing the user (user-specific via
--       `consultant_user_id = p_user_id`, or org-wide via
--       `consultant_user_id IS NULL AND consultant_org_id = home_org`).
--
-- Idempotent: re-running on identical projection state yields identical output.
-- Skip-safe for soft-deleted users (deleted_at filter on the UPDATE target).
--
-- SECURITY DEFINER preserves the existing trigger's caller-independence —
-- the helper updates `public.users` from any DML context regardless of RLS.

CREATE OR REPLACE FUNCTION public.recompute_user_accessible_organizations(
  p_user_id uuid
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions', 'pg_temp'
AS $$
DECLARE
  v_accessible_orgs uuid[];
BEGIN
  -- Snapshot the user's accessible_organizations as the canonical membership
  -- oracle for org-wide grant matching (M1 fix 2026-06-01: PRIOR DRAFT used
  -- `current_organization_id` — the active-session pointer, NOT a membership
  -- oracle; a user switched to a different org via switch_organization would
  -- have been silently excluded from org-wide grants targeting their home org).
  -- Returns NULL when the user row is missing or soft-deleted; the org-wide
  -- branch then never matches (ANY against NULL is NULL/false), correctly
  -- excluding such users.
  --
  -- Cyclicity note: this snapshots `accessible_organizations` BEFORE the
  -- UPDATE below recomputes it. The recomputation reads `user_organizations_
  -- projection` and `cross_tenant_access_grants_projection` directly (NOT
  -- `accessible_organizations`), so the post-UPDATE state is canonical.
  SELECT u.accessible_organizations
  INTO v_accessible_orgs
  FROM public.users u
  WHERE u.id = p_user_id
    AND u.deleted_at IS NULL;

  UPDATE public.users
  SET
    accessible_organizations = ARRAY(
      -- ORDER BY org_id makes the output array deterministic, satisfying the
      -- DBC L111 idempotency invariant at array-equality (not just set-equality)
      -- (S2 fix 2026-06-01). Baseline used `array_agg(uop.org_id ORDER BY
      -- uop.created_at)` but that key is unsuitable post-Phase-1 because the
      -- UNION combines two source tables; ORDER BY org_id is the cleanest
      -- deterministic key for the UNIONed set.
      SELECT DISTINCT org_id
      FROM (
        -- (a) Membership via user_organizations_projection
        SELECT uop.org_id
        FROM public.user_organizations_projection uop
        WHERE uop.user_id = p_user_id

        UNION ALL

        -- (b) Active in-window grants addressing this user (either shape).
        --     Org-wide grants use accessible_organizations as the membership
        --     oracle (M1 fix 2026-06-01).
        SELECT g.provider_org_id
        FROM public.cross_tenant_access_grants_projection g
        WHERE g.status = 'active'
          AND (g.expires_at IS NULL OR g.expires_at > now())
          AND (
            g.consultant_user_id = p_user_id
            OR (
              g.consultant_user_id IS NULL
              AND g.consultant_org_id = ANY(v_accessible_orgs)
            )
          )
      ) sources
      ORDER BY org_id
    ),
    updated_at = now()
  WHERE id = p_user_id
    AND deleted_at IS NULL;
END;
$$;

ALTER FUNCTION public.recompute_user_accessible_organizations(uuid) OWNER TO postgres;

COMMENT ON FUNCTION public.recompute_user_accessible_organizations(uuid) IS
  'Recomputes public.users.accessible_organizations for a single user as the '
  'canonical UNION of user_organizations_projection (membership) + active in-window '
  'rows in cross_tenant_access_grants_projection (grants). Called by both the '
  'sync_accessible_organizations trigger (on user_organizations_projection) and the '
  'sync_accessible_organizations_from_grants trigger (on cross_tenant_access_grants_projection); '
  'both triggers maintain the same UNION invariant per plan.md L107-112 DBC. '
  'Idempotent: re-running on identical projection state yields identical output. '
  'Soft-deleted users are skipped (deleted_at filter). '
  'Phase 1 of cross-tenant-access-grant-rollout — step 4a.';


-- -----------------------------------------------------------------------------
-- Step 4b — Modify existing sync_accessible_organizations to call the helper
-- -----------------------------------------------------------------------------
--
-- BEHAVIOR DELTA (this rewrites baseline_v4:11767-11790):
--   - Before: overwrote `accessible_organizations` with `user_organizations_projection`
--     contents only.
--   - After:  delegates to the shared helper, which UNION-merges with active
--     in-window grant rows. Under zero-grant state (today), output is identical
--     to pre-Phase-1 behavior — the UNION arm for (b) contributes nothing.
--
-- The existing trigger `trg_sync_accessible_orgs` (baseline_v4:14864) is
-- preserved verbatim and continues to fire on user_organizations_projection
-- INSERT/UPDATE/DELETE.
--
-- Backward compatibility: pre-Phase-1 callers of this trigger (event handlers
-- that update user_organizations_projection) see no observable behavior change
-- until grants exist. Post-Phase-1, the trigger correctly preserves grant-
-- sourced orgs that the previous overwrite would have erased.

CREATE OR REPLACE FUNCTION public.sync_accessible_organizations()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  target_user_id uuid;
BEGIN
  target_user_id := COALESCE(NEW.user_id, OLD.user_id);
  PERFORM public.recompute_user_accessible_organizations(target_user_id);
  RETURN COALESCE(NEW, OLD);
END;
$$;

COMMENT ON FUNCTION public.sync_accessible_organizations() IS
  'Trigger function: keeps users.accessible_organizations in sync with '
  'user_organizations_projection (membership) UNION cross_tenant_access_grants_projection '
  '(active in-window grants), via shared helper recompute_user_accessible_organizations. '
  'Phase 1 of cross-tenant-access-grant-rollout: body delegates to helper for UNION-canonical '
  'invariant (prior body overwrote with user_organizations_projection only).';


-- -----------------------------------------------------------------------------
-- Step 4c — New sync_accessible_organizations_from_grants trigger function
-- -----------------------------------------------------------------------------
--
-- Fires on `cross_tenant_access_grants_projection` INSERT/UPDATE/DELETE. For
-- each affected user, recomputes `accessible_organizations` via the shared
-- helper.
--
-- Affected user enumeration (M1 fix 2026-06-01: org-wide branch uses the
-- canonical membership oracle accessible_organizations @> [...], NOT the
-- active-session pointer current_organization_id):
--   - INSERT: NEW.consultant_user_id (user-specific) OR all users whose
--     accessible_organizations @> [NEW.consultant_org_id] (org-wide).
--   - UPDATE: UNION of NEW-affected and OLD-affected users. Status flip
--     ('active' → 'revoked') is the common case — both sides resolve to
--     the same user(s) but recomputation reflects the new world.
--   - DELETE: OLD.consultant_user_id (user-specific) OR all users whose
--     accessible_organizations @> [OLD.consultant_org_id] (org-wide).
--
-- Performance note: org-wide grant changes recompute for every user in the
-- consultant org. For consultant orgs with N users, a single grant row change
-- triggers N helper invocations. This is a write-side cost paid only at grant
-- creation/revocation (rare), not at JWT issuance. Acceptable for the typical
-- consultant org size (5-50 users).
--
-- Filtering: the helper itself filters grants by status='active' AND
-- (expires_at IS NULL OR expires_at > now()), so this trigger does NOT need to
-- pre-filter — passing an already-revoked or expired grant just means the
-- helper's UNION arm (b) excludes it. The recomputation is still correct.

CREATE OR REPLACE FUNCTION public.sync_accessible_organizations_from_grants()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions', 'pg_temp'
AS $$
DECLARE
  v_user_ids uuid[] := ARRAY[]::uuid[];
  v_user_id uuid;
BEGIN
  -- Collect affected user IDs from the post-DML row (INSERT, UPDATE).
  IF TG_OP IN ('INSERT', 'UPDATE') THEN
    IF NEW.consultant_user_id IS NOT NULL THEN
      v_user_ids := v_user_ids || NEW.consultant_user_id;
    ELSE
      -- Org-wide grant: all users who are members of NEW.consultant_org_id
      -- per the canonical membership oracle (M1 fix 2026-06-01: PRIOR DRAFT
      -- used `current_organization_id` which is the active-session pointer,
      -- not membership; a user switched to a different org would have been
      -- silently excluded). GIN-indexed via idx_users_accessible_orgs_gin.
      v_user_ids := v_user_ids || ARRAY(
        SELECT u.id
        FROM public.users u
        WHERE u.accessible_organizations @> ARRAY[NEW.consultant_org_id]::uuid[]
          AND u.deleted_at IS NULL
      );
    END IF;
  END IF;

  -- Collect affected user IDs from the pre-DML row (UPDATE, DELETE).
  -- Necessary because UPDATEs can change consultant_user_id / consultant_org_id
  -- (rare but possible per Phase 2 schema), and DELETEs erase the affected set.
  IF TG_OP IN ('UPDATE', 'DELETE') THEN
    IF OLD.consultant_user_id IS NOT NULL THEN
      v_user_ids := v_user_ids || OLD.consultant_user_id;
    ELSE
      v_user_ids := v_user_ids || ARRAY(
        SELECT u.id
        FROM public.users u
        WHERE u.accessible_organizations @> ARRAY[OLD.consultant_org_id]::uuid[]
          AND u.deleted_at IS NULL
      );
    END IF;
  END IF;

  -- Recompute for each unique affected user.
  FOR v_user_id IN SELECT DISTINCT uid FROM unnest(v_user_ids) AS uid LOOP
    IF v_user_id IS NOT NULL THEN
      PERFORM public.recompute_user_accessible_organizations(v_user_id);
    END IF;
  END LOOP;

  RETURN COALESCE(NEW, OLD);
END;
$$;

ALTER FUNCTION public.sync_accessible_organizations_from_grants() OWNER TO postgres;

COMMENT ON FUNCTION public.sync_accessible_organizations_from_grants() IS
  'Trigger function: on INSERT/UPDATE/DELETE of cross_tenant_access_grants_projection '
  'rows, enumerates affected user(s) (user-specific via consultant_user_id, or '
  'org-wide via consultant_org_id) and calls recompute_user_accessible_organizations '
  'for each. UNION-canonical with the existing sync_accessible_organizations trigger '
  'on user_organizations_projection — both maintain users.accessible_organizations as '
  'the UNION of membership + active in-window grants. '
  'Phase 1 of cross-tenant-access-grant-rollout — step 4c.';


-- -----------------------------------------------------------------------------
-- Step 4d — Trigger binding on cross_tenant_access_grants_projection
-- -----------------------------------------------------------------------------
--
-- AFTER INSERT/UPDATE/DELETE per the DBC pre-condition (DML-row trigger, not
-- statement-level). Idempotent under re-CREATE via OR REPLACE (PG 14+).

CREATE OR REPLACE TRIGGER trg_sync_accessible_orgs_from_grants
  AFTER INSERT OR UPDATE OR DELETE ON public.cross_tenant_access_grants_projection
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_accessible_organizations_from_grants();


-- =============================================================================
-- Step 5 — One-time backfill of accessible_organizations from existing grants
-- =============================================================================
--
-- Per ADR Phase 1 manifest step 5: a DO-block within this transactional
-- migration that walks existing active in-window grants and recomputes
-- `users.accessible_organizations` for each affected user.
--
-- Drafter's note 2026-06-01: the ADR sketch (L505-528) does the UNION inline
-- with a hand-written `accessible_organizations || r.grant_orgs` join. This
-- draft uses the Step 4a helper (`recompute_user_accessible_organizations`)
-- instead. Three benefits:
--
--   1. M1 fix carried forward automatically. The helper uses the canonical
--      `accessible_organizations @>` membership oracle for org-wide grants
--      (NOT the active-session pointer `current_organization_id`). The ADR
--      sketch's `g.consultant_org_id = u.current_organization_id` would re-
--      introduce the M1 defect; this draft avoids that by routing through
--      the helper (architect explicitly flagged in the Step 3+4 review).
--   2. S2 fix carried forward automatically. The helper's UPDATE uses
--      `ORDER BY org_id` for deterministic array output (DBC L111
--      idempotency at array-equality level).
--   3. Single source of truth. Per the CLAUDE.md § accessible_organizations
--      canonical membership oracle convention codified in the Step 3+4 N1
--      fold-in: "Never write users.accessible_organizations directly — route
--      through the helper". This backfill obeys that rule.
--
-- The user-selection SELECT must STILL apply the M1 fix in its own WHERE
-- clause because it filters BEFORE delegating to the helper. The org-wide
-- match uses `consultant_org_id = ANY(u.accessible_organizations)` for the
-- same reason — and at backfill time `accessible_organizations` is in its
-- pre-Phase-1 state (UOP-only, per the original sync_accessible_organizations
-- trigger overwrite behavior), so the predicate is structurally equivalent to
-- "is U a UOP-member of consultant_org" at that point. After Step 4's body
-- rewrite takes effect, future user_organizations_projection changes
-- correctly maintain the UNION via the helper.
--
-- Idempotency: the helper is idempotent (re-running on identical projection
-- state yields identical output); the SELECT is set-based (uses DISTINCT).
-- Re-running this DO-block on the same input state yields identical result.
--
-- Pre-flight context (Stage B probe 2026-05-29): `cross_tenant_access_grants_
-- projection` row count on dev = 0. The backfill loop iterates zero times on
-- dev today — a no-op. Will populate when the projection has real grants
-- (Phase 2+ on prod, or seeded test data on dev for Stage E smoke).
--
-- Deploy-time observability: RAISE NOTICE at the end emits the recomputed
-- user count to the migration log for ops visibility.

DO $$
DECLARE
  v_user_id            uuid;
  v_recomputed_count   integer := 0;
BEGIN
  FOR v_user_id IN (
    SELECT DISTINCT u.id
    FROM public.users u
    JOIN public.cross_tenant_access_grants_projection g
      ON (
        -- User-specific grant addressing
        g.consultant_user_id = u.id
        OR
        -- Org-wide grant addressing (M1: accessible_organizations as
        -- canonical membership oracle, NOT current_organization_id).
        -- At backfill time accessible_organizations is UOP-only per the
        -- pre-rewrite sync_accessible_organizations trigger semantics,
        -- so this correctly identifies UOP-members of consultant_org.
        (
          g.consultant_user_id IS NULL
          AND g.consultant_org_id = ANY(u.accessible_organizations)
        )
      )
    WHERE g.status = 'active'
      AND (g.expires_at IS NULL OR g.expires_at > now())
      AND u.deleted_at IS NULL
  ) LOOP
    PERFORM public.recompute_user_accessible_organizations(v_user_id);
    v_recomputed_count := v_recomputed_count + 1;
  END LOOP;

  RAISE NOTICE
    'Phase 1 Step 5 backfill: recomputed accessible_organizations for % '
    'user(s) with active in-window grants.',
    v_recomputed_count;
END $$;


-- =============================================================================
-- End of Phase 1 migration (drafting in progress — Steps 6-15 pending)
-- =============================================================================
