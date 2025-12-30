-- Fix: Remove deleted_at check on user_roles_projection
-- The user_roles_projection table uses hard-delete (row removal), not soft-delete.
-- See documentation/infrastructure/reference/database/tables/user_roles_projection.md line 811:
-- "Revoked roles removed from projection (not soft deleted)"

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
  -- Note: user_roles_projection uses hard-delete (no deleted_at column)
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

COMMENT ON FUNCTION "api"."delete_organization_unit"("p_unit_id" "uuid") IS 'Frontend RPC: Soft delete organizational unit. Emits organization_unit.deleted event (CQRS).';
