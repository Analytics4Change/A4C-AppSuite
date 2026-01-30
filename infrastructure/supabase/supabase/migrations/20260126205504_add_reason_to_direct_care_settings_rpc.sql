-- =============================================================================
-- Migration: Add p_reason parameter to update_organization_direct_care_settings
-- Purpose: Include audit reason in event_metadata per AsyncAPI EventMetadata schema
-- Part of: Multi-Role Authorization Phase 6
-- =============================================================================

-- Replace the update function with p_reason parameter added
CREATE OR REPLACE FUNCTION api.update_organization_direct_care_settings(
  p_org_id uuid,
  p_enable_staff_client_mapping boolean DEFAULT NULL,
  p_enable_schedule_enforcement boolean DEFAULT NULL,
  p_reason text DEFAULT NULL
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
  v_metadata jsonb;
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

  -- Build event metadata with optional reason
  v_metadata := jsonb_build_object('user_id', auth.uid());
  IF p_reason IS NOT NULL THEN
    v_metadata := v_metadata || jsonb_build_object('reason', p_reason);
  END IF;

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
    p_event_metadata := v_metadata
  );

  RETURN v_new_settings;
END;
$$;

-- Update documentation to reflect new parameter
COMMENT ON FUNCTION api.update_organization_direct_care_settings(uuid, boolean, boolean, text) IS
'Update direct care feature flags for an organization.

Parameters:
- p_org_id: Organization ID to update
- p_enable_staff_client_mapping: Enable/disable client-specific staff routing (NULL = no change)
- p_enable_schedule_enforcement: Enable/disable schedule-based filtering (NULL = no change)
- p_reason: Audit reason for the change (included in event metadata when provided)

Returns: Updated settings JSONB object

Permission: organization.update at the org scope

Emits: organization.direct_care_settings_updated event with reason in metadata';

-- Grant execute permission for the new signature
GRANT EXECUTE ON FUNCTION api.update_organization_direct_care_settings(uuid, boolean, boolean, text) TO authenticated;
