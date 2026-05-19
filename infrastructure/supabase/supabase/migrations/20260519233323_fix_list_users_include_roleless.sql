-- ============================================================================
-- Migration: fix_list_users_include_roleless
-- Origin:    dev/active/users-list-omits-roleless-members/ (PR #64 UAT T2 finding)
-- ============================================================================
--
-- Problem
-- -------
-- api.list_users(p_org_id, ...) currently filters by
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
-- Replace the role-EXISTS predicate (in both the count subquery and the
-- SELECT) with `p_org_id = ANY(u.accessible_organizations)`. The
-- accessible_organizations uuid[] column on public.users is maintained by
-- trigger trg_sync_accessible_orgs (AFTER INSERT/UPDATE/DELETE on
-- user_organizations_projection -> sync_accessible_organizations()) which
-- recomputes the array from current projection state. Membership oracle
-- stays consistent by construction.
--
-- The per-user roles aggregation (jsonb_agg over user_roles_projection
-- filtered to p_org_id) is unchanged -- users with zero roles get
-- '[]'::jsonb via COALESCE, which the frontend renders as "No roles
-- assigned".
--
-- Performance
-- -----------
-- public.users had no supporting index for the array-membership predicate;
-- a btree on uuid[] is useless for `= ANY(...)`. Add a GIN index so the
-- common admin-list refresh is an Index Scan rather than a Seq Scan as the
-- user table grows.
--
-- Scope
-- -----
-- Only api.list_users carries this exact role-EXISTS pattern. The three
-- sister functions (list_users_for_role_management,
-- list_users_for_bulk_assignment, list_users_for_schedule_management) gate
-- by u.current_organization_id instead -- a DIFFERENT membership-gating
-- smell that makes multi-org users invisible in role/schedule admin UIs.
-- Seeded as a separate follow-up card; out of scope here.
--
-- Idempotent: CREATE INDEX IF NOT EXISTS + CREATE OR REPLACE FUNCTION.
-- ============================================================================

-- GIN index supporting `p_org_id = ANY(u.accessible_organizations)` lookups.
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
DECLARE
  v_total_count BIGINT;
BEGIN
  -- Total count for pagination
  SELECT COUNT(DISTINCT u.id)
  INTO v_total_count
  FROM public.users u
  WHERE p_org_id = ANY(u.accessible_organizations)
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
       OR u.name  ILIKE '%' || p_search_term || '%');

  -- Users + their roles for the page
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
    v_total_count AS total_count
  FROM public.users u
  WHERE p_org_id = ANY(u.accessible_organizations)
  AND (
    CASE
      WHEN p_status = 'active'      THEN u.is_active = TRUE  AND u.deleted_at IS NULL
      WHEN p_status = 'deactivated' THEN u.is_active = FALSE AND u.deleted_at IS NULL
      WHEN p_status = 'deleted'     THEN u.deleted_at IS NOT NULL
      ELSE u.deleted_at IS NULL
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
$comment$List users in an organization with pagination and filtering. Membership gated by users.accessible_organizations (the canonical membership oracle, maintained by trg_sync_accessible_orgs from user_organizations_projection). Status values: active, deactivated, deleted (or NULL for all non-deleted).

@a4c-rpc-shape: read$comment$;
