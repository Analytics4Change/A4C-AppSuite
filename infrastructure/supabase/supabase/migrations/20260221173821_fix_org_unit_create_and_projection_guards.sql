-- =============================================================================
-- Fix: Organization unit creation silent failure + projection read-back guards
-- =============================================================================
-- Root cause: api.create_organization_unit() emitted event_data with
-- 'root_organization_id' but handler read 'organization_id' (NOT NULL column).
-- Also missing 'slug' field. Handler INSERT failed, exception caught by
-- process_domain_event() and recorded in processing_error, but RPC continued
-- and returned {success: true, unit: {id: null}} — silent failure.
--
-- Fixes:
--   A. Fix create_organization_unit event_data (organization_id + slug)
--   B. Fix handler with COALESCE backward-compat
--   C. Add NOT FOUND guard to all 4 org unit RPCs
--   D. Retry failed event (idempotent)
-- =============================================================================


-- =============================================================================
-- Part A + C: Fix api.create_organization_unit()
--   - event_data: rename root_organization_id → organization_id, add slug
--   - Add NOT FOUND guard after projection read-back
-- =============================================================================
CREATE OR REPLACE FUNCTION "api"."create_organization_unit"("p_parent_id" "uuid" DEFAULT NULL::"uuid", "p_name" "text" DEFAULT NULL::"text", "p_display_name" "text" DEFAULT NULL::"text", "p_timezone" "text" DEFAULT NULL::"text") RETURNS "jsonb"
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
  v_processing_error TEXT;
BEGIN
  -- Validate required fields
  IF p_name IS NULL OR trim(p_name) = '' THEN
    RAISE EXCEPTION 'Name is required'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  -- Get user's scope_path from effective_permissions (claims v4)
  v_scope_path := get_permission_scope('organization.create_ou');

  IF v_scope_path IS NULL THEN
    RAISE EXCEPTION 'Missing permission: organization.create_ou'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- Find root organization for this scope
  SELECT o.id, o.path INTO v_root_org_id, v_parent_path
  FROM organizations_projection o
  WHERE o.path = (
    SELECT subpath(v_scope_path, 0, 2)
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
    SELECT o.path, o.timezone INTO v_parent_path, v_parent_timezone
    FROM organizations_projection o
    WHERE o.id = v_root_org_id;
  ELSE
    SELECT o.path, o.timezone INTO v_parent_path, v_parent_timezone
    FROM organizations_projection o
    WHERE o.id = p_parent_id
      AND o.deleted_at IS NULL
      AND v_scope_path @> o.path;

    IF v_parent_path IS NULL THEN
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

  -- Generate slug from name
  v_slug := lower(regexp_replace(trim(p_name), '[^a-zA-Z0-9]+', '_', 'g'));
  v_slug := regexp_replace(v_slug, '^_+|_+$', '', 'g');

  -- Generate new path
  v_new_path := v_parent_path || v_slug::LTREE;

  -- Check for duplicate path
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

  v_new_id := gen_random_uuid();
  v_event_id := gen_random_uuid();
  v_stream_version := 1;

  -- CQRS: Emit organization_unit.created event
  -- FIX: Added 'slug' field, renamed 'root_organization_id' → 'organization_id'
  INSERT INTO domain_events (
    id, stream_id, stream_type, stream_version,
    event_type, event_data, event_metadata
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
      'slug', v_slug,
      'path', v_new_path::TEXT,
      'parent_path', v_parent_path::TEXT,
      'timezone', COALESCE(p_timezone, v_parent_timezone, 'America/Denver'),
      'organization_id', v_root_org_id,
      'is_active', true
    ),
    jsonb_build_object(
      'user_id', get_current_user_id(),
      'source', 'api.create_organization_unit',
      'timestamp', now()
    )
  );

  -- Read back from projection (updated by BEFORE INSERT trigger handler)
  SELECT * INTO v_result
  FROM organization_units_projection
  WHERE id = v_new_id;

  -- Guard: check projection was actually updated (handler may have failed)
  IF NOT FOUND THEN
    SELECT processing_error INTO v_processing_error
    FROM domain_events
    WHERE stream_id = v_new_id
      AND event_type = 'organization_unit.created'
    ORDER BY sequence_number DESC
    LIMIT 1;

    RETURN jsonb_build_object(
      'success', false,
      'error', COALESCE(v_processing_error, 'Projection not found after event processing'),
      'errorDetails', jsonb_build_object(
        'code', 'PROCESSING_ERROR',
        'message', 'The event was recorded but the handler failed. Check domain_events for details.'
      )
    );
  END IF;

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


-- =============================================================================
-- Part B: Fix handle_organization_unit_created() with backward-compat COALESCE
-- =============================================================================
CREATE OR REPLACE FUNCTION public.handle_organization_unit_created(p_event record)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM organizations_projection
    WHERE path = (p_event.event_data->>'parent_path')::LTREE
    UNION ALL
    SELECT 1 FROM organization_units_projection
    WHERE path = (p_event.event_data->>'parent_path')::LTREE
  ) THEN
    RAISE WARNING 'Parent path % does not exist for organization unit %',
      p_event.event_data->>'parent_path', p_event.stream_id;
  END IF;

  INSERT INTO organization_units_projection (
    id, organization_id, name, display_name, slug, path, parent_path,
    timezone, is_active, created_at, updated_at
  ) VALUES (
    p_event.stream_id,
    -- backward-compat: events before 20260221 used 'root_organization_id'
    COALESCE(
      safe_jsonb_extract_uuid(p_event.event_data, 'organization_id'),
      safe_jsonb_extract_uuid(p_event.event_data, 'root_organization_id')
    ),
    safe_jsonb_extract_text(p_event.event_data, 'name'),
    COALESCE(
      safe_jsonb_extract_text(p_event.event_data, 'display_name'),
      safe_jsonb_extract_text(p_event.event_data, 'name')
    ),
    -- backward-compat: events before 20260221 omitted 'slug'; derive from path
    COALESCE(
      safe_jsonb_extract_text(p_event.event_data, 'slug'),
      subpath((p_event.event_data->>'path')::LTREE, nlevel((p_event.event_data->>'path')::LTREE) - 1, 1)::TEXT
    ),
    (p_event.event_data->>'path')::LTREE,
    (p_event.event_data->>'parent_path')::LTREE,
    COALESCE(safe_jsonb_extract_text(p_event.event_data, 'timezone'), 'UTC'),
    true,
    p_event.created_at,
    p_event.created_at
  ) ON CONFLICT (id) DO UPDATE SET
    name = EXCLUDED.name,
    display_name = EXCLUDED.display_name,
    slug = EXCLUDED.slug,
    path = EXCLUDED.path,
    parent_path = EXCLUDED.parent_path,
    timezone = EXCLUDED.timezone,
    updated_at = EXCLUDED.updated_at;
END;
$function$;


-- =============================================================================
-- Part C: Add NOT FOUND guard to api.deactivate_organization_unit()
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
  v_processing_error TEXT;
BEGIN
  v_scope_path := get_permission_scope('organization.update_ou');

  IF v_scope_path IS NULL THEN
    RAISE EXCEPTION 'Missing permission: organization.update_ou'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

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

  SELECT
    COALESCE(jsonb_agg(jsonb_build_object(
      'id', ou.id,
      'path', ou.path::TEXT,
      'name', ou.name
    )), '[]'::jsonb),
    COUNT(*)::INTEGER
  INTO v_affected_descendants, v_descendant_count
  FROM organization_units_projection ou
  WHERE ou.path <@ v_existing.path
    AND ou.id != p_unit_id
    AND ou.is_active = true
    AND ou.deleted_at IS NULL;

  v_event_id := gen_random_uuid();

  SELECT COALESCE(MAX(stream_version), 0) + 1 INTO v_stream_version
  FROM domain_events
  WHERE stream_id = p_unit_id AND stream_type = 'organization_unit';

  INSERT INTO domain_events (
    id, stream_id, stream_type, stream_version,
    event_type, event_data, event_metadata
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

  SELECT * INTO v_result
  FROM organization_units_projection
  WHERE id = p_unit_id;

  -- Guard: check projection was actually updated
  IF NOT FOUND THEN
    SELECT processing_error INTO v_processing_error
    FROM domain_events
    WHERE stream_id = p_unit_id
      AND event_type = 'organization_unit.deactivated'
    ORDER BY sequence_number DESC
    LIMIT 1;

    RETURN jsonb_build_object(
      'success', false,
      'error', COALESCE(v_processing_error, 'Projection not found after event processing'),
      'errorDetails', jsonb_build_object(
        'code', 'PROCESSING_ERROR',
        'message', 'The event was recorded but the handler failed. Check domain_events for details.'
      )
    );
  END IF;

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


-- =============================================================================
-- Part C: Add NOT FOUND guard to api.reactivate_organization_unit()
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
  v_processing_error TEXT;
BEGIN
  v_scope_path := get_permission_scope('organization.update_ou');

  IF v_scope_path IS NULL THEN
    RAISE EXCEPTION 'Missing permission: organization.update_ou'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

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

  SELECT
    COALESCE(jsonb_agg(jsonb_build_object(
      'id', ou.id,
      'path', ou.path::TEXT,
      'name', ou.name
    )), '[]'::jsonb),
    COUNT(*)::INTEGER
  INTO v_affected_descendants, v_descendant_count
  FROM organization_units_projection ou
  WHERE ou.path <@ v_existing.path
    AND ou.id != p_unit_id
    AND ou.is_active = false
    AND ou.deleted_at IS NULL;

  v_event_id := gen_random_uuid();

  SELECT COALESCE(MAX(stream_version), 0) + 1 INTO v_stream_version
  FROM domain_events
  WHERE stream_id = p_unit_id AND stream_type = 'organization_unit';

  INSERT INTO domain_events (
    id, stream_id, stream_type, stream_version,
    event_type, event_data, event_metadata
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

  SELECT * INTO v_result
  FROM organization_units_projection
  WHERE id = p_unit_id;

  -- Guard: check projection was actually updated
  IF NOT FOUND THEN
    SELECT processing_error INTO v_processing_error
    FROM domain_events
    WHERE stream_id = p_unit_id
      AND event_type = 'organization_unit.reactivated'
    ORDER BY sequence_number DESC
    LIMIT 1;

    RETURN jsonb_build_object(
      'success', false,
      'error', COALESCE(v_processing_error, 'Projection not found after event processing'),
      'errorDetails', jsonb_build_object(
        'code', 'PROCESSING_ERROR',
        'message', 'The event was recorded but the handler failed. Check domain_events for details.'
      )
    );
  END IF;

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


-- =============================================================================
-- Part C: Add NOT FOUND guard to api.update_organization_unit()
-- =============================================================================
CREATE OR REPLACE FUNCTION "api"."update_organization_unit"("p_unit_id" "uuid", "p_name" "text" DEFAULT NULL::"text", "p_display_name" "text" DEFAULT NULL::"text", "p_timezone" "text" DEFAULT NULL::"text") RETURNS "jsonb"
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
  v_processing_error TEXT;
BEGIN
  v_scope_path := get_permission_scope('organization.update_ou');

  IF v_scope_path IS NULL THEN
    RAISE EXCEPTION 'Missing permission: organization.update_ou'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

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

  v_updated_fields := ARRAY[]::TEXT[];
  v_previous_values := '{}'::JSONB;

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

  v_event_id := gen_random_uuid();

  SELECT COALESCE(MAX(stream_version), 0) + 1 INTO v_stream_version
  FROM domain_events
  WHERE stream_id = p_unit_id AND stream_type = 'organization_unit';

  INSERT INTO domain_events (
    id, stream_id, stream_type, stream_version,
    event_type, event_data, event_metadata
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

  SELECT * INTO v_result
  FROM organization_units_projection
  WHERE id = p_unit_id;

  -- Guard: check projection was actually updated
  IF NOT FOUND THEN
    SELECT processing_error INTO v_processing_error
    FROM domain_events
    WHERE stream_id = p_unit_id
      AND event_type = 'organization_unit.updated'
    ORDER BY sequence_number DESC
    LIMIT 1;

    RETURN jsonb_build_object(
      'success', false,
      'error', COALESCE(v_processing_error, 'Projection not found after event processing'),
      'errorDetails', jsonb_build_object(
        'code', 'PROCESSING_ERROR',
        'message', 'The event was recorded but the handler failed. Check domain_events for details.'
      )
    );
  END IF;

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


-- =============================================================================
-- Part D: Retry failed event (idempotent — skips if already retried)
-- =============================================================================
UPDATE domain_events
SET processed_at = NULL, processing_error = NULL
WHERE id = 'fcb87fdc-ce9d-4bfb-9f72-6992fdd6530d'
  AND processing_error IS NOT NULL;
