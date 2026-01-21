-- ============================================================================
-- Migration: User Phone CRUD RPCs
-- Purpose: RPC functions for managing user phones via domain events
--
-- NOTE: This migration was modified to handle the case where 10-param versions
-- (with p_reason) already exist from 20260115155959_add_reason_to_event_metadata.sql.
-- The 10-param versions are canonical. This migration now:
-- 1. Drops any conflicting 9-param versions
-- 2. Creates 9-param versions as wrappers (for backwards compatibility)
-- 3. Uses explicit signatures in COMMENT/GRANT statements
-- ============================================================================

-- Drop any conflicting 9-param versions that might exist
DROP FUNCTION IF EXISTS api.add_user_phone(UUID, TEXT, TEXT, TEXT, TEXT, TEXT, BOOLEAN, BOOLEAN, UUID);
DROP FUNCTION IF EXISTS api.update_user_phone(UUID, TEXT, TEXT, TEXT, TEXT, TEXT, BOOLEAN, BOOLEAN, UUID);
DROP FUNCTION IF EXISTS api.remove_user_phone(UUID, UUID, BOOLEAN);

-- ============================================================================
-- 1. api.add_user_phone - Add a new phone for a user
-- ============================================================================

CREATE OR REPLACE FUNCTION api.add_user_phone(
  p_user_id UUID,
  p_label TEXT,
  p_type TEXT,
  p_number TEXT,
  p_extension TEXT DEFAULT NULL,
  p_country_code TEXT DEFAULT '+1',
  p_is_primary BOOLEAN DEFAULT false,
  p_sms_capable BOOLEAN DEFAULT false,
  p_org_id UUID DEFAULT NULL  -- NULL = global phone, set = org-specific
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_phone_id UUID;
  v_event_id UUID;
BEGIN
  -- Authorization: Three-tier check
  IF NOT (
    public.has_platform_privilege()
    OR public.has_org_admin_permission()
    OR p_user_id = public.get_current_user_id()
  ) THEN
    RAISE EXCEPTION 'Access denied' USING ERRCODE = '42501';
  END IF;

  -- Generate phone ID
  v_phone_id := gen_random_uuid();

  -- Emit domain event (event processor will create the phone record)
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
    p_event_metadata := jsonb_build_object(
      'user_id', public.get_current_user_id(),
      'source', 'api.add_user_phone'
    )
  );

  RETURN jsonb_build_object(
    'success', true,
    'phoneId', v_phone_id,
    'eventId', v_event_id
  );
END;
$$;

ALTER FUNCTION api.add_user_phone(UUID, TEXT, TEXT, TEXT, TEXT, TEXT, BOOLEAN, BOOLEAN, UUID) OWNER TO postgres;

COMMENT ON FUNCTION api.add_user_phone(UUID, TEXT, TEXT, TEXT, TEXT, TEXT, BOOLEAN, BOOLEAN, UUID) IS
'Add a new phone for a user. p_org_id=NULL creates global phone, set creates org-specific override.
Authorization: Platform admin, org admin, or user adding their own phone.';

GRANT EXECUTE ON FUNCTION api.add_user_phone(UUID, TEXT, TEXT, TEXT, TEXT, TEXT, BOOLEAN, BOOLEAN, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION api.add_user_phone(UUID, TEXT, TEXT, TEXT, TEXT, TEXT, BOOLEAN, BOOLEAN, UUID) TO service_role;

-- ============================================================================
-- 2. api.update_user_phone - Update an existing phone
-- ============================================================================

CREATE OR REPLACE FUNCTION api.update_user_phone(
  p_phone_id UUID,
  p_label TEXT DEFAULT NULL,
  p_type TEXT DEFAULT NULL,
  p_number TEXT DEFAULT NULL,
  p_extension TEXT DEFAULT NULL,
  p_country_code TEXT DEFAULT NULL,
  p_is_primary BOOLEAN DEFAULT NULL,
  p_sms_capable BOOLEAN DEFAULT NULL,
  p_org_id UUID DEFAULT NULL  -- Context for org-specific phone
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_user_id UUID;
  v_event_id UUID;
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
    p_event_metadata := jsonb_build_object(
      'user_id', public.get_current_user_id(),
      'source', 'api.update_user_phone'
    )
  );

  RETURN jsonb_build_object(
    'success', true,
    'phoneId', p_phone_id,
    'eventId', v_event_id
  );
END;
$$;

ALTER FUNCTION api.update_user_phone(UUID, TEXT, TEXT, TEXT, TEXT, TEXT, BOOLEAN, BOOLEAN, UUID) OWNER TO postgres;

COMMENT ON FUNCTION api.update_user_phone(UUID, TEXT, TEXT, TEXT, TEXT, TEXT, BOOLEAN, BOOLEAN, UUID) IS
'Update an existing user phone. Only non-NULL parameters are updated.
Authorization: Platform admin, org admin, or phone owner.';

GRANT EXECUTE ON FUNCTION api.update_user_phone(UUID, TEXT, TEXT, TEXT, TEXT, TEXT, BOOLEAN, BOOLEAN, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION api.update_user_phone(UUID, TEXT, TEXT, TEXT, TEXT, TEXT, BOOLEAN, BOOLEAN, UUID) TO service_role;

-- ============================================================================
-- 3. api.remove_user_phone - Remove (soft delete) a phone
-- ============================================================================

CREATE OR REPLACE FUNCTION api.remove_user_phone(
  p_phone_id UUID,
  p_org_id UUID DEFAULT NULL,  -- Context for org-specific phone
  p_hard_delete BOOLEAN DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_user_id UUID;
  v_event_id UUID;
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
    p_event_metadata := jsonb_build_object(
      'user_id', public.get_current_user_id(),
      'source', 'api.remove_user_phone'
    )
  );

  RETURN jsonb_build_object(
    'success', true,
    'phoneId', p_phone_id,
    'eventId', v_event_id
  );
END;
$$;

ALTER FUNCTION api.remove_user_phone(UUID, UUID, BOOLEAN) OWNER TO postgres;

COMMENT ON FUNCTION api.remove_user_phone(UUID, UUID, BOOLEAN) IS
'Remove a user phone. Default is soft delete (is_active=false), use p_hard_delete=true for permanent removal.
Authorization: Platform admin, org admin, or phone owner.';

GRANT EXECUTE ON FUNCTION api.remove_user_phone(UUID, UUID, BOOLEAN) TO authenticated;
GRANT EXECUTE ON FUNCTION api.remove_user_phone(UUID, UUID, BOOLEAN) TO service_role;

