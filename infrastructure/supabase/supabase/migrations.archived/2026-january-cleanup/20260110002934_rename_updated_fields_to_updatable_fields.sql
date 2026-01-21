-- Migration: Rename updated_fields → updatable_fields in event data
--
-- Context: Semantic improvement - "updatable_fields" better describes
-- fields that CAN be updated vs "updated_fields" which implies already updated.
--
-- Changes:
-- 1. api.update_organization_unit: Change JSON key in event_data

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
  -- Get user's scope_path from JWT claims
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

  -- FIX: Use array_append() instead of || operator to avoid "malformed array literal" error
  -- The || operator is ambiguous: PostgreSQL tries to parse 'name' as an array literal
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
  -- The event processor trigger will update the projection table
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
      'updatable_fields', to_jsonb(v_updated_fields),  -- Renamed from updated_fields
      'previous_values', v_previous_values
    ),
    jsonb_build_object(
      'source', 'api.update_organization_unit',
      'user_id', get_current_user_id(),
      'reason', format('Updated organization unit fields: %s', array_to_string(v_updated_fields, ', ')),
      'timestamp', now()
    )
  );

  -- Query projection for result (event processor updates this via trigger)
  SELECT * INTO v_result
  FROM organization_units_projection
  WHERE id = p_unit_id;

  -- Return success with updated data
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

COMMENT ON FUNCTION "api"."update_organization_unit"("p_unit_id" "uuid", "p_name" "text", "p_display_name" "text", "p_timezone" "text")
IS 'Frontend RPC: Update organizational unit metadata. Emits organization_unit.updated event (CQRS pattern - trigger updates projection).';
