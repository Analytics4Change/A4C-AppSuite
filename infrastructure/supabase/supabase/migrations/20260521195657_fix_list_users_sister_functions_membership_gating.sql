-- ============================================================================
-- Migration: fix_list_users_sister_functions_membership_gating
-- Origin:    dev/active/list-users-sister-functions-membership-gating/
-- Precedent: PR #66 (merged 2026-05-20, commit 33e77a4f) — established the
--            `accessible_organizations @> ARRAY[<uuid>]::uuid[]` convention
--            as the canonical membership oracle for user-listing RPCs.
-- ============================================================================
--
-- What this does
-- --------------
-- Two changes across the three `list_users_for_*` visibility-class RPCs:
--
-- (1) Membership predicate swap: `WHERE u.current_organization_id = v_org_id`
--     → `WHERE u.accessible_organizations @> ARRAY[v_org_id]::uuid[]`.
--     Reuses the GIN index idx_users_accessible_orgs_gin from PR #66.
--     Fixes the multi-org-user invisibility gap that the active-session
--     pointer (`current_organization_id`) created.
--
-- (2) Permission-check normalization (role-functions only — schedule already
--     uses this shape): collapse `v_user_scope := get_permission_scope(...)
--     + manual ltree @> check` into a single `has_effective_permission(perm,
--     scope_path)` call. All three sister RPCs now share the permission-
--     check helper. See infrastructure/supabase/CLAUDE.md §"`list_users*`
--     family pattern — three-step skeleton" for the full pattern doc.
--
-- Four-site distribution of the prior two-step pattern
-- ----------------------------------------------------
-- A grep of baseline_v4 for the two-step pattern's "Requested scope is
-- outside your permission scope" error message finds FOUR sites:
--
--   L362  api.bulk_assign_role            (mutation; out of scope)
--   L4705 api.list_users_for_bulk_assignment (visibility; normalized here)
--   L4793 api.list_users_for_role_management (visibility; normalized here)
--   L5571 api.sync_role_assignments        (mutation; out of scope)
--
-- This PR normalizes the two VISIBILITY-class siblings only. The two
-- MUTATION-class siblings are intentionally out of scope: mutations carry
-- side-effect risk warranting a focused diff, and PR #67 is scoped by both
-- card title and architect-blessed plan to "list_users sister RPCs." Short-
-- term visibility/mutation inconsistency in permission-check style is
-- acceptable; no user-observable behavior changes. Future normalization
-- card may extend to the mutation siblings.
--
-- Tripwire — why the permission-check refactor is strictly more correct
-- ---------------------------------------------------------------------
-- The two-step pattern (get_permission_scope LIMIT 1, manual @> check) is
-- observationally equivalent to has_effective_permission (EXISTS) TODAY
-- because compute_effective_permissions (baseline_v4:6932-6985) ends in
-- `SELECT DISTINCT ON (permission_name)` — JWT carries at most one entry
-- per permission name. If that invariant is ever broken (e.g., cross-tenant
-- grants ship and produce multiple effective_permissions entries for the
-- same permission at different scopes), the LIMIT-1 pattern silently picks
-- first and may miss a valid match; the EXISTS pattern correctly ORs across
-- all entries. The refactor removes a latent correctness bug ahead of the
-- cross-tenant grant work captured in dev/active/sub-tenant-admin-design/.
--
-- Migration-session search_path note: the `ltree` parameter type lives in
-- the `extensions` schema. Function-attribute `SET search_path` does NOT
-- apply during CREATE-time parameter parsing — set session-level so `ltree`
-- resolves. (Pattern codified in infrastructure/supabase/CLAUDE.md.)
--
-- Body-drift anchor (captured 2026-05-21 pre-write — Phase 1.5):
--   list_users_for_bulk_assignment    md5: 49e14e620a8b6fc8900cbc018ad5d6bc
--   list_users_for_role_management    md5: e0805df19e3ae848c51df6a50103d059
--   list_users_for_schedule_management md5: 3a08d7940a5e322e291ed558426706d8
--
-- Idempotent: all three are CREATE OR REPLACE FUNCTION (signature unchanged
-- -> OID preserved -> existing COMMENT preserved; defensive re-emission
-- handles future DROP+CREATE).
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
  v_org_id UUID;
BEGIN
  -- Permission gate: caller must hold user.role_assign at a scope that
  -- contains p_scope_path. Uses has_effective_permission (EXISTS over JWT
  -- effective_permissions) which correctly ORs across multiple matching
  -- entries — forward-compatible with future cross-tenant grants. See
  -- header for the DISTINCT ON tripwire that makes the prior two-step
  -- pattern observationally equivalent today.
  IF NOT public.has_effective_permission('user.role_assign', p_scope_path) THEN
    RAISE EXCEPTION 'Missing permission: user.role_assign'
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

COMMENT ON FUNCTION api.list_users_for_bulk_assignment(uuid, ltree, text, integer, integer) IS
$comment$List users in an organization eligible for bulk role assignment to a specific role at a specific scope. Includes current role names per user and an is_already_assigned flag. Membership gated by users.accessible_organizations (the canonical membership oracle, maintained by trg_sync_accessible_orgs from user_organizations_projection). Permission gated by has_effective_permission('user.role_assign', p_scope_path) (verifies the caller holds the permission at a scope that contains the requested path).

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
  v_org_id UUID;
BEGIN
  -- Permission gate: caller must hold user.role_assign at a scope that
  -- contains p_scope_path. Uses has_effective_permission (EXISTS over JWT
  -- effective_permissions) which correctly ORs across multiple matching
  -- entries — forward-compatible with future cross-tenant grants. See
  -- header for the DISTINCT ON tripwire that makes the prior two-step
  -- pattern observationally equivalent today.
  IF NOT public.has_effective_permission('user.role_assign', p_scope_path) THEN
    RAISE EXCEPTION 'Missing permission: user.role_assign'
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

COMMENT ON FUNCTION api.list_users_for_role_management(uuid, ltree, text, integer, integer) IS
$comment$List users in an organization with their assignment status for a specific role at a specific scope. Returns is_assigned flag distinguishing role-bearing users from candidates. Membership gated by users.accessible_organizations (the canonical membership oracle, maintained by trg_sync_accessible_orgs from user_organizations_projection). Permission gated by has_effective_permission('user.role_assign', p_scope_path) (verifies the caller holds the permission at a scope that contains the requested path). Used by the Roles management UI to enumerate assigned users when reviewing or deleting a role.

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

COMMENT ON FUNCTION api.list_users_for_schedule_management(uuid, text, integer, integer) IS
$comment$List users in an organization with their assignment status for a specific schedule template. Returns is_assigned flag plus current_schedule_id/name when the user is on a DIFFERENT template (helps reviewers see where they'd move from). Membership gated by users.accessible_organizations (the canonical membership oracle, maintained by trg_sync_accessible_orgs from user_organizations_projection). Permission gated by has_effective_permission('user.schedule_manage', <ou_path OR org_path>) (verifies the caller holds the permission at a scope that contains the template's org_unit_id path, or the org root if the template is org-scoped).

@a4c-rpc-shape: read$comment$;
