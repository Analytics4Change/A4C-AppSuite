-- Fix: list_user_schedules and list_user_client_assignments
-- Both functions incorrectly joined auth.users and referenced u.display_name
-- which does not exist. Changed to join public.users and use u.name instead.

-- =============================================================================
-- api.list_user_schedules
-- =============================================================================

CREATE OR REPLACE FUNCTION api.list_user_schedules(
  p_org_id UUID DEFAULT NULL,
  p_user_id UUID DEFAULT NULL,
  p_org_unit_id UUID DEFAULT NULL,
  p_active_only BOOLEAN DEFAULT true
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_org_id UUID;
  v_result JSONB;
BEGIN
  v_org_id := COALESCE(p_org_id, public.get_current_org_id());

  IF v_org_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Organization context required');
  END IF;

  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'id', s.id,
      'user_id', s.user_id,
      'user_name', COALESCE(u.name, u.email),
      'user_email', u.email,
      'organization_id', s.organization_id,
      'org_unit_id', s.org_unit_id,
      'org_unit_name', ou.name,
      'schedule', s.schedule,
      'effective_from', s.effective_from,
      'effective_until', s.effective_until,
      'is_active', s.is_active,
      'created_at', s.created_at,
      'updated_at', s.updated_at
    ) ORDER BY u.name, u.email
  ), '[]'::jsonb) INTO v_result
  FROM user_schedule_policies_projection s
  LEFT JOIN users u ON u.id = s.user_id
  LEFT JOIN organization_units_projection ou ON ou.id = s.org_unit_id
  WHERE s.organization_id = v_org_id
    AND (p_user_id IS NULL OR s.user_id = p_user_id)
    AND (p_org_unit_id IS NULL OR s.org_unit_id = p_org_unit_id)
    AND (NOT p_active_only OR s.is_active = true);

  RETURN jsonb_build_object('success', true, 'data', v_result);
END;
$$;

-- =============================================================================
-- api.list_user_client_assignments
-- =============================================================================

CREATE OR REPLACE FUNCTION api.list_user_client_assignments(
  p_org_id UUID DEFAULT NULL,
  p_user_id UUID DEFAULT NULL,
  p_client_id UUID DEFAULT NULL,
  p_active_only BOOLEAN DEFAULT true
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_org_id UUID;
  v_result JSONB;
BEGIN
  v_org_id := COALESCE(p_org_id, public.get_current_org_id());

  IF v_org_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Organization context required');
  END IF;

  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'id', a.id,
      'user_id', a.user_id,
      'user_name', COALESCE(u.name, u.email),
      'user_email', u.email,
      'client_id', a.client_id,
      'organization_id', a.organization_id,
      'assigned_at', a.assigned_at,
      'assigned_until', a.assigned_until,
      'notes', a.notes,
      'is_active', a.is_active
    ) ORDER BY u.name, u.email
  ), '[]'::jsonb) INTO v_result
  FROM user_client_assignments_projection a
  LEFT JOIN users u ON u.id = a.user_id
  WHERE a.organization_id = v_org_id
    AND (p_user_id IS NULL OR a.user_id = p_user_id)
    AND (p_client_id IS NULL OR a.client_id = p_client_id)
    AND (NOT p_active_only OR a.is_active = true);

  RETURN jsonb_build_object('success', true, 'data', v_result);
END;
$$;
