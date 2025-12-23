-- Organization Unit Event Processing Functions
-- Handles all organization unit lifecycle events (sub-organizations, depth > 2)
-- Source events: organization_unit.* events in domain_events table
--
-- NOTE: Organization units are sub-organizations within a provider hierarchy.
-- They are stored in organization_units_projection (separate from organizations_projection)
-- to optimize queries for different actor types:
--   - Platform owners query organizations_projection (root orgs, depth = 2)
--   - Providers query organization_units_projection (their internal hierarchy, depth > 2)

-- Main organization unit event processor
CREATE OR REPLACE FUNCTION process_organization_unit_event(
  p_event RECORD
) RETURNS VOID AS $$
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
    -- Deactivation cascades to children via RPC validation (not direct DB update)
    WHEN 'organization_unit.deactivated' THEN
      UPDATE organization_units_projection
      SET
        is_active = false,
        deactivated_at = p_event.created_at,
        updated_at = p_event.created_at
      WHERE id = p_event.stream_id;

      IF NOT FOUND THEN
        RAISE WARNING 'Organization unit % not found for deactivation event', p_event.stream_id;
      END IF;

      -- Note: Cascade effect is enforced at RPC level by checking for inactive ancestors
      -- This event processor only updates the deactivated OU itself
      -- Descendants remain "is_active = true" but role assignments are blocked via validation

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
$$ LANGUAGE plpgsql
SET search_path = public, extensions, pg_temp;

-- Helper function to check if an organization unit has inactive ancestors
-- Used by safety-net trigger and RPC validation
CREATE OR REPLACE FUNCTION has_inactive_ou_ancestor(
  p_path LTREE
) RETURNS BOOLEAN AS $$
DECLARE
  v_has_inactive BOOLEAN;
BEGIN
  -- Check if any ancestor OU (depth > 2) is inactive
  SELECT EXISTS (
    SELECT 1
    FROM organization_units_projection
    WHERE p_path <@ path
      AND path != p_path  -- Exclude self
      AND is_active = false
      AND deleted_at IS NULL
  ) INTO v_has_inactive;

  RETURN v_has_inactive;
END;
$$ LANGUAGE plpgsql STABLE
SET search_path = public, extensions, pg_temp;

-- Helper function to get organization unit by path
CREATE OR REPLACE FUNCTION get_organization_unit_by_path(
  p_path LTREE
) RETURNS organization_units_projection AS $$
DECLARE
  v_result organization_units_projection;
BEGIN
  SELECT * INTO v_result
  FROM organization_units_projection
  WHERE path = p_path
    AND deleted_at IS NULL;

  RETURN v_result;
END;
$$ LANGUAGE plpgsql STABLE
SET search_path = public, extensions, pg_temp;

-- Function to get all descendant organization units
CREATE OR REPLACE FUNCTION get_organization_unit_descendants(
  p_ou_path LTREE
) RETURNS TABLE (
  id UUID,
  name TEXT,
  path LTREE,
  depth INTEGER,
  is_active BOOLEAN
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    ou.id, ou.name, ou.path, ou.depth, ou.is_active
  FROM organization_units_projection ou
  WHERE ou.path <@ p_ou_path
    AND ou.deleted_at IS NULL
  ORDER BY ou.path;
END;
$$ LANGUAGE plpgsql STABLE
SET search_path = public, extensions, pg_temp;

-- Function to get organization unit ancestors (returns both orgs and OUs in path)
CREATE OR REPLACE FUNCTION get_organization_unit_ancestors(
  p_ou_path LTREE
) RETURNS TABLE (
  id UUID,
  name TEXT,
  path LTREE,
  depth INTEGER,
  is_active BOOLEAN,
  entity_type TEXT
) AS $$
BEGIN
  -- Return root organization (depth = 2)
  RETURN QUERY
  SELECT
    o.id, o.name, o.path, o.depth, o.is_active, 'organization'::TEXT as entity_type
  FROM organizations_projection o
  WHERE p_ou_path <@ o.path
    AND o.deleted_at IS NULL
  UNION ALL
  -- Return parent organization units (depth > 2)
  SELECT
    ou.id, ou.name, ou.path, ou.depth, ou.is_active, 'organization_unit'::TEXT as entity_type
  FROM organization_units_projection ou
  WHERE p_ou_path <@ ou.path
    AND ou.path != p_ou_path  -- Exclude self
    AND ou.deleted_at IS NULL
  ORDER BY depth;
END;
$$ LANGUAGE plpgsql STABLE
SET search_path = public, extensions, pg_temp;

-- Comments for documentation
COMMENT ON FUNCTION process_organization_unit_event IS
  'Main organization unit event processor - handles creation, updates, deactivation, reactivation, deletion with idempotent operations';
COMMENT ON FUNCTION has_inactive_ou_ancestor IS
  'Checks if any ancestor organization unit is inactive (for role assignment validation)';
COMMENT ON FUNCTION get_organization_unit_by_path IS
  'Retrieves an organization unit by its ltree path';
COMMENT ON FUNCTION get_organization_unit_descendants IS
  'Returns all active descendant organization units for a given OU path';
COMMENT ON FUNCTION get_organization_unit_ancestors IS
  'Returns all ancestor organizations and OUs for a given OU path, including entity type';
