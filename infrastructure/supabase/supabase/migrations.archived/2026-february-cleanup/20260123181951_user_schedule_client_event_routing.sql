-- =============================================================================
-- Migration: User Schedule & Client Assignment Event Routing
-- Purpose: Add event routing for schedule and client assignment events
-- Part of: Multi-Role Authorization Phase 3
-- =============================================================================

-- =============================================================================
-- UPDATE process_user_event() ROUTER
-- =============================================================================
-- Add new CASE entries for schedule and client assignment events

CREATE OR REPLACE FUNCTION process_user_event(p_event record)
RETURNS void
LANGUAGE plpgsql
SET search_path = public, extensions, pg_temp
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

    -- Access dates
    WHEN 'user.access_dates.updated' THEN PERFORM handle_user_access_dates_updated(p_event);

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

    -- Schedule policies (Phase 3B)
    WHEN 'user.schedule.created' THEN PERFORM handle_user_schedule_created(p_event);
    WHEN 'user.schedule.updated' THEN PERFORM handle_user_schedule_updated(p_event);
    WHEN 'user.schedule.deactivated' THEN PERFORM handle_user_schedule_deactivated(p_event);

    -- Client assignments (Phase 3C)
    WHEN 'user.client.assigned' THEN PERFORM handle_user_client_assigned(p_event);
    WHEN 'user.client.unassigned' THEN PERFORM handle_user_client_unassigned(p_event);

    ELSE
      RAISE WARNING 'Unknown user event type: %', p_event.event_type;
  END CASE;
END;
$$;

COMMENT ON FUNCTION process_user_event(record) IS
'User event router v6 - dispatches to individual handler functions.

Handlers:
- Lifecycle: handle_user_created, handle_user_synced_from_auth,
  handle_user_deactivated, handle_user_reactivated, handle_user_organization_switched
- Roles: handle_user_role_assigned, handle_user_role_revoked
- Access: handle_user_access_dates_updated
- Notifications: handle_user_notification_preferences_updated
- Address: handle_user_address_added/updated/removed
- Phone: handle_user_phone_added/updated/removed
- Schedule (Phase 3B): handle_user_schedule_created/updated/deactivated
- Client Assignment (Phase 3C): handle_user_client_assigned/unassigned';

-- =============================================================================
-- UPDATE TRIGGER to include all event types
-- =============================================================================

DROP TRIGGER IF EXISTS process_user_events_trigger ON domain_events;

CREATE TRIGGER process_user_events_trigger
  AFTER INSERT ON domain_events
  FOR EACH ROW
  WHEN (NEW.event_type = ANY (ARRAY[
    -- User lifecycle
    'user.created'::text,
    'user.synced_from_auth'::text,
    'user.deactivated'::text,
    'user.reactivated'::text,
    'user.organization_switched'::text,
    -- Role assignments
    'user.role.assigned'::text,
    'user.role.revoked'::text,
    -- Access dates
    'user.access_dates.updated'::text,
    -- Notification preferences
    'user.notification_preferences.updated'::text,
    -- Addresses
    'user.address.added'::text,
    'user.address.updated'::text,
    'user.address.removed'::text,
    -- Phones
    'user.phone.added'::text,
    'user.phone.updated'::text,
    'user.phone.removed'::text,
    -- Schedule policies (Phase 3B)
    'user.schedule.created'::text,
    'user.schedule.updated'::text,
    'user.schedule.deactivated'::text,
    -- Client assignments (Phase 3C)
    'user.client.assigned'::text,
    'user.client.unassigned'::text
  ]))
  EXECUTE FUNCTION process_user_event();

COMMENT ON TRIGGER process_user_events_trigger ON domain_events IS
'Triggers user event processing for all user.* domain events.
Routes to process_user_event() which dispatches to individual handlers.
Updated in Phase 3 to include schedule and client assignment events.';

-- =============================================================================
-- ORGANIZATION EVENT HANDLER: direct_care_settings.updated (Phase 3A)
-- =============================================================================

CREATE OR REPLACE FUNCTION handle_organization_direct_care_settings_updated(p_event record)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  UPDATE organizations_projection SET
    direct_care_settings = p_event.event_data->'settings',
    updated_at = now()
  WHERE id = p_event.aggregate_id;
END;
$$;

COMMENT ON FUNCTION handle_organization_direct_care_settings_updated(record) IS
'Event handler for organization.direct_care_settings.updated events.
Updates the direct_care_settings JSONB column on organizations_projection.';

-- =============================================================================
-- UPDATE process_organization_event() ROUTER
-- =============================================================================

CREATE OR REPLACE FUNCTION process_organization_event(p_event record)
RETURNS void
LANGUAGE plpgsql
SET search_path = public, extensions, pg_temp
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

    -- Direct care settings (Phase 3A)
    WHEN 'organization.direct_care_settings.updated' THEN PERFORM handle_organization_direct_care_settings_updated(p_event);

    -- Bootstrap
    WHEN 'bootstrap.completed' THEN PERFORM handle_bootstrap_completed(p_event);
    WHEN 'bootstrap.failed' THEN PERFORM handle_bootstrap_failed(p_event);
    WHEN 'bootstrap.cancelled' THEN PERFORM handle_bootstrap_cancelled(p_event);

    -- Invitations
    WHEN 'user.invited' THEN PERFORM handle_user_invited(p_event);
    WHEN 'invitation.resent' THEN PERFORM handle_invitation_resent(p_event);

    ELSE
      RAISE WARNING 'Unknown organization event type: %', p_event.event_type;
  END CASE;
END;
$$;

COMMENT ON FUNCTION process_organization_event(record) IS
'Organization event router v3 - dispatches to individual handler functions.

Handlers:
- Lifecycle: handle_organization_created/updated/deactivated/reactivated/deleted
- Subdomain: handle_organization_subdomain_status_changed/verified/dns_created/failed
- Direct Care (Phase 3A): handle_organization_direct_care_settings_updated
- Bootstrap: handle_bootstrap_completed/failed/cancelled
- Invitations: handle_user_invited, handle_invitation_resent';

-- =============================================================================
-- UPDATE organization trigger to include direct_care_settings event
-- =============================================================================
-- Note: The organization trigger filters on aggregate_type, so we need to check
-- if there's a trigger that needs updating. Organization events typically go
-- through the main domain_events trigger which filters by aggregate_type.

-- First, let's check what triggers exist and add the new event type if needed.
-- The main event router uses aggregate_type, so no trigger update needed.
