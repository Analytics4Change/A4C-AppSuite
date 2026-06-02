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
--   [x] Step 6  — composite partial index on cross_tenant_access_grants_projection
--   [x] Step 7  — 10 C-legacy RPC normalizations (must-pair with Step 1)
--   [x] Step 8  — M3 RPC Shape Registry re-tag for the 10 normalized RPCs
--   [x] Step 9  — authorization_type CHECK constraint (5 values)
--   [x] Step 10 — access_grant.policy_override_applied handler + perm-defined events
--   [x] Step 11 — 170-RPC @a4c-bucket/@a4c-consultant-callable/@a4c-phase-target backfill
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
-- match uses the canonical `accessible_organizations @> ARRAY[<org_id>]`
-- containment form (GIN-indexable via `idx_users_accessible_orgs_gin`) — at
-- backfill time `accessible_organizations` is in its pre-Phase-1 state
-- (UOP-only, per the original sync_accessible_organizations trigger overwrite
-- behavior), so the predicate is structurally equivalent to "is U a UOP-member
-- of consultant_org" at that point. After Step 4's body rewrite takes effect,
-- future user_organizations_projection changes correctly maintain the UNION
-- via the helper.
--
-- Why the pre-Phase-1 state assumption holds inside the migration (N1 fold-in
-- 2026-06-01 step-5+6 architect review): Steps 1-4 execute zero DML on
-- `user_organizations_projection` or `cross_tenant_access_grants_projection`.
-- Step 4's `CREATE OR REPLACE FUNCTION sync_accessible_organizations()`
-- rewrites the function body via DDL (takes effect immediately for subsequent
-- statements), but the trigger that binds the function only fires on
-- INSERT/UPDATE/DELETE of user_organizations_projection — and no such DML runs
-- between Step 4's rewrite landing and Step 5's DO-block executing. The
-- rewritten body becomes effective only for future writes after deploy. This
-- transactional design is load-bearing — inserting any UOP DML between Step 4
-- and Step 5 would invalidate the pre-Phase-1 state assumption.
--
-- F2 invariant (step-5+6 architect review 2026-06-01): the user-selection
-- WHERE clause below MUST match the affected-user enumeration in Step 4c's
-- `sync_accessible_organizations_from_grants` trigger function (L835-880)
-- VERBATIM in structure. Step 5 (one-shot backfill) and Step 4c (live trigger)
-- are the two sites that resolve `org-wide-grant → eligible-users`. If their
-- predicates drift, future maintenance could leave the projection in a state
-- where the backfill says user U should have provider_org P but the trigger
-- fires and disagrees. Drift-detection: re-grep both sites whenever either is
-- modified.
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
  v_eligible_count     integer;
BEGIN
  -- Pre-loop count for deploy-time observability (N3 fold-in 2026-06-01).
  -- Operators see "about to recompute N user(s)" before the LOOP runs;
  -- catches off-by-N bugs in the predicate during Stage E smoke.
  -- Precedent: `20260424182345_add_missing_user_lifecycle_handlers_*` uses
  -- the count-first pattern.
  SELECT COUNT(DISTINCT u.id)
  INTO v_eligible_count
  FROM public.users u
  JOIN public.cross_tenant_access_grants_projection g
    ON (
      g.consultant_user_id = u.id
      OR (
        g.consultant_user_id IS NULL
        AND u.accessible_organizations @> ARRAY[g.consultant_org_id]::uuid[]
      )
    )
  WHERE g.status = 'active'
    AND (g.expires_at IS NULL OR g.expires_at > now())
    AND u.deleted_at IS NULL;

  RAISE NOTICE
    'Phase 1 Step 5 backfill: about to recompute accessible_organizations '
    'for % user(s) with active in-window grants...',
    v_eligible_count;

  FOR v_user_id IN (
    SELECT DISTINCT u.id
    FROM public.users u
    JOIN public.cross_tenant_access_grants_projection g
      ON (
        -- User-specific grant addressing
        g.consultant_user_id = u.id
        OR
        -- Org-wide grant addressing — canonical `@>` containment form per
        -- infrastructure/supabase/CLAUDE.md § accessible_organizations is the
        -- canonical membership oracle. GIN-indexable via
        -- idx_users_accessible_orgs_gin (created PR #66). F1 fix 2026-06-01
        -- step-5+6 architect review: PRIOR DRAFT used `consultant_org_id =
        -- ANY(u.accessible_organizations)` — the codified anti-pattern that
        -- cannot use GIN `array_ops`. Same drift class as M1; rewrite to the
        -- containment form mirrors Step 4c's trigger predicate verbatim.
        -- At backfill time, accessible_organizations is UOP-only per the
        -- pre-rewrite sync_accessible_organizations trigger semantics, so
        -- this correctly identifies UOP-members of consultant_org.
        (
          g.consultant_user_id IS NULL
          AND u.accessible_organizations @> ARRAY[g.consultant_org_id]::uuid[]
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
    'user(s) (eligible count was %; mismatch indicates predicate drift).',
    v_recomputed_count,
    v_eligible_count;
END $$;


-- =============================================================================
-- Step 6 — Composite partial index closing the auth-hook query gap
-- =============================================================================
--
-- Per ADR Phase 1 manifest step 6 + plan.md N1 fold-in (both indexes stay):
--
--   `CREATE INDEX idx_access_grants_consultant_user_status_partial
--    ON public.cross_tenant_access_grants_projection (consultant_user_id, status)
--    WHERE status='active';`
--
-- Existing index landscape (baseline_v4:14095-14131):
--   - idx_access_grants_authorization_type — by authorization_type
--   - idx_access_grants_consultant_org      — by consultant_org_id (full)
--   - idx_access_grants_consultant_user     — partial on (consultant_user_id)
--                                             WHERE consultant_user_id IS NOT NULL
--                                             [serves user-keyed lookups; does NOT
--                                              encode status filter]
--   - idx_access_grants_expires             — partial on (expires_at, status)
--                                             WHERE expires_at IS NOT NULL
--                                             AND status IN ('active','suspended')
--   - idx_access_grants_granted_by          — by (granted_by, granted_at)
--   - idx_access_grants_lookup              — partial on (consultant_org_id,
--                                             provider_org_id, status)
--                                             WHERE status='active' [serves the
--                                             org+provider pair lookup; does NOT
--                                             leading-column on consultant_user_id]
--   - idx_access_grants_provider_org        — by provider_org_id (full)
--   - idx_access_grants_scope               — by scope (full)
--   - idx_access_grants_status              — by status (full)
--   - idx_access_grants_suspended           — partial on (expected_resolution_date)
--                                             WHERE status='suspended'
--
-- The auth-hook's user-specific query in Step 1's compute_effective_permissions:
--
--   WHERE g.consultant_user_id = p_user_id
--     AND g.status = 'active'
--     AND (g.expires_at IS NULL OR g.expires_at > now())
--
-- Neither existing index serves this with a single index scan. PostgreSQL's
-- planner would bitmap-AND `idx_access_grants_consultant_user` against
-- `idx_access_grants_status`, which is materially slower than the new partial
-- composite (N2 fold-in 2026-06-01 step-5+6 architect review):
--   - idx_access_grants_consultant_user finds user matches but requires reading
--     ALL such rows (including historically revoked/expired grants for the same
--     user over their grant lifetime), then filtering by status in the bitmap
--     stage.
--   - idx_access_grants_status finds all status='active' rows globally
--     (potentially large in steady state) but does NOT leading-column on
--     consultant_user_id; lookups by user require reading the full active set.
--   - Bitmap-AND of the two index reads + intersection + heap-fetch the
--     intersection. Steady-state cost: O(|user's grant lifetime|) +
--     O(|all active grants|) index page reads, vs O(|user's active grants|)
--     for the new partial composite.
-- Auth-hook latency matters disproportionately per ADR § Performance and
-- JWT-size considerations (hook runs on every token refresh; amortization
-- across hot path is poor). Concrete EXPLAIN ANALYZE evidence for the new
-- partial vs. bitmap-AND alternative TBD in Phase 1 UAT (per ADR L586).
--
-- The new partial index leading-columns on consultant_user_id AND pre-filters
-- status='active' via the partial predicate. Auth-hook lookup becomes:
--   1. Index scan on (consultant_user_id=p_user_id) — pre-filtered to active rows
--   2. Heap fetch for permissions jsonb + expires_at filter
--
-- The `status` column is included in the index key (not just the partial
-- predicate) per the ADR's spec. Technically redundant given the partial WHERE
-- (every indexed row has status='active'), but: (a) matches the ADR-specified
-- shape verbatim, (b) enables index-only scans for future queries that need to
-- check status without heap fetch, (c) negligible storage cost (one short-text
-- column per active row).
--
-- Per plan.md N1: BOTH indexes stay (existing idx_access_grants_consultant_user
-- serves user-keyed lookups regardless of status; this new index serves the
-- auth-hook's (consultant_user_id, status='active') access pattern). They are
-- not redundant — the partial-WHERE predicates are different and address
-- different query shapes.
--
-- Org-wide query (consultant_user_id IS NULL AND consultant_org_id = ANY(...))
-- is served by the existing idx_access_grants_lookup (partial on
-- consultant_org_id WHERE status='active') — no new index needed for that
-- branch.
--
-- Idempotent: CREATE INDEX IF NOT EXISTS skips if already present.
-- Note: regular CREATE INDEX (not CONCURRENTLY) because CONCURRENTLY cannot
-- run within a transaction. Brief ACCESS EXCLUSIVE lock during creation;
-- acceptable given the projection is currently small (Stage B probe 2026-05-29
-- confirmed 0 rows on dev). Phase 2+ prod deployment timing is a future concern.

CREATE INDEX IF NOT EXISTS idx_access_grants_consultant_user_status_partial
  ON public.cross_tenant_access_grants_projection (consultant_user_id, status)
  WHERE status = 'active';

COMMENT ON INDEX public.idx_access_grants_consultant_user_status_partial IS
  'Composite partial index closing the auth-hook query gap (Phase 1 step 6 of '
  'cross-tenant-access-grant-rollout). Leading-columns on consultant_user_id '
  'with status pre-filtered to ''active'' via partial predicate. Serves the '
  'user-specific branch of compute_effective_permissions.grant_derived_perms '
  '(WHERE g.consultant_user_id = p_user_id AND g.status = ''active''). '
  'Complements (does not replace) idx_access_grants_consultant_user (partial '
  'on consultant_user_id IS NOT NULL) which serves user-keyed lookups '
  'irrespective of status. Org-wide queries (consultant_user_id IS NULL) '
  'continue to use idx_access_grants_lookup on (consultant_org_id, '
  'provider_org_id, status) WHERE status=''active''.';


-- =============================================================================
-- Step 7 — 10 C-legacy RPC normalizations (operational-tripwire must-pair set)
-- =============================================================================
--
-- Per ADR Phase 1 manifest step 7 + plan.md constraint #7 (F2 fold-in):
-- normalize 10 RPCs that use the legacy two-step `get_permission_scope +
-- manual @>` pattern to single `has_effective_permission(perm, path)` calls.
--
-- WHY THIS MUST SHIP IN THE SAME TRANSACTION AS STEP 1:
-- Step 1 tightens `compute_effective_permissions`'s outer DISTINCT ON from
-- `(permission_name)` to `(permission_name, scope_path)`. Under multi-entry-
-- per-permission shape, `get_permission_scope(perm)` (LIMIT 1) returns an
-- arbitrary winner from the user's matching scope entries. The legacy
-- two-step `v_user_scope @> p_scope_path` check then breaks intermittently
-- for multi-scope users — depending on the LIMIT-1 pick.
--
-- Replacing the two-step pattern with `has_effective_permission(perm, path)`
-- (an EXISTS over `effective_permissions` JWT claim) closes the tripwire:
-- the check correctly ORs across ALL matching entries, forward-compatible
-- with multi-scope grants under Phase 1.
--
-- ORDERING (per plan.md constraint #7 / F2 ordering):
--   7.1-7.5  5 OU mutators (create, update, delete, deactivate, reactivate)
--   7.6-7.7  2 role-management mutations (bulk_assign_role, sync_role_assignments)
--   7.8-7.10 3 OU readers (get_organization_unit_by_id, _descendants, _units)
--
-- SHAPE PRESERVATION:
-- Each RPC's signature, return shape, envelope (success/error), error codes,
-- event emission, and Pattern A v2 readback are preserved verbatim. The only
-- change is the permission gate. Signatures unchanged → OID-keyed
-- COMMENT ON FUNCTION + @a4c-rpc-shape tags are preserved by CREATE OR REPLACE
-- (defensively re-issued in Step 8 anyway per the M3 DROP+CREATE re-tag rule).
--
-- NORMALIZATION PATTERNS:
-- For RPCs with `p_unit_id` lookup, the permission predicate is FOLDED INTO
-- the entity-fetch query — preserves the NOT_FOUND-for-both-cases envelope
-- semantic (does not leak existence vs permission-denied to the caller):
--
--   SELECT * INTO v_existing
--   FROM organization_units_projection ou
--   WHERE ou.id = p_unit_id
--     AND ou.deleted_at IS NULL
--     AND public.has_effective_permission('organization.<verb>_ou', ou.path);
--
--   IF v_existing IS NULL THEN
--     RETURN <NOT_FOUND envelope>;
--   END IF;
--
-- For RPCs with `p_scope_path` parameter (role mutations + sister RPCs from
-- PR #67), the permission check is up-front:
--
--   IF NOT public.has_effective_permission('user.role_assign', p_scope_path) THEN
--     RAISE EXCEPTION 'Missing permission: ...' USING ERRCODE = 'insufficient_privilege';
--   END IF;
--
-- For `create_organization_unit` (no p_unit_id; takes optional p_parent_id),
-- parent's path is resolved first, then permission checked at parent's path.
-- When p_parent_id IS NULL, the user's current_org_id (active session) is the
-- disambiguator for which root to create under — the PRIOR draft used
-- `subpath(v_scope_path, 0, 2)` to derive root from the permission scope,
-- which is incompatible with multi-scope grants (the LIMIT-1 pick could
-- be any of several roots the user has create_ou at).
--
-- For OU readers without an entity-id input (get_organization_units), the
-- WHERE predicate uses `has_effective_permission` per row. This is one
-- function call per result row, bounded by JWT entry count (~40-60 elements);
-- each row pays a deterministic small EXISTS cost. Acceptable for typical OU
-- tree sizes (tens of OUs, not thousands). F6 fold-in 2026-06-01 architect
-- review: prior draft claimed this was "cheaper than the two-step's per-row
-- ltree containment" which is not strictly true (the two-step had
-- v_user_scope pre-resolved at function entry; the new pattern iterates JWT
-- per row). The correct framing is bounded-cost-per-row + correctness under
-- multi-scope, not cheaper.
--
-- DECLARE delta: `v_scope_path extensions.ltree;` (or `LTREE`) declarations
-- are REMOVED from each function since the variable is no longer used.


-- -----------------------------------------------------------------------------
-- Step 7.1 — api.create_organization_unit
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION api.create_organization_unit(
  p_parent_id    uuid DEFAULT NULL,
  p_name         text DEFAULT NULL,
  p_display_name text DEFAULT NULL,
  p_timezone     text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'extensions', 'pg_temp'
AS $_$
DECLARE
  v_parent_path     ltree;
  v_parent_timezone text;
  v_root_org_id     uuid;
  v_new_path        ltree;
  v_new_id          uuid;
  v_slug            text;
  v_event_id        uuid;
  v_stream_version  integer;
  v_result          record;
  v_processing_error text;
  v_current_org_id  uuid;
BEGIN
  -- Validate required fields
  IF p_name IS NULL OR trim(p_name) = '' THEN
    RAISE EXCEPTION 'Name is required'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  -- Resolve the parent path FIRST. When p_parent_id IS NULL, disambiguate via
  -- the user's active org (get_current_org_id) — under multi-scope grants the
  -- user could have organization.create_ou at multiple distinct roots, and
  -- the active-session pointer is the canonical disambiguator. Permission is
  -- then checked at the resolved parent path.
  --
  -- N1 fold-in 2026-06-01 architect review: partner consultants with
  -- multi-scope create_ou (e.g., home + grant target) MUST explicitly pass
  -- p_parent_id to create under a non-active-session root; the NULL-parent
  -- path always uses the active session as the deterministic disambiguator.
  -- This is intentional — implicit-root creation is for the org-owner case,
  -- not the consultant-acting-on-grant case.
  --
  -- N3 note 2026-06-01: when v_current_org_id IS NULL (no active session),
  -- the function raises with ERRCODE 'invalid_parameter_value' (vs the prior
  -- body's 'insufficient_privilege'). This is a new error branch; the prior
  -- body would have reached this path only via get_permission_scope=NULL.
  IF p_parent_id IS NULL THEN
    v_current_org_id := public.get_current_org_id();
    IF v_current_org_id IS NULL THEN
      RAISE EXCEPTION 'No active organization context'
        USING ERRCODE = 'invalid_parameter_value';
    END IF;

    SELECT o.id, o.path, o.timezone
    INTO v_root_org_id, v_parent_path, v_parent_timezone
    FROM public.organizations_projection o
    WHERE o.id = v_current_org_id
      AND o.deleted_at IS NULL;

    IF v_root_org_id IS NULL THEN
      RETURN jsonb_build_object(
        'success', false,
        'error', 'Root organization not found',
        'errorDetails', jsonb_build_object(
          'code', 'NOT_FOUND',
          'message', 'Could not find root organization for active session'
        )
      );
    END IF;
  ELSE
    -- p_parent_id provided: look up the parent (org or sub-OU). The two
    -- SELECTs probe organizations_projection then organization_units_projection.
    SELECT o.path, o.timezone INTO v_parent_path, v_parent_timezone
    FROM public.organizations_projection o
    WHERE o.id = p_parent_id
      AND o.deleted_at IS NULL;

    IF v_parent_path IS NULL THEN
      SELECT ou.path, ou.timezone INTO v_parent_path, v_parent_timezone
      FROM public.organization_units_projection ou
      WHERE ou.id = p_parent_id
        AND ou.deleted_at IS NULL;
    END IF;

    IF v_parent_path IS NULL THEN
      RETURN jsonb_build_object(
        'success', false,
        'error', 'Parent organization not found or not accessible',
        'errorDetails', jsonb_build_object(
          'code', 'NOT_FOUND',
          'message', 'Parent organization not found'
        )
      );
    END IF;

    -- Resolve root org for the parent path (used as `organization_id` in event).
    SELECT o.id INTO v_root_org_id
    FROM public.organizations_projection o
    WHERE o.path = subpath(v_parent_path, 0, 1)
      AND o.deleted_at IS NULL;

    IF v_root_org_id IS NULL THEN
      RETURN jsonb_build_object(
        'success', false,
        'error', 'Root organization not found',
        'errorDetails', jsonb_build_object(
          'code', 'NOT_FOUND',
          'message', 'Could not resolve root org for parent path'
        )
      );
    END IF;

    -- Inactive-parent guard preserved verbatim.
    IF EXISTS (
      SELECT 1 FROM public.organization_units_projection
      WHERE path = v_parent_path AND is_active = false AND deleted_at IS NULL
    ) THEN
      RETURN jsonb_build_object(
        'success', false,
        'error', 'Cannot create sub-unit under inactive parent',
        'errorDetails', jsonb_build_object(
          'code', 'PARENT_INACTIVE',
          'message', 'Reactivate the parent organization unit first'
        )
      );
    END IF;
  END IF;

  -- Permission gate at the resolved parent path. has_effective_permission is
  -- forward-compatible with multi-scope grants (EXISTS over JWT claim entries).
  IF NOT public.has_effective_permission('organization.create_ou', v_parent_path) THEN
    -- NOT_FOUND-style envelope (not RAISE EXCEPTION) preserves the prior
    -- two-step behavior of returning a not-found envelope when the parent
    -- was outside scope. Convention matches the entity-fetch-with-permission
    -- pattern used in update/delete/deactivate/reactivate.
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Parent organization not found or not accessible',
      'errorDetails', jsonb_build_object(
        'code', 'NOT_FOUND',
        'message', 'Parent organization not found or outside your permission scope'
      )
    );
  END IF;

  -- Generate slug from name
  v_slug := lower(regexp_replace(trim(p_name), '[^a-zA-Z0-9]+', '_', 'g'));
  v_slug := regexp_replace(v_slug, '^_+|_+$', '', 'g');

  -- Generate new path
  v_new_path := v_parent_path || v_slug::ltree;

  -- Check for duplicate path
  IF EXISTS (
    SELECT 1 FROM public.organizations_projection WHERE path = v_new_path AND deleted_at IS NULL
    UNION ALL
    SELECT 1 FROM public.organization_units_projection WHERE path = v_new_path AND deleted_at IS NULL
  ) THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'An organizational unit with this name already exists under the same parent',
      'errorDetails', jsonb_build_object(
        'code', 'DUPLICATE_NAME',
        'message', format('Unit "%s" already exists under this parent', p_name)
      )
    );
  END IF;

  v_new_id := gen_random_uuid();
  v_event_id := gen_random_uuid();
  v_stream_version := 1;

  INSERT INTO public.domain_events (
    id, stream_id, stream_type, stream_version,
    event_type, event_data, event_metadata
  ) VALUES (
    v_event_id,
    v_new_id,
    'organization_unit',
    v_stream_version,
    'organization_unit.created',
    jsonb_build_object(
      'organization_unit_id', v_new_id,
      'name', trim(p_name),
      'display_name', COALESCE(trim(p_display_name), trim(p_name)),
      'slug', v_slug,
      'path', v_new_path::text,
      'parent_path', v_parent_path::text,
      'timezone', COALESCE(p_timezone, v_parent_timezone, 'America/Denver'),
      'organization_id', v_root_org_id,
      'is_active', true
    ),
    jsonb_build_object(
      'user_id', public.get_current_user_id(),
      'source', 'api.create_organization_unit',
      'timestamp', now()
    )
  );

  SELECT * INTO v_result
  FROM public.organization_units_projection
  WHERE id = v_new_id;

  -- F4 fold-in 2026-06-01 architect review: canonical Pattern A v2
  -- form WHERE id = v_event_id (replaces legacy stream_id+event_type+ORDER BY
  -- LIMIT 1 form which had concurrency-race exposure under retry storms).
  IF NOT FOUND THEN
    SELECT processing_error INTO v_processing_error
    FROM public.domain_events
    WHERE id = v_event_id;

    RETURN jsonb_build_object(
      'success', false,
      'error', COALESCE(v_processing_error, 'Projection not found after event processing'),
      'errorDetails', jsonb_build_object(
        'code', 'PROCESSING_ERROR',
        'message', 'The event was recorded but the handler failed. Check domain_events for details.'
      )
    );
  END IF;

  -- F5 fold-in 2026-06-01 architect review: Pattern A v2 race-safe second
  -- check (handler-mid-update silent-failure protection). Required by
  -- CLAUDE.md § Pattern A v2 canonical form.
  SELECT processing_error INTO v_processing_error
  FROM public.domain_events WHERE id = v_event_id;
  IF v_processing_error IS NOT NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Event processing failed: ' || v_processing_error,
      'errorDetails', jsonb_build_object(
        'code', 'PROCESSING_ERROR',
        'message', 'The event was recorded but the handler failed. Check domain_events for details.'
      )
    );
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'unit', jsonb_build_object(
      'id', v_result.id,
      'name', v_result.name,
      'displayName', v_result.display_name,
      'path', v_result.path::text,
      'parentPath', v_result.parent_path::text,
      'timeZone', v_result.timezone,
      'isActive', v_result.is_active,
      'isRootOrganization', false,
      'createdAt', v_result.created_at,
      'updatedAt', v_result.updated_at
    )
  );
END;
$_$;


-- -----------------------------------------------------------------------------
-- Step 7.2 — api.update_organization_unit
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION api.update_organization_unit(
  p_unit_id      uuid,
  p_name         text DEFAULT NULL,
  p_display_name text DEFAULT NULL,
  p_timezone     text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'extensions', 'pg_temp'
AS $$
DECLARE
  v_existing         record;
  v_event_id         uuid;
  v_stream_version   integer;
  v_updated_fields   text[];
  v_previous_values  jsonb;
  v_result           record;
  v_processing_error text;
BEGIN
  -- Fetch the OU with permission predicate folded into the WHERE clause.
  -- Preserves the NOT_FOUND-for-both-cases envelope (does not leak existence
  -- vs permission-denied).
  SELECT * INTO v_existing
  FROM public.organization_units_projection ou
  WHERE ou.id = p_unit_id
    AND ou.deleted_at IS NULL
    AND public.has_effective_permission('organization.update_ou', ou.path);

  IF v_existing IS NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Organizational unit not found',
      'errorDetails', jsonb_build_object(
        'code', 'NOT_FOUND',
        'message', 'Unit not found or outside your scope. Note: Root organizations use different update path.'
      )
    );
  END IF;

  v_updated_fields := ARRAY[]::text[];
  v_previous_values := '{}'::jsonb;

  IF p_name IS NOT NULL AND p_name != v_existing.name THEN
    v_updated_fields := array_append(v_updated_fields, 'name');
    v_previous_values := v_previous_values || jsonb_build_object('name', v_existing.name);
  END IF;

  IF p_display_name IS NOT NULL AND p_display_name != v_existing.display_name THEN
    v_updated_fields := array_append(v_updated_fields, 'display_name');
    v_previous_values := v_previous_values || jsonb_build_object('display_name', v_existing.display_name);
  END IF;

  IF p_timezone IS NOT NULL AND p_timezone != v_existing.timezone THEN
    v_updated_fields := array_append(v_updated_fields, 'timezone');
    v_previous_values := v_previous_values || jsonb_build_object('timezone', v_existing.timezone);
  END IF;

  IF array_length(v_updated_fields, 1) IS NULL THEN
    RETURN jsonb_build_object(
      'success', true,
      'unit', jsonb_build_object(
        'id', v_existing.id,
        'name', v_existing.name,
        'displayName', v_existing.display_name,
        'path', v_existing.path::text,
        'parentPath', v_existing.parent_path::text,
        'timeZone', v_existing.timezone,
        'isActive', v_existing.is_active,
        'isRootOrganization', false,
        'createdAt', v_existing.created_at,
        'updatedAt', v_existing.updated_at
      )
    );
  END IF;

  v_event_id := gen_random_uuid();

  SELECT COALESCE(MAX(stream_version), 0) + 1 INTO v_stream_version
  FROM public.domain_events
  WHERE stream_id = p_unit_id AND stream_type = 'organization_unit';

  INSERT INTO public.domain_events (
    id, stream_id, stream_type, stream_version,
    event_type, event_data, event_metadata
  ) VALUES (
    v_event_id,
    p_unit_id,
    'organization_unit',
    v_stream_version,
    'organization_unit.updated',
    jsonb_build_object(
      'organization_unit_id', p_unit_id,
      'name', COALESCE(p_name, v_existing.name),
      'display_name', COALESCE(p_display_name, v_existing.display_name),
      'timezone', COALESCE(p_timezone, v_existing.timezone),
      'updatable_fields', to_jsonb(v_updated_fields),
      'previous_values', v_previous_values
    ),
    jsonb_build_object(
      'user_id', public.get_current_user_id(),
      'source', 'api.update_organization_unit',
      'timestamp', now()
    )
  );

  SELECT * INTO v_result
  FROM public.organization_units_projection
  WHERE id = p_unit_id;

  IF NOT FOUND THEN
    SELECT processing_error INTO v_processing_error
    FROM public.domain_events WHERE id = v_event_id;
    RETURN jsonb_build_object(
      'success', false,
      'error', COALESCE(v_processing_error, 'Projection not found after event processing'),
      'errorDetails', jsonb_build_object(
        'code', 'PROCESSING_ERROR',
        'message', 'The event was recorded but the handler failed. Check domain_events for details.'
      )
    );
  END IF;

  -- Pattern A v2 race-safe check
  SELECT processing_error INTO v_processing_error
  FROM public.domain_events WHERE id = v_event_id;
  IF v_processing_error IS NOT NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Event processing failed: ' || v_processing_error,
      'errorDetails', jsonb_build_object(
        'code', 'PROCESSING_ERROR',
        'message', 'The event was recorded but the handler failed. Check domain_events for details.'
      )
    );
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'unit', jsonb_build_object(
      'id', v_result.id,
      'name', v_result.name,
      'displayName', v_result.display_name,
      'path', v_result.path::text,
      'parentPath', v_result.parent_path::text,
      'timeZone', v_result.timezone,
      'isActive', v_result.is_active,
      'isRootOrganization', false,
      'createdAt', v_result.created_at,
      'updatedAt', v_result.updated_at
    )
  );
END;
$$;


-- -----------------------------------------------------------------------------
-- Step 7.3 — api.delete_organization_unit
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION api.delete_organization_unit(p_unit_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'extensions', 'pg_temp'
AS $$
DECLARE
  v_existing         record;
  v_child_count      integer;
  v_role_count       integer;
  v_event_id         uuid;
  v_stream_version   integer;
  v_result           record;
  v_processing_error text;
BEGIN
  SELECT * INTO v_existing
  FROM public.organization_units_projection ou
  WHERE ou.id = p_unit_id
    AND ou.deleted_at IS NULL
    AND public.has_effective_permission('organization.delete_ou', ou.path);

  IF v_existing IS NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Organizational unit not found',
      'errorDetails', jsonb_build_object(
        'code', 'NOT_FOUND',
        'message', 'Unit not found or outside your scope. Root organizations cannot be deleted via this function.'
      )
    );
  END IF;

  -- Check for active children
  SELECT COUNT(*) INTO v_child_count
  FROM public.organization_units_projection
  WHERE parent_path = v_existing.path
    AND deleted_at IS NULL;

  IF v_child_count > 0 THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', format('Cannot delete: %s child unit(s) exist', v_child_count),
      'errorDetails', jsonb_build_object(
        'code', 'HAS_CHILDREN',
        'count', v_child_count,
        'message', format('This unit has %s child unit(s). Delete or move them first.', v_child_count)
      )
    );
  END IF;

  -- Check for role assignments at or below this OU's scope
  SELECT COUNT(*) INTO v_role_count
  FROM public.user_roles_projection ur
  WHERE ur.scope_path IS NOT NULL
    AND ur.scope_path <@ v_existing.path;

  IF v_role_count > 0 THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', format('Cannot delete: %s role assignment(s) reference this unit', v_role_count),
      'errorDetails', jsonb_build_object(
        'code', 'HAS_ROLES',
        'count', v_role_count,
        'message', format('This unit has %s role assignment(s). Reassign them first.', v_role_count)
      )
    );
  END IF;

  v_event_id := gen_random_uuid();

  SELECT COALESCE(MAX(stream_version), 0) + 1 INTO v_stream_version
  FROM public.domain_events
  WHERE stream_id = p_unit_id AND stream_type = 'organization_unit';

  INSERT INTO public.domain_events (
    id, stream_id, stream_type, stream_version,
    event_type, event_data, event_metadata
  ) VALUES (
    v_event_id,
    p_unit_id,
    'organization_unit',
    v_stream_version,
    'organization_unit.deleted',
    jsonb_build_object(
      'organization_unit_id', p_unit_id,
      'deleted_path', v_existing.path::text,
      'had_role_references', false,
      'deletion_type', 'soft_delete'
    ),
    jsonb_build_object(
      'user_id', public.get_current_user_id(),
      'source', 'api.delete_organization_unit',
      'timestamp', now()
    )
  );

  SELECT * INTO v_result
  FROM public.organization_units_projection
  WHERE id = p_unit_id
    AND deleted_at IS NOT NULL;

  -- F4 fold-in: canonical Pattern A v2 form WHERE id = v_event_id.
  IF NOT FOUND THEN
    SELECT processing_error INTO v_processing_error
    FROM public.domain_events
    WHERE id = v_event_id;

    RETURN jsonb_build_object(
      'success', false,
      'error', COALESCE(v_processing_error, 'Projection not found after event processing'),
      'errorDetails', jsonb_build_object(
        'code', 'PROCESSING_ERROR',
        'message', 'The event was recorded but the handler failed. Check domain_events for details.'
      )
    );
  END IF;

  -- F5 fold-in: Pattern A v2 race-safe second check.
  SELECT processing_error INTO v_processing_error
  FROM public.domain_events WHERE id = v_event_id;
  IF v_processing_error IS NOT NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Event processing failed: ' || v_processing_error,
      'errorDetails', jsonb_build_object(
        'code', 'PROCESSING_ERROR',
        'message', 'The event was recorded but the handler failed. Check domain_events for details.'
      )
    );
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'unit', jsonb_build_object(
      'id', v_result.id,
      'name', v_result.name,
      'displayName', v_result.display_name,
      'path', v_result.path::text,
      'parentPath', v_result.parent_path::text,
      'timeZone', v_result.timezone,
      'isActive', v_result.is_active,
      'deletedAt', v_result.deleted_at,
      'isRootOrganization', false,
      'createdAt', v_result.created_at,
      'updatedAt', v_result.updated_at
    )
  );
END;
$$;


-- -----------------------------------------------------------------------------
-- Step 7.4 — api.deactivate_organization_unit
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION api.deactivate_organization_unit(p_unit_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'extensions', 'pg_temp'
AS $$
DECLARE
  v_existing             record;
  v_event_id             uuid;
  v_stream_version       integer;
  v_result               record;
  v_affected_descendants jsonb;
  v_descendant_count     integer;
  v_processing_error     text;
BEGIN
  SELECT * INTO v_existing
  FROM public.organization_units_projection ou
  WHERE ou.id = p_unit_id
    AND ou.deleted_at IS NULL
    AND public.has_effective_permission('organization.update_ou', ou.path);

  IF v_existing IS NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Organizational unit not found',
      'errorDetails', jsonb_build_object(
        'code', 'NOT_FOUND',
        'message', 'Unit not found or outside your scope. Root organizations cannot be deactivated via this function.'
      )
    );
  END IF;

  IF v_existing.is_active = false THEN
    RETURN jsonb_build_object(
      'success', true,
      'unit', jsonb_build_object(
        'id', v_existing.id,
        'name', v_existing.name,
        'displayName', v_existing.display_name,
        'path', v_existing.path::text,
        'parentPath', v_existing.parent_path::text,
        'timeZone', v_existing.timezone,
        'isActive', false,
        'isRootOrganization', false,
        'createdAt', v_existing.created_at,
        'updatedAt', v_existing.updated_at
      ),
      'message', 'Organization unit is already deactivated'
    );
  END IF;

  SELECT
    COALESCE(jsonb_agg(jsonb_build_object(
      'id', ou.id,
      'path', ou.path::text,
      'name', ou.name
    )), '[]'::jsonb),
    COUNT(*)::integer
  INTO v_affected_descendants, v_descendant_count
  FROM public.organization_units_projection ou
  WHERE ou.path <@ v_existing.path
    AND ou.id != p_unit_id
    AND ou.is_active = true
    AND ou.deleted_at IS NULL;

  v_event_id := gen_random_uuid();

  SELECT COALESCE(MAX(stream_version), 0) + 1 INTO v_stream_version
  FROM public.domain_events
  WHERE stream_id = p_unit_id AND stream_type = 'organization_unit';

  INSERT INTO public.domain_events (
    id, stream_id, stream_type, stream_version,
    event_type, event_data, event_metadata
  ) VALUES (
    v_event_id,
    p_unit_id,
    'organization_unit',
    v_stream_version,
    'organization_unit.deactivated',
    jsonb_build_object(
      'organization_unit_id', p_unit_id,
      'path', v_existing.path::text,
      'cascade_effect', 'role_assignment_blocked',
      'affected_descendants', v_affected_descendants,
      'descendant_count', v_descendant_count
    ),
    jsonb_build_object(
      'user_id', public.get_current_user_id(),
      'source', 'api.deactivate_organization_unit',
      'timestamp', now()
    )
  );

  SELECT * INTO v_result
  FROM public.organization_units_projection
  WHERE id = p_unit_id;

  -- F4 fold-in: canonical Pattern A v2 form WHERE id = v_event_id.
  IF NOT FOUND THEN
    SELECT processing_error INTO v_processing_error
    FROM public.domain_events
    WHERE id = v_event_id;

    RETURN jsonb_build_object(
      'success', false,
      'error', COALESCE(v_processing_error, 'Projection not found after event processing'),
      'errorDetails', jsonb_build_object(
        'code', 'PROCESSING_ERROR',
        'message', 'The event was recorded but the handler failed. Check domain_events for details.'
      )
    );
  END IF;

  -- F5 fold-in: Pattern A v2 race-safe second check.
  SELECT processing_error INTO v_processing_error
  FROM public.domain_events WHERE id = v_event_id;
  IF v_processing_error IS NOT NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Event processing failed: ' || v_processing_error,
      'errorDetails', jsonb_build_object(
        'code', 'PROCESSING_ERROR',
        'message', 'The event was recorded but the handler failed. Check domain_events for details.'
      )
    );
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'unit', jsonb_build_object(
      'id', v_result.id,
      'name', v_result.name,
      'displayName', v_result.display_name,
      'path', v_result.path::text,
      'parentPath', v_result.parent_path::text,
      'timeZone', v_result.timezone,
      'isActive', v_result.is_active,
      'isRootOrganization', false,
      'createdAt', v_result.created_at,
      'updatedAt', v_result.updated_at
    ),
    'cascadedDeactivations', v_descendant_count
  );
END;
$$;


-- -----------------------------------------------------------------------------
-- Step 7.5 — api.reactivate_organization_unit
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION api.reactivate_organization_unit(p_unit_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'extensions', 'pg_temp'
AS $$
DECLARE
  v_existing               record;
  v_event_id               uuid;
  v_stream_version         integer;
  v_result                 record;
  v_inactive_ancestor_path ltree;
  v_affected_descendants   jsonb;
  v_descendant_count       integer;
  v_processing_error       text;
BEGIN
  SELECT * INTO v_existing
  FROM public.organization_units_projection ou
  WHERE ou.id = p_unit_id
    AND ou.deleted_at IS NULL
    AND public.has_effective_permission('organization.update_ou', ou.path);

  IF v_existing IS NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Organizational unit not found',
      'errorDetails', jsonb_build_object(
        'code', 'NOT_FOUND',
        'message', 'Unit not found or outside your scope'
      )
    );
  END IF;

  IF v_existing.is_active = true THEN
    RETURN jsonb_build_object(
      'success', true,
      'unit', jsonb_build_object(
        'id', v_existing.id,
        'name', v_existing.name,
        'displayName', v_existing.display_name,
        'path', v_existing.path::text,
        'parentPath', v_existing.parent_path::text,
        'timeZone', v_existing.timezone,
        'isActive', true,
        'isRootOrganization', false,
        'createdAt', v_existing.created_at,
        'updatedAt', v_existing.updated_at
      ),
      'message', 'Organization unit is already active'
    );
  END IF;

  SELECT ou.path INTO v_inactive_ancestor_path
  FROM public.organization_units_projection ou
  WHERE v_existing.path <@ ou.path
    AND ou.path != v_existing.path
    AND ou.is_active = false
    AND ou.deleted_at IS NULL
  ORDER BY ou.depth DESC
  LIMIT 1;

  IF v_inactive_ancestor_path IS NOT NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Cannot reactivate while parent is inactive',
      'errorDetails', jsonb_build_object(
        'code', 'PARENT_INACTIVE',
        'message', format('Reactivate ancestor %s first', v_inactive_ancestor_path::text)
      )
    );
  END IF;

  SELECT
    COALESCE(jsonb_agg(jsonb_build_object(
      'id', ou.id,
      'path', ou.path::text,
      'name', ou.name
    )), '[]'::jsonb),
    COUNT(*)::integer
  INTO v_affected_descendants, v_descendant_count
  FROM public.organization_units_projection ou
  WHERE ou.path <@ v_existing.path
    AND ou.id != p_unit_id
    AND ou.is_active = false
    AND ou.deleted_at IS NULL;

  v_event_id := gen_random_uuid();

  SELECT COALESCE(MAX(stream_version), 0) + 1 INTO v_stream_version
  FROM public.domain_events
  WHERE stream_id = p_unit_id AND stream_type = 'organization_unit';

  INSERT INTO public.domain_events (
    id, stream_id, stream_type, stream_version,
    event_type, event_data, event_metadata
  ) VALUES (
    v_event_id,
    p_unit_id,
    'organization_unit',
    v_stream_version,
    'organization_unit.reactivated',
    jsonb_build_object(
      'organization_unit_id', p_unit_id,
      'path', v_existing.path::text,
      'affected_descendants', v_affected_descendants,
      'descendant_count', v_descendant_count
    ),
    jsonb_build_object(
      'user_id', public.get_current_user_id(),
      'source', 'api.reactivate_organization_unit',
      'timestamp', now()
    )
  );

  SELECT * INTO v_result
  FROM public.organization_units_projection
  WHERE id = p_unit_id;

  -- F4 fold-in: canonical Pattern A v2 form WHERE id = v_event_id.
  IF NOT FOUND THEN
    SELECT processing_error INTO v_processing_error
    FROM public.domain_events
    WHERE id = v_event_id;

    RETURN jsonb_build_object(
      'success', false,
      'error', COALESCE(v_processing_error, 'Projection not found after event processing'),
      'errorDetails', jsonb_build_object(
        'code', 'PROCESSING_ERROR',
        'message', 'The event was recorded but the handler failed. Check domain_events for details.'
      )
    );
  END IF;

  -- F5 fold-in: Pattern A v2 race-safe second check.
  SELECT processing_error INTO v_processing_error
  FROM public.domain_events WHERE id = v_event_id;
  IF v_processing_error IS NOT NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Event processing failed: ' || v_processing_error,
      'errorDetails', jsonb_build_object(
        'code', 'PROCESSING_ERROR',
        'message', 'The event was recorded but the handler failed. Check domain_events for details.'
      )
    );
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'unit', jsonb_build_object(
      'id', v_result.id,
      'name', v_result.name,
      'displayName', v_result.display_name,
      'path', v_result.path::text,
      'parentPath', v_result.parent_path::text,
      'timeZone', v_result.timezone,
      'isActive', v_result.is_active,
      'isRootOrganization', false,
      'createdAt', v_result.created_at,
      'updatedAt', v_result.updated_at
    ),
    -- F1 fold-in 2026-06-01 architect review: preserved baseline key
    -- `cascadedReactivations` (symmetric with deactivate's `cascadedDeactivations`).
    -- Prior draft used `reactivatedDescendants` which would silently break
    -- frontend code paths reading `result.cascadedReactivations`.
    'cascadedReactivations', v_descendant_count
  );
END;
$$;


-- -----------------------------------------------------------------------------
-- Step 7.6 — api.bulk_assign_role
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION api.bulk_assign_role(
  p_role_id        uuid,
  p_user_ids       uuid[],
  p_scope_path     ltree,
  p_correlation_id uuid DEFAULT gen_random_uuid(),
  p_reason         text DEFAULT 'Bulk role assignment'
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'extensions', 'pg_temp'
AS $$
DECLARE
  v_org_id         uuid;
  v_role_name      text;
  v_user_id        uuid;
  v_user_index     integer := 0;
  v_total_users    integer;
  v_successful     uuid[] := ARRAY[]::uuid[];
  v_failed         jsonb := '[]'::jsonb;
  v_event_data     jsonb;
  v_event_metadata jsonb;
  v_assigned_by    uuid;
BEGIN
  v_assigned_by := auth.uid();

  IF v_assigned_by IS NULL THEN
    RAISE EXCEPTION 'Authentication required'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- Permission gate — F2 fold-in 2026-06-01 architect review:
  -- Preserves the two-branch error-shape contract of the prior body. The
  -- first branch catches "missing permission entirely" and the second catches
  -- "permission exists but not at this scope". Frontend error-discrimination
  -- relies on these distinct error strings; collapsing them into a single
  -- gate would break the UX of distinguishing "you have user.role_assign
  -- somewhere else, just not here" from "you don't have user.role_assign
  -- at all". has_effective_permission is forward-compatible with multi-scope
  -- grants under Phase 1's tightened DISTINCT ON.
  IF NOT public.has_permission('user.role_assign') THEN
    RAISE EXCEPTION 'Missing permission: user.role_assign'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF NOT public.has_effective_permission('user.role_assign', p_scope_path) THEN
    RAISE EXCEPTION 'Requested scope is outside your permission scope'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT r.name INTO v_role_name
  FROM public.roles_projection r
  WHERE r.id = p_role_id
    AND r.deleted_at IS NULL;

  IF v_role_name IS NULL THEN
    RAISE EXCEPTION 'Role not found'
      USING ERRCODE = 'P0002';
  END IF;

  SELECT o.id INTO v_org_id
  FROM public.organizations_projection o
  WHERE o.path = subpath(p_scope_path, 0, 1)
    AND o.deleted_at IS NULL;

  IF v_org_id IS NULL THEN
    RAISE EXCEPTION 'Organization not found for scope path'
      USING ERRCODE = 'P0002';
  END IF;

  v_total_users := array_length(p_user_ids, 1);

  IF v_total_users IS NULL OR v_total_users = 0 THEN
    RETURN jsonb_build_object(
      'successful', '[]'::jsonb,
      'failed', '[]'::jsonb,
      'totalRequested', 0,
      'totalSucceeded', 0,
      'totalFailed', 0,
      'correlationId', p_correlation_id
    );
  END IF;

  FOREACH v_user_id IN ARRAY p_user_ids LOOP
    v_user_index := v_user_index + 1;

    BEGIN
      -- Membership check uses accessible_organizations @> canonical oracle
      -- (PR #66 / PR #67 convention codified in CLAUDE.md).
      IF NOT EXISTS (
        SELECT 1 FROM public.users u
        WHERE u.id = v_user_id
          AND u.accessible_organizations @> ARRAY[v_org_id]::uuid[]
          AND u.deleted_at IS NULL
      ) THEN
        RAISE EXCEPTION 'User not found or not in organization';
      END IF;

      IF NOT EXISTS (
        SELECT 1 FROM public.users u
        WHERE u.id = v_user_id
          AND u.is_active = true
      ) THEN
        RAISE EXCEPTION 'User is not active';
      END IF;

      IF EXISTS (
        SELECT 1 FROM public.user_roles_projection ur
        WHERE ur.user_id = v_user_id
          AND ur.role_id = p_role_id
          AND ur.scope_path = p_scope_path
      ) THEN
        RAISE EXCEPTION 'User already has this role at this scope';
      END IF;

      v_event_data := jsonb_build_object(
        'role_id', p_role_id,
        'role_name', v_role_name,
        'org_id', v_org_id,
        'scope_path', p_scope_path::text,
        'assigned_by', v_assigned_by
      );

      v_event_metadata := jsonb_build_object(
        'timestamp', NOW()::text,
        'correlation_id', p_correlation_id,
        'user_id', v_assigned_by::text,
        'reason', p_reason,
        'source', 'api',
        'tags', to_jsonb(ARRAY['bulk-assignment']::text[]),
        'bulk_operation', true,
        'bulk_operation_id', p_correlation_id::text,
        'user_index', v_user_index,
        'total_users', v_total_users
      );

      PERFORM api.emit_domain_event(
        v_user_id,
        'user',
        'user.role.assigned',
        v_event_data,
        v_event_metadata
      );

      v_successful := array_append(v_successful, v_user_id);

    EXCEPTION WHEN OTHERS THEN
      v_failed := v_failed || jsonb_build_object(
        'userId', v_user_id,
        'reason', SQLERRM,
        'sqlstate', SQLSTATE
      );
    END;
  END LOOP;

  RETURN jsonb_build_object(
    'successful', to_jsonb(v_successful),
    'failed', v_failed,
    'totalRequested', v_total_users,
    'totalSucceeded', array_length(v_successful, 1),
    'totalFailed', jsonb_array_length(v_failed),
    'correlationId', p_correlation_id
  );
END;
$$;


-- -----------------------------------------------------------------------------
-- Step 7.7 — api.sync_role_assignments
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION api.sync_role_assignments(
  p_role_id              uuid,
  p_user_ids_to_add      uuid[],
  p_user_ids_to_remove   uuid[],
  p_scope_path           ltree,
  p_correlation_id       uuid DEFAULT gen_random_uuid(),
  p_reason               text DEFAULT 'Role assignment update'
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'extensions', 'pg_temp'
AS $$
DECLARE
  v_org_id             uuid;
  v_role_name          text;
  v_user_id            uuid;
  v_acting_user        uuid;
  v_event_data         jsonb;
  v_event_metadata     jsonb;
  v_added_successful   uuid[] := ARRAY[]::uuid[];
  v_added_failed       jsonb := '[]'::jsonb;
  v_removed_successful uuid[] := ARRAY[]::uuid[];
  v_removed_failed     jsonb := '[]'::jsonb;
  v_total_operations   integer;
  v_current_index      integer := 0;
BEGIN
  v_acting_user := auth.uid();

  IF v_acting_user IS NULL THEN
    RAISE EXCEPTION 'Authentication required'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- Permission gate — same two-branch shape as bulk_assign_role (F2 fold-in).
  IF NOT public.has_permission('user.role_assign') THEN
    RAISE EXCEPTION 'Missing permission: user.role_assign'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF NOT public.has_effective_permission('user.role_assign', p_scope_path) THEN
    RAISE EXCEPTION 'Requested scope is outside your permission scope'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT r.name INTO v_role_name
  FROM public.roles_projection r
  WHERE r.id = p_role_id
    AND r.deleted_at IS NULL;

  IF v_role_name IS NULL THEN
    RAISE EXCEPTION 'Role not found'
      USING ERRCODE = 'P0002';
  END IF;

  SELECT o.id INTO v_org_id
  FROM public.organizations_projection o
  WHERE o.path = subpath(p_scope_path, 0, 1)
    AND o.deleted_at IS NULL;

  IF v_org_id IS NULL THEN
    RAISE EXCEPTION 'Organization not found for scope path'
      USING ERRCODE = 'P0002';
  END IF;

  v_total_operations := COALESCE(array_length(p_user_ids_to_add, 1), 0)
                      + COALESCE(array_length(p_user_ids_to_remove, 1), 0);

  IF v_total_operations = 0 THEN
    RETURN jsonb_build_object(
      'added', jsonb_build_object('successful', '[]'::jsonb, 'failed', '[]'::jsonb),
      'removed', jsonb_build_object('successful', '[]'::jsonb, 'failed', '[]'::jsonb),
      'correlationId', p_correlation_id
    );
  END IF;

  IF p_user_ids_to_add IS NOT NULL THEN
    FOREACH v_user_id IN ARRAY p_user_ids_to_add LOOP
      v_current_index := v_current_index + 1;

      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM public.users u
          WHERE u.id = v_user_id
            AND u.accessible_organizations @> ARRAY[v_org_id]::uuid[]
            AND u.deleted_at IS NULL
        ) THEN
          RAISE EXCEPTION 'User not found or not in organization';
        END IF;

        IF NOT EXISTS (
          SELECT 1 FROM public.users u
          WHERE u.id = v_user_id
            AND u.is_active = true
        ) THEN
          RAISE EXCEPTION 'User is not active';
        END IF;

        IF EXISTS (
          SELECT 1 FROM public.user_roles_projection ur
          WHERE ur.user_id = v_user_id
            AND ur.role_id = p_role_id
            AND ur.scope_path = p_scope_path
        ) THEN
          RAISE EXCEPTION 'User already has this role at this scope';
        END IF;

        v_event_data := jsonb_build_object(
          'role_id', p_role_id,
          'role_name', v_role_name,
          'org_id', v_org_id,
          'scope_path', p_scope_path::text,
          'assigned_by', v_acting_user
        );

        v_event_metadata := jsonb_build_object(
          'timestamp', NOW()::text,
          'correlation_id', p_correlation_id,
          'user_id', v_acting_user::text,
          'reason', p_reason,
          'source', 'api',
          'tags', to_jsonb(ARRAY['role-management', 'assignment']::text[]),
          'bulk_operation', true,
          'bulk_operation_id', p_correlation_id::text,
          'operation_index', v_current_index,
          'total_operations', v_total_operations
        );

        PERFORM api.emit_domain_event(
          v_user_id,
          'user',
          'user.role.assigned',
          v_event_data,
          v_event_metadata
        );

        v_added_successful := array_append(v_added_successful, v_user_id);

      EXCEPTION WHEN OTHERS THEN
        v_added_failed := v_added_failed || jsonb_build_object(
          'userId', v_user_id,
          'reason', SQLERRM,
          'sqlstate', SQLSTATE
        );
      END;
    END LOOP;
  END IF;

  IF p_user_ids_to_remove IS NOT NULL THEN
    FOREACH v_user_id IN ARRAY p_user_ids_to_remove LOOP
      v_current_index := v_current_index + 1;

      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM public.users u
          WHERE u.id = v_user_id
            AND u.accessible_organizations @> ARRAY[v_org_id]::uuid[]
            AND u.deleted_at IS NULL
        ) THEN
          RAISE EXCEPTION 'User not found or not in organization';
        END IF;

        IF NOT EXISTS (
          SELECT 1 FROM public.user_roles_projection ur
          WHERE ur.user_id = v_user_id
            AND ur.role_id = p_role_id
            AND ur.scope_path = p_scope_path
        ) THEN
          RAISE EXCEPTION 'User does not have this role at this scope';
        END IF;

        v_event_data := jsonb_build_object(
          'role_id', p_role_id,
          'role_name', v_role_name,
          'org_id', v_org_id,
          'scope_path', p_scope_path::text,
          'removed_by', v_acting_user
        );

        v_event_metadata := jsonb_build_object(
          'timestamp', NOW()::text,
          'correlation_id', p_correlation_id,
          'user_id', v_acting_user::text,
          'reason', p_reason,
          'source', 'api',
          'tags', to_jsonb(ARRAY['role-management', 'removal']::text[]),
          'bulk_operation', true,
          'bulk_operation_id', p_correlation_id::text,
          'operation_index', v_current_index,
          'total_operations', v_total_operations
        );

        PERFORM api.emit_domain_event(
          v_user_id,
          'user',
          'user.role.revoked',
          v_event_data,
          v_event_metadata
        );

        v_removed_successful := array_append(v_removed_successful, v_user_id);

      EXCEPTION WHEN OTHERS THEN
        v_removed_failed := v_removed_failed || jsonb_build_object(
          'userId', v_user_id,
          'reason', SQLERRM,
          'sqlstate', SQLSTATE
        );
      END;
    END LOOP;
  END IF;

  RETURN jsonb_build_object(
    'added', jsonb_build_object(
      'successful', to_jsonb(v_added_successful),
      'failed', v_added_failed
    ),
    'removed', jsonb_build_object(
      'successful', to_jsonb(v_removed_successful),
      'failed', v_removed_failed
    ),
    'correlationId', p_correlation_id
  );
END;
$$;


-- -----------------------------------------------------------------------------
-- Step 7.8 — api.get_organization_unit_by_id
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION api.get_organization_unit_by_id(p_unit_id uuid)
RETURNS TABLE(
  id                  uuid,
  name                text,
  display_name        text,
  path                text,
  parent_path         text,
  parent_id           uuid,
  timezone            text,
  is_active           boolean,
  child_count         bigint,
  is_root_organization boolean,
  created_at          timestamp with time zone,
  updated_at          timestamp with time zone
)
LANGUAGE plpgsql
SET search_path TO 'public', 'extensions', 'pg_temp'
AS $$
BEGIN
  -- Up-front zero-permission gate (F3 fold-in 2026-06-01 architect review):
  -- preserves the prior body's RAISE EXCEPTION behavior for the
  -- zero-permission case. Without this, a user with NO view_ou would receive
  -- an empty result set instead of the documented insufficient_privilege
  -- exception — a HTTP-200-empty-vs-HTTP-403 contract shift that frontend
  -- error handling can't catch.
  IF NOT public.has_permission('organization.view_ou') THEN
    RAISE EXCEPTION 'Missing permission: organization.view_ou'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- Root organization branch (depth=1). Per-row scoped permission check in
  -- WHERE handles multi-scope grants correctly.
  RETURN QUERY
  SELECT
    o.id,
    o.name,
    o.display_name,
    o.path::text,
    o.parent_path::text,
    NULL::uuid AS parent_id,
    o.timezone,
    o.is_active,
    (SELECT COUNT(*) FROM public.organization_units_projection c
       WHERE c.parent_path = o.path AND c.deleted_at IS NULL) AS child_count,
    true AS is_root_organization,
    o.created_at,
    o.updated_at
  FROM public.organizations_projection o
  WHERE o.id = p_unit_id
    AND nlevel(o.path) = 1
    AND o.deleted_at IS NULL
    AND public.has_effective_permission('organization.view_ou', o.path)
  LIMIT 1;

  IF FOUND THEN
    RETURN;
  END IF;

  -- Sub-OU branch (depth>1). Permission check folded into WHERE.
  RETURN QUERY
  SELECT
    ou.id,
    ou.name,
    ou.display_name,
    ou.path::text,
    ou.parent_path::text,
    (
      SELECT COALESCE(
        (SELECT p.id FROM public.organization_units_projection p WHERE p.path = ou.parent_path LIMIT 1),
        (SELECT o.id FROM public.organizations_projection o WHERE o.path = ou.parent_path LIMIT 1)
      )
    ) AS parent_id,
    ou.timezone,
    ou.is_active,
    (SELECT COUNT(*) FROM public.organization_units_projection c
       WHERE c.parent_path = ou.path AND c.deleted_at IS NULL) AS child_count,
    false AS is_root_organization,
    ou.created_at,
    ou.updated_at
  FROM public.organization_units_projection ou
  WHERE ou.id = p_unit_id
    AND ou.deleted_at IS NULL
    AND public.has_effective_permission('organization.view_ou', ou.path)
  LIMIT 1;
END;
$$;


-- -----------------------------------------------------------------------------
-- Step 7.9 — api.get_organization_unit_descendants
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION api.get_organization_unit_descendants(p_unit_id uuid)
RETURNS TABLE(
  id                   uuid,
  name                 text,
  display_name         text,
  path                 text,
  parent_path          text,
  parent_id            uuid,
  timezone             text,
  is_active            boolean,
  child_count          bigint,
  is_root_organization boolean,
  created_at           timestamp with time zone,
  updated_at           timestamp with time zone
)
LANGUAGE plpgsql
SET search_path TO 'public', 'extensions', 'pg_temp'
AS $$
DECLARE
  v_unit_path ltree;
BEGIN
  -- Up-front zero-permission gate (F3 fold-in 2026-06-01 architect review).
  IF NOT public.has_permission('organization.view_ou') THEN
    RAISE EXCEPTION 'Missing permission: organization.view_ou'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- Find the unit's path (root org or sub-OU) WITH permission check folded
  -- into the WHERE clause. Returns NULL (and empty result set) if the unit
  -- doesn't exist or is outside the user's permission scope.
  SELECT o.path INTO v_unit_path
  FROM public.organizations_projection o
  WHERE o.id = p_unit_id
    AND o.deleted_at IS NULL
    AND public.has_effective_permission('organization.view_ou', o.path);

  IF v_unit_path IS NULL THEN
    SELECT ou.path INTO v_unit_path
    FROM public.organization_units_projection ou
    WHERE ou.id = p_unit_id
      AND ou.deleted_at IS NULL
      AND public.has_effective_permission('organization.view_ou', ou.path);
  END IF;

  IF v_unit_path IS NULL THEN
    RETURN;
  END IF;

  -- Descendants — per-row permission check correctly handles multi-scope
  -- grants where the user may have view_ou at some descendants but not others.
  RETURN QUERY
  SELECT
    ou.id,
    ou.name,
    ou.display_name,
    ou.path::text,
    ou.parent_path::text,
    (
      SELECT COALESCE(
        (SELECT p.id FROM public.organization_units_projection p WHERE p.path = ou.parent_path LIMIT 1),
        (SELECT o.id FROM public.organizations_projection o WHERE o.path = ou.parent_path LIMIT 1)
      )
    ) AS parent_id,
    ou.timezone,
    ou.is_active,
    (SELECT COUNT(*) FROM public.organization_units_projection c
       WHERE c.parent_path = ou.path AND c.deleted_at IS NULL) AS child_count,
    false AS is_root_organization,
    ou.created_at,
    ou.updated_at
  FROM public.organization_units_projection ou
  WHERE v_unit_path @> ou.path
    AND ou.path != v_unit_path
    AND ou.deleted_at IS NULL
    AND public.has_effective_permission('organization.view_ou', ou.path)
  ORDER BY ou.path ASC;
END;
$$;


-- -----------------------------------------------------------------------------
-- Step 7.10 — api.get_organization_units
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION api.get_organization_units(
  p_status      text DEFAULT 'all',
  p_search_term text DEFAULT NULL
) RETURNS TABLE(
  id                   uuid,
  name                 text,
  display_name         text,
  path                 text,
  parent_path          text,
  parent_id            uuid,
  timezone             text,
  is_active            boolean,
  child_count          bigint,
  is_root_organization boolean,
  created_at           timestamp with time zone,
  updated_at           timestamp with time zone
)
LANGUAGE plpgsql
SET search_path TO 'public', 'extensions', 'pg_temp'
AS $$
BEGIN
  -- Up-front zero-permission gate (F3 fold-in 2026-06-01 architect review).
  IF NOT public.has_permission('organization.view_ou') THEN
    RAISE EXCEPTION 'Missing permission: organization.view_ou - user not associated with organization'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- Return all OUs the user has organization.view_ou permission for. Per-row
  -- has_effective_permission correctly handles multi-scope grants.
  RETURN QUERY
  WITH all_units AS (
    -- Root organizations (depth=1)
    SELECT
      o.id,
      o.name,
      o.display_name,
      o.path,
      o.parent_path,
      o.timezone,
      o.is_active,
      true AS is_root_org,
      o.created_at,
      o.updated_at
    FROM public.organizations_projection o
    WHERE nlevel(o.path) = 1
      AND o.deleted_at IS NULL
      AND public.has_effective_permission('organization.view_ou', o.path)
    UNION ALL
    -- Sub-organizations (depth>1)
    SELECT
      ou.id,
      ou.name,
      ou.display_name,
      ou.path,
      ou.parent_path,
      ou.timezone,
      ou.is_active,
      false AS is_root_org,
      ou.created_at,
      ou.updated_at
    FROM public.organization_units_projection ou
    WHERE ou.deleted_at IS NULL
      AND public.has_effective_permission('organization.view_ou', ou.path)
  ),
  unit_children AS (
    SELECT
      oup.parent_path AS pp,
      COUNT(*) as cnt
    FROM public.organization_units_projection oup
    WHERE oup.deleted_at IS NULL
    GROUP BY oup.parent_path
  )
  SELECT
    u.id,
    u.name,
    u.display_name,
    u.path::text,
    u.parent_path::text,
    (
      SELECT COALESCE(
        (SELECT p.id FROM public.organization_units_projection p WHERE p.path = u.parent_path LIMIT 1),
        (SELECT o.id FROM public.organizations_projection o WHERE o.path = u.parent_path LIMIT 1)
      )
    ) AS parent_id,
    u.timezone,
    u.is_active,
    COALESCE(uc.cnt, 0) AS child_count,
    u.is_root_org AS is_root_organization,
    u.created_at,
    u.updated_at
  FROM all_units u
  LEFT JOIN unit_children uc ON uc.pp = u.path
  WHERE (p_status = 'all'
         OR (p_status = 'active' AND u.is_active = true)
         OR (p_status = 'inactive' AND u.is_active = false))
    AND (p_search_term IS NULL
         OR u.name ILIKE '%' || p_search_term || '%'
         OR u.display_name ILIKE '%' || p_search_term || '%')
  ORDER BY u.path ASC;
END;
$$;


-- =============================================================================
-- Step 8 — M3 RPC Shape Registry re-tag (Step 7's 10 RPCs) + assertion
-- =============================================================================
--
-- Per ADR Phase 1 manifest step 8: re-issue `COMMENT ON FUNCTION ... '...
-- @a4c-rpc-shape: envelope|read ...'` for ALL 10 C-legacy RPCs normalized in
-- Step 7. Plus a SQL-level assertion that every api.* function carries a
-- shape tag (the equivalent of `UncategorizedRpcs = never` in the frontend
-- codegen, enforced at deploy time).
--
-- Why re-issue defensively under CREATE OR REPLACE FUNCTION:
-- CREATE OR REPLACE with the SAME signature preserves the OID-keyed COMMENT.
-- All 10 Step 7 RPCs keep the same signatures, so the existing M3 tags from
-- `20260430172625_backfill_rpc_shape_comments.sql` SHOULD already be intact.
-- However, the M3 DROP+CREATE re-tag rule mandates defensive re-emission
-- (`infrastructure/supabase/CLAUDE.md` § RPC Shape Registry). Re-emitting
-- explicitly here also documents the per-RPC shape decision INLINE with the
-- normalization for future readers — they don't have to grep across the M3
-- backfill DO block + body-introspection rule to know which tag each RPC
-- carries.
--
-- Shape classification (body introspection per `20260430172625_*.sql:74-83`):
--   `envelope` IFF returns jsonb/json AND body contains `'success', true|false`
--   `read` otherwise
--
-- All 5 OU mutators (7.1-7.5) return jsonb with Pattern A v2 envelope
-- `RETURN jsonb_build_object('success', true|false, ...)` shape → envelope.
-- The 2 role mutations (7.6-7.7) return custom-shape jsonb without a
-- top-level `success` discriminator (`{successful, failed, totalRequested,
-- ...}` and `{added: {...}, removed: {...}}` respectively) → read. The 3
-- OU readers (7.8-7.10) return TABLE() → read.
--
-- The 2 role mutations being tagged `read` despite their semantic operation
-- being state-mutation is the N1-RESOLVED-REJECTED outcome (2026-05-30):
-- the M3 tag is a WIRE-SHAPE contract for compile-time frontend helper
-- narrowing, NOT a state-mutation marker. SupabaseRoleService consumes both
-- via `apiRpc<T>` (read helper); promoting to `envelope` would break that.
-- See Stage D § N1 entry in tasks.md.

-- -----------------------------------------------------------------------------
-- Step 8.1-8.5 — 5 OU mutators (envelope)
-- -----------------------------------------------------------------------------

COMMENT ON FUNCTION api.create_organization_unit(uuid, text, text, text) IS
$cmt$Create a new organization unit under p_parent_id (or under the user's
active org root when p_parent_id IS NULL). Emits organization_unit.created
domain event; reads back the projection (Pattern A v2). Phase 1 (Step 7.1):
normalized from two-step get_permission_scope + manual @> to single
has_effective_permission(perm, path) call at the resolved parent path.

@a4c-rpc-shape: envelope$cmt$;

COMMENT ON FUNCTION api.update_organization_unit(uuid, text, text, text) IS
$cmt$Update an organization unit (name, display_name, timezone). Emits
organization_unit.updated; reads back the projection (Pattern A v2 with
both IF NOT FOUND and processing_error checks). Phase 1 (Step 7.2):
normalized to has_effective_permission folded into entity-fetch WHERE,
preserving NOT_FOUND-for-both-cases envelope semantics.

@a4c-rpc-shape: envelope$cmt$;

COMMENT ON FUNCTION api.delete_organization_unit(uuid) IS
$cmt$Soft-delete an organization unit (rejects when children or role
assignments exist). Emits organization_unit.deleted; reads back the
projection (Pattern A v2). Phase 1 (Step 7.3): normalized to
has_effective_permission folded into entity-fetch WHERE.

@a4c-rpc-shape: envelope$cmt$;

COMMENT ON FUNCTION api.deactivate_organization_unit(uuid) IS
$cmt$Deactivate an organization unit with cascade-effect-tracking for
descendants. Emits organization_unit.deactivated; reads back the projection
(Pattern A v2). Phase 1 (Step 7.4): normalized to has_effective_permission
folded into entity-fetch WHERE.

@a4c-rpc-shape: envelope$cmt$;

COMMENT ON FUNCTION api.reactivate_organization_unit(uuid) IS
$cmt$Reactivate an organization unit with parent-active validation and
cascade-effect tracking. Returns `cascadedReactivations` (symmetric with
deactivate's `cascadedDeactivations`). Emits organization_unit.reactivated;
reads back the projection (Pattern A v2). Phase 1 (Step 7.5): normalized to
has_effective_permission folded into entity-fetch WHERE.

@a4c-rpc-shape: envelope$cmt$;


-- -----------------------------------------------------------------------------
-- Step 8.6-8.7 — 2 role mutations (read — wire-shape; not state-mutation)
-- -----------------------------------------------------------------------------

COMMENT ON FUNCTION api.bulk_assign_role(uuid, uuid[], ltree, uuid, text) IS
$cmt$Assign multiple users to a role at a given scope path in a single
operation. Returns `{successful, failed, totalRequested, totalSucceeded,
totalFailed, correlationId}` (no top-level success discriminator). Phase 1
(Step 7.6): normalized to two-branch has_permission + has_effective_permission
gate (preserves the prior body's distinct error strings for frontend
discrimination). Inner FOREACH membership check updated from
current_organization_id to canonical accessible_organizations @> (PR #67
convention). Consumed via apiRpc<T> (read helper) by SupabaseRoleService.

@a4c-rpc-shape: read$cmt$;

COMMENT ON FUNCTION api.sync_role_assignments(uuid, uuid[], uuid[], ltree, uuid, text) IS
$cmt$Sync role membership at a scope: assign to one set of users, revoke
from another, in a single operation. Returns `{added: {successful, failed},
removed: {successful, failed}, correlationId}` (no top-level success
discriminator). Phase 1 (Step 7.7): same normalization as bulk_assign_role.
Consumed via apiRpc<T> (read helper) by SupabaseRoleService.

@a4c-rpc-shape: read$cmt$;


-- -----------------------------------------------------------------------------
-- Step 8.8-8.10 — 3 OU readers (read)
-- -----------------------------------------------------------------------------

COMMENT ON FUNCTION api.get_organization_unit_by_id(uuid) IS
$cmt$Get a single organization unit (root org or sub-OU) by ID. Returns
empty result set when the user lacks view_ou permission at the OU's scope.
Up-front has_permission gate raises insufficient_privilege for zero-
permission callers. Phase 1 (Step 7.8): normalized to per-row
has_effective_permission folded into WHERE clause; up-front
has_permission gate restored (F3 fold-in 2026-06-01 — without it,
zero-permission users got empty result instead of HTTP 403).

@a4c-rpc-shape: read$cmt$;

COMMENT ON FUNCTION api.get_organization_unit_descendants(uuid) IS
$cmt$Get all descendants of an organizational unit (org or sub-OU).
Per-row has_effective_permission filtering correctly handles multi-scope
grants where the user may have view_ou at some descendants but not others.
Up-front has_permission gate raises insufficient_privilege for zero-
permission callers. Phase 1 (Step 7.9): same F3 fold-in as Step 7.8.

@a4c-rpc-shape: read$cmt$;

COMMENT ON FUNCTION api.get_organization_units(text, text) IS
$cmt$List all organization units the caller has view_ou permission for,
filtered by status and optional search term. Per-row
has_effective_permission filtering for multi-scope grant correctness.
Up-front has_permission gate raises insufficient_privilege for zero-
permission callers. Phase 1 (Step 7.10): same F3 fold-in as Steps 7.8/7.9.

@a4c-rpc-shape: read$cmt$;


-- -----------------------------------------------------------------------------
-- Step 8 assertion — every api.* function carries an @a4c-rpc-shape tag
-- -----------------------------------------------------------------------------
--
-- SQL-level enforcement of the frontend codegen's `UncategorizedRpcs = never`
-- invariant. If any api.* function lacks `@a4c-rpc-shape: envelope|read` in
-- its COMMENT ON FUNCTION, the migration RAISE EXCEPTIONs immediately —
-- preventing a deploy of untagged RPCs that would break compile-time helper
-- narrowing.
--
-- Idempotent: re-run on the same state produces the same outcome (either
-- success or the same failure). Catches:
--   - New api.* functions added without a tag.
--   - DROP+CREATE migrations that dropped the OID-keyed comment without
--     re-issuing the tag.
--   - The 10 Step 7 RPCs above if any of the COMMENT ON FUNCTION statements
--     failed silently (e.g., signature drift).

DO $$
DECLARE
  v_untagged_count integer;
  v_first_untagged text;
  v_untagged_list  text;
BEGIN
  SELECT
    COUNT(*),
    MIN(p.proname),
    string_agg(p.proname, ', ' ORDER BY p.proname)
  INTO v_untagged_count, v_first_untagged, v_untagged_list
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  LEFT JOIN pg_description d ON d.objoid = p.oid AND d.objsubid = 0
  WHERE n.nspname = 'api'
    AND p.prokind = 'f'
    AND (
      d.description IS NULL
      OR d.description !~ '@a4c-rpc-shape:\s*(envelope|read)\b'
    );

  IF v_untagged_count > 0 THEN
    RAISE EXCEPTION
      'Phase 1 Step 8 assertion failed: % api.* function(s) lack @a4c-rpc-shape '
      'tag. First untagged: api.%. Full list: %. Add COMMENT ON FUNCTION ... '
      'IS ''... @a4c-rpc-shape: envelope|read ...'' for each untagged RPC.',
      v_untagged_count, v_first_untagged, v_untagged_list
      USING ERRCODE = 'P9001';
  END IF;

  RAISE NOTICE 'Phase 1 Step 8 assertion: all api.* functions carry @a4c-rpc-shape tag (UncategorizedRpcs = never)';
END $$;


-- =============================================================================
-- Step 9 — authorization_type CHECK constraint (5-value enumeration)
-- =============================================================================
--
-- Per ADR Phase 1 manifest step 9: close the schema-open hole on
-- `cross_tenant_access_grants_projection.authorization_type`. The projection
-- COMMENT (baseline_v4:12516) already declares the 5-value enumeration
-- (`var_contract`, `court_order`, `family_participation`,
-- `social_services_assignment`, `emergency_access`) but no CHECK constraint
-- enforces it. Phase 1 adds the constraint so handlers and emit RPCs cannot
-- write invalid values silently.
--
-- Three sources previously disagreed (per plan.md § Documentation
-- reconciliation):
--   - Projection COMMENT — 5 values (correct)
--   - provider-partners-architecture.md L324 — was 4 values; updated to 5
--     in PR #68 F1 fix
--   - Schema CHECK — ABSENT (added by Step 9)
--
-- After Step 9 lands all three are in sync.
--
-- Pre-flight context (Stage B probe 2026-05-29): row count = 0 on dev → the
-- ALTER TABLE ADD CONSTRAINT validates a zero-row set instantly. Phase 2+
-- prod deployment timing: if real grants exist at deploy time and any carry
-- a non-enumerated `authorization_type`, the ALTER will FAIL — by design,
-- catches schema-open-hole exploitation before it propagates.
--
-- Idempotent: DROP CONSTRAINT IF EXISTS + ADD CONSTRAINT. The constraint
-- name matches the codebase convention `<table>_<column>_check` (mirrors
-- the existing `cross_tenant_access_grants_projection_status_check` at
-- baseline_v4:12485 and `_scope_check` at L12484).

ALTER TABLE public.cross_tenant_access_grants_projection
  DROP CONSTRAINT IF EXISTS cross_tenant_access_grants_projection_authorization_type_check;

ALTER TABLE public.cross_tenant_access_grants_projection
  ADD CONSTRAINT cross_tenant_access_grants_projection_authorization_type_check
  CHECK (authorization_type IN (
    'var_contract',
    'court_order',
    'family_participation',
    'social_services_assignment',
    'emergency_access'
  ));

COMMENT ON CONSTRAINT cross_tenant_access_grants_projection_authorization_type_check
  ON public.cross_tenant_access_grants_projection IS
  'Enforces the 5-value enumeration on authorization_type: var_contract, '
  'court_order, family_participation, social_services_assignment, '
  'emergency_access. Closes the schema-open hole that previously allowed '
  'silent invalid writes. The projection COMMENT (baseline_v4:12516) and '
  'provider-partners-architecture.md (L313 canonical TS type union; L345 '
  'interface field repeat) are kept in sync with this enumeration '
  '(Phase 1 step 9 of cross-tenant-access-grant-rollout). Note L513 '
  'declares a NARROWER 3-value enumeration for a different table — not '
  'this column.';


-- =============================================================================
-- Step 10 — access_grant.policy_override_applied handler + 7 perm.defined events
-- =============================================================================
--
-- Per ADR Phase 1 manifest step 10:
--   (a) Add the `access_grant.policy_override_applied` event handler branch to
--       process_access_grant_event() — handler-only, no emit RPC (per Decision
--       B.3 the emit RPC api.revoke_permission_across_grants ships in Phase 2).
--   (b) Emit `permission.defined` events for 7 new permissions that do not
--       exist in the current permission registry: `grant.create`, `grant.view`,
--       `grant.revoke`, plus the 4 `partner.*` permissions seeded by the
--       var_default template (Step 15): `partner.view_analytics`,
--       `partner.view_support_tickets`, `partner.view_billing_reports`,
--       `partner.export_reports`.
--
-- (a) DBC contract (plan.md L114-126):
--   Preconditions:
--     - p_event.event_data->'permissions' is the new resolved permission
--       jsonb array (well-formed; same shape as
--       cross_tenant_access_grants_projection.permissions).
--     - p_event.event_data->>'override_reason' is non-empty (HIPAA
--       audit-trail requirement; enforced at handler entry).
--     - Target grant row identified by p_event.stream_id (global rule
--       "use stream_id, not aggregate_id").
--   Postconditions:
--     - Matching grant row's permissions jsonb is REPLACED (not merged)
--       with event_data->'permissions'.
--     - Grant row's updated_at is bumped.
--     - No other grant fields modified (NOT status, NOT scope, NOT
--       consultant_*, NOT authorization_*, NOT expires_at).
--   Invariants:
--     - Handler is purely projective (no event emission from within).
--       Phase 1 ships handler-only.
--     - Replacement is byte-exact: future re-emission of identical override
--       events is idempotent on the projection.
--
-- Implementation drift correction (Rule 8 in CLAUDE.md): the baseline_v4
-- body of this router at L10521-10522 uses RAISE WARNING for the ELSE,
-- which is a Rule 8 violation (warnings are invisible; exceptions are
-- caught by process_domain_event and persisted to processing_error). The
-- handler reference file at
-- infrastructure/supabase/handlers/routers/process_access_grant_event.sql
-- has the CORRECT RAISE EXCEPTION P9001 form. CREATE OR REPLACE FUNCTION
-- here writes the reference body + the new WHEN branch, propagating the
-- ELSE fix as a side-benefit of this Phase 1 touch.
--
-- Three-layer event audit (CLAUDE.md Rule 12):
--   1. Emitter — none in Phase 1 (handler-only per Decision B.3). Phase 2
--      adds api.revoke_permission_across_grants which emits this event.
--   2. Dispatcher — process_domain_event routes stream_type='access_grant'
--      to this router. Existing; no change.
--   3. Router — this Step 10 adds the WHEN branch.

CREATE OR REPLACE FUNCTION public.process_access_grant_event(p_event record)
RETURNS void
LANGUAGE plpgsql
SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE
  v_grant_id UUID;
BEGIN
  CASE p_event.event_type

    WHEN 'access_grant.created' THEN
      INSERT INTO cross_tenant_access_grants_projection (
        id, consultant_org_id, consultant_user_id, provider_org_id,
        scope, scope_id, authorization_type, legal_reference,
        granted_by, granted_at, expires_at, permissions, terms,
        status, created_at, updated_at
      ) VALUES (
        p_event.stream_id,
        safe_jsonb_extract_uuid(p_event.event_data, 'consultant_org_id'),
        safe_jsonb_extract_uuid(p_event.event_data, 'consultant_user_id'),
        safe_jsonb_extract_uuid(p_event.event_data, 'provider_org_id'),
        safe_jsonb_extract_text(p_event.event_data, 'scope'),
        safe_jsonb_extract_uuid(p_event.event_data, 'scope_id'),
        safe_jsonb_extract_text(p_event.event_data, 'authorization_type'),
        safe_jsonb_extract_text(p_event.event_data, 'legal_reference'),
        safe_jsonb_extract_uuid(p_event.event_data, 'granted_by'),
        p_event.created_at,
        safe_jsonb_extract_timestamp(p_event.event_data, 'expires_at'),
        COALESCE(p_event.event_data->'permissions', '[]'::jsonb),
        COALESCE(p_event.event_data->'terms', '{}'::jsonb),
        'active',
        p_event.created_at,
        p_event.created_at
      );

    WHEN 'access_grant.revoked' THEN
      v_grant_id := safe_jsonb_extract_uuid(p_event.event_data, 'grant_id');
      UPDATE cross_tenant_access_grants_projection
      SET status = 'revoked',
          revoked_at = p_event.created_at,
          revoked_by = safe_jsonb_extract_uuid(p_event.event_data, 'revoked_by'),
          revocation_reason = safe_jsonb_extract_text(p_event.event_data, 'revocation_reason'),
          revocation_details = safe_jsonb_extract_text(p_event.event_data, 'revocation_details'),
          updated_at = p_event.created_at
      WHERE id = v_grant_id;

    WHEN 'access_grant.expired' THEN
      v_grant_id := safe_jsonb_extract_uuid(p_event.event_data, 'grant_id');
      UPDATE cross_tenant_access_grants_projection
      SET status = 'expired',
          expired_at = p_event.created_at,
          expiration_type = safe_jsonb_extract_text(p_event.event_data, 'expiration_type'),
          updated_at = p_event.created_at
      WHERE id = v_grant_id;

    WHEN 'access_grant.suspended' THEN
      v_grant_id := safe_jsonb_extract_uuid(p_event.event_data, 'grant_id');
      UPDATE cross_tenant_access_grants_projection
      SET status = 'suspended',
          suspended_at = p_event.created_at,
          suspended_by = safe_jsonb_extract_uuid(p_event.event_data, 'suspended_by'),
          suspension_reason = safe_jsonb_extract_text(p_event.event_data, 'suspension_reason'),
          suspension_details = safe_jsonb_extract_text(p_event.event_data, 'suspension_details'),
          expected_resolution_date = safe_jsonb_extract_timestamp(p_event.event_data, 'expected_resolution_date'),
          updated_at = p_event.created_at
      WHERE id = v_grant_id;

    WHEN 'access_grant.reactivated' THEN
      v_grant_id := safe_jsonb_extract_uuid(p_event.event_data, 'grant_id');
      UPDATE cross_tenant_access_grants_projection
      SET status = 'active',
          suspended_at = NULL, suspended_by = NULL,
          suspension_reason = NULL, suspension_details = NULL,
          expected_resolution_date = NULL,
          reactivated_at = p_event.created_at,
          reactivated_by = safe_jsonb_extract_uuid(p_event.event_data, 'reactivated_by'),
          resolution_details = safe_jsonb_extract_text(p_event.event_data, 'resolution_details'),
          expires_at = COALESCE(
            safe_jsonb_extract_timestamp(p_event.event_data, 'new_expires_at'),
            expires_at
          ),
          updated_at = p_event.created_at
      WHERE id = v_grant_id;

    -- NEW (Phase 1 Step 10) — Decision B.3 policy override application.
    -- Handler-only; emit RPC api.revoke_permission_across_grants ships Phase 2.
    -- Replaces (NOT merges) the grant's permissions jsonb with the event's
    -- new permissions array. Pre-conditions enforced at handler entry per
    -- plan.md L114-126 DBC.
    WHEN 'access_grant.policy_override_applied' THEN
      -- Pre-condition: event_data must carry a permissions JSONB ARRAY
      -- (F4 fold-in 2026-06-02 architect review: prior draft only checked
      -- IS NULL; a scalar or object would have silently corrupted the grant
      -- row's permissions jsonb. The DBC pre-condition at plan.md L116-117
      -- specifies "well-formed; same shape as cross_tenant_access_grants_
      -- projection.permissions" which is a jsonb array. Enforce defensively.)
      IF p_event.event_data->'permissions' IS NULL
         OR jsonb_typeof(p_event.event_data->'permissions') <> 'array' THEN
        RAISE EXCEPTION 'access_grant.policy_override_applied missing or non-array required field: permissions'
          USING ERRCODE = 'P9001';
      END IF;

      -- Pre-condition: override_reason non-empty (HIPAA audit-trail requirement)
      IF COALESCE(p_event.event_data->>'override_reason', '') = '' THEN
        RAISE EXCEPTION 'access_grant.policy_override_applied missing required field: override_reason'
          USING ERRCODE = 'P9001';
      END IF;

      -- Post-condition: REPLACE (not merge) permissions; bump updated_at.
      -- Per DBC L121-124, no other fields modified (status/scope/consultant_*/
      -- authorization_*/expires_at all preserved by omission).
      UPDATE cross_tenant_access_grants_projection
      SET permissions = p_event.event_data->'permissions',
          updated_at = p_event.created_at
      WHERE id = p_event.stream_id;

      -- Defensive: target grant must exist. PII-safe error (no stream_id in
      -- message per Rule 16); caller can correlate via domain_events.id.
      IF NOT FOUND THEN
        RAISE EXCEPTION 'Grant not found for policy_override_applied'
          USING ERRCODE = 'P0002';
      END IF;

    ELSE
      RAISE EXCEPTION 'Unhandled event type "%" in process_access_grant_event', p_event.event_type
        USING ERRCODE = 'P9001';
  END CASE;

END;
$function$;

ALTER FUNCTION public.process_access_grant_event(record) OWNER TO postgres;

COMMENT ON FUNCTION public.process_access_grant_event(record) IS
  'Main access grant event processor — handles cross-tenant grant lifecycle '
  'with CQRS compliance. Phase 1 of cross-tenant-access-grant-rollout '
  '(Step 10): added access_grant.policy_override_applied handler branch '
  '(handler-only per Decision B.3; emit RPC ships Phase 2). Also corrected '
  'the ELSE clause from RAISE WARNING to RAISE EXCEPTION P9001 per '
  'CLAUDE.md Rule 8 (warnings are invisible to process_domain_event; '
  'exceptions are caught and persisted to domain_events.processing_error).';


-- -----------------------------------------------------------------------------
-- Step 10.B — 7 permission.defined event emissions
-- -----------------------------------------------------------------------------
--
-- Pattern matches 20260430002824:46-54 (PR #43 permission-projection rollout)
-- BUT WITH THE F2 FOLD-IN CORRECTION: idempotency is enforced via a
-- pre-condition guard (IF NOT EXISTS check on permissions_projection) rather
-- than the architecturally-dead `EXCEPTION WHEN unique_violation` pattern.
--
-- F2 fold-in 2026-06-02 architect review — dead-code idempotency guard:
-- The prior pattern wrapped each INSERT into domain_events with
-- `EXCEPTION WHEN unique_violation THEN NULL`. This pattern is DEAD CODE in
-- the current process_domain_event trigger architecture because
-- process_domain_event's `BEGIN ... EXCEPTION WHEN OTHERS` wrapper
-- (baseline_v4:10804-10809) catches the unique_violation raised by
-- handle_permission_defined's INSERT into permissions_projection, writes it
-- to processing_error, and the outer INSERT into domain_events SUCCEEDS. No
-- exception escapes the trigger to the DO block. Re-running the migration
-- silently creates N additional failed domain_events rows per emission, each
-- visible in the admin dashboard — the OPPOSITE of the intended idempotent
-- no-op. The PR #43 precedent has the same defect but ran once cleanly so
-- no failed events ever materialized; Step 10 would multiply the blast radius
-- 7x by inheriting the broken pattern.
--
-- Corrected idempotency form: precondition guard via IF NOT EXISTS on
-- permissions_projection (the canonical source-of-truth for "is this
-- permission seeded"). If the row exists, skip the emit entirely. If not,
-- emit the event → handle_permission_defined INSERTs the row → idempotent
-- across re-runs because re-runs find the row and skip.
--
-- Permission scope_type:
--   - permissions_projection_scope_type_check (baseline_v4:13237) enumerates
--     only ('global', 'org'). 'resource' is NOT a valid value (CHECK violation
--     would silently fail via the WHEN OTHERS path above).
--   - grant.* permissions are platform-management actions →
--     scope_type='global' (matches existing organization.create / .activate
--     / .deactivate precedent in seeds/001-permissions-seed.sql L48-78).
--   - partner.* permissions are org-bound: they apply at provider_org scope
--     and are filtered at JWT issuance by the grant row's window. →
--     scope_type='org' (matches client.* / medication.* precedent in seeds
--     L157-239). F1 fold-in 2026-06-02 architect review: prior draft used
--     'resource' which violates the CHECK.
--
-- requires_mfa:
--   - grant.revoke is destructive AND cross-tenant (HIPAA-significant
--     destructive grant ops). requires_mfa=true introduces a NEW PRECEDENT —
--     no existing permission in the seed file sets requires_mfa=true. The
--     gate is defensible on its own merits; documenting this as a new
--     precedent (F3 fold-in 2026-06-02 architect review: prior draft falsely
--     claimed user.delete sets requires_mfa=true; user.delete is actually
--     false per seeds/001-permissions-seed.sql L385).
--   - All other 6 perms → requires_mfa=false (matches the existing
--     uniform-false convention across all seed entries).

-- F2 fold-in 2026-06-02: precondition-guarded emits. Each DO block checks
-- whether the (applet, action) row already exists in permissions_projection;
-- if so, skip the emit (true idempotency). If not, emit → handle_permission_
-- defined INSERTs the row. Re-runs are byte-correct no-ops.

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.permissions_projection
    WHERE applet = 'grant' AND action = 'create'
  ) THEN
    INSERT INTO public.domain_events (stream_id, stream_type, stream_version, event_type, event_data, event_metadata)
    VALUES (
      gen_random_uuid(), 'permission', 1, 'permission.defined',
      '{"applet": "grant", "action": "create", "description": "Create a new cross-tenant access grant (Phase 2+ emitter; gated for platform admins + future consultant-org admins)", "scope_type": "global", "requires_mfa": false}'::jsonb,
      '{"user_id": "00000000-0000-0000-0000-000000000000", "reason": "Phase 1 step 10: seed grant.create for Phase 2+ emit RPC"}'::jsonb
    );
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.permissions_projection
    WHERE applet = 'grant' AND action = 'view'
  ) THEN
    INSERT INTO public.domain_events (stream_id, stream_type, stream_version, event_type, event_data, event_metadata)
    VALUES (
      gen_random_uuid(), 'permission', 1, 'permission.defined',
      '{"applet": "grant", "action": "view", "description": "View cross-tenant access grant records and grant lifecycle history", "scope_type": "global", "requires_mfa": false}'::jsonb,
      '{"user_id": "00000000-0000-0000-0000-000000000000", "reason": "Phase 1 step 10: seed grant.view"}'::jsonb
    );
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.permissions_projection
    WHERE applet = 'grant' AND action = 'revoke'
  ) THEN
    INSERT INTO public.domain_events (stream_id, stream_type, stream_version, event_type, event_data, event_metadata)
    VALUES (
      gen_random_uuid(), 'permission', 1, 'permission.defined',
      '{"applet": "grant", "action": "revoke", "description": "Revoke an active cross-tenant access grant (destructive; immediate effect on JWT issuance via compute_effective_permissions filter)", "scope_type": "global", "requires_mfa": true}'::jsonb,
      '{"user_id": "00000000-0000-0000-0000-000000000000", "reason": "Phase 1 step 10: seed grant.revoke (NEW MFA precedent for HIPAA-significant cross-tenant destructive action)"}'::jsonb
    );
  END IF;
END $$;

-- 4 partner.* permissions seeded by var_default template (Step 15).
-- F1 fold-in 2026-06-02: scope_type='org' (was 'resource' — CHECK violation).
-- partner.* perms are org-scoped (the grant's provider_org) and filtered at
-- JWT issuance by the grant row's status='active' AND in-window window.
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.permissions_projection
    WHERE applet = 'partner' AND action = 'view_analytics'
  ) THEN
    INSERT INTO public.domain_events (stream_id, stream_type, stream_version, event_type, event_data, event_metadata)
    VALUES (
      gen_random_uuid(), 'permission', 1, 'permission.defined',
      '{"applet": "partner", "action": "view_analytics", "description": "View usage analytics data via VAR partnership grant (PHI-restricted by var_default terms)", "scope_type": "org", "requires_mfa": false}'::jsonb,
      '{"user_id": "00000000-0000-0000-0000-000000000000", "reason": "Phase 1 step 10: seed partner.view_analytics (var_default template member)"}'::jsonb
    );
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.permissions_projection
    WHERE applet = 'partner' AND action = 'view_support_tickets'
  ) THEN
    INSERT INTO public.domain_events (stream_id, stream_type, stream_version, event_type, event_data, event_metadata)
    VALUES (
      gen_random_uuid(), 'permission', 1, 'permission.defined',
      '{"applet": "partner", "action": "view_support_tickets", "description": "View provider org support tickets via VAR partnership grant (PHI-restricted)", "scope_type": "org", "requires_mfa": false}'::jsonb,
      '{"user_id": "00000000-0000-0000-0000-000000000000", "reason": "Phase 1 step 10: seed partner.view_support_tickets (var_default template member)"}'::jsonb
    );
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.permissions_projection
    WHERE applet = 'partner' AND action = 'view_billing_reports'
  ) THEN
    INSERT INTO public.domain_events (stream_id, stream_type, stream_version, event_type, event_data, event_metadata)
    VALUES (
      gen_random_uuid(), 'permission', 1, 'permission.defined',
      '{"applet": "partner", "action": "view_billing_reports", "description": "View provider org billing/usage reports via VAR partnership grant (PHI-restricted)", "scope_type": "org", "requires_mfa": false}'::jsonb,
      '{"user_id": "00000000-0000-0000-0000-000000000000", "reason": "Phase 1 step 10: seed partner.view_billing_reports (var_default template member)"}'::jsonb
    );
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.permissions_projection
    WHERE applet = 'partner' AND action = 'export_reports'
  ) THEN
    INSERT INTO public.domain_events (stream_id, stream_type, stream_version, event_type, event_data, event_metadata)
    VALUES (
      gen_random_uuid(), 'permission', 1, 'permission.defined',
      '{"applet": "partner", "action": "export_reports", "description": "Export VAR partnership reports as files (analytics, support, billing — PHI-restricted)", "scope_type": "org", "requires_mfa": false}'::jsonb,
      '{"user_id": "00000000-0000-0000-0000-000000000000", "reason": "Phase 1 step 10: seed partner.export_reports (var_default template member)"}'::jsonb
    );
  END IF;
END $$;


-- =============================================================================
-- Step 11 — 170-RPC @a4c-bucket / @a4c-consultant-callable / @a4c-phase-target
-- =============================================================================
--
-- Per ADR Phase 1 manifest step 11: backfill COMMENT ON FUNCTION tags for ALL
-- api.* RPCs with @a4c-bucket + @a4c-consultant-callable +
-- @a4c-consultant-callable-reason (when applicable) + @a4c-phase-target per
-- the Phase 0.3 matrix (Stage R reconciled 2026-05-29; scope expanded from
-- 104 → 170). Must happen BEFORE Step 12 (codegen) so the script has
-- deterministic input.
--
-- Post-Step-7 transformation: the 10 C-legacy RPCs (the must-pair set with
-- Step 1's DISTINCT ON tightening) flip from `C-legacy` to `C` post-
-- normalization. The mapping below reflects the POST-Phase-1 state, so the
-- 10 are tagged `@a4c-bucket: C`.
--
-- Mapping source: documentation/architecture/authorization/cross-tenant-
-- access-grant-rpc-reachability-matrix.md § The matrix (170 rows). Extracted
-- mechanically by parsing the markdown table — names verified against live
-- pg_proc (Stage B probe 5 / Stage R reconciliation set diff).
--
-- Idempotency: COMMENT ON FUNCTION has replace-semantics. Re-runs strip any
-- prior @a4c-* tags from the existing description and re-apply the canonical
-- set from this mapping. Existing prose (e.g., from baseline_v4 or PR-#43-
-- style manually-written comments) is preserved by appending the tag block
-- to whatever remains after the strip.
--
-- F2 lesson from Step 10 (per architect 2026-06-02): COMMENT ON FUNCTION
-- does NOT emit domain events — it's pure pg_catalog metadata. So the
-- dead-code EXCEPTION WHEN unique_violation guard pattern does not apply
-- here. COMMENT is naturally idempotent.
--
-- Bucket → derived tags rule:
--   A             → callable=no, phase=3, reason=early-return tenancy guard
--                   (PR #66 pattern); forward-incompatible with grant-bearers;
--                   Phase 3 refactor target.
--   A-variant     → same as A (RAISE-not-RETURN variant of strict-A).
--   B             → callable=no, phase=none, reason=JWT-bound; consultant
--                   variant deferred to case-by-case Phase 2+ work.
--   C             → callable=yes, phase=none, reason=scope-path-bound
--                   has_effective_permission; forward-compatible with
--                   multi-scope grants.
--   D             → callable=pending-phase4-rls, phase=4, reason=entity-lookup
--                   with RLS-enforced tenancy; per-table RLS audit in Phase 4.
--   D-variant     → same as D (admin-override branch + load-bearing RLS).
--   E             → callable=yes, phase=none, reason=no tenancy context;
--                   grant-irrelevant by default. Per-RPC sub-classification
--                   ([admin-only] / [service-role-only] / [pre-auth] /
--                   [emitter-primitive]) deferred to a follow-up that the
--                   matrix-doc codegen (Step 12) will surface.
--   E-variant     → same as E (mixed self-context + org-admin predicate).
--
-- Assertion: a final scan verifies that EVERY api.* function carries the
-- @a4c-bucket tag. Functions in pg_proc.api.* that were NOT in the matrix-
-- doc mapping (e.g., added in unrelated work after 2026-05-29 Stage R
-- reconciliation) RAISE EXCEPTION so the deploy fails fast — surfaces
-- post-reconciliation drift immediately rather than letting it propagate
-- into the codegen output.

DO $$
DECLARE
  v_mapping jsonb := $json$
  [
    {"n":"add_client_address","b":"B"}
    ,{"n":"add_client_email","b":"B"}
    ,{"n":"add_client_funding_source","b":"B"}
    ,{"n":"add_client_insurance","b":"B"}
    ,{"n":"add_client_phone","b":"B"}
    ,{"n":"add_user_phone","b":"D"}
    ,{"n":"admit_client","b":"B"}
    ,{"n":"assign_client_contact","b":"B"}
    ,{"n":"assign_client_to_user","b":"B"}
    ,{"n":"assign_user_to_schedule","b":"C"}
    ,{"n":"batch_update_field_definitions","b":"B"}
    ,{"n":"bulk_assign_role","b":"C"}
    ,{"n":"change_client_placement","b":"B"}
    ,{"n":"check_field_definitions_exist","b":"E"}
    ,{"n":"check_invitation_acceptance_eligibility","b":"E"}
    ,{"n":"check_organization_by_name","b":"E"}
    ,{"n":"check_organization_by_slug","b":"E"}
    ,{"n":"check_pending_invitation","b":"D"}
    ,{"n":"check_user_exists","b":"E"}
    ,{"n":"check_user_invitation_existence","b":"E"}
    ,{"n":"check_user_org_membership","b":"D"}
    ,{"n":"create_field_category","b":"B"}
    ,{"n":"create_field_definition","b":"B"}
    ,{"n":"create_organization_address","b":"C"}
    ,{"n":"create_organization_contact","b":"C"}
    ,{"n":"create_organization_phone","b":"C"}
    ,{"n":"create_organization_unit","b":"C"}
    ,{"n":"create_role","b":"B"}
    ,{"n":"create_schedule_template","b":"C"}
    ,{"n":"deactivate_all_field_definitions","b":"E"}
    ,{"n":"deactivate_field_category","b":"B"}
    ,{"n":"deactivate_field_definition","b":"B"}
    ,{"n":"deactivate_organization","b":"E"}
    ,{"n":"deactivate_organization_unit","b":"C"}
    ,{"n":"deactivate_role","b":"B"}
    ,{"n":"deactivate_schedule_template","b":"C"}
    ,{"n":"deactivate_user","b":"E"}
    ,{"n":"delete_field_category","b":"B"}
    ,{"n":"delete_field_definition","b":"B"}
    ,{"n":"delete_organization_address","b":"C"}
    ,{"n":"delete_organization_contact","b":"C"}
    ,{"n":"delete_organization","b":"E"}
    ,{"n":"delete_organization_phone","b":"C"}
    ,{"n":"delete_organization_unit","b":"C"}
    ,{"n":"delete_role","b":"B"}
    ,{"n":"delete_schedule_template","b":"C"}
    ,{"n":"delete_user","b":"E"}
    ,{"n":"discharge_client","b":"B"}
    ,{"n":"dismiss_failed_event","b":"E"}
    ,{"n":"emit_domain_event","b":"E"}
    ,{"n":"emit_workflow_started_event","b":"E"}
    ,{"n":"end_client_placement","b":"B"}
    ,{"n":"find_contacts_by_phone","b":"D"}
    ,{"n":"get_addresses_by_org","b":"D"}
    ,{"n":"get_assignable_roles","b":"D"}
    ,{"n":"get_bootstrap_status","b":"D"}
    ,{"n":"get_category_field_count","b":"B"}
    ,{"n":"get_child_organizations","b":"E"}
    ,{"n":"get_client","b":"B"}
    ,{"n":"get_contacts_by_org","b":"D"}
    ,{"n":"get_current_org_unit","b":"B"}
    ,{"n":"get_emails_by_org","b":"D"}
    ,{"n":"get_event_processing_stats","b":"E"}
    ,{"n":"get_events_by_correlation","b":"E"}
    ,{"n":"get_events_by_session","b":"E"}
    ,{"n":"get_failed_events","b":"E"}
    ,{"n":"get_failed_events_with_detail","b":"E"}
    ,{"n":"get_field_usage_count","b":"B"}
    ,{"n":"get_invitation_by_id","b":"D"}
    ,{"n":"get_invitation_by_org_and_email","b":"D"}
    ,{"n":"get_invitation_by_token","b":"D"}
    ,{"n":"get_invitation_for_resend","b":"D"}
    ,{"n":"get_organization_by_id","b":"D"}
    ,{"n":"get_organization_details","b":"D"}
    ,{"n":"get_organization_direct_care_settings","b":"D"}
    ,{"n":"get_organization_name","b":"D"}
    ,{"n":"get_organizations","b":"E"}
    ,{"n":"get_organizations_paginated","b":"E"}
    ,{"n":"get_organization_unit_by_id","b":"C"}
    ,{"n":"get_organization_unit_descendants","b":"C"}
    ,{"n":"get_organization_units","b":"C"}
    ,{"n":"get_orphaned_deletions","b":"E"}
    ,{"n":"get_pending_invitations_by_org","b":"D"}
    ,{"n":"get_permission_ids_by_names","b":"E"}
    ,{"n":"get_permissions","b":"E"}
    ,{"n":"get_person_phones","b":"D"}
    ,{"n":"get_phones_by_org","b":"D"}
    ,{"n":"get_role_by_id","b":"D"}
    ,{"n":"get_role_by_name_and_org","b":"D"}
    ,{"n":"get_role_by_name","b":"D"}
    ,{"n":"get_role_permission_names","b":"D"}
    ,{"n":"get_role_permission_templates","b":"E"}
    ,{"n":"get_roles","b":"B"}
    ,{"n":"get_schedule_template","b":"B"}
    ,{"n":"get_trace_timeline","b":"E"}
    ,{"n":"get_user_addresses","b":"D"}
    ,{"n":"get_user_addresses_for_org","b":"D-variant"}
    ,{"n":"get_user_by_id","b":"D"}
    ,{"n":"get_user_notification_preferences","b":"B"}
    ,{"n":"get_user_org_access","b":"B"}
    ,{"n":"get_user_org_details","b":"D"}
    ,{"n":"get_user_permissions","b":"E"}
    ,{"n":"get_user_phones","b":"D"}
    ,{"n":"get_user_phones_for_org","b":"D"}
    ,{"n":"get_user_sms_phones","b":"D"}
    ,{"n":"list_clients","b":"B"}
    ,{"n":"list_field_categories","b":"B"}
    ,{"n":"list_field_definitions","b":"B"}
    ,{"n":"list_field_definition_templates","b":"E"}
    ,{"n":"list_invitations","b":"A-variant"}
    ,{"n":"list_roles_for_user","b":"D"}
    ,{"n":"list_schedule_templates","b":"D"}
    ,{"n":"list_system_field_categories","b":"E"}
    ,{"n":"list_user_client_assignments","b":"D"}
    ,{"n":"list_user_org_access","b":"E"}
    ,{"n":"list_user_organizations","b":"E-variant"}
    ,{"n":"list_users","b":"A"}
    ,{"n":"list_users_for_bulk_assignment","b":"C"}
    ,{"n":"list_users_for_role_management","b":"C"}
    ,{"n":"list_users_for_schedule_management","b":"C"}
    ,{"n":"modify_user_roles","b":"B"}
    ,{"n":"reactivate_field_category","b":"B"}
    ,{"n":"reactivate_field_definition","b":"B"}
    ,{"n":"reactivate_organization","b":"E"}
    ,{"n":"reactivate_organization_unit","b":"C"}
    ,{"n":"reactivate_role","b":"B"}
    ,{"n":"reactivate_schedule_template","b":"C"}
    ,{"n":"register_client","b":"B"}
    ,{"n":"remove_client_address","b":"B"}
    ,{"n":"remove_client_email","b":"B"}
    ,{"n":"remove_client_funding_source","b":"B"}
    ,{"n":"remove_client_insurance","b":"B"}
    ,{"n":"remove_client_phone","b":"B"}
    ,{"n":"remove_user_phone","b":"E"}
    ,{"n":"resend_invitation","b":"E"}
    ,{"n":"retry_deletion_workflow","b":"E"}
    ,{"n":"retry_failed_event","b":"E"}
    ,{"n":"revoke_invitation","b":"D"}
    ,{"n":"safety_net_deactivate_organization","b":"E"}
    ,{"n":"soft_delete_organization_addresses","b":"E"}
    ,{"n":"soft_delete_organization_contacts","b":"E"}
    ,{"n":"soft_delete_organization_phones","b":"E"}
    ,{"n":"switch_org_unit","b":"B"}
    ,{"n":"sync_role_assignments","b":"C"}
    ,{"n":"sync_schedule_assignments","b":"E"}
    ,{"n":"unassign_client_contact","b":"B"}
    ,{"n":"unassign_client_from_user","b":"B"}
    ,{"n":"unassign_user_from_schedule","b":"C"}
    ,{"n":"undismiss_failed_event","b":"E"}
    ,{"n":"update_client_address","b":"B"}
    ,{"n":"update_client","b":"B"}
    ,{"n":"update_client_email","b":"B"}
    ,{"n":"update_client_funding_source","b":"B"}
    ,{"n":"update_client_insurance","b":"B"}
    ,{"n":"update_client_phone","b":"B"}
    ,{"n":"update_field_category","b":"B"}
    ,{"n":"update_field_definition","b":"B"}
    ,{"n":"update_organization_address","b":"C"}
    ,{"n":"update_organization","b":"C"}
    ,{"n":"update_organization_contact","b":"C"}
    ,{"n":"update_organization_direct_care_settings","b":"E"}
    ,{"n":"update_organization_phone","b":"C"}
    ,{"n":"update_organization_unit","b":"C"}
    ,{"n":"update_role","b":"B"}
    ,{"n":"update_schedule_template","b":"C"}
    ,{"n":"update_user_access_dates","b":"B"}
    ,{"n":"update_user","b":"D"}
    ,{"n":"update_user_notification_preferences","b":"D"}
    ,{"n":"update_user_phone","b":"B"}
    ,{"n":"validate_role_assignment","b":"C"}
  ]
  $json$::jsonb;

  v_entry            jsonb;
  v_proname          text;
  v_bucket           text;
  v_callable         text;
  v_phase_target     text;
  v_reason           text;
  v_overload         record;
  v_existing_comment text;
  v_new_comment      text;
  v_tag_count        integer := 0;
  v_overload_count   integer := 0;
  v_matrix_entries_absent_from_pg    text := '';
BEGIN
  FOR v_entry IN SELECT * FROM jsonb_array_elements(v_mapping)
  LOOP
    v_proname := v_entry->>'n';
    v_bucket  := v_entry->>'b';

    -- Derive callable + phase_target + reason from bucket. Generic per-bucket
    -- reasons; the matrix doc has richer per-RPC text that the Step 12
    -- codegen (or a follow-up) can re-emit at full fidelity.
    CASE v_bucket
      WHEN 'A' THEN
        v_callable     := 'pending-phase3-refactor';
        v_phase_target := '3';
        v_reason       := 'Early-return tenancy guard (PR #66 strict-A pattern); forward-incompatible with grant-bearers; Phase 3 refactor target.';
      WHEN 'A-variant' THEN
        v_callable     := 'pending-phase3-refactor';
        v_phase_target := '3';
        v_reason       := 'A-variant: same equality-check shape as strict-A but RAISEs instead of RETURNs; Phase 3 refactor target.';
      WHEN 'B' THEN
        v_callable     := 'no';
        v_phase_target := 'none';
        v_reason       := 'JWT-bound (derives org via get_current_org_id); consultant variant deferred to case-by-case Phase 2+ work.';
      WHEN 'C' THEN
        v_callable     := 'yes';
        v_phase_target := 'none';
        v_reason       := 'Scope-path-bound has_effective_permission; forward-compatible with multi-scope grants under Phase 1 tightened DISTINCT ON.';
      WHEN 'D' THEN
        v_callable     := 'pending-phase4-rls';
        v_phase_target := '4';
        v_reason       := 'Entity-lookup signature with RLS-enforced tenancy; per-table RLS extension required in Phase 4.';
      WHEN 'D-variant' THEN
        v_callable     := 'pending-phase4-rls';
        v_phase_target := '4';
        -- N1 fold-in 2026-06-02: match the E branch's "deferred follow-up"
        -- forward-pointer so future readers see the deferral at the
        -- pg_description surface, not just the migration header.
        v_reason       := 'D-variant: has_platform_privilege() admin-override branch combined with load-bearing RLS; Phase 4 per-table audit applies. Per-RPC sub-classification (e.g., [admin-only] vs strict-D) deferred to Step 12 codegen follow-up.';
      WHEN 'E' THEN
        v_callable     := 'yes';
        v_phase_target := 'none';
        v_reason       := 'No tenancy context; grant-irrelevant by default. Per-RPC sub-classification ([admin-only] / [service-role-only] / [pre-auth] / [emitter-primitive]) deferred to follow-up.';
      WHEN 'E-variant' THEN
        v_callable     := 'yes';
        v_phase_target := 'none';
        v_reason       := 'E-variant: sui generis (mixed self-context + org-admin predicate).';
      ELSE
        RAISE EXCEPTION 'Step 11 internal error: unknown bucket % for api.%', v_bucket, v_proname
          USING ERRCODE = 'P9001';
    END CASE;

    -- Find ALL overloads of api.<proname> in pg_proc. Each overload gets the
    -- same logical tag set (matrix-doc classification is by function name,
    -- not by signature). If proname has zero overloads, accumulate into
    -- v_matrix_entries_absent_from_pg for the final assertion.
    v_overload_count := 0;
    FOR v_overload IN
      SELECT p.oid,
             pg_get_function_identity_arguments(p.oid) AS args,
             obj_description(p.oid, 'pg_proc') AS existing_comment
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'api'
        AND p.prokind = 'f'
        AND p.proname = v_proname
    LOOP
      v_existing_comment := COALESCE(v_overload.existing_comment, '');

      -- Strip any prior @a4c-bucket / @a4c-consultant-callable /
      -- @a4c-consultant-callable-reason / @a4c-phase-target tags. Existing
      -- @a4c-rpc-shape (M3) is preserved — the regexes target only the four
      -- Step 11 tags.
      v_new_comment := regexp_replace(v_existing_comment, '\n*@a4c-bucket:\s*\S+', '', 'g');
      v_new_comment := regexp_replace(v_new_comment, '\n*@a4c-consultant-callable-reason:[^\n]*', '', 'g');
      v_new_comment := regexp_replace(v_new_comment, '\n*@a4c-consultant-callable:\s*\S+', '', 'g');
      v_new_comment := regexp_replace(v_new_comment, '\n*@a4c-phase-target:\s*\S+', '', 'g');
      v_new_comment := rtrim(v_new_comment);

      IF v_new_comment <> '' THEN
        v_new_comment := v_new_comment || E'\n\n';
      END IF;

      v_new_comment := v_new_comment
                    || '@a4c-bucket: ' || v_bucket || E'\n'
                    || '@a4c-consultant-callable: ' || v_callable || E'\n'
                    || '@a4c-consultant-callable-reason: ' || v_reason || E'\n'
                    || '@a4c-phase-target: ' || v_phase_target;

      EXECUTE format(
        'COMMENT ON FUNCTION api.%I(%s) IS %L',
        v_proname, v_overload.args, v_new_comment
      );

      v_overload_count := v_overload_count + 1;
      v_tag_count := v_tag_count + 1;
    END LOOP;

    IF v_overload_count = 0 THEN
      -- Mapping-doc-says-it-exists-but-pg_proc-disagrees. Accumulate for the
      -- final assertion below — surfaces matrix-doc drift since 2026-05-29.
      IF v_matrix_entries_absent_from_pg <> '' THEN
        v_matrix_entries_absent_from_pg := v_matrix_entries_absent_from_pg || ', ';
      END IF;
      v_matrix_entries_absent_from_pg := v_matrix_entries_absent_from_pg || 'api.' || v_proname;
    END IF;
  END LOOP;

  RAISE NOTICE 'Phase 1 Step 11 backfill: tagged % api.* function row(s) across % matrix-doc entries with @a4c-bucket/@a4c-consultant-callable/@a4c-phase-target', v_tag_count, jsonb_array_length(v_mapping);

  IF v_matrix_entries_absent_from_pg <> '' THEN
    RAISE WARNING 'Phase 1 Step 11 — matrix-doc entries with no matching api.* function in pg_proc (matrix-doc post-2026-05-29 drift): %', v_matrix_entries_absent_from_pg;
  END IF;
END $$;


-- -----------------------------------------------------------------------------
-- Step 11 assertion — every api.* function carries the four @a4c-* tags
-- -----------------------------------------------------------------------------
--
-- Catches the inverse drift: api.* functions that exist in pg_proc but were
-- NOT in the matrix-doc mapping (added by unrelated work after Stage R
-- reconciliation, or matrix-doc typos that bypassed the loop above).
-- RAISE EXCEPTION fails the migration deploy fast — surfaces drift
-- immediately rather than letting it propagate into the Step 12 codegen.

DO $$
DECLARE
  v_untagged_count  integer;
  v_first_untagged  text;
  v_untagged_list   text;
BEGIN
  SELECT
    COUNT(*),
    MIN(p.proname),
    string_agg(p.proname, ', ' ORDER BY p.proname)
  INTO v_untagged_count, v_first_untagged, v_untagged_list
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  LEFT JOIN pg_description d ON d.objoid = p.oid AND d.objsubid = 0
  WHERE n.nspname = 'api'
    AND p.prokind = 'f'
    AND (
      d.description IS NULL
      -- F1 fold-in 2026-06-02 architect review: alternation ORDERED LONGEST-FIRST
      -- per-prefix. PG POSIX regex matches alternation left-to-right at each
      -- position; a bare `A` alternative listed before `A-variant` would
      -- greedy-match `A` on `@a4c-bucket: A-variant` (the position between `A`
      -- and `-` satisfies `\b`), silently masking malformed values like
      -- `@a4c-bucket: A-something-junk`. Listing the variants first ensures
      -- the assertion fails on garbage rather than accepting `A` as a prefix.
      OR d.description !~ '@a4c-bucket:\s*(A-variant|A|B|C|D-variant|D|E-variant|E)\b'
      OR d.description !~ '@a4c-consultant-callable:\s*\S+'
      OR d.description !~ '@a4c-phase-target:\s*\S+'
    );

  IF v_untagged_count > 0 THEN
    RAISE EXCEPTION
      'Phase 1 Step 11 assertion failed: % api.* function(s) lack required @a4c-bucket / @a4c-consultant-callable / @a4c-phase-target tags. First untagged: api.%. Full list: %. These functions either post-date the 2026-05-29 Stage R reconciliation OR the matrix-doc mapping in this step missed them. Update the matrix doc + this step''s v_mapping JSONB.',
      v_untagged_count, v_first_untagged, v_untagged_list
      USING ERRCODE = 'P9001';
  END IF;

  RAISE NOTICE 'Phase 1 Step 11 assertion: all api.* functions carry @a4c-bucket + @a4c-consultant-callable + @a4c-phase-target tags (matrix-doc deterministic input ready for Step 12 codegen)';
END $$;


-- =============================================================================
-- End of Phase 1 migration (drafting in progress — Steps 14-15 pending)
-- =============================================================================
-- (Steps 12-13 are file additions — codegen script + CI workflow — not SQL.)
