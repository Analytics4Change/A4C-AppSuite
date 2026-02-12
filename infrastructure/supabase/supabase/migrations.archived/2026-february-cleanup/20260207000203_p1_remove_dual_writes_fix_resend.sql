-- =============================================================================
-- P1 Migration: Remove Dual Writes + Fix resend_invitation
-- =============================================================================
-- From CQRS dual-write audit (dev/active/cqrs-dual-write-audit.md):
--   Migration 2a: Remove direct write from update_organization_direct_care_settings (both overloads)
--   Migration 2b: Remove direct write from update_user_access_dates
--   Migration 3a: Rewrite api.resend_invitation to emit event + add routing
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Fix invitation router: add invitation.resent + RAISE EXCEPTION
--    (Must be applied BEFORE resend_invitation emits to this router)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION process_invitation_event(p_event record)
RETURNS void
LANGUAGE plpgsql
SET search_path TO 'public', 'extensions', 'pg_temp'
AS $$
DECLARE
  v_org_id UUID;
  v_invitation_id UUID;
BEGIN
  CASE p_event.event_type

    -- Handle user invitation
    WHEN 'user.invited' THEN
      v_org_id := (p_event.event_data->>'org_id')::UUID;
      v_invitation_id := (p_event.event_data->>'invitation_id')::UUID;

      INSERT INTO invitations_projection (
        id,
        invitation_id,
        organization_id,
        email,
        first_name,
        last_name,
        roles,
        token,
        expires_at,
        access_start_date,
        access_expiration_date,
        notification_preferences,
        status,
        created_at,
        updated_at
      ) VALUES (
        v_invitation_id,
        v_invitation_id,
        v_org_id,
        p_event.event_data->>'email',
        p_event.event_data->>'first_name',
        p_event.event_data->>'last_name',
        p_event.event_data->'roles',
        p_event.event_data->>'token',
        (p_event.event_data->>'expires_at')::TIMESTAMPTZ,
        (p_event.event_data->>'access_start_date')::DATE,
        (p_event.event_data->>'access_expiration_date')::DATE,
        COALESCE(
          p_event.event_data->'notification_preferences',
          '{"email": true, "sms": {"enabled": false, "phone_id": null}, "in_app": false}'::jsonb
        ),
        'pending',
        p_event.created_at,
        p_event.created_at
      )
      ON CONFLICT (id) DO UPDATE SET
        email = EXCLUDED.email,
        first_name = EXCLUDED.first_name,
        last_name = EXCLUDED.last_name,
        roles = EXCLUDED.roles,
        token = EXCLUDED.token,
        expires_at = EXCLUDED.expires_at,
        access_start_date = EXCLUDED.access_start_date,
        access_expiration_date = EXCLUDED.access_expiration_date,
        notification_preferences = EXCLUDED.notification_preferences,
        updated_at = p_event.created_at;

    -- Handle invitation accepted
    WHEN 'invitation.accepted' THEN
      v_invitation_id := (p_event.event_data->>'invitation_id')::UUID;

      UPDATE invitations_projection
      SET
        status = 'accepted',
        accepted_at = (p_event.event_data->>'accepted_at')::TIMESTAMPTZ,
        updated_at = p_event.created_at
      WHERE id = v_invitation_id;

    -- Handle invitation revoked
    WHEN 'invitation.revoked' THEN
      v_invitation_id := (p_event.event_data->>'invitation_id')::UUID;

      UPDATE invitations_projection
      SET
        status = 'revoked',
        updated_at = p_event.created_at
      WHERE id = v_invitation_id;

    -- Handle invitation expired
    WHEN 'invitation.expired' THEN
      v_invitation_id := (p_event.event_data->>'invitation_id')::UUID;

      UPDATE invitations_projection
      SET
        status = 'expired',
        updated_at = p_event.created_at
      WHERE id = v_invitation_id;

    -- Handle invitation resent (NEW: was only in process_organization_event)
    WHEN 'invitation.resent' THEN
      PERFORM handle_invitation_resent(p_event);

    -- Unhandled event type (fixed: EXCEPTION instead of WARNING)
    ELSE
      RAISE EXCEPTION 'Unhandled event type "%" in process_invitation_event', p_event.event_type
        USING ERRCODE = 'P9001';
  END CASE;

END;
$$;

-- ---------------------------------------------------------------------------
-- 2. Rewrite api.resend_invitation: emit event instead of direct write
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION api.resend_invitation(
  p_invitation_id UUID,
  p_new_token TEXT,
  p_new_expires_at TIMESTAMPTZ
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_exists BOOLEAN;
BEGIN
  -- Check invitation exists and is in resendable state
  SELECT EXISTS(
    SELECT 1 FROM invitations_projection
    WHERE id = p_invitation_id AND status IN ('pending', 'expired')
  ) INTO v_exists;

  IF NOT v_exists THEN
    RETURN false;
  END IF;

  -- Emit domain event (handler updates projection)
  PERFORM api.emit_domain_event(
    p_stream_id := p_invitation_id,
    p_stream_type := 'invitation',
    p_event_type := 'invitation.resent',
    p_event_data := jsonb_build_object(
      'invitation_id', p_invitation_id,
      'token', p_new_token,
      'expires_at', p_new_expires_at
    ),
    p_event_metadata := jsonb_build_object(
      'user_id', auth.uid()
    )
  );

  RETURN true;
END;
$$;

-- ---------------------------------------------------------------------------
-- 3. Remove dual write from update_organization_direct_care_settings (3-param)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION api.update_organization_direct_care_settings(
  p_org_id uuid,
  p_enable_staff_client_mapping boolean DEFAULT NULL::boolean,
  p_enable_schedule_enforcement boolean DEFAULT NULL::boolean
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
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

  -- REMOVED: Direct write to organizations_projection
  -- Handler handle_organization_direct_care_settings_updated updates projection
  -- synchronously via BEFORE INSERT trigger on domain_events

  -- Emit domain event for audit trail
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
$$;

-- ---------------------------------------------------------------------------
-- 4. Remove dual write from update_organization_direct_care_settings (4-param)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION api.update_organization_direct_care_settings(
  p_org_id uuid,
  p_enable_staff_client_mapping boolean DEFAULT NULL::boolean,
  p_enable_schedule_enforcement boolean DEFAULT NULL::boolean,
  p_reason text DEFAULT NULL::text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
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

  -- REMOVED: Direct write to organizations_projection
  -- Handler handle_organization_direct_care_settings_updated updates projection
  -- synchronously via BEFORE INSERT trigger on domain_events

  -- Build event metadata with optional reason
  v_metadata := jsonb_build_object('user_id', auth.uid());
  IF p_reason IS NOT NULL THEN
    v_metadata := v_metadata || jsonb_build_object('reason', p_reason);
  END IF;

  -- Emit domain event for audit trail
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
$$;

-- ---------------------------------------------------------------------------
-- 5. Remove dual write from update_user_access_dates
-- ---------------------------------------------------------------------------
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
AS $$
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

  -- Get old values for event AND verify record exists
  SELECT access_start_date, access_expiration_date
  INTO v_old_record
  FROM public.user_organizations_projection
  WHERE user_id = p_user_id AND org_id = p_org_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'User organization access record not found' USING ERRCODE = 'P0002';
  END IF;

  -- Emit domain event
  -- Handler handle_user_access_dates_updated updates projection
  -- synchronously via BEFORE INSERT trigger on domain_events
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

  -- REMOVED: Direct write to user_organizations_projection
  -- REMOVED: IF NOT FOUND check (moved above, before event emission)
END;
$$;
