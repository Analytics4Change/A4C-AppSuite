-- =============================================================================
-- Migration: Fix bulk assignment functions - remove invalid deleted_at references
-- Purpose: user_roles_projection uses hard deletes, not soft deletes
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Function: api.list_users_for_bulk_assignment (FIXED)
-- Removed: ur.deleted_at IS NULL checks (column doesn't exist)
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION "api"."list_users_for_bulk_assignment"(
  "p_role_id" UUID,
  "p_scope_path" extensions.ltree,
  "p_search_term" TEXT DEFAULT NULL,
  "p_limit" INT DEFAULT 100,
  "p_offset" INT DEFAULT 0
)
RETURNS TABLE(
  "id" UUID,
  "email" TEXT,
  "display_name" TEXT,
  "is_active" BOOLEAN,
  "current_roles" TEXT[],
  "is_already_assigned" BOOLEAN
)
LANGUAGE "plpgsql"
SECURITY DEFINER
SET "search_path" TO 'public', 'extensions', 'pg_temp'
AS $$
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
    -- Note: user_roles_projection uses hard deletes (no deleted_at column)
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
    -- Note: user_roles_projection uses hard deletes (no deleted_at column)
    SELECT ur.user_id
    FROM user_roles_projection ur
    WHERE ur.role_id = p_role_id
      AND ur.scope_path = p_scope_path
  )
  SELECT
    u.id,
    u.email,
    u.display_name,
    u.is_active,
    COALESCE(ucr.role_names, ARRAY[]::TEXT[]) AS current_roles,
    (aa.user_id IS NOT NULL) AS is_already_assigned
  FROM users_projection u
  LEFT JOIN user_current_roles ucr ON ucr.user_id = u.id
  LEFT JOIN already_assigned aa ON aa.user_id = u.id
  WHERE u.organization_id = v_org_id
    AND u.deleted_at IS NULL
    AND (
      p_search_term IS NULL
      OR u.display_name ILIKE '%' || p_search_term || '%'
      OR u.email ILIKE '%' || p_search_term || '%'
    )
  ORDER BY
    is_already_assigned ASC,  -- Non-assigned first
    u.display_name ASC
  LIMIT p_limit
  OFFSET p_offset;
END;
$$;

-- -----------------------------------------------------------------------------
-- Function: api.bulk_assign_role (FIXED)
-- Removed: ur.deleted_at IS NULL check (column doesn't exist)
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION "api"."bulk_assign_role"(
  "p_role_id" UUID,
  "p_user_ids" UUID[],
  "p_scope_path" extensions.ltree,
  "p_correlation_id" UUID DEFAULT gen_random_uuid(),
  "p_reason" TEXT DEFAULT 'Bulk role assignment'
)
RETURNS JSONB
LANGUAGE "plpgsql"
SECURITY DEFINER
SET "search_path" TO 'public', 'extensions', 'pg_temp'
AS $$
DECLARE
  v_user_scope extensions.ltree;
  v_org_id UUID;
  v_role_name TEXT;
  v_user_id UUID;
  v_user_index INT := 0;
  v_total_users INT;
  v_successful UUID[] := ARRAY[]::UUID[];
  v_failed JSONB := '[]'::JSONB;
  v_event_data JSONB;
  v_event_metadata JSONB;
  v_assigned_by UUID;
BEGIN
  -- Get acting user ID
  v_assigned_by := auth.uid();

  IF v_assigned_by IS NULL THEN
    RAISE EXCEPTION 'Authentication required'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

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

  -- Validate role exists and get its name
  SELECT r.name INTO v_role_name
  FROM roles_projection r
  WHERE r.id = p_role_id
    AND r.deleted_at IS NULL;

  IF v_role_name IS NULL THEN
    RAISE EXCEPTION 'Role not found: %', p_role_id
      USING ERRCODE = 'P0002';
  END IF;

  -- Get organization ID from scope path
  SELECT o.id INTO v_org_id
  FROM organizations_projection o
  WHERE o.path = subpath(p_scope_path, 0, 1)
    AND o.deleted_at IS NULL;

  IF v_org_id IS NULL THEN
    RAISE EXCEPTION 'Organization not found for scope path'
      USING ERRCODE = 'P0002';
  END IF;

  -- Calculate total for metadata
  v_total_users := array_length(p_user_ids, 1);

  IF v_total_users IS NULL OR v_total_users = 0 THEN
    RETURN jsonb_build_object(
      'successful', '[]'::JSONB,
      'failed', '[]'::JSONB,
      'totalRequested', 0,
      'totalSucceeded', 0,
      'totalFailed', 0,
      'correlationId', p_correlation_id
    );
  END IF;

  -- Process each user
  FOREACH v_user_id IN ARRAY p_user_ids LOOP
    v_user_index := v_user_index + 1;

    BEGIN
      -- Check user exists and is in the organization
      IF NOT EXISTS (
        SELECT 1 FROM users_projection u
        WHERE u.id = v_user_id
          AND u.organization_id = v_org_id
          AND u.deleted_at IS NULL
      ) THEN
        RAISE EXCEPTION 'User not found or not in organization';
      END IF;

      -- Check user is active
      IF NOT EXISTS (
        SELECT 1 FROM users_projection u
        WHERE u.id = v_user_id
          AND u.is_active = true
      ) THEN
        RAISE EXCEPTION 'User is not active';
      END IF;

      -- Check not already assigned to this role at this scope
      -- Note: user_roles_projection uses hard deletes (no deleted_at column)
      IF EXISTS (
        SELECT 1 FROM user_roles_projection ur
        WHERE ur.user_id = v_user_id
          AND ur.role_id = p_role_id
          AND ur.scope_path = p_scope_path
      ) THEN
        RAISE EXCEPTION 'User already has this role at this scope';
      END IF;

      -- Build event data
      v_event_data := jsonb_build_object(
        'role_id', p_role_id,
        'role_name', v_role_name,
        'org_id', v_org_id,
        'scope_path', p_scope_path::TEXT,
        'assigned_by', v_assigned_by
      );

      -- Build event metadata with bulk operation tracking
      v_event_metadata := jsonb_build_object(
        'timestamp', NOW()::TEXT,
        'correlation_id', p_correlation_id,
        'user_id', v_assigned_by::TEXT,
        'reason', p_reason,
        'source', 'api',
        'tags', to_jsonb(ARRAY['bulk-assignment']::TEXT[]),
        'bulk_operation', true,
        'bulk_operation_id', p_correlation_id::TEXT,
        'user_index', v_user_index,
        'total_users', v_total_users
      );

      -- Emit the domain event (event processor handles projection update)
      PERFORM api.emit_domain_event(
        v_user_id,                -- stream_id (user being assigned)
        'user',                   -- stream_type
        'user.role.assigned',     -- event_type
        v_event_data,             -- event_data
        v_event_metadata          -- event_metadata
      );

      -- Track success
      v_successful := array_append(v_successful, v_user_id);

    EXCEPTION WHEN OTHERS THEN
      -- Track failure with reason
      v_failed := v_failed || jsonb_build_object(
        'userId', v_user_id,
        'reason', SQLERRM,
        'sqlstate', SQLSTATE
      );
    END;
  END LOOP;

  -- Return structured result
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
