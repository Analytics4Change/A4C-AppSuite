-- =============================================================================
-- Migration: Fix deprecated get_current_scope_path() in API functions
-- Purpose: Replace deprecated scope_path JWT claim with get_permission_scope()
-- Part of: Multi-Role Authorization - Bug Fix for claims_version 4
-- =============================================================================
--
-- CONTEXT:
-- In claims_version 4 (Phase 5B), the `scope_path` JWT claim was removed in
-- favor of the new `effective_permissions` array. However, 8 API functions
-- in the baseline still called `get_current_scope_path()` which now returns
-- NULL, breaking the organization units functionality.
--
-- FIX:
-- Replace `get_current_scope_path()` with `get_permission_scope('permission')`
-- which reads from the effective_permissions array and returns the user's
-- scope for that specific permission.
--
-- FUNCTIONS FIXED:
-- 1. api.create_organization_unit      - organization.create_ou
-- 2. api.deactivate_organization_unit  - organization.update_ou
-- 3. api.delete_organization_unit      - organization.delete_ou
-- 4. api.get_organization_unit_by_id   - organization.view_ou
-- 5. api.get_organization_unit_descendants - organization.view_ou
-- 6. api.get_organization_units        - organization.view_ou
-- 7. api.reactivate_organization_unit  - organization.update_ou
-- 8. api.update_organization_unit      - organization.update_ou
-- =============================================================================

-- =============================================================================
-- 1. api.create_organization_unit - uses organization.create_ou
-- =============================================================================
CREATE OR REPLACE FUNCTION "api"."create_organization_unit"(
  "p_parent_id" "uuid" DEFAULT NULL::"uuid",
  "p_name" "text" DEFAULT NULL::"text",
  "p_display_name" "text" DEFAULT NULL::"text",
  "p_timezone" "text" DEFAULT NULL::"text"
) RETURNS "jsonb"
LANGUAGE "plpgsql" SECURITY DEFINER
SET "search_path" TO 'public', 'extensions', 'pg_temp'
AS $_$
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

  -- Get user's scope_path from effective_permissions (claims v4)
  -- Uses get_permission_scope() instead of deprecated get_current_scope_path()
  v_scope_path := get_permission_scope('organization.create_ou');

  IF v_scope_path IS NULL THEN
    RAISE EXCEPTION 'Missing permission: organization.create_ou'
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
  v_stream_version := 1;

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
      'organization_unit_id', v_new_id,
      'name', trim(p_name),
      'display_name', COALESCE(trim(p_display_name), trim(p_name)),
      'path', v_new_path::TEXT,
      'parent_path', v_parent_path::TEXT,
      'timezone', COALESCE(p_timezone, v_parent_timezone, 'America/Denver'),
      'root_organization_id', v_root_org_id,
      'is_active', true
    ),
    jsonb_build_object(
      'user_id', get_current_user_id(),
      'source', 'api.create_organization_unit',
      'timestamp', now()
    )
  );

  -- Wait for event processor trigger to update projection
  -- Then read back the created row
  SELECT * INTO v_result
  FROM organization_units_projection
  WHERE id = v_new_id;

  RETURN jsonb_build_object(
    'success', true,
    'unit', jsonb_build_object(
      'id', v_result.id,
      'name', v_result.name,
      'displayName', v_result.display_name,
      'path', v_result.path::TEXT,
      'parentPath', v_result.parent_path::TEXT,
      'timeZone', v_result.timezone,
      'isActive', v_result.is_active,
      'isRootOrganization', false,
      'createdAt', v_result.created_at,
      'updatedAt', v_result.updated_at
    )
  );
END;
$_$;

COMMENT ON FUNCTION "api"."create_organization_unit"("p_parent_id" "uuid", "p_name" "text", "p_display_name" "text", "p_timezone" "text") IS
'Create a new organization unit (CQRS via domain events).
Uses get_permission_scope(organization.create_ou) for authorization (claims v4).';


-- =============================================================================
-- 2. api.deactivate_organization_unit - uses organization.update_ou
-- =============================================================================
CREATE OR REPLACE FUNCTION "api"."deactivate_organization_unit"("p_unit_id" "uuid") RETURNS "jsonb"
LANGUAGE "plpgsql" SECURITY DEFINER
SET "search_path" TO 'public', 'extensions', 'pg_temp'
AS $$
DECLARE
  v_scope_path LTREE;
  v_existing RECORD;
  v_event_id UUID;
  v_stream_version INTEGER;
  v_result RECORD;
  v_affected_descendants JSONB;
  v_descendant_count INTEGER;
BEGIN
  -- Get user's scope_path from effective_permissions (claims v4)
  v_scope_path := get_permission_scope('organization.update_ou');

  IF v_scope_path IS NULL THEN
    RAISE EXCEPTION 'Missing permission: organization.update_ou'
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

  -- Collect all active descendants that will be affected by cascade deactivation
  SELECT
    COALESCE(jsonb_agg(jsonb_build_object(
      'id', ou.id,
      'path', ou.path::TEXT,
      'name', ou.name
    )), '[]'::jsonb),
    COUNT(*)::INTEGER
  INTO v_affected_descendants, v_descendant_count
  FROM organization_units_projection ou
  WHERE ou.path <@ v_existing.path    -- Descendants of this OU (ltree containment)
    AND ou.id != p_unit_id            -- Exclude self
    AND ou.is_active = true           -- Only currently active ones
    AND ou.deleted_at IS NULL;

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
      'affected_descendants', v_affected_descendants,
      'descendant_count', v_descendant_count
    ),
    jsonb_build_object(
      'user_id', get_current_user_id(),
      'source', 'api.deactivate_organization_unit',
      'timestamp', now()
    )
  );

  -- Read back the updated row (after event processor trigger)
  SELECT * INTO v_result
  FROM organization_units_projection
  WHERE id = p_unit_id;

  RETURN jsonb_build_object(
    'success', true,
    'unit', jsonb_build_object(
      'id', v_result.id,
      'name', v_result.name,
      'displayName', v_result.display_name,
      'path', v_result.path::TEXT,
      'parentPath', v_result.parent_path::TEXT,
      'timeZone', v_result.timezone,
      'isActive', v_result.is_active,
      'isRootOrganization', false,
      'createdAt', v_result.created_at,
      'updatedAt', v_result.updated_at
    ),
    'cascadedDeactivations', v_descendant_count
  );
END;
$$;

COMMENT ON FUNCTION "api"."deactivate_organization_unit"("p_unit_id" "uuid") IS
'Deactivate an organization unit with cascade to descendants (CQRS via domain events).
Uses get_permission_scope(organization.update_ou) for authorization (claims v4).';


-- =============================================================================
-- 3. api.delete_organization_unit - uses organization.delete_ou
-- =============================================================================
CREATE OR REPLACE FUNCTION "api"."delete_organization_unit"("p_unit_id" "uuid") RETURNS "jsonb"
LANGUAGE "plpgsql" SECURITY DEFINER
SET "search_path" TO 'public', 'extensions', 'pg_temp'
AS $$
DECLARE
  v_scope_path LTREE;
  v_existing RECORD;
  v_child_count INTEGER;
  v_role_count INTEGER;
  v_event_id UUID;
  v_stream_version INTEGER;
BEGIN
  -- Get user's scope_path from effective_permissions (claims v4)
  v_scope_path := get_permission_scope('organization.delete_ou');

  IF v_scope_path IS NULL THEN
    RAISE EXCEPTION 'Missing permission: organization.delete_ou'
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
    AND ur.scope_path <@ v_existing.path;

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
      'user_id', get_current_user_id(),
      'source', 'api.delete_organization_unit',
      'timestamp', now()
    )
  );

  RETURN jsonb_build_object(
    'success', true,
    'deletedUnit', jsonb_build_object(
      'id', v_existing.id,
      'name', v_existing.name,
      'path', v_existing.path::TEXT
    )
  );
END;
$$;

COMMENT ON FUNCTION "api"."delete_organization_unit"("p_unit_id" "uuid") IS
'Soft-delete an organization unit (CQRS via domain events).
Uses get_permission_scope(organization.delete_ou) for authorization (claims v4).';


-- =============================================================================
-- 4. api.get_organization_unit_by_id - uses organization.view_ou
-- =============================================================================
CREATE OR REPLACE FUNCTION "api"."get_organization_unit_by_id"("p_unit_id" "uuid")
RETURNS TABLE(
  "id" "uuid",
  "name" "text",
  "display_name" "text",
  "path" "text",
  "parent_path" "text",
  "parent_id" "uuid",
  "timezone" "text",
  "is_active" boolean,
  "child_count" bigint,
  "is_root_organization" boolean,
  "created_at" timestamp with time zone,
  "updated_at" timestamp with time zone
)
LANGUAGE "plpgsql"
SET "search_path" TO 'public', 'extensions', 'pg_temp'
AS $$
DECLARE
  v_scope_path LTREE;
BEGIN
  -- Get user's scope_path from effective_permissions (claims v4)
  v_scope_path := get_permission_scope('organization.view_ou');

  IF v_scope_path IS NULL THEN
    RAISE EXCEPTION 'Missing permission: organization.view_ou'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- Try root organization first (depth = 1)
  RETURN QUERY
  SELECT
    o.id,
    o.name,
    o.display_name,
    o.path::TEXT,
    o.parent_path::TEXT,
    NULL::UUID AS parent_id,
    o.timezone,
    o.is_active,
    (SELECT COUNT(*) FROM organization_units_projection c WHERE c.parent_path = o.path AND c.deleted_at IS NULL) AS child_count,
    true AS is_root_organization,
    o.created_at,
    o.updated_at
  FROM organizations_projection o
  WHERE o.id = p_unit_id
    AND nlevel(o.path) = 1
    AND o.deleted_at IS NULL
    AND v_scope_path @> o.path
  LIMIT 1;

  IF FOUND THEN
    RETURN;
  END IF;

  -- Try sub-organization (depth > 1)
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

COMMENT ON FUNCTION "api"."get_organization_unit_by_id"("p_unit_id" "uuid") IS
'Get a single organization unit by ID.
Uses get_permission_scope(organization.view_ou) for authorization (claims v4).';


-- =============================================================================
-- 5. api.get_organization_unit_descendants - uses organization.view_ou
-- =============================================================================
CREATE OR REPLACE FUNCTION "api"."get_organization_unit_descendants"("p_unit_id" "uuid")
RETURNS TABLE(
  "id" "uuid",
  "name" "text",
  "display_name" "text",
  "path" "text",
  "parent_path" "text",
  "parent_id" "uuid",
  "timezone" "text",
  "is_active" boolean,
  "child_count" bigint,
  "is_root_organization" boolean,
  "created_at" timestamp with time zone,
  "updated_at" timestamp with time zone
)
LANGUAGE "plpgsql"
SET "search_path" TO 'public', 'extensions', 'pg_temp'
AS $$
DECLARE
  v_scope_path LTREE;
  v_unit_path LTREE;
BEGIN
  -- Get user's scope_path from effective_permissions (claims v4)
  v_scope_path := get_permission_scope('organization.view_ou');

  IF v_scope_path IS NULL THEN
    RAISE EXCEPTION 'Missing permission: organization.view_ou'
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

COMMENT ON FUNCTION "api"."get_organization_unit_descendants"("p_unit_id" "uuid") IS
'Get all descendants of an organizational unit.
Uses get_permission_scope(organization.view_ou) for authorization (claims v4).';


-- =============================================================================
-- 6. api.get_organization_units - uses organization.view_ou
-- =============================================================================
CREATE OR REPLACE FUNCTION "api"."get_organization_units"(
  "p_status" "text" DEFAULT 'all'::"text",
  "p_search_term" "text" DEFAULT NULL::"text"
)
RETURNS TABLE(
  "id" "uuid",
  "name" "text",
  "display_name" "text",
  "path" "text",
  "parent_path" "text",
  "parent_id" "uuid",
  "timezone" "text",
  "is_active" boolean,
  "child_count" bigint,
  "is_root_organization" boolean,
  "created_at" timestamp with time zone,
  "updated_at" timestamp with time zone
)
LANGUAGE "plpgsql"
SET "search_path" TO 'public', 'extensions', 'pg_temp'
AS $$
DECLARE
  v_scope_path LTREE;
BEGIN
  -- Get user's scope_path from effective_permissions (claims v4)
  v_scope_path := get_permission_scope('organization.view_ou');

  IF v_scope_path IS NULL THEN
    RAISE EXCEPTION 'Missing permission: organization.view_ou - user not associated with organization'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  RETURN QUERY
  WITH all_units AS (
    -- Root organizations (depth = 1)
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
    WHERE nlevel(o.path) = 1
      AND v_scope_path @> o.path
      AND o.deleted_at IS NULL
    UNION ALL
    -- Sub-organizations (depth > 1)
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
    SELECT
      parent_path,
      COUNT(*) as cnt
    FROM organization_units_projection
    WHERE deleted_at IS NULL
    GROUP BY parent_path
  )
  SELECT
    u.id,
    u.name,
    u.display_name,
    u.path::TEXT,
    u.parent_path::TEXT,
    (
      SELECT COALESCE(
        (SELECT p.id FROM organization_units_projection p WHERE p.path = u.parent_path LIMIT 1),
        (SELECT o.id FROM organizations_projection o WHERE o.path = u.parent_path LIMIT 1)
      )
    ) AS parent_id,
    u.timezone,
    u.is_active,
    COALESCE(uc.cnt, 0) AS child_count,
    u.is_root_org AS is_root_organization,
    u.created_at,
    u.updated_at
  FROM all_units u
  LEFT JOIN unit_children uc ON uc.parent_path = u.path
  WHERE (
    p_status = 'all'
    OR (p_status = 'active' AND u.is_active = true)
    OR (p_status = 'inactive' AND u.is_active = false)
  )
  AND (
    p_search_term IS NULL
    OR u.name ILIKE '%' || p_search_term || '%'
    OR u.display_name ILIKE '%' || p_search_term || '%'
  )
  ORDER BY u.path ASC;
END;
$$;

COMMENT ON FUNCTION "api"."get_organization_units"("p_status" "text", "p_search_term" "text") IS
'List all organization units within user scope.
Uses get_permission_scope(organization.view_ou) for authorization (claims v4).';


-- =============================================================================
-- 7. api.reactivate_organization_unit - uses organization.update_ou
-- =============================================================================
CREATE OR REPLACE FUNCTION "api"."reactivate_organization_unit"("p_unit_id" "uuid") RETURNS "jsonb"
LANGUAGE "plpgsql" SECURITY DEFINER
SET "search_path" TO 'public', 'extensions', 'pg_temp'
AS $$
DECLARE
  v_scope_path LTREE;
  v_existing RECORD;
  v_event_id UUID;
  v_stream_version INTEGER;
  v_result RECORD;
  v_inactive_ancestor_path LTREE;
  v_affected_descendants JSONB;
  v_descendant_count INTEGER;
BEGIN
  -- Get user's scope_path from effective_permissions (claims v4)
  v_scope_path := get_permission_scope('organization.update_ou');

  IF v_scope_path IS NULL THEN
    RAISE EXCEPTION 'Missing permission: organization.update_ou'
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

  -- Collect all inactive descendants that will be affected by cascade reactivation
  SELECT
    COALESCE(jsonb_agg(jsonb_build_object(
      'id', ou.id,
      'path', ou.path::TEXT,
      'name', ou.name
    )), '[]'::jsonb),
    COUNT(*)::INTEGER
  INTO v_affected_descendants, v_descendant_count
  FROM organization_units_projection ou
  WHERE ou.path <@ v_existing.path    -- Descendants of this OU (ltree containment)
    AND ou.id != p_unit_id            -- Exclude self
    AND ou.is_active = false          -- Only currently inactive ones
    AND ou.deleted_at IS NULL;

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
      'path', v_existing.path::TEXT,
      'affected_descendants', v_affected_descendants,
      'descendant_count', v_descendant_count
    ),
    jsonb_build_object(
      'user_id', get_current_user_id(),
      'source', 'api.reactivate_organization_unit',
      'timestamp', now()
    )
  );

  -- Read back the updated row (after event processor trigger)
  SELECT * INTO v_result
  FROM organization_units_projection
  WHERE id = p_unit_id;

  RETURN jsonb_build_object(
    'success', true,
    'unit', jsonb_build_object(
      'id', v_result.id,
      'name', v_result.name,
      'displayName', v_result.display_name,
      'path', v_result.path::TEXT,
      'parentPath', v_result.parent_path::TEXT,
      'timeZone', v_result.timezone,
      'isActive', v_result.is_active,
      'isRootOrganization', false,
      'createdAt', v_result.created_at,
      'updatedAt', v_result.updated_at
    ),
    'cascadedReactivations', v_descendant_count
  );
END;
$$;

COMMENT ON FUNCTION "api"."reactivate_organization_unit"("p_unit_id" "uuid") IS
'Reactivate an organization unit with cascade to descendants (CQRS via domain events).
Uses get_permission_scope(organization.update_ou) for authorization (claims v4).';


-- =============================================================================
-- 8. api.update_organization_unit - uses organization.update_ou
-- =============================================================================
CREATE OR REPLACE FUNCTION "api"."update_organization_unit"(
  "p_unit_id" "uuid",
  "p_name" "text" DEFAULT NULL::"text",
  "p_display_name" "text" DEFAULT NULL::"text",
  "p_timezone" "text" DEFAULT NULL::"text"
) RETURNS "jsonb"
LANGUAGE "plpgsql" SECURITY DEFINER
SET "search_path" TO 'public', 'extensions', 'pg_temp'
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
  -- Get user's scope_path from effective_permissions (claims v4)
  v_scope_path := get_permission_scope('organization.update_ou');

  IF v_scope_path IS NULL THEN
    RAISE EXCEPTION 'Missing permission: organization.update_ou'
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

  -- Use array_append() instead of || operator to avoid "malformed array literal" error
  IF p_name IS NOT NULL AND p_name != v_existing.name THEN
    v_updated_fields := array_append(v_updated_fields, 'name');
    v_previous_values := v_previous_values || jsonb_build_object('name', v_existing.name);
  END IF;

  IF p_display_name IS NOT NULL AND p_display_name != v_existing.display_name THEN
    v_updated_fields := array_append(v_updated_fields, 'display_name');
    v_previous_values := v_previous_values || jsonb_build_object('display_name', v_existing.display_name);
  END IF;

  IF p_timezone IS NOT NULL AND p_timezone != v_existing.timezone THEN
    v_updated_fields := array_append(v_updated_fields, 'timezone');
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

  -- CQRS Pattern: Emit organization_unit.updated event
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
      'updatable_fields', to_jsonb(v_updated_fields),
      'previous_values', v_previous_values
    ),
    jsonb_build_object(
      'user_id', get_current_user_id(),
      'source', 'api.update_organization_unit',
      'timestamp', now()
    )
  );

  -- Read back the updated row (after event processor trigger)
  SELECT * INTO v_result
  FROM organization_units_projection
  WHERE id = p_unit_id;

  RETURN jsonb_build_object(
    'success', true,
    'unit', jsonb_build_object(
      'id', v_result.id,
      'name', v_result.name,
      'displayName', v_result.display_name,
      'path', v_result.path::TEXT,
      'parentPath', v_result.parent_path::TEXT,
      'timeZone', v_result.timezone,
      'isActive', v_result.is_active,
      'isRootOrganization', false,
      'createdAt', v_result.created_at,
      'updatedAt', v_result.updated_at
    )
  );
END;
$$;

COMMENT ON FUNCTION "api"."update_organization_unit"("p_unit_id" "uuid", "p_name" "text", "p_display_name" "text", "p_timezone" "text") IS
'Update an organization unit (CQRS via domain events).
Uses get_permission_scope(organization.update_ou) for authorization (claims v4).';


-- =============================================================================
-- Documentation
-- =============================================================================
COMMENT ON SCHEMA api IS
'API functions for frontend RPC calls.

Migration 20260203170442: Fixed 8 functions that were using deprecated
get_current_scope_path() (returns NULL in claims v4) by replacing with
get_permission_scope(permission) which reads from effective_permissions array.

Fixed functions:
- api.create_organization_unit (organization.create_ou)
- api.deactivate_organization_unit (organization.update_ou)
- api.delete_organization_unit (organization.delete_ou)
- api.get_organization_unit_by_id (organization.view_ou)
- api.get_organization_unit_descendants (organization.view_ou)
- api.get_organization_units (organization.view_ou)
- api.reactivate_organization_unit (organization.update_ou)
- api.update_organization_unit (organization.update_ou)';
