-- Migration: Add user.role.revoked event routing and fix handler
--
-- Purpose: Complete the role revocation flow for Phase 6.2 (Role Reassignment)
--
-- Changes:
-- 1. Update handle_user_role_revoked to also update users.roles array
-- 2. Add routing case for user.role.revoked in process_user_event
--
-- The handler was created in 20260119212104_split_event_handlers.sql but:
-- - Routing was missing from process_user_event
-- - users.roles array was not being updated

-- =============================================================================
-- 1. Update handle_user_role_revoked to also update users.roles array
-- =============================================================================
CREATE OR REPLACE FUNCTION handle_user_role_revoked(p_event record)
RETURNS void
LANGUAGE plpgsql
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_role_name TEXT;
BEGIN
  -- Look up the role name for updating users.roles array
  SELECT name INTO v_role_name
  FROM roles_projection
  WHERE id = (p_event.event_data->>'role_id')::UUID;

  -- Delete from user_roles_projection
  DELETE FROM user_roles_projection
  WHERE user_id = p_event.stream_id
    AND role_id = (p_event.event_data->>'role_id')::UUID;

  -- Update users.roles array (remove role_name)
  IF v_role_name IS NOT NULL THEN
    UPDATE users
    SET
      roles = array_remove(roles, v_role_name),
      updated_at = p_event.created_at
    WHERE id = p_event.stream_id;
  END IF;
END;
$$;

COMMENT ON FUNCTION handle_user_role_revoked(record) IS
'Handles user.role.revoked events. Removes role from user_roles_projection
and updates the users.roles denormalized array.';

-- =============================================================================
-- 2. Update process_user_event router to include user.role.revoked case
-- =============================================================================
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

    ELSE
      RAISE WARNING 'Unknown user event type: %', p_event.event_type;
  END CASE;
END;
$$;

COMMENT ON FUNCTION process_user_event(record) IS
'User event router v5 - dispatches to individual handler functions.
Handlers: handle_user_created, handle_user_synced_from_auth,
handle_user_role_assigned, handle_user_role_revoked,
handle_user_access_dates_updated, handle_user_notification_preferences_updated,
handle_user_address_added/updated/removed, handle_user_phone_added/updated/removed';
