-- Migration: OU Update Diagnostic Logging
-- Date: 2025-12-23
-- Description: Adds RAISE NOTICE statements to api.update_organization_unit to trace
--              the "malformed array literal" error that persists despite to_jsonb() fix.
--
-- Diagnostic approach:
--   1. Log function entry with all parameters
--   2. Log v_updated_fields state before/after each field append
--   3. Log to_jsonb() result before INSERT
--   4. Log INSERT success/failure
--
-- AsyncAPI Contract Compliance:
--   - organization_unit.updated event requires: organization_unit_id, updated_fields
--   - updated_fields is array of strings: ["name", "display_name", "timezone"]
--   - Reference: infrastructure/supabase/contracts/asyncapi/domains/organization-unit.yaml

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
  v_updated_fields_jsonb JSONB;  -- Pre-computed for logging
BEGIN
  -- DIAGNOSTIC: Log entry point
  RAISE NOTICE '[OU_UPDATE] Entry: p_unit_id=%, p_name=%, p_display_name=%, p_timezone=%',
    p_unit_id, p_name, p_display_name, p_timezone;

  -- Get user's scope_path
  v_scope_path := get_current_scope_path();

  -- DIAGNOSTIC: Log scope_path
  RAISE NOTICE '[OU_UPDATE] scope_path=%', v_scope_path;

  IF v_scope_path IS NULL THEN
    RAISE NOTICE '[OU_UPDATE] ERROR: No scope_path in JWT claims';
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
    RAISE NOTICE '[OU_UPDATE] ERROR: Unit not found for id=% with scope=%', p_unit_id, v_scope_path;
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Organizational unit not found',
      'errorDetails', jsonb_build_object(
        'code', 'NOT_FOUND',
        'message', 'Unit not found or outside your scope. Note: Root organizations use different update path.'
      )
    );
  END IF;

  -- DIAGNOSTIC: Log existing record found
  RAISE NOTICE '[OU_UPDATE] Found existing: id=%, name=%, display_name=%, timezone=%',
    v_existing.id, v_existing.name, v_existing.display_name, v_existing.timezone;

  -- Track what's being updated
  v_updated_fields := ARRAY[]::TEXT[];
  v_previous_values := '{}'::JSONB;

  -- DIAGNOSTIC: Log initial array state
  RAISE NOTICE '[OU_UPDATE] Initial v_updated_fields: %', v_updated_fields;

  IF p_name IS NOT NULL AND p_name != v_existing.name THEN
    RAISE NOTICE '[OU_UPDATE] Appending "name" to v_updated_fields (old=%, new=%)', v_existing.name, p_name;
    v_updated_fields := v_updated_fields || 'name';
    v_previous_values := v_previous_values || jsonb_build_object('name', v_existing.name);
    RAISE NOTICE '[OU_UPDATE] After name append: v_updated_fields=%', v_updated_fields;
  END IF;

  IF p_display_name IS NOT NULL AND p_display_name != v_existing.display_name THEN
    RAISE NOTICE '[OU_UPDATE] Appending "display_name" to v_updated_fields (old=%, new=%)', v_existing.display_name, p_display_name;
    v_updated_fields := v_updated_fields || 'display_name';
    v_previous_values := v_previous_values || jsonb_build_object('display_name', v_existing.display_name);
    RAISE NOTICE '[OU_UPDATE] After display_name append: v_updated_fields=%', v_updated_fields;
  END IF;

  IF p_timezone IS NOT NULL AND p_timezone != v_existing.timezone THEN
    RAISE NOTICE '[OU_UPDATE] Appending "timezone" to v_updated_fields (old=%, new=%)', v_existing.timezone, p_timezone;
    v_updated_fields := v_updated_fields || 'timezone';
    v_previous_values := v_previous_values || jsonb_build_object('timezone', v_existing.timezone);
    RAISE NOTICE '[OU_UPDATE] After timezone append: v_updated_fields=%', v_updated_fields;
  END IF;

  -- DIAGNOSTIC: Log final array state and length
  RAISE NOTICE '[OU_UPDATE] Final v_updated_fields: %, length=%', v_updated_fields, array_length(v_updated_fields, 1);

  -- If nothing changed, return success with existing data
  IF array_length(v_updated_fields, 1) IS NULL THEN
    RAISE NOTICE '[OU_UPDATE] No changes detected, returning early';
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

  -- DIAGNOSTIC: Pre-compute and log to_jsonb conversion BEFORE INSERT
  v_updated_fields_jsonb := to_jsonb(v_updated_fields);
  RAISE NOTICE '[OU_UPDATE] to_jsonb(v_updated_fields) = %', v_updated_fields_jsonb;
  RAISE NOTICE '[OU_UPDATE] v_previous_values = %', v_previous_values;
  RAISE NOTICE '[OU_UPDATE] v_event_id=%, v_stream_version=%', v_event_id, v_stream_version;

  -- DIAGNOSTIC: Log the complete event_data before INSERT
  RAISE NOTICE '[OU_UPDATE] event_data will be: %', jsonb_build_object(
    'organization_unit_id', p_unit_id,
    'name', COALESCE(p_name, v_existing.name),
    'display_name', COALESCE(p_display_name, v_existing.display_name),
    'timezone', COALESCE(p_timezone, v_existing.timezone),
    'updated_fields', v_updated_fields_jsonb,
    'previous_values', v_previous_values
  );

  -- DIAGNOSTIC: About to INSERT
  RAISE NOTICE '[OU_UPDATE] About to INSERT into domain_events...';

  BEGIN
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
        'updated_fields', v_updated_fields_jsonb,  -- Use pre-computed JSONB
        'previous_values', v_previous_values
      ),
      jsonb_build_object(
        'source', 'api.update_organization_unit',
        'user_id', get_current_user_id(),
        'reason', format('Updated organization unit fields: %s', array_to_string(v_updated_fields, ', ')),
        'timestamp', now()
      )
    );

    -- DIAGNOSTIC: INSERT succeeded
    RAISE NOTICE '[OU_UPDATE] INSERT SUCCESS: event_id=%', v_event_id;

  EXCEPTION WHEN OTHERS THEN
    -- DIAGNOSTIC: Catch and log any error during INSERT
    RAISE WARNING '[OU_UPDATE] INSERT FAILED: SQLSTATE=%, SQLERRM=%', SQLSTATE, SQLERRM;
    RAISE;  -- Re-raise the exception
  END;

  -- Query projection for result
  SELECT * INTO v_result
  FROM organization_units_projection
  WHERE id = p_unit_id;

  -- DIAGNOSTIC: Log result from projection
  RAISE NOTICE '[OU_UPDATE] Projection query result: id=%, name=%', v_result.id, v_result.name;

  -- Return success
  RAISE NOTICE '[OU_UPDATE] Returning success response';
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

COMMENT ON FUNCTION "api"."update_organization_unit"("p_unit_id" "uuid", "p_name" "text", "p_display_name" "text", "p_timezone" "text") IS 'Frontend RPC: Update organizational unit metadata. Emits organization_unit.updated event (CQRS). DIAGNOSTIC VERSION with RAISE NOTICE logging.';
