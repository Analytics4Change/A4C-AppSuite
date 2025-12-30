-- ============================================
-- Role Management API Functions
-- ============================================
-- This migration adds API functions for role CRUD operations
-- following the SECURITY INVOKER pattern with RLS enforcement.
--
-- Events added: role.updated, role.deactivated, role.reactivated, role.deleted
-- (role.created, role.permission.granted, role.permission.revoked already exist)

-- ============================================
-- 1. API Functions (SECURITY INVOKER)
-- ============================================

-- 1.1 Get all roles for the user's organization
CREATE OR REPLACE FUNCTION api.get_roles(
  p_status TEXT DEFAULT 'all',
  p_search_term TEXT DEFAULT NULL
)
RETURNS TABLE (
  id UUID,
  name TEXT,
  description TEXT,
  organization_id UUID,
  org_hierarchy_scope TEXT,
  is_active BOOLEAN,
  deleted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ,
  permission_count BIGINT,
  user_count BIGINT
)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, extensions, pg_temp
AS $$
BEGIN
  RETURN QUERY
  SELECT
    r.id,
    r.name,
    r.description,
    r.organization_id,
    r.org_hierarchy_scope::TEXT,
    r.is_active,
    r.deleted_at,
    r.created_at,
    r.updated_at,
    (SELECT COUNT(*) FROM role_permissions_projection rp WHERE rp.role_id = r.id) AS permission_count,
    (SELECT COUNT(*) FROM user_roles_projection ur WHERE ur.role_id = r.id) AS user_count
  FROM roles_projection r
  WHERE
    r.deleted_at IS NULL
    AND (p_status = 'all'
         OR (p_status = 'active' AND r.is_active = true)
         OR (p_status = 'inactive' AND r.is_active = false))
    AND (p_search_term IS NULL
         OR r.name ILIKE '%' || p_search_term || '%'
         OR r.description ILIKE '%' || p_search_term || '%')
  ORDER BY
    r.is_active DESC,
    r.name ASC;
END;
$$;

COMMENT ON FUNCTION api.get_roles IS 'List roles visible to current user (filtered by RLS). Supports status and search filtering.';

-- 1.2 Get a single role by ID with its permissions
CREATE OR REPLACE FUNCTION api.get_role_by_id(p_role_id UUID)
RETURNS TABLE (
  id UUID,
  name TEXT,
  description TEXT,
  organization_id UUID,
  org_hierarchy_scope TEXT,
  is_active BOOLEAN,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ,
  permissions JSONB
)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, extensions, pg_temp
AS $$
BEGIN
  RETURN QUERY
  SELECT
    r.id,
    r.name,
    r.description,
    r.organization_id,
    r.org_hierarchy_scope::TEXT,
    r.is_active,
    r.created_at,
    r.updated_at,
    (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'id', p.id,
        'name', p.name,
        'applet', p.applet,
        'action', p.action,
        'description', p.description,
        'scope_type', p.scope_type
      ) ORDER BY p.applet, p.action), '[]'::jsonb)
      FROM role_permissions_projection rp
      JOIN permissions_projection p ON p.id = rp.permission_id
      WHERE rp.role_id = r.id
    ) AS permissions
  FROM roles_projection r
  WHERE
    r.id = p_role_id
    AND r.deleted_at IS NULL;
END;
$$;

COMMENT ON FUNCTION api.get_role_by_id IS 'Get a single role with its associated permissions. Access controlled by RLS.';

-- 1.3 Get all available permissions (for permission selector UI)
CREATE OR REPLACE FUNCTION api.get_permissions()
RETURNS TABLE (
  id UUID,
  name TEXT,
  applet TEXT,
  action TEXT,
  description TEXT,
  scope_type TEXT,
  requires_mfa BOOLEAN
)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, extensions, pg_temp
AS $$
BEGIN
  RETURN QUERY
  SELECT
    p.id,
    p.name,
    p.applet,
    p.action,
    p.description,
    p.scope_type,
    p.requires_mfa
  FROM permissions_projection p
  ORDER BY p.applet, p.action;
END;
$$;

COMMENT ON FUNCTION api.get_permissions IS 'List all available permissions grouped by applet. Used for role permission selector UI.';

-- 1.4 Get current user's permissions (for subset-only delegation enforcement)
CREATE OR REPLACE FUNCTION api.get_user_permissions()
RETURNS TABLE (permission_id UUID)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_user_id UUID;
BEGIN
  v_user_id := public.get_current_user_id();

  RETURN QUERY
  SELECT DISTINCT rp.permission_id
  FROM user_roles_projection ur
  JOIN role_permissions_projection rp ON rp.role_id = ur.role_id
  WHERE ur.user_id = v_user_id;
END;
$$;

COMMENT ON FUNCTION api.get_user_permissions IS 'Get permission IDs the current user possesses. Used to enforce subset-only delegation in UI.';

-- 1.5 Create a new role with permissions
CREATE OR REPLACE FUNCTION api.create_role(
  p_name TEXT,
  p_description TEXT,
  p_org_hierarchy_scope TEXT DEFAULT NULL,
  p_permission_ids UUID[] DEFAULT '{}'
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
    p_event_metadata := jsonb_build_object(
      'user_id', v_user_id,
      'organization_id', v_org_id,
      'reason', 'Creating new role via Role Management UI'
    )
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
        'reason', 'Initial permission grant during role creation'
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

COMMENT ON FUNCTION api.create_role IS 'Create a new role with optional permissions. Enforces subset-only delegation.';

-- 1.6 Update an existing role
CREATE OR REPLACE FUNCTION api.update_role(
  p_role_id UUID,
  p_name TEXT DEFAULT NULL,
  p_description TEXT DEFAULT NULL,
  p_permission_ids UUID[] DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_user_id UUID;
  v_org_id UUID;
  v_existing RECORD;
  v_current_perms UUID[];
  v_new_perms UUID[];
  v_to_grant UUID[];
  v_to_revoke UUID[];
  v_perm_id UUID;
  v_user_perms UUID[];
  v_perm_name TEXT;
BEGIN
  v_user_id := public.get_current_user_id();
  v_org_id := public.get_current_org_id();

  -- Get existing role (RLS will filter unauthorized access)
  SELECT * INTO v_existing FROM roles_projection
  WHERE id = p_role_id AND deleted_at IS NULL;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Role not found',
      'errorDetails', jsonb_build_object('code', 'NOT_FOUND', 'message', 'Role not found or access denied')
    );
  END IF;

  IF NOT v_existing.is_active THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Cannot update inactive role',
      'errorDetails', jsonb_build_object('code', 'INACTIVE_ROLE', 'message', 'Reactivate the role before making changes')
    );
  END IF;

  -- Emit role.updated event if name or description changed
  IF p_name IS NOT NULL OR p_description IS NOT NULL THEN
    PERFORM api.emit_domain_event(
      p_stream_id := p_role_id,
      p_stream_type := 'role',
      p_event_type := 'role.updated',
      p_event_data := jsonb_build_object(
        'name', COALESCE(p_name, v_existing.name),
        'description', COALESCE(p_description, v_existing.description)
      ),
      p_event_metadata := jsonb_build_object(
        'user_id', v_user_id,
        'organization_id', v_org_id,
        'reason', 'Role metadata update via Role Management UI'
      )
    );
  END IF;

  -- Handle permission changes
  IF p_permission_ids IS NOT NULL THEN
    -- Get current permissions
    SELECT array_agg(permission_id) INTO v_current_perms
    FROM role_permissions_projection WHERE role_id = p_role_id;
    v_current_perms := COALESCE(v_current_perms, '{}');
    v_new_perms := p_permission_ids;

    -- Get user's permissions for subset-only check
    SELECT array_agg(DISTINCT rp.permission_id) INTO v_user_perms
    FROM user_roles_projection ur
    JOIN role_permissions_projection rp ON rp.role_id = ur.role_id
    WHERE ur.user_id = v_user_id;
    v_user_perms := COALESCE(v_user_perms, '{}');

    -- Permissions to grant (in new but not in current)
    v_to_grant := ARRAY(SELECT unnest(v_new_perms) EXCEPT SELECT unnest(v_current_perms));

    -- Validate subset-only for grants
    FOREACH v_perm_id IN ARRAY v_to_grant
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

    -- Permissions to revoke (in current but not in new)
    v_to_revoke := ARRAY(SELECT unnest(v_current_perms) EXCEPT SELECT unnest(v_new_perms));

    -- Emit grant events
    FOREACH v_perm_id IN ARRAY v_to_grant
    LOOP
      SELECT name INTO v_perm_name FROM permissions_projection WHERE id = v_perm_id;
      PERFORM api.emit_domain_event(
        p_stream_id := p_role_id,
        p_stream_type := 'role',
        p_event_type := 'role.permission.granted',
        p_event_data := jsonb_build_object(
          'permission_id', v_perm_id,
          'permission_name', v_perm_name
        ),
        p_event_metadata := jsonb_build_object(
          'user_id', v_user_id,
          'organization_id', v_org_id,
          'reason', 'Permission added via Role Management UI'
        )
      );
    END LOOP;

    -- Emit revoke events
    FOREACH v_perm_id IN ARRAY v_to_revoke
    LOOP
      SELECT name INTO v_perm_name FROM permissions_projection WHERE id = v_perm_id;
      PERFORM api.emit_domain_event(
        p_stream_id := p_role_id,
        p_stream_type := 'role',
        p_event_type := 'role.permission.revoked',
        p_event_data := jsonb_build_object(
          'permission_id', v_perm_id,
          'permission_name', v_perm_name,
          'revocation_reason', 'Permission removed via Role Management UI'
        ),
        p_event_metadata := jsonb_build_object(
          'user_id', v_user_id,
          'organization_id', v_org_id,
          'reason', 'Permission removed via Role Management UI'
        )
      );
    END LOOP;
  END IF;

  RETURN jsonb_build_object('success', true);
END;
$$;

COMMENT ON FUNCTION api.update_role IS 'Update role name/description and permissions. Enforces subset-only delegation for grants.';

-- 1.7 Deactivate a role
CREATE OR REPLACE FUNCTION api.deactivate_role(p_role_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_user_id UUID;
  v_org_id UUID;
  v_existing RECORD;
BEGIN
  v_user_id := public.get_current_user_id();
  v_org_id := public.get_current_org_id();

  SELECT * INTO v_existing FROM roles_projection
  WHERE id = p_role_id AND deleted_at IS NULL;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Role not found',
      'errorDetails', jsonb_build_object('code', 'NOT_FOUND', 'message', 'Role not found or access denied')
    );
  END IF;

  IF NOT v_existing.is_active THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Role already inactive',
      'errorDetails', jsonb_build_object('code', 'ALREADY_INACTIVE', 'message', 'Role is already deactivated')
    );
  END IF;

  PERFORM api.emit_domain_event(
    p_stream_id := p_role_id,
    p_stream_type := 'role',
    p_event_type := 'role.deactivated',
    p_event_data := jsonb_build_object('reason', 'Deactivated via Role Management UI'),
    p_event_metadata := jsonb_build_object(
      'user_id', v_user_id,
      'organization_id', v_org_id,
      'reason', 'Role deactivation via UI'
    )
  );

  RETURN jsonb_build_object('success', true);
END;
$$;

COMMENT ON FUNCTION api.deactivate_role IS 'Deactivate a role (soft freeze). Users with this role retain it but it cannot be assigned.';

-- 1.8 Reactivate a role
CREATE OR REPLACE FUNCTION api.reactivate_role(p_role_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_user_id UUID;
  v_org_id UUID;
  v_existing RECORD;
BEGIN
  v_user_id := public.get_current_user_id();
  v_org_id := public.get_current_org_id();

  SELECT * INTO v_existing FROM roles_projection
  WHERE id = p_role_id AND deleted_at IS NULL;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Role not found',
      'errorDetails', jsonb_build_object('code', 'NOT_FOUND', 'message', 'Role not found or access denied')
    );
  END IF;

  IF v_existing.is_active THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Role already active',
      'errorDetails', jsonb_build_object('code', 'ALREADY_ACTIVE', 'message', 'Role is already active')
    );
  END IF;

  PERFORM api.emit_domain_event(
    p_stream_id := p_role_id,
    p_stream_type := 'role',
    p_event_type := 'role.reactivated',
    p_event_data := jsonb_build_object('reason', 'Reactivated via Role Management UI'),
    p_event_metadata := jsonb_build_object(
      'user_id', v_user_id,
      'organization_id', v_org_id,
      'reason', 'Role reactivation via UI'
    )
  );

  RETURN jsonb_build_object('success', true);
END;
$$;

COMMENT ON FUNCTION api.reactivate_role IS 'Reactivate a previously deactivated role.';

-- 1.9 Delete a role (soft delete)
CREATE OR REPLACE FUNCTION api.delete_role(p_role_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_user_id UUID;
  v_org_id UUID;
  v_existing RECORD;
  v_user_count INTEGER;
BEGIN
  v_user_id := public.get_current_user_id();
  v_org_id := public.get_current_org_id();

  SELECT * INTO v_existing FROM roles_projection
  WHERE id = p_role_id AND deleted_at IS NULL;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Role not found',
      'errorDetails', jsonb_build_object('code', 'NOT_FOUND', 'message', 'Role not found or access denied')
    );
  END IF;

  IF v_existing.is_active THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Role must be deactivated first',
      'errorDetails', jsonb_build_object('code', 'STILL_ACTIVE', 'message', 'Deactivate role before deletion')
    );
  END IF;

  SELECT COUNT(*) INTO v_user_count FROM user_roles_projection WHERE role_id = p_role_id;
  IF v_user_count > 0 THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Role has user assignments',
      'errorDetails', jsonb_build_object(
        'code', 'HAS_USERS',
        'count', v_user_count,
        'message', format('%s users still assigned to this role', v_user_count)
      )
    );
  END IF;

  PERFORM api.emit_domain_event(
    p_stream_id := p_role_id,
    p_stream_type := 'role',
    p_event_type := 'role.deleted',
    p_event_data := jsonb_build_object('reason', 'Deleted via Role Management UI'),
    p_event_metadata := jsonb_build_object(
      'user_id', v_user_id,
      'organization_id', v_org_id,
      'reason', 'Role deletion via UI'
    )
  );

  RETURN jsonb_build_object('success', true);
END;
$$;

COMMENT ON FUNCTION api.delete_role IS 'Soft delete a role. Requires deactivation first and no user assignments.';

-- ============================================
-- 2. Grant execute permissions
-- ============================================
GRANT EXECUTE ON FUNCTION api.get_roles TO authenticated;
GRANT EXECUTE ON FUNCTION api.get_role_by_id TO authenticated;
GRANT EXECUTE ON FUNCTION api.get_permissions TO authenticated;
GRANT EXECUTE ON FUNCTION api.get_user_permissions TO authenticated;
GRANT EXECUTE ON FUNCTION api.create_role TO authenticated;
GRANT EXECUTE ON FUNCTION api.update_role TO authenticated;
GRANT EXECUTE ON FUNCTION api.deactivate_role TO authenticated;
GRANT EXECUTE ON FUNCTION api.reactivate_role TO authenticated;
GRANT EXECUTE ON FUNCTION api.delete_role TO authenticated;

-- ============================================
-- 3. Event Processor Updates
-- ============================================
-- Update process_rbac_event to handle new event types

CREATE OR REPLACE FUNCTION public.process_rbac_event(p_event RECORD)
RETURNS VOID
LANGUAGE plpgsql
SET search_path = public, extensions, pg_temp
AS $$
BEGIN
  CASE p_event.event_type
    -- Existing: role.created
    WHEN 'role.created' THEN
      INSERT INTO roles_projection (
        id, name, description, organization_id, org_hierarchy_scope,
        is_active, created_at, updated_at
      ) VALUES (
        p_event.stream_id,
        p_event.event_data->>'name',
        p_event.event_data->>'description',
        (p_event.event_data->>'organization_id')::UUID,
        (p_event.event_data->>'org_hierarchy_scope')::LTREE,
        true,
        p_event.created_at,
        p_event.created_at
      )
      ON CONFLICT (id) DO UPDATE SET
        name = EXCLUDED.name,
        description = EXCLUDED.description,
        organization_id = EXCLUDED.organization_id,
        org_hierarchy_scope = EXCLUDED.org_hierarchy_scope,
        updated_at = EXCLUDED.updated_at;

    -- NEW: role.updated
    WHEN 'role.updated' THEN
      UPDATE roles_projection
      SET
        name = COALESCE(p_event.event_data->>'name', name),
        description = COALESCE(p_event.event_data->>'description', description),
        updated_at = p_event.created_at
      WHERE id = p_event.stream_id;

      IF NOT FOUND THEN
        RAISE WARNING 'Role % not found for update event', p_event.stream_id;
      END IF;

    -- NEW: role.deactivated
    WHEN 'role.deactivated' THEN
      UPDATE roles_projection
      SET
        is_active = false,
        updated_at = p_event.created_at
      WHERE id = p_event.stream_id;

      IF NOT FOUND THEN
        RAISE WARNING 'Role % not found for deactivation event', p_event.stream_id;
      END IF;

    -- NEW: role.reactivated
    WHEN 'role.reactivated' THEN
      UPDATE roles_projection
      SET
        is_active = true,
        updated_at = p_event.created_at
      WHERE id = p_event.stream_id;

      IF NOT FOUND THEN
        RAISE WARNING 'Role % not found for reactivation event', p_event.stream_id;
      END IF;

    -- NEW: role.deleted
    WHEN 'role.deleted' THEN
      UPDATE roles_projection
      SET
        deleted_at = p_event.created_at,
        updated_at = p_event.created_at
      WHERE id = p_event.stream_id;

      IF NOT FOUND THEN
        RAISE WARNING 'Role % not found for deletion event', p_event.stream_id;
      END IF;

    -- Existing: role.permission.granted
    WHEN 'role.permission.granted' THEN
      INSERT INTO role_permissions_projection (role_id, permission_id, granted_at)
      VALUES (
        p_event.stream_id,
        (p_event.event_data->>'permission_id')::UUID,
        p_event.created_at
      )
      ON CONFLICT (role_id, permission_id) DO NOTHING;

    -- Existing: role.permission.revoked
    WHEN 'role.permission.revoked' THEN
      DELETE FROM role_permissions_projection
      WHERE role_id = p_event.stream_id
        AND permission_id = (p_event.event_data->>'permission_id')::UUID;

    -- Existing: permission.defined
    WHEN 'permission.defined' THEN
      INSERT INTO permissions_projection (
        id, applet, action, description, scope_type, requires_mfa, created_at
      ) VALUES (
        p_event.stream_id,
        p_event.event_data->>'applet',
        p_event.event_data->>'action',
        p_event.event_data->>'description',
        p_event.event_data->>'scope_type',
        COALESCE((p_event.event_data->>'requires_mfa')::BOOLEAN, false),
        p_event.created_at
      )
      ON CONFLICT (id) DO UPDATE SET
        description = EXCLUDED.description,
        scope_type = EXCLUDED.scope_type,
        requires_mfa = EXCLUDED.requires_mfa;

    -- Existing: user.role.assigned
    WHEN 'user.role.assigned' THEN
      INSERT INTO user_roles_projection (
        user_id, role_id, org_id, scope_path, assigned_at
      ) VALUES (
        p_event.stream_id,
        (p_event.event_data->>'role_id')::UUID,
        CASE WHEN p_event.event_data->>'org_id' = '*' THEN NULL ELSE (p_event.event_data->>'org_id')::UUID END,
        CASE WHEN p_event.event_data->>'scope_path' = '*' THEN NULL ELSE (p_event.event_data->>'scope_path')::LTREE END,
        p_event.created_at
      )
      ON CONFLICT (user_id, role_id, org_id) DO NOTHING;

    -- Existing: user.role.revoked
    WHEN 'user.role.revoked' THEN
      DELETE FROM user_roles_projection
      WHERE user_id = p_event.stream_id
        AND role_id = (p_event.event_data->>'role_id')::UUID;

    ELSE
      RAISE WARNING 'Unknown RBAC event type: %', p_event.event_type;
  END CASE;
END;
$$;

COMMENT ON FUNCTION public.process_rbac_event IS 'Process RBAC domain events and update projections. Handles role lifecycle and permission management.';
