-- Migration: Add cloned_from_role_id support for role duplication
-- Purpose: Track role duplication for audit trail
-- Issue: #3 - Role duplication feature
--
-- Changes:
-- 1. Update api.create_role() to accept optional p_cloned_from_role_id parameter
-- 2. Include cloned_from_role_id in role.created event metadata when provided

-- ============================================================================
-- Update api.create_role() to support cloned_from_role_id
-- ============================================================================
CREATE OR REPLACE FUNCTION api.create_role(
  p_name TEXT,
  p_description TEXT,
  p_org_hierarchy_scope TEXT DEFAULT NULL,
  p_permission_ids UUID[] DEFAULT '{}',
  p_cloned_from_role_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_user_id UUID;
  v_org_id UUID;
  v_role_id UUID;
  v_org_path LTREE;
  v_scope_path LTREE;
  v_perm_id UUID;
  v_user_perms UUID[];
  v_perm_name TEXT;
  v_event_metadata JSONB;
BEGIN
  -- Get user context from JWT
  v_user_id := public.get_current_user_id();
  v_org_id := public.get_current_org_id();

  IF v_org_id IS NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Organization context required',
      'errorDetails', jsonb_build_object('code', 'NO_ORG_CONTEXT', 'message', 'User must be in an organization context')
    );
  END IF;

  -- Validate name is not empty
  IF p_name IS NULL OR length(trim(p_name)) = 0 THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Name is required',
      'errorDetails', jsonb_build_object('code', 'VALIDATION_ERROR', 'message', 'Role name cannot be empty')
    );
  END IF;

  -- Get org path for default scope
  SELECT path INTO v_org_path FROM organizations_projection WHERE id = v_org_id;

  -- Determine scope path
  IF p_org_hierarchy_scope IS NOT NULL THEN
    v_scope_path := p_org_hierarchy_scope::LTREE;
  ELSE
    v_scope_path := v_org_path;
  END IF;

  -- Validate subset-only delegation: user can only grant permissions they have
  SELECT array_agg(DISTINCT rp.permission_id) INTO v_user_perms
  FROM user_roles_projection ur
  JOIN role_permissions_projection rp ON rp.role_id = ur.role_id
  WHERE ur.user_id = v_user_id;

  v_user_perms := COALESCE(v_user_perms, '{}');

  FOREACH v_perm_id IN ARRAY p_permission_ids
  LOOP
    IF NOT (v_perm_id = ANY(v_user_perms)) THEN
      SELECT name INTO v_perm_name FROM permissions_projection WHERE id = v_perm_id;
      RETURN jsonb_build_object(
        'success', false,
        'error', 'Cannot grant permission you do not possess',
        'errorDetails', jsonb_build_object(
          'code', 'SUBSET_ONLY_VIOLATION',
          'message', format('Permission %s is not in your granted set', COALESCE(v_perm_name, v_perm_id::TEXT))
        )
      );
    END IF;
  END LOOP;

  v_role_id := gen_random_uuid();

  -- Build event metadata (include cloned_from_role_id if this is a duplicate)
  v_event_metadata := jsonb_build_object(
    'user_id', v_user_id,
    'organization_id', v_org_id,
    'reason', CASE
      WHEN p_cloned_from_role_id IS NOT NULL THEN 'Role duplicated via Role Management UI'
      ELSE 'Creating new role via Role Management UI'
    END
  );

  -- Add cloned_from_role_id to metadata if provided
  IF p_cloned_from_role_id IS NOT NULL THEN
    v_event_metadata := v_event_metadata || jsonb_build_object('cloned_from_role_id', p_cloned_from_role_id);
  END IF;

  -- Emit role.created event
  PERFORM api.emit_domain_event(
    p_stream_id := v_role_id,
    p_stream_type := 'role',
    p_event_type := 'role.created',
    p_event_data := jsonb_build_object(
      'name', p_name,
      'description', p_description,
      'organization_id', v_org_id,
      'org_hierarchy_scope', v_scope_path::TEXT
    ),
    p_event_metadata := v_event_metadata
  );

  -- Emit permission grant events
  FOREACH v_perm_id IN ARRAY p_permission_ids
  LOOP
    SELECT name INTO v_perm_name FROM permissions_projection WHERE id = v_perm_id;
    PERFORM api.emit_domain_event(
      p_stream_id := v_role_id,
      p_stream_type := 'role',
      p_event_type := 'role.permission.granted',
      p_event_data := jsonb_build_object(
        'permission_id', v_perm_id,
        'permission_name', v_perm_name
      ),
      p_event_metadata := jsonb_build_object(
        'user_id', v_user_id,
        'organization_id', v_org_id,
        'reason', CASE
          WHEN p_cloned_from_role_id IS NOT NULL THEN 'Permission cloned from source role'
          ELSE 'Initial permission grant during role creation'
        END
      )
    );
  END LOOP;

  RETURN jsonb_build_object(
    'success', true,
    'role', jsonb_build_object(
      'id', v_role_id,
      'name', p_name,
      'description', p_description,
      'organizationId', v_org_id,
      'orgHierarchyScope', v_scope_path::TEXT,
      'isActive', true,
      'createdAt', now(),
      'updatedAt', now()
    )
  );
END;
$$;

COMMENT ON FUNCTION api.create_role(TEXT, TEXT, TEXT, UUID[], UUID) IS 'Create a new role with permissions. Supports optional p_cloned_from_role_id for role duplication audit trail. Enforces subset-only delegation.';
