-- =============================================================================
-- Migration: Fix Schedule Assignment Column References
-- Purpose: Fix column name mismatches in list_users_for_schedule_management
--          and sync_schedule_assignments functions.
--          - schedule_templates_projection uses "schedule_name" not "name"
--          - schedule_templates_projection has no "deleted_at" (hard delete)
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Fix: api.list_users_for_schedule_management
-- Fixes: t.name→t.schedule_name, st.name→st.schedule_name,
--         removed deleted_at references (hard-delete table)
-- -----------------------------------------------------------------------------

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
  SELECT t.id, t.schedule_name, t.org_unit_id INTO v_template
  FROM schedule_templates_projection t
  WHERE t.id = p_template_id
    AND t.organization_id = v_org_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Schedule template not found'
      USING ERRCODE = 'P0002';
  END IF;

  -- Permission check
  IF NOT public.has_effective_permission(
    'user.schedule_manage',
    COALESCE(
      (SELECT path FROM organization_units_projection WHERE id = v_template.org_unit_id),
      (SELECT path FROM organizations_projection WHERE id = v_org_id)
    )
  ) THEN
    RAISE EXCEPTION 'Missing permission: user.schedule_manage'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  RETURN QUERY
  WITH user_current_schedule AS (
    -- For each user, find their current schedule assignment (if any)
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


-- -----------------------------------------------------------------------------
-- 2. Fix: api.sync_schedule_assignments
-- Fixes: t.name→t.schedule_name, st.name→st.schedule_name,
--         v_template.name→v_template.schedule_name,
--         removed deleted_at references (hard-delete table)
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION "api"."sync_schedule_assignments"(
  "p_template_id" UUID,
  "p_user_ids_to_add" UUID[],
  "p_user_ids_to_remove" UUID[],
  "p_correlation_id" UUID DEFAULT gen_random_uuid(),
  "p_reason" TEXT DEFAULT 'Schedule assignment update'
)
RETURNS JSONB
LANGUAGE "plpgsql"
SECURITY DEFINER
SET "search_path" TO 'public', 'extensions', 'pg_temp'
AS $$
DECLARE
  v_org_id UUID;
  v_template RECORD;
  v_user_id UUID;
  v_acting_user UUID;
  v_event_data JSONB;
  v_event_metadata JSONB;
  -- Auto-transfer tracking
  v_existing_assignment RECORD;
  -- Result tracking
  v_added_successful UUID[] := ARRAY[]::UUID[];
  v_added_failed JSONB := '[]'::JSONB;
  v_removed_successful UUID[] := ARRAY[]::UUID[];
  v_removed_failed JSONB := '[]'::JSONB;
  v_transferred JSONB := '[]'::JSONB;
  -- Counters for metadata
  v_total_operations INT;
  v_current_index INT := 0;
BEGIN
  -- Get acting user ID
  v_acting_user := auth.uid();

  IF v_acting_user IS NULL THEN
    RAISE EXCEPTION 'Authentication required'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- Get organization from JWT
  v_org_id := public.get_current_org_id();

  IF v_org_id IS NULL THEN
    RAISE EXCEPTION 'No organization context'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- Validate template exists and belongs to org
  SELECT t.id, t.schedule_name, t.org_unit_id INTO v_template
  FROM schedule_templates_projection t
  WHERE t.id = p_template_id
    AND t.organization_id = v_org_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Schedule template not found: %', p_template_id
      USING ERRCODE = 'P0002';
  END IF;

  -- Permission check
  IF NOT public.has_effective_permission(
    'user.schedule_manage',
    COALESCE(
      (SELECT path FROM organization_units_projection WHERE id = v_template.org_unit_id),
      (SELECT path FROM organizations_projection WHERE id = v_org_id)
    )
  ) THEN
    RAISE EXCEPTION 'Missing permission: user.schedule_manage'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- Calculate total operations for metadata
  v_total_operations := COALESCE(array_length(p_user_ids_to_add, 1), 0)
                      + COALESCE(array_length(p_user_ids_to_remove, 1), 0);

  -- Return early if nothing to do
  IF v_total_operations = 0 THEN
    RETURN jsonb_build_object(
      'added', jsonb_build_object('successful', '[]'::JSONB, 'failed', '[]'::JSONB),
      'removed', jsonb_build_object('successful', '[]'::JSONB, 'failed', '[]'::JSONB),
      'transferred', '[]'::JSONB,
      'correlationId', p_correlation_id
    );
  END IF;

  -- =========================================================================
  -- Process ADDITIONS (with auto-transfer from other templates)
  -- =========================================================================
  IF p_user_ids_to_add IS NOT NULL THEN
    FOREACH v_user_id IN ARRAY p_user_ids_to_add LOOP
      v_current_index := v_current_index + 1;

      BEGIN
        -- Check user exists and is in the organization
        IF NOT EXISTS (
          SELECT 1 FROM users u
          WHERE u.id = v_user_id
            AND u.current_organization_id = v_org_id
            AND u.deleted_at IS NULL
        ) THEN
          RAISE EXCEPTION 'User not found or not in organization';
        END IF;

        -- Check user is active
        IF NOT EXISTS (
          SELECT 1 FROM users u
          WHERE u.id = v_user_id
            AND u.is_active = true
        ) THEN
          RAISE EXCEPTION 'User is not active';
        END IF;

        -- Check if already assigned to THIS template (idempotent — skip)
        IF EXISTS (
          SELECT 1 FROM schedule_user_assignments_projection
          WHERE schedule_template_id = p_template_id
            AND user_id = v_user_id
        ) THEN
          v_added_successful := array_append(v_added_successful, v_user_id);
          CONTINUE;
        END IF;

        -- Check if assigned to a DIFFERENT template (auto-transfer)
        SELECT sua.schedule_template_id, st.schedule_name AS template_name
        INTO v_existing_assignment
        FROM schedule_user_assignments_projection sua
        JOIN schedule_templates_projection st ON st.id = sua.schedule_template_id
        WHERE sua.user_id = v_user_id
          AND sua.organization_id = v_org_id;

        IF FOUND THEN
          -- Auto-transfer: unassign from old template first
          v_event_metadata := jsonb_build_object(
            'timestamp', NOW()::TEXT,
            'correlation_id', p_correlation_id,
            'user_id', v_acting_user::TEXT,
            'organization_id', v_org_id::TEXT,
            'reason', 'Auto-transfer to template: ' || v_template.schedule_name,
            'source', 'api',
            'tags', to_jsonb(ARRAY['schedule-management', 'auto-transfer', 'removal']::TEXT[]),
            'bulk_operation', true,
            'bulk_operation_id', p_correlation_id::TEXT,
            'operation_index', v_current_index,
            'total_operations', v_total_operations
          );

          PERFORM api.emit_domain_event(
            v_existing_assignment.schedule_template_id,
            'schedule',
            'schedule.user_unassigned',
            jsonb_build_object(
              'template_id', v_existing_assignment.schedule_template_id,
              'user_id', v_user_id,
              'organization_id', v_org_id,
              'reason', 'Auto-transfer to template: ' || v_template.schedule_name
            ),
            v_event_metadata
          );

          -- Track transfer
          v_transferred := v_transferred || jsonb_build_object(
            'userId', v_user_id,
            'fromTemplateId', v_existing_assignment.schedule_template_id,
            'fromTemplateName', v_existing_assignment.template_name
          );
        END IF;

        -- Build event data for assignment
        v_event_data := jsonb_build_object(
          'template_id', p_template_id,
          'user_id', v_user_id,
          'organization_id', v_org_id,
          'effective_from', NULL,
          'effective_until', NULL
        );

        -- Build event metadata
        v_event_metadata := jsonb_build_object(
          'timestamp', NOW()::TEXT,
          'correlation_id', p_correlation_id,
          'user_id', v_acting_user::TEXT,
          'organization_id', v_org_id::TEXT,
          'reason', p_reason,
          'source', 'api',
          'tags', to_jsonb(ARRAY['schedule-management', 'assignment']::TEXT[]),
          'bulk_operation', true,
          'bulk_operation_id', p_correlation_id::TEXT,
          'operation_index', v_current_index,
          'total_operations', v_total_operations
        );

        -- Emit the domain event
        PERFORM api.emit_domain_event(
          p_template_id,
          'schedule',
          'schedule.user_assigned',
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

  -- =========================================================================
  -- Process REMOVALS
  -- =========================================================================
  IF p_user_ids_to_remove IS NOT NULL THEN
    FOREACH v_user_id IN ARRAY p_user_ids_to_remove LOOP
      v_current_index := v_current_index + 1;

      BEGIN
        -- Check user exists and is in the organization
        IF NOT EXISTS (
          SELECT 1 FROM users u
          WHERE u.id = v_user_id
            AND u.current_organization_id = v_org_id
            AND u.deleted_at IS NULL
        ) THEN
          RAISE EXCEPTION 'User not found or not in organization';
        END IF;

        -- Check user IS assigned to this template
        IF NOT EXISTS (
          SELECT 1 FROM schedule_user_assignments_projection
          WHERE schedule_template_id = p_template_id
            AND user_id = v_user_id
        ) THEN
          RAISE EXCEPTION 'User is not assigned to this schedule';
        END IF;

        -- Build event data
        v_event_data := jsonb_build_object(
          'template_id', p_template_id,
          'user_id', v_user_id,
          'organization_id', v_org_id,
          'reason', p_reason
        );

        -- Build event metadata
        v_event_metadata := jsonb_build_object(
          'timestamp', NOW()::TEXT,
          'correlation_id', p_correlation_id,
          'user_id', v_acting_user::TEXT,
          'organization_id', v_org_id::TEXT,
          'reason', p_reason,
          'source', 'api',
          'tags', to_jsonb(ARRAY['schedule-management', 'removal']::TEXT[]),
          'bulk_operation', true,
          'bulk_operation_id', p_correlation_id::TEXT,
          'operation_index', v_current_index,
          'total_operations', v_total_operations
        );

        -- Emit the domain event
        PERFORM api.emit_domain_event(
          p_template_id,
          'schedule',
          'schedule.user_unassigned',
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

  -- Return combined result
  RETURN jsonb_build_object(
    'added', jsonb_build_object(
      'successful', to_jsonb(v_added_successful),
      'failed', v_added_failed
    ),
    'removed', jsonb_build_object(
      'successful', to_jsonb(v_removed_successful),
      'failed', v_removed_failed
    ),
    'transferred', v_transferred,
    'correlationId', p_correlation_id
  );
END;
$$;
