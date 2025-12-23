-- Migration: OU Cascade Reactivation
-- Date: 2025-12-23
-- Description: Adds cascade reactivation to Organization Units
--   When a parent OU is reactivated, all inactive descendants are also reactivated
--   Mirrors the cascade deactivation behavior
--
-- Functions modified:
--   - api.reactivate_organization_unit: Added cascade logic to collect affected descendants
--   - public.process_organization_unit_event: Added batch cascade update using ltree containment

-- ============================================================================
-- 1. api.reactivate_organization_unit
-- ============================================================================
-- Added: Collects all inactive descendants and includes them in the event data
-- for the event processor to batch update via ltree containment

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
      'cascade_effect', 'role_assignment_allowed',
      'affected_descendants', v_affected_descendants,
      'total_descendants_affected', COALESCE(v_descendant_count, 0)
    ),
    jsonb_build_object(
      'source', 'api.reactivate_organization_unit',
      'user_id', get_current_user_id(),
      'reason', format('Reactivated organization unit "%s" and %s descendant(s) - role assignments now allowed', v_existing.name, COALESCE(v_descendant_count, 0)),
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
    ),
    'cascadeResult', jsonb_build_object(
      'descendantsReactivated', COALESCE(v_descendant_count, 0)
    )
  );
END;
$$;

COMMENT ON FUNCTION "api"."reactivate_organization_unit"("p_unit_id" "uuid") IS 'Frontend RPC: Unfreeze organizational unit and all descendants. Emits organization_unit.reactivated event with cascade (CQRS).';

-- ============================================================================
-- 2. public.process_organization_unit_event
-- ============================================================================
-- Updated: organization_unit.reactivated handler now uses ltree containment (<@)
-- to batch update the parent OU AND all its descendants in a single UPDATE
-- Mirrors the cascade deactivation behavior

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
        COALESCE(safe_jsonb_extract_text(p_event.event_data, 'display_name'), safe_jsonb_extract_text(p_event.event_data, 'name')),
        safe_jsonb_extract_text(p_event.event_data, 'slug'),
        (p_event.event_data->>'path')::LTREE,
        (p_event.event_data->>'parent_path')::LTREE,
        COALESCE(safe_jsonb_extract_text(p_event.event_data, 'timezone'), 'UTC'),
        true,
        p_event.created_at,
        p_event.created_at
      )
      ON CONFLICT (id) DO UPDATE SET
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
    -- Organization unit metadata updated (name, display_name, timezone, etc.)
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
    -- Organization unit frozen - no new role assignments allowed
    -- CASCADE: Uses ltree containment to batch update parent AND all descendants
    WHEN 'organization_unit.deactivated' THEN
      -- Cascade deactivate: Update parent OU AND all its descendants in one UPDATE
      UPDATE organization_units_projection
      SET
        is_active = false,
        deactivated_at = p_event.created_at,
        updated_at = p_event.created_at
      WHERE path <@ (p_event.event_data->>'path')::ltree  -- Parent + all descendants via ltree containment
        AND is_active = true
        AND deleted_at IS NULL;

      IF NOT FOUND THEN
        RAISE WARNING 'Organization unit % not found for deactivation event', p_event.stream_id;
      END IF;

    -- ========================================
    -- organization_unit.reactivated
    -- ========================================
    -- Organization unit unfrozen - role assignments allowed again
    -- CASCADE: Uses ltree containment to batch update parent AND all descendants
    WHEN 'organization_unit.reactivated' THEN
      -- Cascade reactivate: Update parent OU AND all its descendants in one UPDATE
      UPDATE organization_units_projection
      SET
        is_active = true,
        deactivated_at = NULL,
        updated_at = p_event.created_at
      WHERE path <@ (p_event.event_data->>'path')::ltree  -- Parent + all descendants via ltree containment
        AND is_active = false
        AND deleted_at IS NULL;

      IF NOT FOUND THEN
        RAISE WARNING 'Organization unit % not found for reactivation event', p_event.stream_id;
      END IF;

    -- ========================================
    -- organization_unit.deleted
    -- ========================================
    -- Organization unit soft-deleted (marked as deleted, not actually removed)
    WHEN 'organization_unit.deleted' THEN
      UPDATE organization_units_projection
      SET
        deleted_at = p_event.created_at,
        updated_at = p_event.created_at
      WHERE id = p_event.stream_id
        AND deleted_at IS NULL;

      IF NOT FOUND THEN
        RAISE WARNING 'Organization unit % not found or already deleted for deletion event', p_event.stream_id;
      END IF;

    ELSE
      -- Unknown event type - log warning but don't fail
      RAISE WARNING 'Unknown organization_unit event type: %', p_event.event_type;
  END CASE;
END;
$$;

COMMENT ON FUNCTION "public"."process_organization_unit_event"("p_event" "record") IS 'Event processor for organization_unit events. Cascade deactivation AND reactivation use ltree containment for batch updates.';
