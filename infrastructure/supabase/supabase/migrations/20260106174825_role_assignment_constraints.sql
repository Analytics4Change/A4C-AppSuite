-- Migration: Role Assignment Constraint Validation
-- Purpose: Extract shared validation logic into reusable helpers, add role assignment validation
--
-- This migration:
-- 1. Creates helper functions for permission and scope validation
-- 2. Refactors api.create_role() and api.update_role() to use helpers
-- 3. Adds api.get_assignable_roles() for filtering roles by inviter constraints
-- 4. Adds api.validate_role_assignment() for server-side validation

-- ============================================================================
-- STEP 1: Create reusable helper functions (in public schema, not api)
-- ============================================================================

-- Helper: Get all permission IDs a user has across all their roles
-- Note: Roles with validity dates are considered active if current date is within range
CREATE OR REPLACE FUNCTION public.get_user_aggregated_permissions(p_user_id UUID)
RETURNS UUID[]
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
  SELECT COALESCE(
    array_agg(DISTINCT rp.permission_id),
    '{}'::UUID[]
  )
  FROM user_roles_projection ur
  JOIN role_permissions_projection rp ON rp.role_id = ur.role_id
  WHERE ur.user_id = p_user_id
    AND (ur.role_valid_from IS NULL OR ur.role_valid_from <= CURRENT_DATE)
    AND (ur.role_valid_until IS NULL OR ur.role_valid_until >= CURRENT_DATE);
$$;

COMMENT ON FUNCTION public.get_user_aggregated_permissions(UUID) IS
'Returns array of all permission IDs the user has across all active roles. Used for subset-only delegation validation.';


-- Helper: Get all scope paths a user has across their roles
-- NULL in the array means global access (can assign to any scope)
-- Note: Roles with validity dates are considered active if current date is within range
CREATE OR REPLACE FUNCTION public.get_user_scope_paths(p_user_id UUID)
RETURNS ltree[]
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
  SELECT COALESCE(
    array_agg(DISTINCT ur.scope_path),
    '{}'::ltree[]
  )
  FROM user_roles_projection ur
  WHERE ur.user_id = p_user_id
    AND (ur.role_valid_from IS NULL OR ur.role_valid_from <= CURRENT_DATE)
    AND (ur.role_valid_until IS NULL OR ur.role_valid_until >= CURRENT_DATE);
$$;

COMMENT ON FUNCTION public.get_user_scope_paths(UUID) IS
'Returns array of all scope paths (ltree) the user has. NULL in array means global access.';


-- Helper: Check if all required permissions exist in the available set
CREATE OR REPLACE FUNCTION public.check_permissions_subset(
  p_required UUID[],
  p_available UUID[]
)
RETURNS BOOLEAN
LANGUAGE sql
IMMUTABLE
AS $$
  -- All required permissions must be in available set
  -- Empty required array always passes
  SELECT p_required <@ p_available;
$$;

COMMENT ON FUNCTION public.check_permissions_subset(UUID[], UUID[]) IS
'Returns TRUE if all required permissions exist in available set. Pure function, no DB queries.';


-- Helper: Check if target scope is contained within any of the user's scopes
-- NULL in user_scopes means global access (allows any target)
-- NULL target_scope means role has no scope restriction (rare but valid)
CREATE OR REPLACE FUNCTION public.check_scope_containment(
  p_target_scope ltree,
  p_user_scopes ltree[]
)
RETURNS BOOLEAN
LANGUAGE plpgsql
IMMUTABLE
AS $$
BEGIN
  -- If user has NULL in their scopes, they have global access
  IF NULL = ANY(p_user_scopes) THEN
    RETURN TRUE;
  END IF;

  -- If target scope is NULL, it means no scope restriction (global role)
  -- Only users with global access (NULL scope) can assign such roles
  IF p_target_scope IS NULL THEN
    RETURN FALSE;
  END IF;

  -- Check if any user scope contains the target scope
  -- Using ltree @> operator: parent @> child means parent contains child
  RETURN EXISTS (
    SELECT 1 FROM unnest(p_user_scopes) AS user_scope
    WHERE user_scope @> p_target_scope
  );
END;
$$;

COMMENT ON FUNCTION public.check_scope_containment(ltree, ltree[]) IS
'Returns TRUE if target scope is within any user scope. NULL user scope = global access.';


-- ============================================================================
-- STEP 2: Refactor api.create_role() to use helper functions
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
  v_perm_count INT := 0;
BEGIN
  v_user_id := public.get_current_user_id();
  v_org_id := public.get_current_org_id();

  IF v_org_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Organization context required',
      'errorDetails', jsonb_build_object('code', 'NO_ORG_CONTEXT', 'message', 'User must be in an organization context'));
  END IF;

  IF p_name IS NULL OR length(trim(p_name)) = 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Name is required',
      'errorDetails', jsonb_build_object('code', 'VALIDATION_ERROR', 'message', 'Role name cannot be empty'));
  END IF;

  SELECT path INTO v_org_path FROM organizations_projection WHERE id = v_org_id;
  v_scope_path := COALESCE(p_org_hierarchy_scope::LTREE, v_org_path);

  -- Use helper function for permission aggregation
  v_user_perms := public.get_user_aggregated_permissions(v_user_id);

  -- Use helper function for subset check
  IF NOT public.check_permissions_subset(p_permission_ids, v_user_perms) THEN
    -- Find which permission is violating
    FOREACH v_perm_id IN ARRAY p_permission_ids
    LOOP
      IF NOT (v_perm_id = ANY(v_user_perms)) THEN
        SELECT name INTO v_perm_name FROM permissions_projection WHERE id = v_perm_id;
        RETURN jsonb_build_object('success', false, 'error', 'Cannot grant permission you do not possess',
          'errorDetails', jsonb_build_object('code', 'SUBSET_ONLY_VIOLATION',
            'message', format('Permission %s is not in your granted set', COALESCE(v_perm_name, v_perm_id::TEXT))));
      END IF;
    END LOOP;
  END IF;

  v_role_id := gen_random_uuid();

  v_event_metadata := jsonb_build_object(
    'user_id', v_user_id,
    'organization_id', v_org_id,
    'reason', CASE WHEN p_cloned_from_role_id IS NOT NULL THEN 'Role duplicated via Role Management UI'
      ELSE 'Creating new role via Role Management UI' END
  );
  IF p_cloned_from_role_id IS NOT NULL THEN
    v_event_metadata := v_event_metadata || jsonb_build_object('cloned_from_role_id', p_cloned_from_role_id);
  END IF;

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
    v_perm_count := v_perm_count + 1;
    SELECT name INTO v_perm_name FROM permissions_projection WHERE id = v_perm_id;

    PERFORM api.emit_domain_event(
      p_stream_id := v_role_id,
      p_stream_type := 'role',
      p_event_type := 'role.permission.granted',
      p_event_data := jsonb_build_object('permission_id', v_perm_id, 'permission_name', v_perm_name),
      p_event_metadata := jsonb_build_object(
        'user_id', v_user_id,
        'organization_id', v_org_id,
        'reason', CASE WHEN p_cloned_from_role_id IS NOT NULL THEN 'Permission cloned from source role'
          ELSE 'Initial permission grant during role creation' END
      )
    );
  END LOOP;

  RETURN jsonb_build_object('success', true, 'role', jsonb_build_object(
    'id', v_role_id, 'name', p_name, 'description', p_description,
    'organizationId', v_org_id, 'orgHierarchyScope', v_scope_path::TEXT,
    'isActive', true, 'createdAt', now(), 'updatedAt', now()
  ));
END;
$$;

COMMENT ON FUNCTION api.create_role(TEXT, TEXT, TEXT, UUID[], UUID) IS
'Create a new role with permissions. Uses helper functions for subset-only delegation validation.';


-- ============================================================================
-- STEP 3: Refactor api.update_role() to use helper functions
-- ============================================================================

CREATE OR REPLACE FUNCTION api.update_role(
  p_role_id UUID,
  p_name TEXT DEFAULT NULL,
  p_description TEXT DEFAULT NULL,
  p_permission_ids UUID[] DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
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

    -- Use helper function for permission aggregation
    v_user_perms := public.get_user_aggregated_permissions(v_user_id);

    -- Permissions to grant (in new but not in current)
    v_to_grant := ARRAY(SELECT unnest(v_new_perms) EXCEPT SELECT unnest(v_current_perms));

    -- Use helper function for subset check on grants only
    IF NOT public.check_permissions_subset(v_to_grant, v_user_perms) THEN
      -- Find which permission is violating
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
    END IF;

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

COMMENT ON FUNCTION api.update_role(UUID, TEXT, TEXT, UUID[]) IS
'Update role name/description and permissions. Uses helper functions for subset-only delegation validation.';


-- ============================================================================
-- STEP 4: Create api.get_assignable_roles() - filter roles by inviter constraints
-- ============================================================================

CREATE OR REPLACE FUNCTION api.get_assignable_roles(
  p_org_id UUID DEFAULT NULL
)
RETURNS TABLE (
  role_id UUID,
  role_name TEXT,
  role_description TEXT,
  org_hierarchy_scope TEXT,
  permission_count BIGINT,
  is_assignable BOOLEAN,
  restriction_reason TEXT
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_user_id UUID;
  v_org_id UUID;
  v_user_perms UUID[];
  v_user_scopes ltree[];
BEGIN
  v_user_id := public.get_current_user_id();
  v_org_id := COALESCE(p_org_id, public.get_current_org_id());

  IF v_org_id IS NULL THEN
    RETURN;
  END IF;

  -- Get inviter's permissions and scopes
  v_user_perms := public.get_user_aggregated_permissions(v_user_id);
  v_user_scopes := public.get_user_scope_paths(v_user_id);

  RETURN QUERY
  SELECT
    r.id AS role_id,
    r.name AS role_name,
    r.description AS role_description,
    r.org_hierarchy_scope::TEXT AS org_hierarchy_scope,
    COALESCE(perm_counts.perm_count, 0) AS permission_count,
    -- Role is assignable if:
    -- 1. All its permissions are in inviter's permission set
    -- 2. Its scope is within inviter's scope hierarchy
    CASE
      WHEN NOT public.check_permissions_subset(
        COALESCE(role_perms.permissions, '{}'),
        v_user_perms
      ) THEN FALSE
      WHEN NOT public.check_scope_containment(
        r.org_hierarchy_scope,
        v_user_scopes
      ) THEN FALSE
      ELSE TRUE
    END AS is_assignable,
    -- Explain why not assignable (for debugging/UI)
    CASE
      WHEN NOT public.check_permissions_subset(
        COALESCE(role_perms.permissions, '{}'),
        v_user_perms
      ) THEN 'Role has permissions you do not possess'
      WHEN NOT public.check_scope_containment(
        r.org_hierarchy_scope,
        v_user_scopes
      ) THEN 'Role scope is outside your authority'
      ELSE NULL
    END AS restriction_reason
  FROM roles_projection r
  LEFT JOIN (
    SELECT rp.role_id, array_agg(rp.permission_id) AS permissions
    FROM role_permissions_projection rp
    GROUP BY rp.role_id
  ) role_perms ON role_perms.role_id = r.id
  LEFT JOIN (
    SELECT rp.role_id, COUNT(*) AS perm_count
    FROM role_permissions_projection rp
    GROUP BY rp.role_id
  ) perm_counts ON perm_counts.role_id = r.id
  WHERE r.organization_id = v_org_id
    AND r.is_active = TRUE
    AND r.deleted_at IS NULL
  ORDER BY r.name;
END;
$$;

COMMENT ON FUNCTION api.get_assignable_roles(UUID) IS
'Returns roles in the organization with assignability status based on inviter constraints (permission subset + scope hierarchy).';

-- Grant execute permission to authenticated users
GRANT EXECUTE ON FUNCTION api.get_assignable_roles(UUID) TO authenticated;


-- ============================================================================
-- STEP 5: Create api.validate_role_assignment() - server-side validation
-- ============================================================================

CREATE OR REPLACE FUNCTION api.validate_role_assignment(
  p_role_ids UUID[]
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_user_id UUID;
  v_user_perms UUID[];
  v_user_scopes ltree[];
  v_role RECORD;
  v_role_perms UUID[];
  v_violations JSONB := '[]'::JSONB;
BEGIN
  -- Empty array is always valid (no-role invitations allowed)
  IF p_role_ids IS NULL OR array_length(p_role_ids, 1) IS NULL THEN
    RETURN jsonb_build_object('valid', true, 'violations', '[]'::JSONB);
  END IF;

  v_user_id := public.get_current_user_id();
  v_user_perms := public.get_user_aggregated_permissions(v_user_id);
  v_user_scopes := public.get_user_scope_paths(v_user_id);

  -- Check each role
  FOR v_role IN
    SELECT r.id, r.name, r.org_hierarchy_scope
    FROM roles_projection r
    WHERE r.id = ANY(p_role_ids)
      AND r.is_active = TRUE
      AND r.deleted_at IS NULL
  LOOP
    -- Get role's permissions
    SELECT array_agg(permission_id) INTO v_role_perms
    FROM role_permissions_projection
    WHERE role_id = v_role.id;
    v_role_perms := COALESCE(v_role_perms, '{}');

    -- Check permission subset
    IF NOT public.check_permissions_subset(v_role_perms, v_user_perms) THEN
      v_violations := v_violations || jsonb_build_object(
        'role_id', v_role.id,
        'role_name', v_role.name,
        'error_code', 'SUBSET_ONLY_VIOLATION',
        'message', format('Role "%s" has permissions you do not possess', v_role.name)
      );
      CONTINUE;
    END IF;

    -- Check scope containment
    IF NOT public.check_scope_containment(v_role.org_hierarchy_scope, v_user_scopes) THEN
      v_violations := v_violations || jsonb_build_object(
        'role_id', v_role.id,
        'role_name', v_role.name,
        'error_code', 'SCOPE_HIERARCHY_VIOLATION',
        'message', format('Role "%s" scope is outside your authority', v_role.name)
      );
      CONTINUE;
    END IF;
  END LOOP;

  -- Check for roles that don't exist
  FOR v_role IN
    SELECT unnest(p_role_ids) AS id
    EXCEPT
    SELECT r.id FROM roles_projection r WHERE r.id = ANY(p_role_ids) AND r.is_active = TRUE
  LOOP
    v_violations := v_violations || jsonb_build_object(
      'role_id', v_role.id,
      'role_name', NULL,
      'error_code', 'ROLE_NOT_FOUND',
      'message', format('Role %s not found or inactive', v_role.id)
    );
  END LOOP;

  RETURN jsonb_build_object(
    'valid', jsonb_array_length(v_violations) = 0,
    'violations', v_violations
  );
END;
$$;

COMMENT ON FUNCTION api.validate_role_assignment(UUID[]) IS
'Validates role assignment against inviter constraints. Returns violations for each role that fails permission subset or scope hierarchy checks.';

-- Grant execute permission to authenticated users
GRANT EXECUTE ON FUNCTION api.validate_role_assignment(UUID[]) TO authenticated;


-- ============================================================================
-- GRANTS for helper functions (needed by api functions)
-- ============================================================================

GRANT EXECUTE ON FUNCTION public.get_user_aggregated_permissions(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_user_scope_paths(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.check_permissions_subset(UUID[], UUID[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.check_scope_containment(ltree, ltree[]) TO authenticated;
