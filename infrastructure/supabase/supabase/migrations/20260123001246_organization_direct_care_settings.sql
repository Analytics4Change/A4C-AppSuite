-- =============================================================================
-- Migration: Organization Direct Care Settings
-- Purpose: Add feature flags for direct care workflow routing per organization
-- Part of: Multi-Role Authorization Phase 3A
-- =============================================================================

-- =============================================================================
-- COLUMN: organizations_projection.direct_care_settings
-- =============================================================================

-- Add direct_care_settings JSONB column with default feature flags
ALTER TABLE organizations_projection
ADD COLUMN IF NOT EXISTS direct_care_settings jsonb DEFAULT '{
  "enable_staff_client_mapping": false,
  "enable_schedule_enforcement": false
}'::jsonb;

-- Documentation
COMMENT ON COLUMN organizations_projection.direct_care_settings IS
'Feature flags for direct care workflow routing:

- enable_staff_client_mapping (boolean, default: false):
  When true: Notifications go only to staff assigned to the specific client
  When false: Notifications go to all staff at the client''s org unit

- enable_schedule_enforcement (boolean, default: false):
  When true: Only staff currently on schedule receive notifications
  When false: Any staff (assigned or at OU) receive notifications

These settings control Temporal workflow routing for medication alerts and
other time-sensitive notifications. They do NOT affect RLS access policies.

Updated via api.update_organization_direct_care_settings() or organization settings UI.';

-- =============================================================================
-- FUNCTION: api.update_organization_direct_care_settings()
-- =============================================================================

-- API function to update direct care settings
CREATE OR REPLACE FUNCTION api.update_organization_direct_care_settings(
  p_org_id uuid,
  p_enable_staff_client_mapping boolean DEFAULT NULL,
  p_enable_schedule_enforcement boolean DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_current_settings jsonb;
  v_new_settings jsonb;
  v_org_path ltree;
BEGIN
  -- Validate org exists and user has permission
  SELECT path INTO v_org_path
  FROM organizations_projection
  WHERE id = p_org_id;

  IF v_org_path IS NULL THEN
    RAISE EXCEPTION 'Organization not found';
  END IF;

  -- Check permission: organization.update at org scope
  IF NOT has_effective_permission('organization.update', v_org_path) THEN
    RAISE EXCEPTION 'Insufficient permissions: organization.update required';
  END IF;

  -- Get current settings
  SELECT COALESCE(direct_care_settings, '{}'::jsonb)
  INTO v_current_settings
  FROM organizations_projection
  WHERE id = p_org_id;

  -- Build new settings, preserving values not being updated
  v_new_settings := v_current_settings;

  IF p_enable_staff_client_mapping IS NOT NULL THEN
    v_new_settings := jsonb_set(v_new_settings, '{enable_staff_client_mapping}', to_jsonb(p_enable_staff_client_mapping));
  END IF;

  IF p_enable_schedule_enforcement IS NOT NULL THEN
    v_new_settings := jsonb_set(v_new_settings, '{enable_schedule_enforcement}', to_jsonb(p_enable_schedule_enforcement));
  END IF;

  -- Update the settings
  UPDATE organizations_projection
  SET
    direct_care_settings = v_new_settings,
    updated_at = now()
  WHERE id = p_org_id;

  -- Emit domain event for audit trail
  PERFORM api.emit_domain_event(
    p_aggregate_type := 'organization',
    p_aggregate_id := p_org_id,
    p_event_type := 'organization.direct_care_settings_updated',
    p_event_data := jsonb_build_object(
      'organization_id', p_org_id,
      'settings', v_new_settings,
      'previous_settings', v_current_settings
    ),
    p_event_metadata := jsonb_build_object(
      'user_id', auth.uid()
    )
  );

  RETURN v_new_settings;
END;
$$;

-- Documentation
COMMENT ON FUNCTION api.update_organization_direct_care_settings(uuid, boolean, boolean) IS
'Update direct care feature flags for an organization.

Parameters:
- p_org_id: Organization ID to update
- p_enable_staff_client_mapping: Enable/disable client-specific staff routing (NULL = no change)
- p_enable_schedule_enforcement: Enable/disable schedule-based filtering (NULL = no change)

Returns: Updated settings JSONB object

Permission: organization.update at the org scope

Emits: organization.direct_care_settings_updated event';

-- Grant execute permission
GRANT EXECUTE ON FUNCTION api.update_organization_direct_care_settings(uuid, boolean, boolean) TO authenticated;

-- =============================================================================
-- FUNCTION: api.get_organization_direct_care_settings()
-- =============================================================================

-- API function to get direct care settings for an organization
CREATE OR REPLACE FUNCTION api.get_organization_direct_care_settings(p_org_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
  SELECT COALESCE(direct_care_settings, '{
    "enable_staff_client_mapping": false,
    "enable_schedule_enforcement": false
  }'::jsonb)
  FROM organizations_projection
  WHERE id = p_org_id;
$$;

-- Documentation
COMMENT ON FUNCTION api.get_organization_direct_care_settings(uuid) IS
'Get direct care feature flags for an organization.

Parameters:
- p_org_id: Organization ID

Returns: Settings JSONB object with:
- enable_staff_client_mapping: boolean
- enable_schedule_enforcement: boolean

Note: Returns default settings if not explicitly set.';

-- Grant execute permission
GRANT EXECUTE ON FUNCTION api.get_organization_direct_care_settings(uuid) TO authenticated;

-- =============================================================================
-- EVENT HANDLER: organization.direct_care_settings_updated
-- =============================================================================

-- Add handler for the direct care settings update event
-- This is handled inline by the RPC function (settings updated directly on projection)
-- The event is emitted for audit trail and potential external consumers

-- Note: Since this is a projection update via RPC (not via event processor),
-- we don't need a separate handler - the RPC function updates both the
-- projection and emits the event atomically.
