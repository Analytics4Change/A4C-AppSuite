-- =============================================================================
-- P0 Migration: Fix Critical CQRS Bugs
-- =============================================================================
-- Fixes from CQRS dual-write audit (dev/active/cqrs-dual-write-audit.md):
--   1. handle_organization_direct_care_settings_updated: aggregate_id -> stream_id
--   2. process_organization_event: event type mismatch + RAISE WARNING -> EXCEPTION
--   3. process_user_event: event type mismatch + RAISE WARNING -> EXCEPTION
--   4. api.revoke_invitation: broken column refs + missing event emission
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Fix handler: aggregate_id -> stream_id, now() -> p_event.created_at
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION handle_organization_direct_care_settings_updated(p_event record)
RETURNS void
LANGUAGE plpgsql
SET search_path = public, extensions, pg_temp
AS $$
BEGIN
  UPDATE organizations_projection SET
    direct_care_settings = p_event.event_data->'settings',
    updated_at = p_event.created_at
  WHERE id = p_event.stream_id;
END;
$$;

-- ---------------------------------------------------------------------------
-- 2. Fix organization router: event type mismatch + RAISE EXCEPTION
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION process_organization_event(p_event record)
RETURNS void
LANGUAGE plpgsql
SET search_path TO 'public', 'extensions', 'pg_temp'
AS $$
BEGIN
  CASE p_event.event_type
    -- Organization lifecycle
    WHEN 'organization.created' THEN PERFORM handle_organization_created(p_event);
    WHEN 'organization.updated' THEN PERFORM handle_organization_updated(p_event);
    WHEN 'organization.subdomain_status.changed' THEN PERFORM handle_organization_subdomain_status_changed(p_event);
    WHEN 'organization.deactivated' THEN PERFORM handle_organization_deactivated(p_event);
    WHEN 'organization.reactivated' THEN PERFORM handle_organization_reactivated(p_event);
    WHEN 'organization.deleted' THEN PERFORM handle_organization_deleted(p_event);

    -- Subdomain lifecycle
    WHEN 'organization.subdomain.verified' THEN PERFORM handle_organization_subdomain_verified(p_event);
    WHEN 'organization.subdomain.dns_created' THEN PERFORM handle_organization_subdomain_dns_created(p_event);
    WHEN 'organization.subdomain.failed' THEN PERFORM handle_organization_subdomain_failed(p_event);

    -- Direct care settings (fixed: underscore to match emitted event type)
    WHEN 'organization.direct_care_settings_updated' THEN PERFORM handle_organization_direct_care_settings_updated(p_event);

    -- Bootstrap
    WHEN 'bootstrap.completed' THEN PERFORM handle_bootstrap_completed(p_event);
    WHEN 'bootstrap.failed' THEN PERFORM handle_bootstrap_failed(p_event);
    WHEN 'bootstrap.cancelled' THEN PERFORM handle_bootstrap_cancelled(p_event);

    -- Invitations
    WHEN 'user.invited' THEN PERFORM handle_user_invited(p_event);
    WHEN 'invitation.resent' THEN PERFORM handle_invitation_resent(p_event);

    -- Unhandled event type (fixed: EXCEPTION instead of WARNING)
    ELSE
      RAISE EXCEPTION 'Unhandled event type "%" in process_organization_event', p_event.event_type
        USING ERRCODE = 'P9001';
  END CASE;
END;
$$;

-- ---------------------------------------------------------------------------
-- 3. Fix user router: event type mismatch + RAISE EXCEPTION
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION process_user_event(p_event record)
RETURNS void
LANGUAGE plpgsql
SET search_path TO 'public', 'extensions', 'pg_temp'
AS $$
BEGIN
  CASE p_event.event_type
    -- User lifecycle
    WHEN 'user.created' THEN PERFORM handle_user_created(p_event);
    WHEN 'user.synced_from_auth' THEN PERFORM handle_user_synced_from_auth(p_event);
    WHEN 'user.deactivated' THEN PERFORM handle_user_deactivated(p_event);
    WHEN 'user.reactivated' THEN PERFORM handle_user_reactivated(p_event);
    WHEN 'user.organization_switched' THEN PERFORM handle_user_organization_switched(p_event);

    -- Role assignments
    WHEN 'user.role.assigned' THEN PERFORM handle_user_role_assigned(p_event);
    WHEN 'user.role.revoked' THEN PERFORM handle_user_role_revoked(p_event);

    -- Access dates (fixed: underscore to match emitted event type)
    WHEN 'user.access_dates_updated' THEN PERFORM handle_user_access_dates_updated(p_event);

    -- Notification preferences
    WHEN 'user.notification_preferences.updated' THEN PERFORM handle_user_notification_preferences_updated(p_event);

    -- Addresses
    WHEN 'user.address.added' THEN PERFORM handle_user_address_added(p_event);
    WHEN 'user.address.updated' THEN PERFORM handle_user_address_updated(p_event);
    WHEN 'user.address.removed' THEN PERFORM handle_user_address_removed(p_event);

    -- Phones
    WHEN 'user.phone.added' THEN PERFORM handle_user_phone_added(p_event);
    WHEN 'user.phone.updated' THEN PERFORM handle_user_phone_updated(p_event);
    WHEN 'user.phone.removed' THEN PERFORM handle_user_phone_removed(p_event);

    -- Schedule policies
    WHEN 'user.schedule.created' THEN PERFORM handle_user_schedule_created(p_event);
    WHEN 'user.schedule.updated' THEN PERFORM handle_user_schedule_updated(p_event);
    WHEN 'user.schedule.deactivated' THEN PERFORM handle_user_schedule_deactivated(p_event);
    WHEN 'user.schedule.reactivated' THEN PERFORM handle_user_schedule_reactivated(p_event);
    WHEN 'user.schedule.deleted' THEN PERFORM handle_user_schedule_deleted(p_event);

    -- Client assignments
    WHEN 'user.client.assigned' THEN PERFORM handle_user_client_assigned(p_event);
    WHEN 'user.client.unassigned' THEN PERFORM handle_user_client_unassigned(p_event);

    -- Unhandled event type (fixed: EXCEPTION instead of WARNING)
    ELSE
      RAISE EXCEPTION 'Unhandled event type "%" in process_user_event', p_event.event_type
        USING ERRCODE = 'P9001';
  END CASE;
END;
$$;

-- ---------------------------------------------------------------------------
-- 4. Fix api.revoke_invitation: emit event instead of broken direct write
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION api.revoke_invitation(
  p_invitation_id UUID,
  p_reason TEXT DEFAULT 'manual_revocation'
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_exists BOOLEAN;
BEGIN
  -- Check invitation exists and is pending
  SELECT EXISTS(
    SELECT 1 FROM invitations_projection
    WHERE id = p_invitation_id AND status = 'pending'
  ) INTO v_exists;

  IF NOT v_exists THEN
    RETURN false;
  END IF;

  -- Emit domain event (handler in process_invitation_event updates projection)
  PERFORM api.emit_domain_event(
    p_stream_id := p_invitation_id,
    p_stream_type := 'invitation',
    p_event_type := 'invitation.revoked',
    p_event_data := jsonb_build_object(
      'invitation_id', p_invitation_id,
      'reason', p_reason
    ),
    p_event_metadata := jsonb_build_object(
      'user_id', auth.uid(),
      'reason', p_reason
    )
  );

  RETURN true;
END;
$$;
