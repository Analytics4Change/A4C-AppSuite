-- ============================================================================
-- Migration: Notification Preferences RPCs
-- Purpose: Read/update RPCs for the new notification preferences projection
-- ============================================================================

-- ============================================================================
-- 1. api.get_user_notification_preferences - Read from new projection table
-- ============================================================================

CREATE OR REPLACE FUNCTION api.get_user_notification_preferences(
  p_user_id UUID,
  p_organization_id UUID
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_result jsonb;
BEGIN
  -- Authorization: Three-tier check
  IF NOT (
    -- Tier 1: Platform admin (cross-tenant access)
    public.has_platform_privilege()
    -- Tier 2: Org admin for this org
    OR public.has_org_admin_permission()
    -- User reading their own preferences
    OR p_user_id = public.get_current_user_id()
  ) THEN
    RAISE EXCEPTION 'Access denied' USING ERRCODE = '42501';
  END IF;

  -- Read from the new normalized projection table
  SELECT jsonb_build_object(
    'email', unp.email_enabled,
    'sms', jsonb_build_object(
      'enabled', unp.sms_enabled,
      'phoneId', unp.sms_phone_id
    ),
    'inApp', unp.in_app_enabled
  ) INTO v_result
  FROM user_notification_preferences_projection unp
  WHERE unp.user_id = p_user_id
    AND unp.organization_id = p_organization_id;

  -- Return defaults if no record found
  RETURN COALESCE(
    v_result,
    '{"email": true, "sms": {"enabled": false, "phoneId": null}, "inApp": false}'::jsonb
  );
END;
$$;

ALTER FUNCTION api.get_user_notification_preferences(UUID, UUID) OWNER TO postgres;

COMMENT ON FUNCTION api.get_user_notification_preferences(UUID, UUID) IS
'Read user notification preferences for an organization from the normalized projection table.
Returns defaults if no record exists.
Authorization:
- Platform admins can read any user/org
- Org admins can read users in their org
- Users can read their own preferences';

GRANT EXECUTE ON FUNCTION api.get_user_notification_preferences(UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION api.get_user_notification_preferences(UUID, UUID) TO service_role;

-- ============================================================================
-- 2. api.update_user_notification_preferences - Emit domain event
-- ============================================================================

-- Drop existing function first (changing return type from void to jsonb)
DROP FUNCTION IF EXISTS api.update_user_notification_preferences(UUID, UUID, JSONB);

-- Replace the existing function to emit a domain event instead of direct write
-- This ensures the event processor writes to BOTH tables (JSONB and normalized)

CREATE OR REPLACE FUNCTION api.update_user_notification_preferences(
  p_user_id UUID,
  p_org_id UUID,
  p_notification_preferences jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_event_id UUID;
BEGIN
  -- Authorization: Three-tier check
  IF NOT (
    -- Tier 1: Platform admin (cross-tenant access)
    public.has_platform_privilege()
    -- Tier 2: Org admin for this org
    OR public.has_org_admin_permission()
    -- User updating their own preferences
    OR p_user_id = public.get_current_user_id()
  ) THEN
    RAISE EXCEPTION 'Access denied' USING ERRCODE = '42501';
  END IF;

  -- Emit domain event (event processor will handle dual-write)
  v_event_id := api.emit_domain_event(
    p_stream_id := p_user_id,
    p_stream_type := 'user',
    p_event_type := 'user.notification_preferences.updated',
    p_event_data := jsonb_build_object(
      'user_id', p_user_id,
      'org_id', p_org_id,
      'notification_preferences', p_notification_preferences
    ),
    p_event_metadata := jsonb_build_object(
      'user_id', public.get_current_user_id(),
      'source', 'api.update_user_notification_preferences'
    )
  );

  -- Return the updated preferences for confirmation
  RETURN jsonb_build_object(
    'success', true,
    'event_id', v_event_id,
    'preferences', p_notification_preferences
  );
END;
$$;

ALTER FUNCTION api.update_user_notification_preferences(UUID, UUID, JSONB) OWNER TO postgres;

COMMENT ON FUNCTION api.update_user_notification_preferences(UUID, UUID, JSONB) IS
'Update user notification preferences for an organization via domain event.
The event processor handles dual-write to both JSONB (legacy) and normalized projection tables.
Authorization:
- Platform admins can update any user/org
- Org admins can update users in their org
- Users can update their own preferences';

GRANT EXECUTE ON FUNCTION api.update_user_notification_preferences(UUID, UUID, JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION api.update_user_notification_preferences(UUID, UUID, JSONB) TO service_role;

-- ============================================================================
-- 3. api.get_user_phones - Get phones for notification settings dropdown
-- Note: user_org_phone_overrides are SEPARATE phone records, not overrides
-- ============================================================================

CREATE OR REPLACE FUNCTION api.get_user_phones(
  p_user_id UUID,
  p_organization_id UUID DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
BEGIN
  -- Authorization: Three-tier check
  IF NOT (
    -- Tier 1: Platform admin (cross-tenant access)
    public.has_platform_privilege()
    -- Tier 2: Org admin for this org
    OR public.has_org_admin_permission()
    -- User reading their own phones
    OR p_user_id = public.get_current_user_id()
  ) THEN
    RAISE EXCEPTION 'Access denied' USING ERRCODE = '42501';
  END IF;

  -- Return user's global phones UNION org-specific phones if org specified
  RETURN (
    WITH all_phones AS (
      -- Global user phones
      SELECT
        up.id,
        up.label,
        up.type::text,
        up.number,
        up.extension,
        up.country_code,
        up.sms_capable,
        up.is_primary,
        up.is_active,
        (up.source_contact_phone_id IS NOT NULL) AS is_mirrored,
        'global'::text AS source,
        up.created_at
      FROM user_phones up
      WHERE up.user_id = p_user_id
        AND up.is_active = true

      UNION ALL

      -- Org-specific phones (only if org specified)
      SELECT
        uopo.id,
        uopo.label,
        uopo.type::text,
        uopo.number,
        uopo.extension,
        uopo.country_code,
        uopo.sms_capable,
        false AS is_primary,  -- Org phones don't have primary flag
        uopo.is_active,
        false AS is_mirrored,  -- Org phones are not mirrored
        'org'::text AS source,
        uopo.created_at
      FROM user_org_phone_overrides uopo
      WHERE uopo.user_id = p_user_id
        AND uopo.org_id = p_organization_id
        AND uopo.is_active = true
        AND p_organization_id IS NOT NULL
    )
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'id', ap.id,
      'label', ap.label,
      'type', ap.type,
      'number', ap.number,
      'extension', ap.extension,
      'countryCode', ap.country_code,
      'smsCapable', ap.sms_capable,
      'isPrimary', ap.is_primary,
      'isActive', ap.is_active,
      'isMirrored', ap.is_mirrored,
      'source', ap.source
    ) ORDER BY ap.is_primary DESC, ap.created_at ASC), '[]'::jsonb)
    FROM all_phones ap
  );
END;
$$;

ALTER FUNCTION api.get_user_phones(UUID, UUID) OWNER TO postgres;

COMMENT ON FUNCTION api.get_user_phones(UUID, UUID) IS
'Get user phones for notification settings. Returns global phones + org-specific phones if org specified.
Includes isMirrored flag to indicate phones auto-copied from contact profile.
source="global" for user_phones, source="org" for user_org_phone_overrides.
Authorization:
- Platform admins can read any user
- Org admins can read users in their org
- Users can read their own phones';

GRANT EXECUTE ON FUNCTION api.get_user_phones(UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION api.get_user_phones(UUID, UUID) TO service_role;

-- ============================================================================
-- 4. api.get_user_sms_phones - Convenience function for SMS-capable phones only
-- ============================================================================

CREATE OR REPLACE FUNCTION api.get_user_sms_phones(
  p_user_id UUID,
  p_organization_id UUID DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
BEGIN
  -- Authorization: Three-tier check
  IF NOT (
    -- Tier 1: Platform admin (cross-tenant access)
    public.has_platform_privilege()
    -- Tier 2: Org admin for this org
    OR public.has_org_admin_permission()
    -- User reading their own phones
    OR p_user_id = public.get_current_user_id()
  ) THEN
    RAISE EXCEPTION 'Access denied' USING ERRCODE = '42501';
  END IF;

  -- Return only SMS-capable phones for dropdown
  RETURN (
    WITH sms_phones AS (
      -- Global user phones (SMS-capable only)
      SELECT
        up.id,
        up.label,
        up.number,
        up.is_primary,
        (up.source_contact_phone_id IS NOT NULL) AS is_mirrored,
        up.created_at
      FROM user_phones up
      WHERE up.user_id = p_user_id
        AND up.is_active = true
        AND up.sms_capable = true

      UNION ALL

      -- Org-specific phones (SMS-capable only)
      SELECT
        uopo.id,
        uopo.label,
        uopo.number,
        false AS is_primary,
        false AS is_mirrored,
        uopo.created_at
      FROM user_org_phone_overrides uopo
      WHERE uopo.user_id = p_user_id
        AND uopo.org_id = p_organization_id
        AND uopo.is_active = true
        AND uopo.sms_capable = true
        AND p_organization_id IS NOT NULL
    )
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'id', sp.id,
      'label', sp.label,
      'number', sp.number,
      'isPrimary', sp.is_primary,
      'isMirrored', sp.is_mirrored
    ) ORDER BY sp.is_primary DESC, sp.created_at ASC), '[]'::jsonb)
    FROM sms_phones sp
  );
END;
$$;

ALTER FUNCTION api.get_user_sms_phones(UUID, UUID) OWNER TO postgres;

COMMENT ON FUNCTION api.get_user_sms_phones(UUID, UUID) IS
'Get SMS-capable phones for notification preferences dropdown.
Returns only phones marked as SMS-capable.
Authorization:
- Platform admins can read any user
- Org admins can read users in their org
- Users can read their own phones';

GRANT EXECUTE ON FUNCTION api.get_user_sms_phones(UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION api.get_user_sms_phones(UUID, UUID) TO service_role;

