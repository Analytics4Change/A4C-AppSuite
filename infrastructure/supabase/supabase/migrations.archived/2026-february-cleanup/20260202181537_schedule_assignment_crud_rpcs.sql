-- ============================================
-- CRUD RPC Functions: Staff Schedules & Client Assignments
-- Phase 7: api.* schema functions for frontend consumption
-- ============================================
-- Write RPCs emit domain events (CQRS write side)
-- Read RPCs query projections (CQRS read side)
-- Pattern follows api.create_role() from role_management_api.sql
-- ============================================

-- =============================================================================
-- SCHEDULE WRITE RPCs
-- =============================================================================

-- api.create_user_schedule
CREATE OR REPLACE FUNCTION api.create_user_schedule(
  p_user_id UUID,
  p_schedule JSONB,
  p_org_unit_id UUID DEFAULT NULL,
  p_effective_from DATE DEFAULT NULL,
  p_effective_until DATE DEFAULT NULL,
  p_reason TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_user_id UUID;
  v_org_id UUID;
  v_schedule_id UUID;
BEGIN
  v_user_id := public.get_current_user_id();
  v_org_id := public.get_current_org_id();

  IF v_org_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Organization context required');
  END IF;

  IF p_user_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'User ID is required');
  END IF;

  IF p_schedule IS NULL OR p_schedule = '{}'::jsonb THEN
    RETURN jsonb_build_object('success', false, 'error', 'Schedule is required');
  END IF;

  -- Check if schedule already exists for this user/org/ou combination
  IF EXISTS (
    SELECT 1 FROM user_schedule_policies_projection
    WHERE user_id = p_user_id
      AND organization_id = v_org_id
      AND COALESCE(org_unit_id, '00000000-0000-0000-0000-000000000000'::uuid) =
          COALESCE(p_org_unit_id, '00000000-0000-0000-0000-000000000000'::uuid)
      AND is_active = true
  ) THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Schedule already exists for this user/organization unit combination'
    );
  END IF;

  v_schedule_id := gen_random_uuid();

  PERFORM api.emit_domain_event(
    p_stream_id := p_user_id,
    p_stream_type := 'user',
    p_event_type := 'user.schedule.created',
    p_event_data := jsonb_build_object(
      'schedule_id', v_schedule_id,
      'organization_id', v_org_id,
      'schedule', p_schedule,
      'org_unit_id', p_org_unit_id,
      'effective_from', p_effective_from,
      'effective_until', p_effective_until
    ),
    p_event_metadata := jsonb_build_object(
      'user_id', v_user_id,
      'organization_id', v_org_id
    ) || CASE WHEN p_reason IS NOT NULL
         THEN jsonb_build_object('reason', p_reason)
         ELSE '{}'::jsonb END
  );

  RETURN jsonb_build_object(
    'success', true,
    'schedule_id', v_schedule_id
  );
END;
$$;

GRANT EXECUTE ON FUNCTION api.create_user_schedule(UUID, JSONB, UUID, DATE, DATE, TEXT) TO authenticated;

-- api.update_user_schedule
CREATE OR REPLACE FUNCTION api.update_user_schedule(
  p_schedule_id UUID,
  p_schedule JSONB DEFAULT NULL,
  p_org_unit_id UUID DEFAULT NULL,
  p_effective_from DATE DEFAULT NULL,
  p_effective_until DATE DEFAULT NULL,
  p_reason TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_user_id UUID;
  v_org_id UUID;
  v_target_user_id UUID;
BEGIN
  v_user_id := public.get_current_user_id();
  v_org_id := public.get_current_org_id();

  IF v_org_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Organization context required');
  END IF;

  -- Verify schedule exists and belongs to this org
  SELECT user_id INTO v_target_user_id
  FROM user_schedule_policies_projection
  WHERE id = p_schedule_id AND organization_id = v_org_id;

  IF v_target_user_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Schedule not found');
  END IF;

  PERFORM api.emit_domain_event(
    p_stream_id := v_target_user_id,
    p_stream_type := 'user',
    p_event_type := 'user.schedule.updated',
    p_event_data := jsonb_build_object(
      'schedule_id', p_schedule_id,
      'organization_id', v_org_id,
      'schedule', p_schedule,
      'org_unit_id', p_org_unit_id,
      'effective_from', p_effective_from,
      'effective_until', p_effective_until
    ),
    p_event_metadata := jsonb_build_object(
      'user_id', v_user_id,
      'organization_id', v_org_id
    ) || CASE WHEN p_reason IS NOT NULL
         THEN jsonb_build_object('reason', p_reason)
         ELSE '{}'::jsonb END
  );

  RETURN jsonb_build_object('success', true);
END;
$$;

GRANT EXECUTE ON FUNCTION api.update_user_schedule(UUID, JSONB, UUID, DATE, DATE, TEXT) TO authenticated;

-- api.deactivate_user_schedule
CREATE OR REPLACE FUNCTION api.deactivate_user_schedule(
  p_schedule_id UUID,
  p_reason TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_user_id UUID;
  v_org_id UUID;
  v_target_user_id UUID;
BEGIN
  v_user_id := public.get_current_user_id();
  v_org_id := public.get_current_org_id();

  IF v_org_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Organization context required');
  END IF;

  SELECT user_id INTO v_target_user_id
  FROM user_schedule_policies_projection
  WHERE id = p_schedule_id AND organization_id = v_org_id AND is_active = true;

  IF v_target_user_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Active schedule not found');
  END IF;

  PERFORM api.emit_domain_event(
    p_stream_id := v_target_user_id,
    p_stream_type := 'user',
    p_event_type := 'user.schedule.deactivated',
    p_event_data := jsonb_build_object(
      'schedule_id', p_schedule_id,
      'organization_id', v_org_id
    ),
    p_event_metadata := jsonb_build_object(
      'user_id', v_user_id,
      'organization_id', v_org_id
    ) || CASE WHEN p_reason IS NOT NULL
         THEN jsonb_build_object('reason', p_reason)
         ELSE '{}'::jsonb END
  );

  RETURN jsonb_build_object('success', true);
END;
$$;

GRANT EXECUTE ON FUNCTION api.deactivate_user_schedule(UUID, TEXT) TO authenticated;

-- =============================================================================
-- SCHEDULE READ RPC
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
      'user_name', COALESCE(u.display_name, u.email),
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
    ) ORDER BY u.display_name, u.email
  ), '[]'::jsonb) INTO v_result
  FROM user_schedule_policies_projection s
  LEFT JOIN auth.users u ON u.id = s.user_id
  LEFT JOIN organization_units_projection ou ON ou.id = s.org_unit_id
  WHERE s.organization_id = v_org_id
    AND (p_user_id IS NULL OR s.user_id = p_user_id)
    AND (p_org_unit_id IS NULL OR s.org_unit_id = p_org_unit_id)
    AND (NOT p_active_only OR s.is_active = true);

  RETURN jsonb_build_object('success', true, 'data', v_result);
END;
$$;

GRANT EXECUTE ON FUNCTION api.list_user_schedules(UUID, UUID, UUID, BOOLEAN) TO authenticated;

-- =============================================================================
-- CLIENT ASSIGNMENT WRITE RPCs
-- =============================================================================

-- api.assign_client_to_user
CREATE OR REPLACE FUNCTION api.assign_client_to_user(
  p_user_id UUID,
  p_client_id UUID,
  p_assigned_until TIMESTAMPTZ DEFAULT NULL,
  p_notes TEXT DEFAULT NULL,
  p_reason TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_user_id UUID;
  v_org_id UUID;
  v_assignment_id UUID;
BEGIN
  v_user_id := public.get_current_user_id();
  v_org_id := public.get_current_org_id();

  IF v_org_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Organization context required');
  END IF;

  IF p_user_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'User ID is required');
  END IF;

  IF p_client_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Client ID is required');
  END IF;

  v_assignment_id := gen_random_uuid();

  PERFORM api.emit_domain_event(
    p_stream_id := p_user_id,
    p_stream_type := 'user',
    p_event_type := 'user.client.assigned',
    p_event_data := jsonb_build_object(
      'assignment_id', v_assignment_id,
      'client_id', p_client_id,
      'organization_id', v_org_id,
      'assigned_until', p_assigned_until,
      'notes', p_notes
    ),
    p_event_metadata := jsonb_build_object(
      'user_id', v_user_id,
      'organization_id', v_org_id
    ) || CASE WHEN p_reason IS NOT NULL
         THEN jsonb_build_object('reason', p_reason)
         ELSE '{}'::jsonb END
  );

  RETURN jsonb_build_object(
    'success', true,
    'assignment_id', v_assignment_id
  );
END;
$$;

GRANT EXECUTE ON FUNCTION api.assign_client_to_user(UUID, UUID, TIMESTAMPTZ, TEXT, TEXT) TO authenticated;

-- api.unassign_client_from_user
CREATE OR REPLACE FUNCTION api.unassign_client_from_user(
  p_user_id UUID,
  p_client_id UUID,
  p_reason TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_user_id UUID;
  v_org_id UUID;
BEGIN
  v_user_id := public.get_current_user_id();
  v_org_id := public.get_current_org_id();

  IF v_org_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Organization context required');
  END IF;

  -- Verify assignment exists
  IF NOT EXISTS (
    SELECT 1 FROM user_client_assignments_projection
    WHERE user_id = p_user_id
      AND client_id = p_client_id
      AND organization_id = v_org_id
      AND is_active = true
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Active assignment not found');
  END IF;

  PERFORM api.emit_domain_event(
    p_stream_id := p_user_id,
    p_stream_type := 'user',
    p_event_type := 'user.client.unassigned',
    p_event_data := jsonb_build_object(
      'client_id', p_client_id,
      'organization_id', v_org_id
    ),
    p_event_metadata := jsonb_build_object(
      'user_id', v_user_id,
      'organization_id', v_org_id
    ) || CASE WHEN p_reason IS NOT NULL
         THEN jsonb_build_object('reason', p_reason)
         ELSE '{}'::jsonb END
  );

  RETURN jsonb_build_object('success', true);
END;
$$;

GRANT EXECUTE ON FUNCTION api.unassign_client_from_user(UUID, UUID, TEXT) TO authenticated;

-- =============================================================================
-- CLIENT ASSIGNMENT READ RPC
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
      'user_name', COALESCE(u.display_name, u.email),
      'user_email', u.email,
      'client_id', a.client_id,
      'organization_id', a.organization_id,
      'assigned_at', a.assigned_at,
      'assigned_until', a.assigned_until,
      'notes', a.notes,
      'is_active', a.is_active
    ) ORDER BY u.display_name, u.email
  ), '[]'::jsonb) INTO v_result
  FROM user_client_assignments_projection a
  LEFT JOIN auth.users u ON u.id = a.user_id
  WHERE a.organization_id = v_org_id
    AND (p_user_id IS NULL OR a.user_id = p_user_id)
    AND (p_client_id IS NULL OR a.client_id = p_client_id)
    AND (NOT p_active_only OR a.is_active = true);

  RETURN jsonb_build_object('success', true, 'data', v_result);
END;
$$;

GRANT EXECUTE ON FUNCTION api.list_user_client_assignments(UUID, UUID, UUID, BOOLEAN) TO authenticated;
