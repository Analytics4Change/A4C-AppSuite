-- Organization Unit CRUD RPC Functions
-- These functions provide CRUD operations for organizational units via the 'api' schema
-- since PostgREST only exposes 'api' schema, not 'public' schema.
--
-- Matches frontend service: frontend/src/services/organization/SupabaseOrganizationUnitService.ts
-- Frontend calls: .schema('api').rpc('get_organization_units', params)
--
-- Security Model:
-- - All operations scoped to user's JWT scope_path claim
-- - RLS policies provide additional enforcement (see 06-rls/004-ou-management-policies.sql)
-- - Only users with organization.create_ou permission should access these functions
--
-- IMPORTANT: These functions operate on sub-organizations (nlevel(path) > 2 only)
-- Root organizations (nlevel(path) = 2) are created via organization bootstrap workflow
--
-- Contract: infrastructure/supabase/contracts/asyncapi/domains/organization.yaml

-- Drop old function signatures to prevent ambiguity
DROP FUNCTION IF EXISTS api.get_organization_units(TEXT, BOOLEAN, TEXT);
DROP FUNCTION IF EXISTS api.get_organization_unit_by_id(UUID);
DROP FUNCTION IF EXISTS api.get_organization_unit_descendants(UUID);
DROP FUNCTION IF EXISTS api.create_organization_unit(UUID, TEXT, TEXT, TEXT);
DROP FUNCTION IF EXISTS api.update_organization_unit(UUID, TEXT, TEXT, TEXT, BOOLEAN);
DROP FUNCTION IF EXISTS api.deactivate_organization_unit(UUID);

-- ============================================================================
-- 1. GET ORGANIZATION UNITS
-- ============================================================================
-- Maps to: SupabaseOrganizationUnitService.getUnits()
-- Returns all organizational units within user's scope_path hierarchy
-- Includes root organization and all descendants

CREATE OR REPLACE FUNCTION api.get_organization_units(
  p_status TEXT DEFAULT 'all',           -- 'active', 'inactive', 'all'
  p_search_term TEXT DEFAULT NULL        -- Search by name or display_name
)
RETURNS TABLE (
  id UUID,
  name TEXT,
  display_name TEXT,
  path TEXT,
  parent_path TEXT,
  parent_id UUID,
  timezone TEXT,
  is_active BOOLEAN,
  child_count BIGINT,
  is_root_organization BOOLEAN,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ
)
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
LANGUAGE plpgsql
AS $$
DECLARE
  v_scope_path LTREE;
BEGIN
  -- Get user's scope_path from JWT claims
  v_scope_path := get_current_scope_path();

  IF v_scope_path IS NULL THEN
    RAISE EXCEPTION 'No scope_path in JWT claims - user not associated with organization'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  RETURN QUERY
  WITH unit_children AS (
    -- Pre-calculate child counts for performance
    SELECT
      o.parent_path AS pp,
      COUNT(*) AS cnt
    FROM organizations_projection o
    WHERE o.deleted_at IS NULL
      AND v_scope_path @> o.path  -- User's scope contains this path
    GROUP BY o.parent_path
  )
  SELECT
    o.id,
    o.name,
    o.display_name,
    o.path::TEXT,
    o.parent_path::TEXT,
    -- Get parent_id by finding org with matching path
    (SELECT p.id FROM organizations_projection p WHERE p.path = o.parent_path LIMIT 1) AS parent_id,
    o.timezone,
    o.is_active,
    COALESCE(uc.cnt, 0) AS child_count,
    -- Root organization: depth = 2 (e.g., 'root.provider')
    (nlevel(o.path) = 2) AS is_root_organization,
    o.created_at,
    o.updated_at
  FROM organizations_projection o
  LEFT JOIN unit_children uc ON uc.pp = o.path
  WHERE
    -- Must be within user's scope hierarchy
    v_scope_path @> o.path
    -- Not deleted
    AND o.deleted_at IS NULL
    -- Status filter
    AND (
      p_status = 'all'
      OR (p_status = 'active' AND o.is_active = true)
      OR (p_status = 'inactive' AND o.is_active = false)
    )
    -- Search filter
    AND (
      p_search_term IS NULL
      OR o.name ILIKE '%' || p_search_term || '%'
      OR o.display_name ILIKE '%' || p_search_term || '%'
    )
  ORDER BY o.path ASC;  -- Tree order
END;
$$;

GRANT EXECUTE ON FUNCTION api.get_organization_units TO authenticated, service_role;

COMMENT ON FUNCTION api.get_organization_units IS
'Frontend RPC: Get organizational units within user scope. Returns tree-ordered list with parent_id and child_count.';


-- ============================================================================
-- 2. GET ORGANIZATION UNIT BY ID
-- ============================================================================
-- Maps to: SupabaseOrganizationUnitService.getUnitById()

CREATE OR REPLACE FUNCTION api.get_organization_unit_by_id(p_unit_id UUID)
RETURNS TABLE (
  id UUID,
  name TEXT,
  display_name TEXT,
  path TEXT,
  parent_path TEXT,
  parent_id UUID,
  timezone TEXT,
  is_active BOOLEAN,
  child_count BIGINT,
  is_root_organization BOOLEAN,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ
)
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
LANGUAGE plpgsql
AS $$
DECLARE
  v_scope_path LTREE;
BEGIN
  v_scope_path := get_current_scope_path();

  IF v_scope_path IS NULL THEN
    RAISE EXCEPTION 'No scope_path in JWT claims'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  RETURN QUERY
  SELECT
    o.id,
    o.name,
    o.display_name,
    o.path::TEXT,
    o.parent_path::TEXT,
    (SELECT p.id FROM organizations_projection p WHERE p.path = o.parent_path LIMIT 1) AS parent_id,
    o.timezone,
    o.is_active,
    (SELECT COUNT(*) FROM organizations_projection c WHERE c.parent_path = o.path AND c.deleted_at IS NULL) AS child_count,
    (nlevel(o.path) = 2) AS is_root_organization,
    o.created_at,
    o.updated_at
  FROM organizations_projection o
  WHERE o.id = p_unit_id
    AND o.deleted_at IS NULL
    AND v_scope_path @> o.path  -- Must be within user's scope
  LIMIT 1;
END;
$$;

GRANT EXECUTE ON FUNCTION api.get_organization_unit_by_id TO authenticated, service_role;

COMMENT ON FUNCTION api.get_organization_unit_by_id IS
'Frontend RPC: Get single organizational unit by ID. Returns NULL if not found or outside user scope.';


-- ============================================================================
-- 3. GET ORGANIZATION UNIT DESCENDANTS
-- ============================================================================
-- Maps to: SupabaseOrganizationUnitService.getDescendants()
-- Returns all descendants (children, grandchildren, etc.) of a given unit

CREATE OR REPLACE FUNCTION api.get_organization_unit_descendants(p_unit_id UUID)
RETURNS TABLE (
  id UUID,
  name TEXT,
  display_name TEXT,
  path TEXT,
  parent_path TEXT,
  parent_id UUID,
  timezone TEXT,
  is_active BOOLEAN,
  child_count BIGINT,
  is_root_organization BOOLEAN,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ
)
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
LANGUAGE plpgsql
AS $$
DECLARE
  v_scope_path LTREE;
  v_unit_path LTREE;
BEGIN
  v_scope_path := get_current_scope_path();

  IF v_scope_path IS NULL THEN
    RAISE EXCEPTION 'No scope_path in JWT claims'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- Get the unit's path
  SELECT o.path INTO v_unit_path
  FROM organizations_projection o
  WHERE o.id = p_unit_id
    AND o.deleted_at IS NULL
    AND v_scope_path @> o.path;

  -- If unit not found or not in scope, return empty
  IF v_unit_path IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    o.id,
    o.name,
    o.display_name,
    o.path::TEXT,
    o.parent_path::TEXT,
    (SELECT p.id FROM organizations_projection p WHERE p.path = o.parent_path LIMIT 1) AS parent_id,
    o.timezone,
    o.is_active,
    (SELECT COUNT(*) FROM organizations_projection c WHERE c.parent_path = o.path AND c.deleted_at IS NULL) AS child_count,
    (nlevel(o.path) = 2) AS is_root_organization,
    o.created_at,
    o.updated_at
  FROM organizations_projection o
  WHERE v_unit_path @> o.path  -- Descendants of the unit
    AND o.path != v_unit_path  -- Exclude the unit itself
    AND o.deleted_at IS NULL
    AND v_scope_path @> o.path  -- Must also be within user's scope
  ORDER BY o.path ASC;
END;
$$;

GRANT EXECUTE ON FUNCTION api.get_organization_unit_descendants TO authenticated, service_role;

COMMENT ON FUNCTION api.get_organization_unit_descendants IS
'Frontend RPC: Get all descendants of an organizational unit.';


-- ============================================================================
-- 4. CREATE ORGANIZATION UNIT
-- ============================================================================
-- Maps to: SupabaseOrganizationUnitService.createUnit()
-- Creates a new sub-organization under the specified parent
-- Emits organization.created domain event

CREATE OR REPLACE FUNCTION api.create_organization_unit(
  p_parent_id UUID DEFAULT NULL,         -- NULL = direct child of user's root org
  p_name TEXT DEFAULT NULL,
  p_display_name TEXT DEFAULT NULL,
  p_timezone TEXT DEFAULT NULL
)
RETURNS JSONB
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
LANGUAGE plpgsql
AS $$
DECLARE
  v_scope_path LTREE;
  v_parent_path LTREE;
  v_parent_timezone TEXT;
  v_parent_type TEXT;
  v_new_path LTREE;
  v_new_id UUID;
  v_slug TEXT;
  v_event_id UUID;
  v_stream_version INTEGER;
BEGIN
  -- Validate required fields
  IF p_name IS NULL OR trim(p_name) = '' THEN
    RAISE EXCEPTION 'Name is required'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  -- Get user's scope_path from JWT claims
  v_scope_path := get_current_scope_path();

  IF v_scope_path IS NULL THEN
    RAISE EXCEPTION 'No scope_path in JWT claims'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- Determine parent path
  IF p_parent_id IS NULL THEN
    -- Use user's root org as parent
    v_parent_path := v_scope_path;

    -- Get root org details
    SELECT o.timezone, o.type INTO v_parent_timezone, v_parent_type
    FROM organizations_projection o
    WHERE o.path = v_scope_path AND o.deleted_at IS NULL;
  ELSE
    -- Get specified parent's details
    SELECT o.path, o.timezone, o.type INTO v_parent_path, v_parent_timezone, v_parent_type
    FROM organizations_projection o
    WHERE o.id = p_parent_id
      AND o.deleted_at IS NULL
      AND v_scope_path @> o.path;  -- Parent must be within user's scope

    IF v_parent_path IS NULL THEN
      RETURN jsonb_build_object(
        'success', false,
        'error', 'Parent organization not found or not accessible',
        'errorDetails', jsonb_build_object(
          'code', 'NOT_FOUND',
          'message', 'Parent organization not found or outside your scope'
        )
      );
    END IF;
  END IF;

  -- Generate slug from name (lowercase, replace spaces with underscores)
  v_slug := lower(regexp_replace(trim(p_name), '[^a-zA-Z0-9]+', '_', 'g'));
  v_slug := regexp_replace(v_slug, '^_+|_+$', '', 'g');  -- Trim leading/trailing underscores

  -- Generate new path
  v_new_path := v_parent_path || v_slug::LTREE;

  -- Check for duplicate path
  IF EXISTS (
    SELECT 1 FROM organizations_projection
    WHERE path = v_new_path AND deleted_at IS NULL
  ) THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'An organizational unit with this name already exists under the same parent',
      'errorDetails', jsonb_build_object(
        'code', 'DUPLICATE_NAME',
        'message', format('Unit "%s" already exists under this parent', p_name)
      )
    );
  END IF;

  -- Generate new ID
  v_new_id := gen_random_uuid();
  v_event_id := gen_random_uuid();

  -- Get next stream version
  SELECT COALESCE(MAX(stream_version), 0) + 1 INTO v_stream_version
  FROM domain_events
  WHERE stream_id = v_new_id AND stream_type = 'organization';

  -- Insert into organizations_projection
  INSERT INTO organizations_projection (
    id,
    name,
    display_name,
    slug,
    type,
    path,
    parent_path,
    timezone,
    is_active,
    created_at,
    updated_at
  ) VALUES (
    v_new_id,
    trim(p_name),
    COALESCE(nullif(trim(p_display_name), ''), trim(p_name)),
    v_slug,
    v_parent_type,  -- Inherit type from parent
    v_new_path,
    v_parent_path,
    COALESCE(p_timezone, v_parent_timezone, 'America/New_York'),
    true,
    now(),
    now()
  );

  -- Emit domain event
  INSERT INTO domain_events (
    id,
    stream_id,
    stream_type,
    stream_version,
    event_type,
    event_data,
    event_metadata
  ) VALUES (
    v_event_id,
    v_new_id,
    'organization',
    v_stream_version,
    'organization.created',
    jsonb_build_object(
      'organization_id', v_new_id,
      'name', trim(p_name),
      'display_name', COALESCE(nullif(trim(p_display_name), ''), trim(p_name)),
      'slug', v_slug,
      'type', v_parent_type,
      'path', v_new_path::TEXT,
      'parent_path', v_parent_path::TEXT,
      'timezone', COALESCE(p_timezone, v_parent_timezone, 'America/New_York'),
      'is_sub_organization', true
    ),
    jsonb_build_object(
      'source', 'api.create_organization_unit',
      'user_id', get_current_user_id(),
      'timestamp', now()
    )
  );

  -- Return success with created unit
  RETURN jsonb_build_object(
    'success', true,
    'unit', jsonb_build_object(
      'id', v_new_id,
      'name', trim(p_name),
      'displayName', COALESCE(nullif(trim(p_display_name), ''), trim(p_name)),
      'path', v_new_path::TEXT,
      'parentPath', v_parent_path::TEXT,
      'parentId', p_parent_id,
      'timeZone', COALESCE(p_timezone, v_parent_timezone, 'America/New_York'),
      'isActive', true,
      'childCount', 0,
      'isRootOrganization', false,
      'createdAt', now(),
      'updatedAt', now()
    )
  );
END;
$$;

GRANT EXECUTE ON FUNCTION api.create_organization_unit TO authenticated, service_role;

COMMENT ON FUNCTION api.create_organization_unit IS
'Frontend RPC: Create new organizational unit. Emits organization.created event.';


-- ============================================================================
-- 5. UPDATE ORGANIZATION UNIT
-- ============================================================================
-- Maps to: SupabaseOrganizationUnitService.updateUnit()
-- Updates an existing organizational unit
-- Emits organization.updated domain event

CREATE OR REPLACE FUNCTION api.update_organization_unit(
  p_unit_id UUID,
  p_name TEXT DEFAULT NULL,
  p_display_name TEXT DEFAULT NULL,
  p_timezone TEXT DEFAULT NULL,
  p_is_active BOOLEAN DEFAULT NULL
)
RETURNS JSONB
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
LANGUAGE plpgsql
AS $$
DECLARE
  v_scope_path LTREE;
  v_existing RECORD;
  v_event_id UUID;
  v_stream_version INTEGER;
  v_updated_fields TEXT[];
  v_previous_values JSONB;
BEGIN
  -- Get user's scope_path
  v_scope_path := get_current_scope_path();

  IF v_scope_path IS NULL THEN
    RAISE EXCEPTION 'No scope_path in JWT claims'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- Get existing unit
  SELECT * INTO v_existing
  FROM organizations_projection o
  WHERE o.id = p_unit_id
    AND o.deleted_at IS NULL
    AND v_scope_path @> o.path;

  IF v_existing IS NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Organizational unit not found',
      'errorDetails', jsonb_build_object(
        'code', 'NOT_FOUND',
        'message', 'Unit not found or outside your scope'
      )
    );
  END IF;

  -- Check if trying to update root organization
  IF nlevel(v_existing.path) = 2 THEN
    -- Only allow name/display_name/timezone updates for root org, not deactivation
    IF p_is_active IS NOT NULL AND p_is_active = false THEN
      RETURN jsonb_build_object(
        'success', false,
        'error', 'Cannot deactivate root organization',
        'errorDetails', jsonb_build_object(
          'code', 'IS_ROOT_ORGANIZATION',
          'message', 'Root organizations cannot be deactivated via this interface'
        )
      );
    END IF;
  END IF;

  -- Track what's being updated
  v_updated_fields := ARRAY[]::TEXT[];
  v_previous_values := '{}'::JSONB;

  IF p_name IS NOT NULL AND p_name != v_existing.name THEN
    v_updated_fields := v_updated_fields || 'name';
    v_previous_values := v_previous_values || jsonb_build_object('name', v_existing.name);
  END IF;

  IF p_display_name IS NOT NULL AND p_display_name != v_existing.display_name THEN
    v_updated_fields := v_updated_fields || 'display_name';
    v_previous_values := v_previous_values || jsonb_build_object('display_name', v_existing.display_name);
  END IF;

  IF p_timezone IS NOT NULL AND p_timezone != v_existing.timezone THEN
    v_updated_fields := v_updated_fields || 'timezone';
    v_previous_values := v_previous_values || jsonb_build_object('timezone', v_existing.timezone);
  END IF;

  IF p_is_active IS NOT NULL AND p_is_active != v_existing.is_active THEN
    v_updated_fields := v_updated_fields || 'is_active';
    v_previous_values := v_previous_values || jsonb_build_object('is_active', v_existing.is_active);
  END IF;

  -- If nothing changed, return success with existing data
  IF array_length(v_updated_fields, 1) IS NULL THEN
    RETURN jsonb_build_object(
      'success', true,
      'unit', jsonb_build_object(
        'id', v_existing.id,
        'name', v_existing.name,
        'displayName', v_existing.display_name,
        'path', v_existing.path::TEXT,
        'parentPath', v_existing.parent_path::TEXT,
        'timeZone', v_existing.timezone,
        'isActive', v_existing.is_active,
        'isRootOrganization', (nlevel(v_existing.path) = 2),
        'createdAt', v_existing.created_at,
        'updatedAt', v_existing.updated_at
      )
    );
  END IF;

  -- Perform update
  UPDATE organizations_projection
  SET
    name = COALESCE(p_name, name),
    display_name = COALESCE(p_display_name, display_name),
    timezone = COALESCE(p_timezone, timezone),
    is_active = COALESCE(p_is_active, is_active),
    deactivated_at = CASE
      WHEN p_is_active = false AND is_active = true THEN now()
      WHEN p_is_active = true THEN NULL
      ELSE deactivated_at
    END,
    updated_at = now()
  WHERE id = p_unit_id;

  -- Emit domain event
  v_event_id := gen_random_uuid();

  SELECT COALESCE(MAX(stream_version), 0) + 1 INTO v_stream_version
  FROM domain_events
  WHERE stream_id = p_unit_id AND stream_type = 'organization';

  INSERT INTO domain_events (
    id,
    stream_id,
    stream_type,
    stream_version,
    event_type,
    event_data,
    event_metadata
  ) VALUES (
    v_event_id,
    p_unit_id,
    'organization',
    v_stream_version,
    'organization.updated',
    jsonb_build_object(
      'organization_id', p_unit_id,
      'name', COALESCE(p_name, v_existing.name),
      'display_name', COALESCE(p_display_name, v_existing.display_name),
      'timezone', COALESCE(p_timezone, v_existing.timezone),
      'is_active', COALESCE(p_is_active, v_existing.is_active),
      'updated_fields', v_updated_fields,
      'previous_values', v_previous_values
    ),
    jsonb_build_object(
      'source', 'api.update_organization_unit',
      'user_id', get_current_user_id(),
      'timestamp', now()
    )
  );

  -- Return success
  RETURN jsonb_build_object(
    'success', true,
    'unit', jsonb_build_object(
      'id', p_unit_id,
      'name', COALESCE(p_name, v_existing.name),
      'displayName', COALESCE(p_display_name, v_existing.display_name),
      'path', v_existing.path::TEXT,
      'parentPath', v_existing.parent_path::TEXT,
      'timeZone', COALESCE(p_timezone, v_existing.timezone),
      'isActive', COALESCE(p_is_active, v_existing.is_active),
      'isRootOrganization', (nlevel(v_existing.path) = 2),
      'createdAt', v_existing.created_at,
      'updatedAt', now()
    )
  );
END;
$$;

GRANT EXECUTE ON FUNCTION api.update_organization_unit TO authenticated, service_role;

COMMENT ON FUNCTION api.update_organization_unit IS
'Frontend RPC: Update organizational unit. Emits organization.updated event.';


-- ============================================================================
-- 6. DEACTIVATE ORGANIZATION UNIT
-- ============================================================================
-- Maps to: SupabaseOrganizationUnitService.deactivateUnit()
-- Soft deletes an organizational unit (sets deleted_at, is_active=false)
-- Validates no children or roles exist (Option A - Simple Blocking)
-- Emits organization.deactivated domain event

CREATE OR REPLACE FUNCTION api.deactivate_organization_unit(p_unit_id UUID)
RETURNS JSONB
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
LANGUAGE plpgsql
AS $$
DECLARE
  v_scope_path LTREE;
  v_existing RECORD;
  v_child_count INTEGER;
  v_role_count INTEGER;
  v_event_id UUID;
  v_stream_version INTEGER;
BEGIN
  -- Get user's scope_path
  v_scope_path := get_current_scope_path();

  IF v_scope_path IS NULL THEN
    RAISE EXCEPTION 'No scope_path in JWT claims'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- Get existing unit
  SELECT * INTO v_existing
  FROM organizations_projection o
  WHERE o.id = p_unit_id
    AND o.deleted_at IS NULL
    AND v_scope_path @> o.path;

  IF v_existing IS NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Organizational unit not found',
      'errorDetails', jsonb_build_object(
        'code', 'NOT_FOUND',
        'message', 'Unit not found or outside your scope'
      )
    );
  END IF;

  -- Check if root organization
  IF nlevel(v_existing.path) = 2 THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Cannot deactivate root organization',
      'errorDetails', jsonb_build_object(
        'code', 'IS_ROOT_ORGANIZATION',
        'message', 'Root organizations cannot be deactivated. Contact platform support.'
      )
    );
  END IF;

  -- Check for active children (Option A - Simple Blocking)
  SELECT COUNT(*) INTO v_child_count
  FROM organizations_projection
  WHERE parent_path = v_existing.path
    AND deleted_at IS NULL;

  IF v_child_count > 0 THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', format('Cannot deactivate: %s child unit(s) exist', v_child_count),
      'errorDetails', jsonb_build_object(
        'code', 'HAS_CHILDREN',
        'count', v_child_count,
        'message', format('This unit has %s child unit(s). Deactivate or move them first.', v_child_count)
      )
    );
  END IF;

  -- Check for roles scoped to this unit
  SELECT COUNT(*) INTO v_role_count
  FROM roles_projection r
  WHERE r.org_hierarchy_scope @> v_existing.path
    AND r.org_hierarchy_scope <@ v_existing.path
    AND r.deleted_at IS NULL;

  IF v_role_count > 0 THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', format('Cannot deactivate: %s role(s) are scoped to this unit', v_role_count),
      'errorDetails', jsonb_build_object(
        'code', 'HAS_ROLES',
        'count', v_role_count,
        'message', format('This unit has %s role(s) assigned. Reassign them first.', v_role_count)
      )
    );
  END IF;

  -- Perform soft delete
  UPDATE organizations_projection
  SET
    is_active = false,
    deactivated_at = now(),
    deactivation_reason = 'User deactivated via UI',
    deleted_at = now(),
    deletion_reason = 'User deactivated via UI',
    updated_at = now()
  WHERE id = p_unit_id;

  -- Emit domain event
  v_event_id := gen_random_uuid();

  SELECT COALESCE(MAX(stream_version), 0) + 1 INTO v_stream_version
  FROM domain_events
  WHERE stream_id = p_unit_id AND stream_type = 'organization';

  INSERT INTO domain_events (
    id,
    stream_id,
    stream_type,
    stream_version,
    event_type,
    event_data,
    event_metadata
  ) VALUES (
    v_event_id,
    p_unit_id,
    'organization',
    v_stream_version,
    'organization.deactivated',
    jsonb_build_object(
      'organization_id', p_unit_id,
      'name', v_existing.name,
      'path', v_existing.path::TEXT,
      'reason', 'User deactivated via UI',
      'deactivated_by', get_current_user_id()
    ),
    jsonb_build_object(
      'source', 'api.deactivate_organization_unit',
      'user_id', get_current_user_id(),
      'timestamp', now()
    )
  );

  -- Return success
  RETURN jsonb_build_object(
    'success', true,
    'unit', jsonb_build_object(
      'id', p_unit_id,
      'name', v_existing.name,
      'displayName', v_existing.display_name,
      'path', v_existing.path::TEXT,
      'parentPath', v_existing.parent_path::TEXT,
      'timeZone', v_existing.timezone,
      'isActive', false,
      'isRootOrganization', false,
      'createdAt', v_existing.created_at,
      'updatedAt', now()
    )
  );
END;
$$;

GRANT EXECUTE ON FUNCTION api.deactivate_organization_unit TO authenticated, service_role;

COMMENT ON FUNCTION api.deactivate_organization_unit IS
'Frontend RPC: Deactivate organizational unit (soft delete). Validates no children or roles exist.';


-- ============================================================================
-- Documentation
-- ============================================================================

COMMENT ON FUNCTION api.get_organization_units IS 'Frontend RPC: Get all organizational units within user scope. Supports status and search filters.';
COMMENT ON FUNCTION api.get_organization_unit_by_id IS 'Frontend RPC: Get single organizational unit by UUID.';
COMMENT ON FUNCTION api.get_organization_unit_descendants IS 'Frontend RPC: Get all descendants of an organizational unit.';
COMMENT ON FUNCTION api.create_organization_unit IS 'Frontend RPC: Create sub-organization. Emits organization.created event.';
COMMENT ON FUNCTION api.update_organization_unit IS 'Frontend RPC: Update organizational unit. Emits organization.updated event.';
COMMENT ON FUNCTION api.deactivate_organization_unit IS 'Frontend RPC: Soft delete organizational unit. Emits organization.deactivated event.';
