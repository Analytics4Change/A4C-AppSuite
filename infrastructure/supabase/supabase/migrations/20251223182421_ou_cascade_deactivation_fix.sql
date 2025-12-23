-- Migration: OU Cascade Deactivation Fix
-- Date: 2025-12-23
-- Description: Fixes two issues with Organization Unit management:
--   1. "malformed array literal" error when editing OU (TEXT[] not wrapped with to_jsonb())
--   2. Cascade deactivation - when parent OU is deactivated, all children are also deactivated
--
-- Functions modified:
--   - api.update_organization_unit: Added to_jsonb() wrapper for updated_fields
--   - api.deactivate_organization_unit: Added cascade logic to collect affected descendants
--   - public.process_organization_unit_event: Added batch cascade update using ltree containment
--   - public.handle_bootstrap_workflow: Added to_jsonb() wrapper for cleanup_actions

-- ============================================================================
-- 1. api.update_organization_unit
-- ============================================================================
-- Fix: Line 2014 - 'updated_fields', to_jsonb(v_updated_fields)
-- Wraps TEXT[] array with to_jsonb() to prevent "malformed array literal" error

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
      'updated_fields', to_jsonb(v_updated_fields),  -- FIX: Wrap TEXT[] with to_jsonb()
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

COMMENT ON FUNCTION "api"."update_organization_unit"("p_unit_id" "uuid", "p_name" "text", "p_display_name" "text", "p_timezone" "text") IS 'Frontend RPC: Update organizational unit metadata. Emits organization_unit.updated event (CQRS).';

-- ============================================================================
-- 2. api.deactivate_organization_unit
-- ============================================================================
-- Fix: Added cascade deactivation logic - collects all active descendants
-- and includes them in the event data for the event processor to batch update

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

  -- FIX: Collect all active descendants that will be affected by cascade deactivation
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
      'affected_descendants', v_affected_descendants,  -- FIX: Include descendants for cascade
      'total_descendants_affected', COALESCE(v_descendant_count, 0)
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

COMMENT ON FUNCTION "api"."deactivate_organization_unit"("p_unit_id" "uuid") IS 'Frontend RPC: Freeze organizational unit. Emits organization_unit.deactivated event (CQRS).';

-- ============================================================================
-- 3. public.process_organization_unit_event
-- ============================================================================
-- Fix: organization_unit.deactivated handler now uses ltree containment (<@)
-- to batch update the parent OU AND all its descendants in a single UPDATE

CREATE OR REPLACE FUNCTION "public"."process_organization_unit_event"("p_event" "record") RETURNS "void"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public', 'extensions', 'pg_temp'
    AS $$
DECLARE
  v_organization_id UUID;
BEGIN
  CASE p_event.event_type

    -- ========================================
    -- organization_unit.created
    -- ========================================
    -- New organization unit created within a provider hierarchy
    -- Requires: name, slug, path, parent_path, organization_id
    WHEN 'organization_unit.created' THEN
      -- Validate that parent path exists (either in organizations_projection or organization_units_projection)
      IF NOT EXISTS (
        SELECT 1 FROM organizations_projection WHERE path = (p_event.event_data->>'parent_path')::LTREE
        UNION ALL
        SELECT 1 FROM organization_units_projection WHERE path = (p_event.event_data->>'parent_path')::LTREE
      ) THEN
        RAISE WARNING 'Parent path % does not exist for organization unit %',
          p_event.event_data->>'parent_path', p_event.stream_id;
        -- Continue anyway - event may be replayed after parent exists
      END IF;

      -- Insert into organization units projection with ON CONFLICT for idempotency
      INSERT INTO organization_units_projection (
        id,
        organization_id,
        name,
        display_name,
        slug,
        path,
        parent_path,
        timezone,
        is_active,
        created_at,
        updated_at
      ) VALUES (
        p_event.stream_id,
        safe_jsonb_extract_uuid(p_event.event_data, 'organization_id'),
        safe_jsonb_extract_text(p_event.event_data, 'name'),
        safe_jsonb_extract_text(p_event.event_data, 'display_name'),
        safe_jsonb_extract_text(p_event.event_data, 'slug'),
        (p_event.event_data->>'path')::LTREE,
        (p_event.event_data->>'parent_path')::LTREE,
        COALESCE(safe_jsonb_extract_text(p_event.event_data, 'timezone'), 'America/New_York'),
        true,  -- New OUs are active by default
        p_event.created_at,
        p_event.created_at
      )
      ON CONFLICT (id) DO UPDATE SET
        -- Idempotency: Update to latest values (replay-safe)
        name = EXCLUDED.name,
        display_name = EXCLUDED.display_name,
        slug = EXCLUDED.slug,
        path = EXCLUDED.path,
        parent_path = EXCLUDED.parent_path,
        timezone = EXCLUDED.timezone,
        updated_at = EXCLUDED.updated_at;

    -- ========================================
    -- organization_unit.updated
    -- ========================================
    -- Organization unit information updated (name, display_name, timezone)
    -- Note: Slug and path are immutable after creation
    WHEN 'organization_unit.updated' THEN
      UPDATE organization_units_projection
      SET
        name = COALESCE(safe_jsonb_extract_text(p_event.event_data, 'name'), name),
        display_name = COALESCE(safe_jsonb_extract_text(p_event.event_data, 'display_name'), display_name),
        timezone = COALESCE(safe_jsonb_extract_text(p_event.event_data, 'timezone'), timezone),
        updated_at = p_event.created_at
      WHERE id = p_event.stream_id;

      IF NOT FOUND THEN
        RAISE WARNING 'Organization unit % not found for update event', p_event.stream_id;
      END IF;

    -- ========================================
    -- organization_unit.deactivated
    -- ========================================
    -- Organization unit frozen - role assignments to this OU and descendants are blocked
    -- FIX: Cascade deactivation - updates parent AND all descendants using ltree path containment
    WHEN 'organization_unit.deactivated' THEN
      -- Batch update: deactivated OU + all active descendants
      UPDATE organization_units_projection
      SET
        is_active = false,
        deactivated_at = p_event.created_at,
        updated_at = p_event.created_at
      WHERE path <@ (p_event.event_data->>'path')::ltree  -- Parent + all descendants
        AND is_active = true                              -- Only currently active
        AND deleted_at IS NULL;

      IF NOT FOUND THEN
        RAISE WARNING 'Organization unit % not found for deactivation event', p_event.stream_id;
      END IF;

      -- Note: Cascade deactivation applies to all descendants via ltree containment
      -- Reactivation does NOT cascade - each child must be reactivated individually

    -- ========================================
    -- organization_unit.reactivated
    -- ========================================
    -- Organization unit unfrozen - role assignments allowed again
    WHEN 'organization_unit.reactivated' THEN
      UPDATE organization_units_projection
      SET
        is_active = true,
        deactivated_at = NULL,
        updated_at = p_event.created_at
      WHERE id = p_event.stream_id;

      IF NOT FOUND THEN
        RAISE WARNING 'Organization unit % not found for reactivation event', p_event.stream_id;
      END IF;

    -- ========================================
    -- organization_unit.deleted
    -- ========================================
    -- Organization unit soft-deleted (requires zero role references)
    -- Soft delete: sets deleted_at timestamp, OU no longer visible in queries
    WHEN 'organization_unit.deleted' THEN
      UPDATE organization_units_projection
      SET
        deleted_at = p_event.created_at,
        is_active = false,
        updated_at = p_event.created_at
      WHERE id = p_event.stream_id;

      IF NOT FOUND THEN
        RAISE WARNING 'Organization unit % not found for deletion event', p_event.stream_id;
      END IF;

    -- ========================================
    -- organization_unit.moved (Future capability)
    -- ========================================
    -- Organization unit reparented to different parent
    -- Updates path and parent_path, cascades to all descendants
    WHEN 'organization_unit.moved' THEN
      -- This is a complex operation that needs to update paths of all descendants
      -- For now, log and skip - will be implemented when feature is needed
      RAISE NOTICE 'organization_unit.moved event received for %, but move functionality not yet implemented',
        p_event.stream_id;

    ELSE
      RAISE WARNING 'Unknown organization unit event type: %', p_event.event_type;
  END CASE;

END;
$$;

COMMENT ON FUNCTION "public"."process_organization_unit_event"("p_event" "record") IS 'Main organization unit event processor - handles creation, updates, deactivation, reactivation, deletion with idempotent operations';

-- ============================================================================
-- 4. public.handle_bootstrap_workflow
-- ============================================================================
-- Fix: Line 2952 - 'cleanup_actions', to_jsonb(ARRAY['partial_resource_cleanup'])
-- Wraps TEXT[] array with to_jsonb() to prevent "malformed array literal" error

CREATE OR REPLACE FUNCTION "public"."handle_bootstrap_workflow"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public', 'extensions', 'pg_temp'
    AS $$
BEGIN
  -- Only process newly inserted events that haven't been processed yet
  IF TG_OP = 'INSERT' AND NEW.processed_at IS NULL THEN

    -- Handle organization bootstrap events
    IF NEW.stream_type = 'organization' THEN

      CASE NEW.event_type

        -- When bootstrap fails, trigger cleanup if needed
        WHEN 'organization.bootstrap.failed' THEN
          -- Check if partial cleanup is required
          IF (NEW.event_data->>'partial_cleanup_required')::BOOLEAN = TRUE THEN
            -- Emit cleanup events for any partial resources
            INSERT INTO domain_events (
              stream_id, stream_type, stream_version, event_type, event_data, event_metadata, created_at
            ) VALUES (
              NEW.stream_id,
              'organization',
              (SELECT COALESCE(MAX(stream_version), 0) + 1 FROM domain_events WHERE stream_id = NEW.stream_id),
              'organization.bootstrap.cancelled',
              jsonb_build_object(
                'bootstrap_id', NEW.event_data->>'bootstrap_id',
                'cleanup_completed', TRUE,
                'cleanup_actions', to_jsonb(ARRAY['partial_resource_cleanup']),  -- FIX: Wrap TEXT[] with to_jsonb()
                'original_failure_stage', NEW.event_data->>'failure_stage'
              ),
              jsonb_build_object(
                'user_id', NEW.event_metadata->>'user_id',
                'organization_id', NEW.event_metadata->>'organization_id',
                'reason', 'Automated cleanup after bootstrap failure',
                'automated', TRUE
              ),
              NOW()
            );
          END IF;

        ELSE
          -- Not a bootstrap event that requires trigger action
          NULL;
      END CASE;

    END IF;

  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION "public"."handle_bootstrap_workflow"() IS 'Trigger function to handle bootstrap workflow events and automated cleanup';
