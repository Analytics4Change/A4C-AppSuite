-- =============================================================================
-- Migration: Unified Role Assignment Management
-- Purpose: Replace separate bulk assign/remove with unified management UI
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Function: api.list_users_for_role_management
-- Purpose: List ALL users with their assignment status for the given role/scope
-- Returns: All users in org with is_assigned flag indicating current state
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION "api"."list_users_for_role_management"(
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
  "is_assigned" BOOLEAN
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
  WHERE u.current_organization_id = v_org_id
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
$$;

-- -----------------------------------------------------------------------------
-- Function: api.sync_role_assignments
-- Purpose: Add AND remove role assignments in a single operation
-- Returns: Combined result with successes/failures for both operations
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION "api"."sync_role_assignments"(
  "p_role_id" UUID,
  "p_user_ids_to_add" UUID[],
  "p_user_ids_to_remove" UUID[],
  "p_scope_path" extensions.ltree,
  "p_correlation_id" UUID DEFAULT gen_random_uuid(),
  "p_reason" TEXT DEFAULT 'Role assignment update'
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
  v_acting_user UUID;
  v_event_data JSONB;
  v_event_metadata JSONB;
  -- Result tracking
  v_added_successful UUID[] := ARRAY[]::UUID[];
  v_added_failed JSONB := '[]'::JSONB;
  v_removed_successful UUID[] := ARRAY[]::UUID[];
  v_removed_failed JSONB := '[]'::JSONB;
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

  -- Calculate total operations for metadata
  v_total_operations := COALESCE(array_length(p_user_ids_to_add, 1), 0)
                      + COALESCE(array_length(p_user_ids_to_remove, 1), 0);

  -- Return early if nothing to do
  IF v_total_operations = 0 THEN
    RETURN jsonb_build_object(
      'added', jsonb_build_object('successful', '[]'::JSONB, 'failed', '[]'::JSONB),
      'removed', jsonb_build_object('successful', '[]'::JSONB, 'failed', '[]'::JSONB),
      'correlationId', p_correlation_id
    );
  END IF;

  -- =========================================================================
  -- Process ADDITIONS
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

        -- Check not already assigned to this role at this scope
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
          'assigned_by', v_acting_user
        );

        -- Build event metadata
        v_event_metadata := jsonb_build_object(
          'timestamp', NOW()::TEXT,
          'correlation_id', p_correlation_id,
          'user_id', v_acting_user::TEXT,
          'reason', p_reason,
          'source', 'api',
          'tags', to_jsonb(ARRAY['role-management', 'assignment']::TEXT[]),
          'bulk_operation', true,
          'bulk_operation_id', p_correlation_id::TEXT,
          'operation_index', v_current_index,
          'total_operations', v_total_operations
        );

        -- Emit the domain event
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

        -- Check user IS assigned to this role at this scope
        IF NOT EXISTS (
          SELECT 1 FROM user_roles_projection ur
          WHERE ur.user_id = v_user_id
            AND ur.role_id = p_role_id
            AND ur.scope_path = p_scope_path
        ) THEN
          RAISE EXCEPTION 'User does not have this role at this scope';
        END IF;

        -- Build event data
        v_event_data := jsonb_build_object(
          'role_id', p_role_id,
          'role_name', v_role_name,
          'org_id', v_org_id,
          'scope_path', p_scope_path::TEXT,
          'removed_by', v_acting_user
        );

        -- Build event metadata
        v_event_metadata := jsonb_build_object(
          'timestamp', NOW()::TEXT,
          'correlation_id', p_correlation_id,
          'user_id', v_acting_user::TEXT,
          'reason', p_reason,
          'source', 'api',
          'tags', to_jsonb(ARRAY['role-management', 'removal']::TEXT[]),
          'bulk_operation', true,
          'bulk_operation_id', p_correlation_id::TEXT,
          'operation_index', v_current_index,
          'total_operations', v_total_operations
        );

        -- Emit the domain event (user.role.revoked per AsyncAPI contract)
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
    'correlationId', p_correlation_id
  );
END;
$$;
