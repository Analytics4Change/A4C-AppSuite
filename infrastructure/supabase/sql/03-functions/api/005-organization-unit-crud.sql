-- Organization Unit CRUD RPC Functions
-- These functions provide CRUD operations for organizational units via the 'api' schema
-- since PostgREST only exposes 'api' schema, not 'public' schema.
--
-- Matches frontend service: frontend/src/services/organization/SupabaseOrganizationUnitService.ts
-- Frontend calls: .schema('api').rpc('get_organization_units', params)
--
-- Security Model:
-- - All operations scoped to user's JWT scope_path claim
-- - RLS policies provide additional enforcement
-- - Only users with organization.create_ou permission should access these functions
--
-- CQRS Pattern (CRITICAL):
-- - Mutations emit events to domain_events table
-- - Event processor trigger updates organization_units_projection
-- - NO direct INSERT/UPDATE to projections from RPC functions
--
-- Data Model:
-- - Root organizations (nlevel = 1): stored in organizations_projection
-- - Sub-organizations (nlevel > 1): stored in organization_units_projection
-- - Read functions query BOTH tables for complete hierarchy view
--
-- Contract: infrastructure/supabase/contracts/asyncapi/domains/organization-unit.yaml

-- Drop old function signatures to prevent ambiguity
DROP FUNCTION IF EXISTS api.get_organization_units(TEXT, TEXT);
DROP FUNCTION IF EXISTS api.get_organization_unit_by_id(UUID);
DROP FUNCTION IF EXISTS api.get_organization_unit_descendants(UUID);
DROP FUNCTION IF EXISTS api.create_organization_unit(UUID, TEXT, TEXT, TEXT);
DROP FUNCTION IF EXISTS api.update_organization_unit(UUID, TEXT, TEXT, TEXT, BOOLEAN);
DROP FUNCTION IF EXISTS api.deactivate_organization_unit(UUID);
DROP FUNCTION IF EXISTS api.reactivate_organization_unit(UUID);
DROP FUNCTION IF EXISTS api.delete_organization_unit(UUID);

-- ============================================================================
-- 1. GET ORGANIZATION UNITS
-- ============================================================================
-- Maps to: SupabaseOrganizationUnitService.getUnits()
-- Returns all organizational units within user's scope_path hierarchy
-- Queries BOTH organizations_projection (root) and organization_units_projection (sub-orgs)

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
SECURITY INVOKER
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
  WITH all_units AS (
    -- Root organization from organizations_projection (depth = 2)
    SELECT
      o.id,
      o.name,
      o.display_name,
      o.path,
      o.parent_path,
      o.timezone,
      o.is_active,
      true AS is_root_org,
      o.created_at,
      o.updated_at
    FROM organizations_projection o
    WHERE nlevel(o.path) = 1  -- Root orgs are depth 1 (e.g., 'poc-test3-20251222')
      AND v_scope_path @> o.path
      AND o.deleted_at IS NULL
    UNION ALL
    -- Sub-organizations from organization_units_projection (depth > 1)
    SELECT
      ou.id,
      ou.name,
      ou.display_name,
      ou.path,
      ou.parent_path,
      ou.timezone,
      ou.is_active,
      false AS is_root_org,
      ou.created_at,
      ou.updated_at
    FROM organization_units_projection ou
    WHERE v_scope_path @> ou.path
      AND ou.deleted_at IS NULL
  ),
  unit_children AS (
    -- Pre-calculate child counts for performance
    SELECT
      au.parent_path AS parent,
      COUNT(*) AS cnt
    FROM all_units au
    WHERE au.parent_path IS NOT NULL
    GROUP BY au.parent_path
  )
  SELECT
    au.id,
    au.name,
    au.display_name,
    au.path::TEXT,
    au.parent_path::TEXT,
    -- Get parent_id by finding unit with matching path
    (
      SELECT p.id FROM all_units p WHERE p.path = au.parent_path LIMIT 1
    ) AS parent_id,
    au.timezone,
    au.is_active,
    COALESCE(uc.cnt, 0) AS child_count,
    au.is_root_org AS is_root_organization,
    au.created_at,
    au.updated_at
  FROM all_units au
  LEFT JOIN unit_children uc ON uc.parent = au.path
  WHERE
    -- Status filter
    (
      p_status = 'all'
      OR (p_status = 'active' AND au.is_active = true)
      OR (p_status = 'inactive' AND au.is_active = false)
    )
    -- Search filter
    AND (
      p_search_term IS NULL
      OR au.name ILIKE '%' || p_search_term || '%'
      OR au.display_name ILIKE '%' || p_search_term || '%'
    )
  ORDER BY au.path ASC;  -- Tree order
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
SECURITY INVOKER
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

  -- Try root organization first
  RETURN QUERY
  SELECT
    o.id,
    o.name,
    o.display_name,
    o.path::TEXT,
    o.parent_path::TEXT,
    NULL::UUID AS parent_id,  -- Root has no parent
    o.timezone,
    o.is_active,
    (SELECT COUNT(*) FROM organization_units_projection c WHERE c.parent_path = o.path AND c.deleted_at IS NULL) AS child_count,
    true AS is_root_organization,
    o.created_at,
    o.updated_at
  FROM organizations_projection o
  WHERE o.id = p_unit_id
    AND nlevel(o.path) = 1  -- Root orgs are depth 1
    AND o.deleted_at IS NULL
    AND v_scope_path @> o.path
  LIMIT 1;

  IF FOUND THEN
    RETURN;
  END IF;

  -- Try sub-organization
  RETURN QUERY
  SELECT
    ou.id,
    ou.name,
    ou.display_name,
    ou.path::TEXT,
    ou.parent_path::TEXT,
    (
      SELECT COALESCE(
        (SELECT p.id FROM organization_units_projection p WHERE p.path = ou.parent_path LIMIT 1),
        (SELECT o.id FROM organizations_projection o WHERE o.path = ou.parent_path LIMIT 1)
      )
    ) AS parent_id,
    ou.timezone,
    ou.is_active,
    (SELECT COUNT(*) FROM organization_units_projection c WHERE c.parent_path = ou.path AND c.deleted_at IS NULL) AS child_count,
    false AS is_root_organization,
    ou.created_at,
    ou.updated_at
  FROM organization_units_projection ou
  WHERE ou.id = p_unit_id
    AND ou.deleted_at IS NULL
    AND v_scope_path @> ou.path
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
SECURITY INVOKER
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

  -- Get the unit's path (could be root org or sub-org)
  SELECT o.path INTO v_unit_path
  FROM organizations_projection o
  WHERE o.id = p_unit_id
    AND o.deleted_at IS NULL
    AND v_scope_path @> o.path;

  IF v_unit_path IS NULL THEN
    SELECT ou.path INTO v_unit_path
    FROM organization_units_projection ou
    WHERE ou.id = p_unit_id
      AND ou.deleted_at IS NULL
      AND v_scope_path @> ou.path;
  END IF;

  -- If unit not found or not in scope, return empty
  IF v_unit_path IS NULL THEN
    RETURN;
  END IF;

  -- Return all descendants from organization_units_projection
  RETURN QUERY
  SELECT
    ou.id,
    ou.name,
    ou.display_name,
    ou.path::TEXT,
    ou.parent_path::TEXT,
    (
      SELECT COALESCE(
        (SELECT p.id FROM organization_units_projection p WHERE p.path = ou.parent_path LIMIT 1),
        (SELECT o.id FROM organizations_projection o WHERE o.path = ou.parent_path LIMIT 1)
      )
    ) AS parent_id,
    ou.timezone,
    ou.is_active,
    (SELECT COUNT(*) FROM organization_units_projection c WHERE c.parent_path = ou.path AND c.deleted_at IS NULL) AS child_count,
    false AS is_root_organization,
    ou.created_at,
    ou.updated_at
  FROM organization_units_projection ou
  WHERE v_unit_path @> ou.path  -- Descendants of the unit
    AND ou.path != v_unit_path  -- Exclude the unit itself
    AND ou.deleted_at IS NULL
    AND v_scope_path @> ou.path  -- Must also be within user's scope
  ORDER BY ou.path ASC;
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
-- CQRS: Emits organization_unit.created event (no direct projection write)

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
  v_root_org_id UUID;
  v_new_path LTREE;
  v_new_id UUID;
  v_slug TEXT;
  v_event_id UUID;
  v_stream_version INTEGER;
  v_result RECORD;
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

  -- Find root organization for this scope
  SELECT o.id, o.path INTO v_root_org_id, v_parent_path
  FROM organizations_projection o
  WHERE o.path = (
    SELECT subpath(v_scope_path, 0, 2)  -- Get root org path (first 2 levels)
  )
  AND o.deleted_at IS NULL;

  IF v_root_org_id IS NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Root organization not found',
      'errorDetails', jsonb_build_object(
        'code', 'NOT_FOUND',
        'message', 'Could not find root organization for your scope'
      )
    );
  END IF;

  -- Determine parent path
  IF p_parent_id IS NULL THEN
    -- Use root org as parent
    SELECT o.path, o.timezone INTO v_parent_path, v_parent_timezone
    FROM organizations_projection o
    WHERE o.id = v_root_org_id;
  ELSE
    -- Get specified parent's details (could be root org or sub-org)
    SELECT o.path, o.timezone INTO v_parent_path, v_parent_timezone
    FROM organizations_projection o
    WHERE o.id = p_parent_id
      AND o.deleted_at IS NULL
      AND v_scope_path @> o.path;

    IF v_parent_path IS NULL THEN
      -- Try organization_units_projection
      SELECT ou.path, ou.timezone INTO v_parent_path, v_parent_timezone
      FROM organization_units_projection ou
      WHERE ou.id = p_parent_id
        AND ou.deleted_at IS NULL
        AND v_scope_path @> ou.path;
    END IF;

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

    -- Check if parent is inactive
    IF EXISTS (
      SELECT 1 FROM organization_units_projection
      WHERE path = v_parent_path AND is_active = false AND deleted_at IS NULL
    ) THEN
      RETURN jsonb_build_object(
        'success', false,
        'error', 'Cannot create sub-unit under inactive parent',
        'errorDetails', jsonb_build_object(
          'code', 'PARENT_INACTIVE',
          'message', 'Reactivate the parent organization unit first'
        )
      );
    END IF;
  END IF;

  -- Generate slug from name (lowercase, replace non-alphanumeric with underscore)
  v_slug := lower(regexp_replace(trim(p_name), '[^a-zA-Z0-9]+', '_', 'g'));
  v_slug := regexp_replace(v_slug, '^_+|_+$', '', 'g');  -- Trim leading/trailing underscores

  -- Generate new path
  v_new_path := v_parent_path || v_slug::LTREE;

  -- Check for duplicate path in both tables
  IF EXISTS (
    SELECT 1 FROM organizations_projection WHERE path = v_new_path AND deleted_at IS NULL
    UNION ALL
    SELECT 1 FROM organization_units_projection WHERE path = v_new_path AND deleted_at IS NULL
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

  -- Get next stream version for this new entity
  SELECT COALESCE(MAX(stream_version), 0) + 1 INTO v_stream_version
  FROM domain_events
  WHERE stream_id = v_new_id AND stream_type = 'organization_unit';

  -- CQRS: Emit organization_unit.created event (no direct projection write)
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
    'organization_unit',
    v_stream_version,
    'organization_unit.created',
    jsonb_build_object(
      'organization_id', v_root_org_id,
      'name', trim(p_name),
      'display_name', COALESCE(nullif(trim(p_display_name), ''), trim(p_name)),
      'slug', v_slug,
      'path', v_new_path::TEXT,
      'parent_path', v_parent_path::TEXT,
      'timezone', COALESCE(p_timezone, v_parent_timezone, 'America/New_York')
    ),
    jsonb_build_object(
      'source', 'api.create_organization_unit',
      'user_id', get_current_user_id(),
      'reason', format('Created sub-organization "%s" under %s', trim(p_name), v_parent_path::TEXT),
      'timestamp', now()
    )
  );

  -- Query projection for result (event processor should have populated it)
  SELECT * INTO v_result
  FROM organization_units_projection
  WHERE id = v_new_id;

  IF v_result IS NULL THEN
    -- If not found, event processing may have failed - return with data from event
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
  END IF;

  -- Return success with created unit from projection
  RETURN jsonb_build_object(
    'success', true,
    'unit', jsonb_build_object(
      'id', v_result.id,
      'name', v_result.name,
      'displayName', v_result.display_name,
      'path', v_result.path::TEXT,
      'parentPath', v_result.parent_path::TEXT,
      'parentId', p_parent_id,
      'timeZone', v_result.timezone,
      'isActive', v_result.is_active,
      'childCount', 0,
      'isRootOrganization', false,
      'createdAt', v_result.created_at,
      'updatedAt', v_result.updated_at
    )
  );
END;
$$;

GRANT EXECUTE ON FUNCTION api.create_organization_unit TO authenticated, service_role;

COMMENT ON FUNCTION api.create_organization_unit IS
'Frontend RPC: Create new organizational unit. Emits organization_unit.created event (CQRS pattern).';


-- ============================================================================
-- 5. UPDATE ORGANIZATION UNIT
-- ============================================================================
-- Maps to: SupabaseOrganizationUnitService.updateUnit()
-- Updates an existing organizational unit
-- CQRS: Emits organization_unit.updated event (no direct projection write)
-- NOTE: For is_active changes, use deactivate/reactivate functions instead

CREATE OR REPLACE FUNCTION api.update_organization_unit(
  p_unit_id UUID,
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
  v_existing RECORD;
  v_event_id UUID;
  v_stream_version INTEGER;
  v_updated_fields TEXT[];
  v_previous_values JSONB;
  v_result RECORD;
BEGIN
  -- Get user's scope_path
  v_scope_path := get_current_scope_path();

  IF v_scope_path IS NULL THEN
    RAISE EXCEPTION 'No scope_path in JWT claims'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- Get existing unit from organization_units_projection
  SELECT * INTO v_existing
  FROM organization_units_projection ou
  WHERE ou.id = p_unit_id
    AND ou.deleted_at IS NULL
    AND v_scope_path @> ou.path;

  IF v_existing IS NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Organizational unit not found',
      'errorDetails', jsonb_build_object(
        'code', 'NOT_FOUND',
        'message', 'Unit not found or outside your scope. Note: Root organizations use different update path.'
      )
    );
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
        'isRootOrganization', false,
        'createdAt', v_existing.created_at,
        'updatedAt', v_existing.updated_at
      )
    );
  END IF;

  -- CQRS: Emit organization_unit.updated event (no direct projection write)
  v_event_id := gen_random_uuid();

  SELECT COALESCE(MAX(stream_version), 0) + 1 INTO v_stream_version
  FROM domain_events
  WHERE stream_id = p_unit_id AND stream_type = 'organization_unit';

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
    'organization_unit',
    v_stream_version,
    'organization_unit.updated',
    jsonb_build_object(
      'organization_unit_id', p_unit_id,
      'name', COALESCE(p_name, v_existing.name),
      'display_name', COALESCE(p_display_name, v_existing.display_name),
      'timezone', COALESCE(p_timezone, v_existing.timezone),
      'updated_fields', v_updated_fields,
      'previous_values', v_previous_values
    ),
    jsonb_build_object(
      'source', 'api.update_organization_unit',
      'user_id', get_current_user_id(),
      'reason', format('Updated organization unit fields: %s', array_to_string(v_updated_fields, ', ')),
      'timestamp', now()
    )
  );

  -- Query projection for result
  SELECT * INTO v_result
  FROM organization_units_projection
  WHERE id = p_unit_id;

  -- Return success
  RETURN jsonb_build_object(
    'success', true,
    'unit', jsonb_build_object(
      'id', COALESCE(v_result.id, p_unit_id),
      'name', COALESCE(v_result.name, p_name, v_existing.name),
      'displayName', COALESCE(v_result.display_name, p_display_name, v_existing.display_name),
      'path', COALESCE(v_result.path::TEXT, v_existing.path::TEXT),
      'parentPath', COALESCE(v_result.parent_path::TEXT, v_existing.parent_path::TEXT),
      'timeZone', COALESCE(v_result.timezone, p_timezone, v_existing.timezone),
      'isActive', COALESCE(v_result.is_active, v_existing.is_active),
      'isRootOrganization', false,
      'createdAt', COALESCE(v_result.created_at, v_existing.created_at),
      'updatedAt', COALESCE(v_result.updated_at, now())
    )
  );
END;
$$;

GRANT EXECUTE ON FUNCTION api.update_organization_unit TO authenticated, service_role;

COMMENT ON FUNCTION api.update_organization_unit IS
'Frontend RPC: Update organizational unit metadata. Emits organization_unit.updated event (CQRS pattern).';


-- ============================================================================
-- 6. DEACTIVATE ORGANIZATION UNIT
-- ============================================================================
-- Maps to: SupabaseOrganizationUnitService.deactivateUnit()
-- Freezes an organizational unit (sets is_active=false)
-- Role assignments to this OU and descendants are blocked
-- CQRS: Emits organization_unit.deactivated event (no direct projection write)
-- NOTE: Does NOT set deleted_at - use delete_organization_unit for soft delete

CREATE OR REPLACE FUNCTION api.deactivate_organization_unit(p_unit_id UUID)
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
  v_result RECORD;
BEGIN
  -- Get user's scope_path
  v_scope_path := get_current_scope_path();

  IF v_scope_path IS NULL THEN
    RAISE EXCEPTION 'No scope_path in JWT claims'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- Get existing unit
  SELECT * INTO v_existing
  FROM organization_units_projection ou
  WHERE ou.id = p_unit_id
    AND ou.deleted_at IS NULL
    AND v_scope_path @> ou.path;

  IF v_existing IS NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Organizational unit not found',
      'errorDetails', jsonb_build_object(
        'code', 'NOT_FOUND',
        'message', 'Unit not found or outside your scope. Root organizations cannot be deactivated via this function.'
      )
    );
  END IF;

  -- Check if already deactivated
  IF v_existing.is_active = false THEN
    RETURN jsonb_build_object(
      'success', true,
      'unit', jsonb_build_object(
        'id', v_existing.id,
        'name', v_existing.name,
        'displayName', v_existing.display_name,
        'path', v_existing.path::TEXT,
        'parentPath', v_existing.parent_path::TEXT,
        'timeZone', v_existing.timezone,
        'isActive', false,
        'isRootOrganization', false,
        'createdAt', v_existing.created_at,
        'updatedAt', v_existing.updated_at
      ),
      'message', 'Organization unit is already deactivated'
    );
  END IF;

  -- CQRS: Emit organization_unit.deactivated event (no direct projection write)
  v_event_id := gen_random_uuid();

  SELECT COALESCE(MAX(stream_version), 0) + 1 INTO v_stream_version
  FROM domain_events
  WHERE stream_id = p_unit_id AND stream_type = 'organization_unit';

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
    'organization_unit',
    v_stream_version,
    'organization_unit.deactivated',
    jsonb_build_object(
      'organization_unit_id', p_unit_id,
      'path', v_existing.path::TEXT,
      'cascade_effect', 'role_assignment_blocked',
      'descendants_affected', true
    ),
    jsonb_build_object(
      'source', 'api.deactivate_organization_unit',
      'user_id', get_current_user_id(),
      'reason', format('Deactivated organization unit "%s" - role assignments to this OU and descendants blocked', v_existing.name),
      'timestamp', now()
    )
  );

  -- Query projection for result
  SELECT * INTO v_result
  FROM organization_units_projection
  WHERE id = p_unit_id;

  -- Return success
  RETURN jsonb_build_object(
    'success', true,
    'unit', jsonb_build_object(
      'id', COALESCE(v_result.id, p_unit_id),
      'name', COALESCE(v_result.name, v_existing.name),
      'displayName', COALESCE(v_result.display_name, v_existing.display_name),
      'path', COALESCE(v_result.path::TEXT, v_existing.path::TEXT),
      'parentPath', COALESCE(v_result.parent_path::TEXT, v_existing.parent_path::TEXT),
      'timeZone', COALESCE(v_result.timezone, v_existing.timezone),
      'isActive', COALESCE(v_result.is_active, false),
      'isRootOrganization', false,
      'createdAt', COALESCE(v_result.created_at, v_existing.created_at),
      'updatedAt', COALESCE(v_result.updated_at, now())
    )
  );
END;
$$;

GRANT EXECUTE ON FUNCTION api.deactivate_organization_unit TO authenticated, service_role;

COMMENT ON FUNCTION api.deactivate_organization_unit IS
'Frontend RPC: Deactivate organizational unit (freeze). Blocks role assignments to this OU and descendants. Emits organization_unit.deactivated event.';


-- ============================================================================
-- 7. REACTIVATE ORGANIZATION UNIT
-- ============================================================================
-- NEW: Unfreezes an organizational unit (sets is_active=true)
-- CQRS: Emits organization_unit.reactivated event (no direct projection write)

CREATE OR REPLACE FUNCTION api.reactivate_organization_unit(p_unit_id UUID)
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
  v_result RECORD;
  v_inactive_ancestor_path LTREE;
BEGIN
  -- Get user's scope_path
  v_scope_path := get_current_scope_path();

  IF v_scope_path IS NULL THEN
    RAISE EXCEPTION 'No scope_path in JWT claims'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- Get existing unit
  SELECT * INTO v_existing
  FROM organization_units_projection ou
  WHERE ou.id = p_unit_id
    AND ou.deleted_at IS NULL
    AND v_scope_path @> ou.path;

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

  -- Check if already active
  IF v_existing.is_active = true THEN
    RETURN jsonb_build_object(
      'success', true,
      'unit', jsonb_build_object(
        'id', v_existing.id,
        'name', v_existing.name,
        'displayName', v_existing.display_name,
        'path', v_existing.path::TEXT,
        'parentPath', v_existing.parent_path::TEXT,
        'timeZone', v_existing.timezone,
        'isActive', true,
        'isRootOrganization', false,
        'createdAt', v_existing.created_at,
        'updatedAt', v_existing.updated_at
      ),
      'message', 'Organization unit is already active'
    );
  END IF;

  -- Check for inactive ancestors (cannot reactivate if parent is inactive)
  SELECT ou.path INTO v_inactive_ancestor_path
  FROM organization_units_projection ou
  WHERE v_existing.path <@ ou.path
    AND ou.path != v_existing.path
    AND ou.is_active = false
    AND ou.deleted_at IS NULL
  ORDER BY ou.depth DESC
  LIMIT 1;

  IF v_inactive_ancestor_path IS NOT NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Cannot reactivate while parent is inactive',
      'errorDetails', jsonb_build_object(
        'code', 'PARENT_INACTIVE',
        'message', format('Reactivate ancestor %s first', v_inactive_ancestor_path::TEXT)
      )
    );
  END IF;

  -- CQRS: Emit organization_unit.reactivated event (no direct projection write)
  v_event_id := gen_random_uuid();

  SELECT COALESCE(MAX(stream_version), 0) + 1 INTO v_stream_version
  FROM domain_events
  WHERE stream_id = p_unit_id AND stream_type = 'organization_unit';

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
    'organization_unit',
    v_stream_version,
    'organization_unit.reactivated',
    jsonb_build_object(
      'organization_unit_id', p_unit_id,
      'path', v_existing.path::TEXT
    ),
    jsonb_build_object(
      'source', 'api.reactivate_organization_unit',
      'user_id', get_current_user_id(),
      'reason', format('Reactivated organization unit "%s" - role assignments now allowed', v_existing.name),
      'timestamp', now()
    )
  );

  -- Query projection for result
  SELECT * INTO v_result
  FROM organization_units_projection
  WHERE id = p_unit_id;

  -- Return success
  RETURN jsonb_build_object(
    'success', true,
    'unit', jsonb_build_object(
      'id', COALESCE(v_result.id, p_unit_id),
      'name', COALESCE(v_result.name, v_existing.name),
      'displayName', COALESCE(v_result.display_name, v_existing.display_name),
      'path', COALESCE(v_result.path::TEXT, v_existing.path::TEXT),
      'parentPath', COALESCE(v_result.parent_path::TEXT, v_existing.parent_path::TEXT),
      'timeZone', COALESCE(v_result.timezone, v_existing.timezone),
      'isActive', COALESCE(v_result.is_active, true),
      'isRootOrganization', false,
      'createdAt', COALESCE(v_result.created_at, v_existing.created_at),
      'updatedAt', COALESCE(v_result.updated_at, now())
    )
  );
END;
$$;

GRANT EXECUTE ON FUNCTION api.reactivate_organization_unit TO authenticated, service_role;

COMMENT ON FUNCTION api.reactivate_organization_unit IS
'Frontend RPC: Reactivate organizational unit (unfreeze). Allows role assignments again. Emits organization_unit.reactivated event.';


-- ============================================================================
-- 8. DELETE ORGANIZATION UNIT (Soft Delete)
-- ============================================================================
-- NEW: Soft deletes an organizational unit (sets deleted_at)
-- Validates no children or roles exist
-- CQRS: Emits organization_unit.deleted event (no direct projection write)

CREATE OR REPLACE FUNCTION api.delete_organization_unit(p_unit_id UUID)
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
  FROM organization_units_projection ou
  WHERE ou.id = p_unit_id
    AND ou.deleted_at IS NULL
    AND v_scope_path @> ou.path;

  IF v_existing IS NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Organizational unit not found',
      'errorDetails', jsonb_build_object(
        'code', 'NOT_FOUND',
        'message', 'Unit not found or outside your scope. Root organizations cannot be deleted via this function.'
      )
    );
  END IF;

  -- Check for active children
  SELECT COUNT(*) INTO v_child_count
  FROM organization_units_projection
  WHERE parent_path = v_existing.path
    AND deleted_at IS NULL;

  IF v_child_count > 0 THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', format('Cannot delete: %s child unit(s) exist', v_child_count),
      'errorDetails', jsonb_build_object(
        'code', 'HAS_CHILDREN',
        'count', v_child_count,
        'message', format('This unit has %s child unit(s). Delete or move them first.', v_child_count)
      )
    );
  END IF;

  -- Check for role assignments at or below this OU's scope
  SELECT COUNT(*) INTO v_role_count
  FROM user_roles_projection ur
  WHERE ur.scope_path IS NOT NULL
    AND ur.scope_path <@ v_existing.path
    AND ur.deleted_at IS NULL;

  IF v_role_count > 0 THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', format('Cannot delete: %s role assignment(s) reference this unit', v_role_count),
      'errorDetails', jsonb_build_object(
        'code', 'HAS_ROLES',
        'count', v_role_count,
        'message', format('This unit has %s role assignment(s). Reassign them first.', v_role_count)
      )
    );
  END IF;

  -- CQRS: Emit organization_unit.deleted event (no direct projection write)
  v_event_id := gen_random_uuid();

  SELECT COALESCE(MAX(stream_version), 0) + 1 INTO v_stream_version
  FROM domain_events
  WHERE stream_id = p_unit_id AND stream_type = 'organization_unit';

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
    'organization_unit',
    v_stream_version,
    'organization_unit.deleted',
    jsonb_build_object(
      'organization_unit_id', p_unit_id,
      'deleted_path', v_existing.path::TEXT,
      'had_role_references', false,
      'deletion_type', 'soft_delete'
    ),
    jsonb_build_object(
      'source', 'api.delete_organization_unit',
      'user_id', get_current_user_id(),
      'reason', format('Soft-deleted organization unit "%s" after verifying zero role references', v_existing.name),
      'timestamp', now()
    )
  );

  -- Return success
  RETURN jsonb_build_object(
    'success', true,
    'unit', jsonb_build_object(
      'id', v_existing.id,
      'name', v_existing.name,
      'displayName', v_existing.display_name,
      'path', v_existing.path::TEXT,
      'parentPath', v_existing.parent_path::TEXT,
      'timeZone', v_existing.timezone,
      'isActive', false,
      'isRootOrganization', false,
      'createdAt', v_existing.created_at,
      'updatedAt', now(),
      'deletedAt', now()
    )
  );
END;
$$;

GRANT EXECUTE ON FUNCTION api.delete_organization_unit TO authenticated, service_role;

COMMENT ON FUNCTION api.delete_organization_unit IS
'Frontend RPC: Soft delete organizational unit. Requires zero children and zero role references. Emits organization_unit.deleted event.';


-- ============================================================================
-- Documentation
-- ============================================================================

COMMENT ON FUNCTION api.get_organization_units IS 'Frontend RPC: Get all organizational units within user scope. Supports status and search filters.';
COMMENT ON FUNCTION api.get_organization_unit_by_id IS 'Frontend RPC: Get single organizational unit by UUID.';
COMMENT ON FUNCTION api.get_organization_unit_descendants IS 'Frontend RPC: Get all descendants of an organizational unit.';
COMMENT ON FUNCTION api.create_organization_unit IS 'Frontend RPC: Create sub-organization. Emits organization_unit.created event (CQRS).';
COMMENT ON FUNCTION api.update_organization_unit IS 'Frontend RPC: Update organizational unit metadata. Emits organization_unit.updated event (CQRS).';
COMMENT ON FUNCTION api.deactivate_organization_unit IS 'Frontend RPC: Freeze organizational unit. Emits organization_unit.deactivated event (CQRS).';
COMMENT ON FUNCTION api.reactivate_organization_unit IS 'Frontend RPC: Unfreeze organizational unit. Emits organization_unit.reactivated event (CQRS).';
COMMENT ON FUNCTION api.delete_organization_unit IS 'Frontend RPC: Soft delete organizational unit. Emits organization_unit.deleted event (CQRS).';
