-- =============================================================================
-- Migration: Fix emit_domain_event parameter names
-- Purpose: Correct p_aggregate_type/p_aggregate_id to p_stream_type/p_stream_id
-- Issue: Functions call emit_domain_event with wrong parameter names
-- =============================================================================

-- The api.emit_domain_event function signature uses:
--   p_stream_id, p_stream_type, p_event_type, p_event_data, p_event_metadata
--
-- But these functions were calling it with:
--   p_aggregate_id, p_aggregate_type (wrong names)

-- -----------------------------------------------------------------------------
-- Fix 1: update_organization_direct_care_settings (3-param version)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION api.update_organization_direct_care_settings(
  p_org_id uuid,
  p_enable_staff_client_mapping boolean DEFAULT NULL,
  p_enable_schedule_enforcement boolean DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
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
  -- FIX: Changed p_aggregate_type -> p_stream_type, p_aggregate_id -> p_stream_id
  PERFORM api.emit_domain_event(
    p_stream_type := 'organization',
    p_stream_id := p_org_id,
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
$function$;

-- -----------------------------------------------------------------------------
-- Fix 2: update_organization_direct_care_settings (4-param version with reason)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION api.update_organization_direct_care_settings(
  p_org_id uuid,
  p_enable_staff_client_mapping boolean DEFAULT NULL,
  p_enable_schedule_enforcement boolean DEFAULT NULL,
  p_reason text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
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
  -- FIX: Changed p_aggregate_type -> p_stream_type, p_aggregate_id -> p_stream_id
  PERFORM api.emit_domain_event(
    p_stream_type := 'organization',
    p_stream_id := p_org_id,
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
$function$;

-- -----------------------------------------------------------------------------
-- Fix 3: update_user_access_dates
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION api.update_user_access_dates(
  p_user_id uuid,
  p_org_id uuid,
  p_access_start_date date,
  p_access_expiration_date date
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_old_record record;
BEGIN
  -- Authorization: Three-tier check
  IF NOT (
    -- Tier 1: Platform admin (cross-tenant access)
    public.has_platform_privilege()
    -- Tier 2: Org admin for this org
    OR public.has_org_admin_permission()
  ) THEN
    RAISE EXCEPTION 'Access denied' USING ERRCODE = '42501';
  END IF;

  -- Validate dates
  IF p_access_start_date IS NOT NULL
     AND p_access_expiration_date IS NOT NULL
     AND p_access_start_date > p_access_expiration_date THEN
    RAISE EXCEPTION 'Start date must be before expiration date' USING ERRCODE = '22023';
  END IF;

  -- Get old values for event
  SELECT access_start_date, access_expiration_date
  INTO v_old_record
  FROM public.user_organizations_projection
  WHERE user_id = p_user_id AND org_id = p_org_id;

  -- Emit domain event
  -- FIX: Changed p_aggregate_type -> p_stream_type, p_aggregate_id -> p_stream_id
  PERFORM api.emit_domain_event(
    p_stream_type := 'user',
    p_stream_id := p_user_id,
    p_event_type := 'user.access_dates_updated',
    p_event_data := jsonb_build_object(
      'user_id', p_user_id,
      'org_id', p_org_id,
      'access_start_date', p_access_start_date,
      'access_expiration_date', p_access_expiration_date,
      'previous_start_date', v_old_record.access_start_date,
      'previous_expiration_date', v_old_record.access_expiration_date
    ),
    p_event_metadata := jsonb_build_object(
      'user_id', public.get_current_user_id()
    )
  );

  -- Update the projection directly (event processor will also handle this)
  UPDATE public.user_organizations_projection
  SET
    access_start_date = p_access_start_date,
    access_expiration_date = p_access_expiration_date,
    updated_at = now()
  WHERE user_id = p_user_id
    AND org_id = p_org_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'User organization access record not found' USING ERRCODE = 'P0002';
  END IF;
END;
$function$;
