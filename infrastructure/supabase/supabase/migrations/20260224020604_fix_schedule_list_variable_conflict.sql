-- =============================================================================
-- Migration: Fix RETURNS TABLE variable conflict in list_users_for_schedule_management
-- Problem: RETURNS TABLE(id, email, is_active, ...) creates implicit PL/pgSQL
--          variables that clash with identically-named table columns, causing
--          "column reference is ambiguous" at runtime.
-- Fix: Add #variable_conflict use_column directive (standard PostgreSQL pattern)
-- =============================================================================

CREATE OR REPLACE FUNCTION "api"."list_users_for_schedule_management"(
  "p_template_id" UUID,
  "p_search_term" TEXT DEFAULT NULL,
  "p_limit" INT DEFAULT 100,
  "p_offset" INT DEFAULT 0
)
RETURNS TABLE(
  "id" UUID,
  "email" TEXT,
  "display_name" TEXT,
  "is_active" BOOLEAN,
  "is_assigned" BOOLEAN,
  "current_schedule_id" UUID,
  "current_schedule_name" TEXT
)
LANGUAGE "plpgsql"
SECURITY DEFINER
SET "search_path" TO 'public', 'extensions', 'pg_temp'
AS $$
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
  WHERE u.current_organization_id = v_org_id
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
$$;
