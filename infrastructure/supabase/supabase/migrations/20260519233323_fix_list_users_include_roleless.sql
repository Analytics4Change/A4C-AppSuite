-- ============================================================================
-- Migration: fix_list_users_include_roleless
-- Origin:    dev/active/users-list-omits-roleless-members/ (PR #64 UAT T2 finding)
-- ============================================================================
--
-- Problem
-- -------
-- api.list_users(p_org_id, ...) filtered by
--   WHERE EXISTS (SELECT 1 FROM user_roles_projection ur
--                 WHERE ur.user_id = u.id AND ur.organization_id = p_org_id)
-- This excludes "zombie" users -- users who joined the org (have a row in
-- user_organizations_projection, are tracked in users.accessible_organizations)
-- but have zero role rows. Such users become invisible to org admins, which
-- is HIPAA-adjacent (admins should be able to see anyone the platform tracks
-- as a member of their org) and breaks audit/cleanup workflows.
--
-- Discovered subject on dev: lars.tice+test3@gmail.com (UUID 2269bdb4-...)
-- was invited to testorg with an empty roles array on 2026-05-06, accepted
-- on 2026-05-11, never had a role assigned, and was invisible in testorg's
-- UI despite being a known platform member.
--
-- Fix
-- ---
-- Replace the role-EXISTS predicate with array-containment against the
-- canonical membership oracle:
--
--   WHERE u.accessible_organizations @> ARRAY[p_org_id]::uuid[]
--
-- The accessible_organizations uuid[] column on public.users is maintained
-- by trigger trg_sync_accessible_orgs (AFTER INSERT/UPDATE/DELETE on
-- user_organizations_projection -> sync_accessible_organizations()) which
-- recomputes the array from current projection state. Membership oracle
-- stays consistent by construction.
--
-- Predicate shape note: PostgreSQL's GIN `array_ops` opclass indexes the
-- containment operators (`@>`, `<@`, `&&`, `=`) but NOT the `scalar = ANY(col)`
-- form. The earlier draft of this migration used `= ANY` and the GIN index
-- below would have been dead weight. The `@>` form makes the index load-
-- bearing (Bitmap Index Scan as the user table grows).
--
-- The per-user roles aggregation (jsonb_agg over user_roles_projection
-- filtered to p_org_id) is unchanged -- users with zero roles get
-- '[]'::jsonb via COALESCE, which the frontend (UserCard.tsx) renders as
-- "No roles assigned".
--
-- Tenancy guard
-- -------------
-- The pre-PR role-EXISTS predicate was an implicit (and unreliable)
-- authorization proxy: you had to have a role in the org to be visible.
-- The new membership predicate broadens what's enumerable (a single org-
-- membership row surfaces PII: email, first_name, last_name, last_login).
-- Since this RPC is SECURITY DEFINER and granted EXECUTE to `authenticated`,
-- callers can otherwise enumerate any org by guessing a UUID. Per
-- infrastructure/supabase/CLAUDE.md § "Choosing between has_permission() and
-- has_effective_permission()", users-as-identity has no organizational
-- location finer than tenant -- so the tenancy-guard pattern applies:
-- platform privilege OR caller is acting in this org. Cross-tenant callers
-- get an empty result set (indistinguishable from "no members").
--
-- Single-pass query (COUNT(*) OVER ())
-- ------------------------------------
-- The prior body duplicated the membership + status + search predicate block
-- in BOTH a count subquery AND the SELECT, creating a drift hazard on every
-- future filter change. Refactored to a single SELECT with `COUNT(*) OVER ()`
-- so the predicate lives in ONE place. Precedent: api.get_organizations_paginated()
-- (baseline_v4.sql L3181, also extended in 20260306214844...sql L160).
-- Empty result set semantics: when zero rows match, no row is emitted and
-- total_count of 0 is implicit (matches the existing get_organizations_paginated()
-- contract; consumers already treat an empty rowset as count=0).
--
-- Performance
-- -----------
-- The GIN index idx_users_accessible_orgs_gin (created here, IF NOT EXISTS)
-- backs the `@>` predicate. EXPLAIN on dev: Bitmap Index Scan kicks in once
-- the row count exceeds the planner's seq-scan threshold (small dev tables
-- still prefer Seq Scan; that's correct planner behavior).
--
-- Two-write ordering note (acknowledgement)
-- -----------------------------------------
-- handle_user_invited (baseline_v4.sql L9210-9216) writes
-- users.accessible_organizations via array union BEFORE inserting into
-- user_organizations_projection. Both writes happen in the same handler
-- so the sync trigger reconciles immediately and the membership invariant
-- holds today. A future refactor that splits these writes across separate
-- event handlers would create a window of divergence -- if that refactor
-- ever lands, audit accessibility-array maintenance in the new sequence.
--
-- Scope
-- -----
-- Only api.list_users carried the exact role-EXISTS pattern this PR repairs.
-- The three sister functions (list_users_for_role_management,
-- list_users_for_bulk_assignment, list_users_for_schedule_management) gate
-- by u.current_organization_id instead -- a DIFFERENT membership-gating
-- smell. Seeded as a separate follow-up card:
-- dev/active/list-users-sister-functions-membership-gating/
--
-- Idempotent: CREATE INDEX IF NOT EXISTS + CREATE OR REPLACE FUNCTION.
-- ============================================================================

-- GIN index supporting `accessible_organizations @> ARRAY[p_org_id]::uuid[]`
-- containment lookups in api.list_users (and forthcoming sister fixes).
CREATE INDEX IF NOT EXISTS idx_users_accessible_orgs_gin
  ON public.users USING GIN (accessible_organizations);

CREATE OR REPLACE FUNCTION api.list_users(
  p_org_id      uuid,
  p_status      text    DEFAULT NULL,
  p_search_term text    DEFAULT NULL,
  p_sort_by     text    DEFAULT 'name',
  p_sort_desc   boolean DEFAULT false,
  p_page        integer DEFAULT 1,
  p_page_size   integer DEFAULT 20
) RETURNS TABLE(
  id          uuid,
  email       text,
  first_name  text,
  last_name   text,
  name        text,
  is_active   boolean,
  deleted_at  timestamp with time zone,
  created_at  timestamp with time zone,
  updated_at  timestamp with time zone,
  last_login  timestamp with time zone,
  roles       jsonb,
  total_count bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'api'
AS $function$
BEGIN
  -- Tenancy guard: platform admins OR callers acting in this org only.
  -- Cross-tenant callers get an empty result (indistinguishable from "no
  -- members"). See header comment for rationale.
  IF NOT (
    public.has_platform_privilege()
    OR p_org_id = public.get_current_org_id()
  ) THEN
    RETURN;
  END IF;

  -- Single-pass query: predicate lives in ONE place. COUNT(*) OVER ()
  -- computes the total over the filtered rowset BEFORE LIMIT/OFFSET so
  -- pagination math stays correct.
  RETURN QUERY
  SELECT
    u.id,
    u.email,
    u.first_name,
    u.last_name,
    u.name,
    u.is_active,
    u.deleted_at,
    u.created_at,
    u.updated_at,
    u.last_login,
    COALESCE(
      (SELECT jsonb_agg(jsonb_build_object(
        'role_id',   ur.role_id,
        'role_name', r.name
      ))
      FROM public.user_roles_projection ur
      JOIN public.roles_projection r ON r.id = ur.role_id
      WHERE ur.user_id = u.id
        AND ur.organization_id = p_org_id),
      '[]'::jsonb
    ) AS roles,
    COUNT(*) OVER () AS total_count
  FROM public.users u
  WHERE u.accessible_organizations @> ARRAY[p_org_id]::uuid[]
  AND (
    CASE
      WHEN p_status = 'active'      THEN u.is_active = TRUE  AND u.deleted_at IS NULL
      WHEN p_status = 'deactivated' THEN u.is_active = FALSE AND u.deleted_at IS NULL
      WHEN p_status = 'deleted'     THEN u.deleted_at IS NOT NULL
      ELSE u.deleted_at IS NULL  -- default: exclude soft-deleted
    END
  )
  AND (p_search_term IS NULL
       OR u.email ILIKE '%' || p_search_term || '%'
       OR u.name  ILIKE '%' || p_search_term || '%')
  ORDER BY
    CASE WHEN NOT p_sort_desc THEN
      CASE p_sort_by
        WHEN 'name'       THEN u.name
        WHEN 'email'      THEN u.email
        WHEN 'created_at' THEN u.created_at::TEXT
        ELSE u.name
      END
    END ASC NULLS LAST,
    CASE WHEN p_sort_desc THEN
      CASE p_sort_by
        WHEN 'name'       THEN u.name
        WHEN 'email'      THEN u.email
        WHEN 'created_at' THEN u.created_at::TEXT
        ELSE u.name
      END
    END DESC NULLS LAST
  LIMIT p_page_size
  OFFSET (p_page - 1) * p_page_size;
END;
$function$;

-- Per infrastructure-guidelines Rule 17 / supabase/CLAUDE.md "RPC Shape Registry":
-- re-emit the RPC shape tag. CREATE OR REPLACE preserves the existing COMMENT,
-- but defensive re-issue guards against future DROP+CREATE losing it.
COMMENT ON FUNCTION api.list_users(uuid, text, text, text, boolean, integer, integer) IS
$comment$List users in an organization with pagination and filtering. Membership gated by users.accessible_organizations (the canonical membership oracle, maintained by trg_sync_accessible_orgs from user_organizations_projection). Tenancy-guarded via has_platform_privilege() OR get_current_org_id() match. Status values: active, deactivated, deleted (or NULL for all non-deleted).

@a4c-rpc-shape: read$comment$;
