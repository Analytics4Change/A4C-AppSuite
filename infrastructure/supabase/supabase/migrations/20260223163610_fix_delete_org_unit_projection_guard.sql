-- =============================================================================
-- Fix: Organization unit delete silent failure — projection read-back guard
-- =============================================================================
-- Root cause: api.delete_organization_unit() emitted the domain event and
-- returned {success: true, deletedUnit: {...}} using the pre-event snapshot,
-- without reading back from the projection. If the handler failed (exception
-- caught by process_domain_event(), recorded in processing_error), the RPC
-- still returned success — a silent failure.
--
-- Also fixes response key: 'deletedUnit' → 'unit' for consistency with all
-- other org unit RPCs. Adds 'deletedAt' to the response object.
--
-- This is the 5th of 5 org unit RPCs. The other 4 were fixed in migration
-- 20260221173821_fix_org_unit_create_and_projection_guards.sql.
--
-- Fixes:
--   A. Add v_result/v_processing_error DECLARE variables
--   B. Add projection read-back guard after INSERT INTO domain_events
--   C. Change response key from 'deletedUnit' to 'unit', add 'deletedAt'
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
  v_result RECORD;
  v_processing_error TEXT;
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

  -- Read back from projection (updated by BEFORE INSERT trigger handler)
  SELECT * INTO v_result
  FROM organization_units_projection
  WHERE id = p_unit_id
    AND deleted_at IS NOT NULL;

  -- Guard: check projection was actually updated (handler may have failed)
  IF NOT FOUND THEN
    SELECT processing_error INTO v_processing_error
    FROM domain_events
    WHERE stream_id = p_unit_id
      AND event_type = 'organization_unit.deleted'
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
      'deletedAt', v_result.deleted_at,
      'createdAt', v_result.created_at,
      'updatedAt', v_result.updated_at
    )
  );
END;
$$;
