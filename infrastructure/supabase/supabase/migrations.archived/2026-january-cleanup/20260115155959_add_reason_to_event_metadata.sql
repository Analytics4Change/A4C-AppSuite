-- ============================================================================
-- Migration: Add reason parameter to event metadata
-- Purpose: Enhance audit trail with business context per documented best practices
-- See: documentation/architecture/data/event-sourcing-overview.md
-- ============================================================================

-- ============================================================================
-- 1. api.update_user_notification_preferences - Add p_reason parameter
-- ============================================================================

DROP FUNCTION IF EXISTS api.update_user_notification_preferences(UUID, UUID, JSONB);

CREATE OR REPLACE FUNCTION api.update_user_notification_preferences(
  p_user_id UUID,
  p_org_id UUID,
  p_notification_preferences JSONB,
  p_reason TEXT DEFAULT NULL  -- Optional: business context for audit
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_event_id UUID;
  v_metadata JSONB;
BEGIN
  -- Authorization: Three-tier check
  IF NOT (
    public.has_platform_privilege()
    OR public.has_org_admin_permission()
    OR p_user_id = public.get_current_user_id()
  ) THEN
    RAISE EXCEPTION 'Access denied' USING ERRCODE = '42501';
  END IF;

  -- Build metadata with optional reason
  v_metadata := jsonb_build_object(
    'user_id', public.get_current_user_id(),
    'source', 'api.update_user_notification_preferences'
  );
  IF p_reason IS NOT NULL THEN
    v_metadata := v_metadata || jsonb_build_object('reason', p_reason);
  END IF;

  -- Emit domain event
  v_event_id := api.emit_domain_event(
    p_stream_id := p_user_id,
    p_stream_type := 'user',
    p_event_type := 'user.notification_preferences.updated',
    p_event_data := jsonb_build_object(
      'user_id', p_user_id,
      'org_id', p_org_id,
      'notification_preferences', p_notification_preferences
    ),
    p_event_metadata := v_metadata
  );

  RETURN jsonb_build_object(
    'success', true,
    'event_id', v_event_id,
    'preferences', p_notification_preferences
  );
END;
$$;

ALTER FUNCTION api.update_user_notification_preferences(UUID, UUID, JSONB, TEXT) OWNER TO postgres;

COMMENT ON FUNCTION api.update_user_notification_preferences(UUID, UUID, JSONB, TEXT) IS
'Update user notification preferences for an organization via domain event.
The event processor writes to the normalized projection table.
p_reason provides optional audit context (e.g., "User updated via settings page").
Authorization: Platform admin, org admin, or user updating their own preferences.';

GRANT EXECUTE ON FUNCTION api.update_user_notification_preferences(UUID, UUID, JSONB, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION api.update_user_notification_preferences(UUID, UUID, JSONB, TEXT) TO service_role;

-- ============================================================================
-- 2. api.add_user_phone - Add p_reason parameter
-- ============================================================================

DROP FUNCTION IF EXISTS api.add_user_phone(UUID, TEXT, TEXT, TEXT, TEXT, TEXT, BOOLEAN, BOOLEAN, UUID);

CREATE OR REPLACE FUNCTION api.add_user_phone(
  p_user_id UUID,
  p_label TEXT,
  p_type TEXT,
  p_number TEXT,
  p_extension TEXT DEFAULT NULL,
  p_country_code TEXT DEFAULT '+1',
  p_is_primary BOOLEAN DEFAULT false,
  p_sms_capable BOOLEAN DEFAULT false,
  p_org_id UUID DEFAULT NULL,
  p_reason TEXT DEFAULT NULL  -- Optional: business context for audit
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_phone_id UUID;
  v_event_id UUID;
  v_metadata JSONB;
BEGIN
  -- Authorization: Three-tier check
  IF NOT (
    public.has_platform_privilege()
    OR public.has_org_admin_permission()
    OR p_user_id = public.get_current_user_id()
  ) THEN
    RAISE EXCEPTION 'Access denied' USING ERRCODE = '42501';
  END IF;

  v_phone_id := gen_random_uuid();

  -- Build metadata with optional reason
  v_metadata := jsonb_build_object(
    'user_id', public.get_current_user_id(),
    'source', 'api.add_user_phone'
  );
  IF p_reason IS NOT NULL THEN
    v_metadata := v_metadata || jsonb_build_object('reason', p_reason);
  END IF;

  -- Emit domain event
  v_event_id := api.emit_domain_event(
    p_stream_id := p_user_id,
    p_stream_type := 'user',
    p_event_type := 'user.phone.added',
    p_event_data := jsonb_build_object(
      'user_id', p_user_id,
      'phone_id', v_phone_id,
      'org_id', p_org_id,
      'label', p_label,
      'type', p_type,
      'number', p_number,
      'extension', p_extension,
      'country_code', p_country_code,
      'is_primary', p_is_primary,
      'sms_capable', p_sms_capable
    ),
    p_event_metadata := v_metadata
  );

  RETURN jsonb_build_object(
    'success', true,
    'phoneId', v_phone_id,
    'eventId', v_event_id
  );
END;
$$;

ALTER FUNCTION api.add_user_phone(UUID, TEXT, TEXT, TEXT, TEXT, TEXT, BOOLEAN, BOOLEAN, UUID, TEXT) OWNER TO postgres;

COMMENT ON FUNCTION api.add_user_phone IS
'Add a new phone for a user. p_org_id=NULL creates global phone, set creates org-specific.
p_reason provides optional audit context (e.g., "Admin added phone during onboarding").
Authorization: Platform admin, org admin, or user adding their own phone.';

GRANT EXECUTE ON FUNCTION api.add_user_phone(UUID, TEXT, TEXT, TEXT, TEXT, TEXT, BOOLEAN, BOOLEAN, UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION api.add_user_phone(UUID, TEXT, TEXT, TEXT, TEXT, TEXT, BOOLEAN, BOOLEAN, UUID, TEXT) TO service_role;

-- ============================================================================
-- 3. api.update_user_phone - Add p_reason parameter
-- ============================================================================

DROP FUNCTION IF EXISTS api.update_user_phone(UUID, TEXT, TEXT, TEXT, TEXT, TEXT, BOOLEAN, BOOLEAN, UUID);

CREATE OR REPLACE FUNCTION api.update_user_phone(
  p_phone_id UUID,
  p_label TEXT DEFAULT NULL,
  p_type TEXT DEFAULT NULL,
  p_number TEXT DEFAULT NULL,
  p_extension TEXT DEFAULT NULL,
  p_country_code TEXT DEFAULT NULL,
  p_is_primary BOOLEAN DEFAULT NULL,
  p_sms_capable BOOLEAN DEFAULT NULL,
  p_org_id UUID DEFAULT NULL,
  p_reason TEXT DEFAULT NULL  -- Optional: business context for audit
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_user_id UUID;
  v_event_id UUID;
  v_metadata JSONB;
BEGIN
  -- Get user_id from the phone
  IF p_org_id IS NULL THEN
    SELECT user_id INTO v_user_id FROM user_phones WHERE id = p_phone_id;
  ELSE
    SELECT user_id INTO v_user_id FROM user_org_phone_overrides WHERE id = p_phone_id;
  END IF;

  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Phone not found' USING ERRCODE = 'P0002';
  END IF;

  -- Authorization: Three-tier check
  IF NOT (
    public.has_platform_privilege()
    OR public.has_org_admin_permission()
    OR v_user_id = public.get_current_user_id()
  ) THEN
    RAISE EXCEPTION 'Access denied' USING ERRCODE = '42501';
  END IF;

  -- Build metadata with optional reason
  v_metadata := jsonb_build_object(
    'user_id', public.get_current_user_id(),
    'source', 'api.update_user_phone'
  );
  IF p_reason IS NOT NULL THEN
    v_metadata := v_metadata || jsonb_build_object('reason', p_reason);
  END IF;

  -- Emit domain event
  v_event_id := api.emit_domain_event(
    p_stream_id := v_user_id,
    p_stream_type := 'user',
    p_event_type := 'user.phone.updated',
    p_event_data := jsonb_build_object(
      'phone_id', p_phone_id,
      'org_id', p_org_id,
      'label', p_label,
      'type', p_type,
      'number', p_number,
      'extension', p_extension,
      'country_code', p_country_code,
      'is_primary', p_is_primary,
      'sms_capable', p_sms_capable
    ),
    p_event_metadata := v_metadata
  );

  RETURN jsonb_build_object(
    'success', true,
    'phoneId', p_phone_id,
    'eventId', v_event_id
  );
END;
$$;

ALTER FUNCTION api.update_user_phone(UUID, TEXT, TEXT, TEXT, TEXT, TEXT, BOOLEAN, BOOLEAN, UUID, TEXT) OWNER TO postgres;

COMMENT ON FUNCTION api.update_user_phone IS
'Update an existing user phone. Only non-NULL parameters are updated.
p_reason provides optional audit context (e.g., "Updated SMS capability").
Authorization: Platform admin, org admin, or phone owner.';

GRANT EXECUTE ON FUNCTION api.update_user_phone(UUID, TEXT, TEXT, TEXT, TEXT, TEXT, BOOLEAN, BOOLEAN, UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION api.update_user_phone(UUID, TEXT, TEXT, TEXT, TEXT, TEXT, BOOLEAN, BOOLEAN, UUID, TEXT) TO service_role;

-- ============================================================================
-- 4. api.remove_user_phone - Add p_reason parameter
-- ============================================================================

DROP FUNCTION IF EXISTS api.remove_user_phone(UUID, UUID, BOOLEAN);

CREATE OR REPLACE FUNCTION api.remove_user_phone(
  p_phone_id UUID,
  p_org_id UUID DEFAULT NULL,
  p_hard_delete BOOLEAN DEFAULT false,
  p_reason TEXT DEFAULT NULL  -- Optional: business context for audit
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_user_id UUID;
  v_event_id UUID;
  v_metadata JSONB;
BEGIN
  -- Get user_id from the phone
  IF p_org_id IS NULL THEN
    SELECT user_id INTO v_user_id FROM user_phones WHERE id = p_phone_id;
  ELSE
    SELECT user_id INTO v_user_id FROM user_org_phone_overrides WHERE id = p_phone_id;
  END IF;

  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Phone not found' USING ERRCODE = 'P0002';
  END IF;

  -- Authorization: Three-tier check
  IF NOT (
    public.has_platform_privilege()
    OR public.has_org_admin_permission()
    OR v_user_id = public.get_current_user_id()
  ) THEN
    RAISE EXCEPTION 'Access denied' USING ERRCODE = '42501';
  END IF;

  -- Build metadata with optional reason
  v_metadata := jsonb_build_object(
    'user_id', public.get_current_user_id(),
    'source', 'api.remove_user_phone'
  );
  IF p_reason IS NOT NULL THEN
    v_metadata := v_metadata || jsonb_build_object('reason', p_reason);
  END IF;

  -- Emit domain event
  v_event_id := api.emit_domain_event(
    p_stream_id := v_user_id,
    p_stream_type := 'user',
    p_event_type := 'user.phone.removed',
    p_event_data := jsonb_build_object(
      'phone_id', p_phone_id,
      'org_id', p_org_id,
      'removal_type', CASE WHEN p_hard_delete THEN 'hard_delete' ELSE 'soft_delete' END
    ),
    p_event_metadata := v_metadata
  );

  RETURN jsonb_build_object(
    'success', true,
    'phoneId', p_phone_id,
    'eventId', v_event_id
  );
END;
$$;

ALTER FUNCTION api.remove_user_phone(UUID, UUID, BOOLEAN, TEXT) OWNER TO postgres;

COMMENT ON FUNCTION api.remove_user_phone IS
'Remove a user phone. Default is soft delete (is_active=false), use p_hard_delete=true for permanent.
p_reason provides optional audit context (e.g., "User requested phone removal").
Authorization: Platform admin, org admin, or phone owner.';

GRANT EXECUTE ON FUNCTION api.remove_user_phone(UUID, UUID, BOOLEAN, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION api.remove_user_phone(UUID, UUID, BOOLEAN, TEXT) TO service_role;
