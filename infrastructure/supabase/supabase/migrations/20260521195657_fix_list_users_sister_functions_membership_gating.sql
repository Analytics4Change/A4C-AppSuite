-- ============================================================================
-- Migration: fix_list_users_sister_functions_membership_gating
-- Origin:    dev/active/list-users-sister-functions-membership-gating/
-- Precedent: PR #66 (merged 2026-05-20, commit 33e77a4f) — established the
--            `accessible_organizations @> ARRAY[<uuid>]::uuid[]` convention
--            for membership-gated user-listing RPCs.
-- ============================================================================
--
-- Problem
-- -------
-- Three sister RPCs to api.list_users carry a different but related smell:
-- they gate user-list membership by `u.current_organization_id = v_org_id`.
-- `current_organization_id` is the user's ACTIVE SESSION pointer (per memory,
-- set via api.switch_org_unit at clock-in for direct-care staff; NULL for
-- super_admin and platform-only users). It is NOT the membership oracle.
--
-- Consequence pre-fix: multi-org users (users with a row in
-- user_organizations_projection for multiple orgs) are invisible in
-- role-management, bulk-assignment, and schedule-assignment admin UIs unless
-- their `current_organization_id` happens to match the target org. Same gap
-- as PR #66's api.list_users, on three additional surfaces.
--
-- Today on dev the defect is dormant (no multi-org users exist), but it
-- will become routine when the cross-tenant grant pipeline ships per
-- dev/active/sub-tenant-admin-design/.
--
-- Fix
-- ---
-- Replace the predicate in all three function bodies:
--
--   BEFORE: WHERE u.current_organization_id = v_org_id
--   AFTER:  WHERE u.accessible_organizations @> ARRAY[v_org_id]::uuid[]
--
-- `users.accessible_organizations` (uuid[]) is the canonical membership
-- oracle, maintained by trigger trg_sync_accessible_orgs from
-- user_organizations_projection. Same predicate shape PR #66 established
-- for api.list_users; reuses the GIN index idx_users_accessible_orgs_gin
-- created in that PR.
--
-- Predicate-shape note (re-stated from PR #66): PostgreSQL's GIN array_ops
-- opclass indexes the containment operators (@>, <@, &&, =) but NOT
-- `scalar = ANY(col)`. The `@>` form is the GIN-indexable shape; do not
-- rewrite to `= ANY` without dropping the index.
--
-- Scope decisions (per architect-reviewed plan)
-- ---------------------------------------------
-- - NOT changing the per-function permission gates (each RPC already has
--   one: has_effective_permission('user.role_assign', p_scope_path) for the
--   two role-functions; has_effective_permission('user.schedule_manage',
--   <ou_or_org_path>) for schedule_management). The predicate swap broadens
--   what's enumerable AT a given scope, but the scope itself is still
--   gated by the existing checks.
-- - NOT reframing `current_organization_id` semantics — it remains the
--   active-session pointer for direct-care use.
-- - NOT addressing super_admin invisibility. Super_admins on dev have
--   `current_organization_id IS NULL` AND `accessible_organizations IS NULL`.
--   `NULL::uuid[] @> ARRAY[<uuid>]::uuid[]` returns NULL (treated as
--   not-matching by WHERE), so super_admins remain excluded post-fix.
--   They have global permissions and rarely have specific role_id
--   assignments at narrow ltree paths, so this is acceptable. If UX
--   feedback later disagrees, file a separate card.
-- - NOT applying PR #66's COUNT(*) OVER () dedup pattern: these three RPCs
--   don't return total_count; they paginate directly with LIMIT/OFFSET.
--   Pagination total is a consumer-side concern.
--
-- COMMENT prose
-- -------------
-- - list_users_for_bulk_assignment had descriptive COMMENT prose pre-fix:
--   edit to mention `accessible_organizations` as the membership oracle.
-- - list_users_for_role_management and list_users_for_schedule_management
--   carried only the bare `@a4c-rpc-shape: read` tag pre-fix: author full
--   new prose blocks (purpose + membership oracle + permission gate +
--   shape tag), modeled on api.list_users.
--
-- Body-drift anchor (captured 2026-05-21 pre-write — Phase 1.5):
--   list_users_for_bulk_assignment    md5: 49e14e620a8b6fc8900cbc018ad5d6bc
--   list_users_for_role_management    md5: e0805df19e3ae848c51df6a50103d059
--   list_users_for_schedule_management md5: 3a08d7940a5e322e291ed558426706d8
--
-- Idempotent: all three are CREATE OR REPLACE FUNCTION (signature unchanged
-- -> OID preserved -> existing COMMENT preserved; defensive re-emission
-- handles future DROP+CREATE).
--
-- Session search_path note: the `ltree` parameter type lives in the
-- `extensions` schema. The function-body `SET search_path` clauses apply
-- inside the function but NOT during CREATE-time parameter type resolution.
-- Set the migration-session search_path explicitly so `ltree` resolves.
-- ============================================================================

SET search_path = public, extensions, pg_temp;


-- ============================================================================
-- 1/3: api.list_users_for_bulk_assignment
-- ============================================================================

CREATE OR REPLACE FUNCTION api.list_users_for_bulk_assignment(
  p_role_id     uuid,
  p_scope_path  ltree,
  p_search_term text    DEFAULT NULL,
  p_limit       integer DEFAULT 100,
  p_offset      integer DEFAULT 0
)
RETURNS TABLE(
  id                  uuid,
  email               text,
  display_name        text,
  is_active           boolean,
  current_roles       text[],
  is_already_assigned boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE
  v_user_scope extensions.ltree;
  v_org_id UUID;
BEGIN
  -- Get user's scope for permission check
  v_user_scope := public.get_permission_scope('user.role_assign');

  IF v_user_scope IS NULL THEN
    RAISE EXCEPTION 'Missing permission: user.role_assign'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- Verify requested scope is within user's scope
  IF NOT (v_user_scope @> p_scope_path) THEN
    RAISE EXCEPTION 'Requested scope is outside your permission scope'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- Get organization ID from scope path (root of path)
  SELECT o.id INTO v_org_id
  FROM organizations_projection o
  WHERE o.path = subpath(p_scope_path, 0, 1)
    AND o.deleted_at IS NULL;

  IF v_org_id IS NULL THEN
    RAISE EXCEPTION 'Organization not found for scope path'
      USING ERRCODE = 'P0002';
  END IF;

  RETURN QUERY
  WITH user_current_roles AS (
    -- Get current role names for each user
    SELECT
      ur.user_id,
      array_agg(DISTINCT r.name ORDER BY r.name) AS role_names
    FROM user_roles_projection ur
    JOIN roles_projection r ON r.id = ur.role_id
    WHERE r.deleted_at IS NULL
      AND r.is_active = true
    GROUP BY ur.user_id
  ),
  already_assigned AS (
    -- Users already assigned to this role at this scope
    SELECT ur.user_id
    FROM user_roles_projection ur
    WHERE ur.role_id = p_role_id
      AND ur.scope_path = p_scope_path
  )
  SELECT
    u.id,
    u.email::TEXT,
    COALESCE(u.name, u.email)::TEXT AS display_name,  -- Fallback to email if name is null
    u.is_active,
    COALESCE(ucr.role_names, ARRAY[]::TEXT[]) AS current_roles,
    (aa.user_id IS NOT NULL) AS is_already_assigned
  FROM users u
  LEFT JOIN user_current_roles ucr ON ucr.user_id = u.id
  LEFT JOIN already_assigned aa ON aa.user_id = u.id
  -- Membership: canonical oracle is users.accessible_organizations (maintained
  -- by trg_sync_accessible_orgs from user_organizations_projection). Replaces
  -- the previous u.current_organization_id = v_org_id check, which conflated
  -- the active-session pointer with organizational membership. See PR #66 and
  -- migration 20260519233323_fix_list_users_include_roleless.sql for the
  -- convention origin and the GIN-index rationale (idx_users_accessible_orgs_gin).
  WHERE u.accessible_organizations @> ARRAY[v_org_id]::uuid[]
    AND u.deleted_at IS NULL
    AND (
      p_search_term IS NULL
      OR u.name ILIKE '%' || p_search_term || '%'
      OR u.email ILIKE '%' || p_search_term || '%'
    )
  ORDER BY
    is_already_assigned ASC,  -- Non-assigned first
    COALESCE(u.name, u.email) ASC
  LIMIT p_limit
  OFFSET p_offset;
END;
$function$;

-- Edit existing prose to mention accessible_organizations as the membership oracle.
COMMENT ON FUNCTION api.list_users_for_bulk_assignment(uuid, ltree, text, integer, integer) IS
$comment$List users in an organization eligible for bulk role assignment to a specific role at a specific scope. Includes current role names per user and an is_already_assigned flag. Membership gated by users.accessible_organizations (the canonical membership oracle, maintained by trg_sync_accessible_orgs from user_organizations_projection). Permission gated by has_permission('user.role_assign') within the requested scope path.

@a4c-rpc-shape: read$comment$;


-- ============================================================================
-- 2/3: api.list_users_for_role_management
-- ============================================================================

CREATE OR REPLACE FUNCTION api.list_users_for_role_management(
  p_role_id     uuid,
  p_scope_path  ltree,
  p_search_term text    DEFAULT NULL,
  p_limit       integer DEFAULT 100,
  p_offset      integer DEFAULT 0
)
RETURNS TABLE(
  id            uuid,
  email         text,
  display_name  text,
  is_active     boolean,
  current_roles text[],
  is_assigned   boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE
  v_user_scope extensions.ltree;
  v_org_id UUID;
BEGIN
  -- Get user's scope for permission check
  v_user_scope := public.get_permission_scope('user.role_assign');

  IF v_user_scope IS NULL THEN
    RAISE EXCEPTION 'Missing permission: user.role_assign'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- Verify requested scope is within user's scope
  IF NOT (v_user_scope @> p_scope_path) THEN
    RAISE EXCEPTION 'Requested scope is outside your permission scope'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- Get organization ID from scope path (root of path)
  SELECT o.id INTO v_org_id
  FROM organizations_projection o
  WHERE o.path = subpath(p_scope_path, 0, 1)
    AND o.deleted_at IS NULL;

  IF v_org_id IS NULL THEN
    RAISE EXCEPTION 'Organization not found for scope path'
      USING ERRCODE = 'P0002';
  END IF;

  RETURN QUERY
  WITH user_current_roles AS (
    -- Get current role names for each user (all roles, not just this one)
    SELECT
      ur.user_id,
      array_agg(DISTINCT r.name ORDER BY r.name) AS role_names
    FROM user_roles_projection ur
    JOIN roles_projection r ON r.id = ur.role_id
    WHERE r.deleted_at IS NULL
      AND r.is_active = true
    GROUP BY ur.user_id
  ),
  assigned_to_this_role AS (
    -- Users assigned to THIS role at THIS scope
    SELECT ur.user_id
    FROM user_roles_projection ur
    WHERE ur.role_id = p_role_id
      AND ur.scope_path = p_scope_path
  )
  SELECT
    u.id,
    u.email::TEXT,
    COALESCE(u.name, u.email)::TEXT AS display_name,
    u.is_active,
    COALESCE(ucr.role_names, ARRAY[]::TEXT[]) AS current_roles,
    (atr.user_id IS NOT NULL) AS is_assigned
  FROM users u
  LEFT JOIN user_current_roles ucr ON ucr.user_id = u.id
  LEFT JOIN assigned_to_this_role atr ON atr.user_id = u.id
  -- See bulk_assignment comment block above for the membership-oracle rationale.
  WHERE u.accessible_organizations @> ARRAY[v_org_id]::uuid[]
    AND u.deleted_at IS NULL
    AND (
      p_search_term IS NULL
      OR u.name ILIKE '%' || p_search_term || '%'
      OR u.email ILIKE '%' || p_search_term || '%'
    )
  ORDER BY
    is_assigned DESC,  -- Assigned users first (for easier review)
    COALESCE(u.name, u.email) ASC
  LIMIT p_limit
  OFFSET p_offset;
END;
$function$;

-- Author new prose (function previously carried only the bare shape tag).
COMMENT ON FUNCTION api.list_users_for_role_management(uuid, ltree, text, integer, integer) IS
$comment$List users in an organization with their assignment status for a specific role at a specific scope. Returns is_assigned flag distinguishing role-bearing users from candidates. Membership gated by users.accessible_organizations (the canonical membership oracle, maintained by trg_sync_accessible_orgs from user_organizations_projection). Permission gated by has_permission('user.role_assign') within the requested scope path. Used by the Roles management UI to enumerate assigned users when reviewing or deleting a role.

@a4c-rpc-shape: read$comment$;


-- ============================================================================
-- 3/3: api.list_users_for_schedule_management
-- ============================================================================

CREATE OR REPLACE FUNCTION api.list_users_for_schedule_management(
  p_template_id uuid,
  p_search_term text    DEFAULT NULL,
  p_limit       integer DEFAULT 100,
  p_offset      integer DEFAULT 0
)
RETURNS TABLE(
  id                    uuid,
  email                 text,
  display_name          text,
  is_active             boolean,
  is_assigned           boolean,
  current_schedule_id   uuid,
  current_schedule_name text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
#variable_conflict use_column
DECLARE
  v_org_id UUID;
  v_template RECORD;
BEGIN
  -- Get organization from JWT
  v_org_id := public.get_current_org_id();

  IF v_org_id IS NULL THEN
    RAISE EXCEPTION 'No organization context'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- Validate template exists and belongs to org
  -- Columns: schedule_templates_projection(id, schedule_name, org_unit_id, organization_id, ...)
  SELECT t.id, t.schedule_name, t.org_unit_id INTO v_template
  FROM schedule_templates_projection t
  WHERE t.id = p_template_id
    AND t.organization_id = v_org_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Schedule template not found'
      USING ERRCODE = 'P0002';
  END IF;

  -- Permission check
  -- Subqueries: organization_units_projection(id, path), organizations_projection(id, path)
  IF NOT public.has_effective_permission(
    'user.schedule_manage',
    COALESCE(
      (SELECT oup.path FROM organization_units_projection oup WHERE oup.id = v_template.org_unit_id),
      (SELECT op.path FROM organizations_projection op WHERE op.id = v_org_id)
    )
  ) THEN
    RAISE EXCEPTION 'Missing permission: user.schedule_manage'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  RETURN QUERY
  WITH user_current_schedule AS (
    -- For each user, find their current schedule assignment (if any)
    -- Columns: schedule_user_assignments_projection(user_id, schedule_template_id, organization_id, ...)
    -- Columns: schedule_templates_projection(id, schedule_name, ...)
    SELECT
      sua.user_id,
      sua.schedule_template_id,
      st.schedule_name AS schedule_name
    FROM schedule_user_assignments_projection sua
    JOIN schedule_templates_projection st ON st.id = sua.schedule_template_id
    WHERE sua.organization_id = v_org_id
  ),
  assigned_to_this_template AS (
    -- Users assigned to THIS template
    SELECT sua.user_id
    FROM schedule_user_assignments_projection sua
    WHERE sua.schedule_template_id = p_template_id
  )
  SELECT
    u.id,
    u.email::TEXT,
    COALESCE(u.name, u.email)::TEXT AS display_name,
    u.is_active,
    (att.user_id IS NOT NULL) AS is_assigned,
    -- Only show current schedule if on a DIFFERENT template
    CASE
      WHEN ucs.schedule_template_id IS NOT NULL
        AND ucs.schedule_template_id <> p_template_id
      THEN ucs.schedule_template_id
      ELSE NULL
    END AS current_schedule_id,
    CASE
      WHEN ucs.schedule_template_id IS NOT NULL
        AND ucs.schedule_template_id <> p_template_id
      THEN ucs.schedule_name
      ELSE NULL
    END AS current_schedule_name
  FROM users u
  LEFT JOIN user_current_schedule ucs ON ucs.user_id = u.id
  LEFT JOIN assigned_to_this_template att ON att.user_id = u.id
  -- See bulk_assignment comment block above for the membership-oracle rationale.
  WHERE u.accessible_organizations @> ARRAY[v_org_id]::uuid[]
    AND u.deleted_at IS NULL
    AND (
      p_search_term IS NULL
      OR u.name ILIKE '%' || p_search_term || '%'
      OR u.email ILIKE '%' || p_search_term || '%'
    )
  ORDER BY
    is_assigned DESC,
    display_name ASC
  LIMIT p_limit
  OFFSET p_offset;
END;
$function$;

-- Author new prose (function previously carried only the bare shape tag).
COMMENT ON FUNCTION api.list_users_for_schedule_management(uuid, text, integer, integer) IS
$comment$List users in an organization with their assignment status for a specific schedule template. Returns is_assigned flag plus current_schedule_id/name when the user is on a DIFFERENT template (helps reviewers see where they'd move from). Membership gated by users.accessible_organizations (the canonical membership oracle, maintained by trg_sync_accessible_orgs from user_organizations_projection). Permission gated by has_effective_permission('user.schedule_manage', <ou_path OR org_path>) where the path derives from the template's org_unit_id (or the org root if the template is org-scoped).

@a4c-rpc-shape: read$comment$;
