-- ===========================================================================
-- Fix user.invited event routing + invitations_projection CHECK constraint
-- ===========================================================================
--
-- Bug 1: user.invited events emitted with stream_type='user' but
--         process_user_event() had no CASE for it. The ELSE clause raised
--         EXCEPTION (P9001), leaving the event with processing_error and
--         invitations_projection never populated.
--
-- Bug 2: chk_invitation_status CHECK constraint on invitations_projection
--         allowed ('pending','accepted','expired','deleted') but NOT 'revoked'.
--         invitation.revoked handler sets status='revoked', which would violate
--         the constraint.
--
-- Both bugs are pre-existing conditions exposed by the CQRS remediation
-- (P0 migration upgraded ELSE from WARNING to EXCEPTION; P1 migration added
-- invitation.revoked handler).
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- Section 1: Add 'user.invited' CASE to process_user_event()
-- ---------------------------------------------------------------------------
-- The handle_user_invited() function already exists (baseline line 7477)
-- with correct INSERT INTO invitations_projection + ON CONFLICT idempotency.
-- We just need to wire it into the user event router.

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

    -- Access dates (fixed in P0: underscore to match emitted event type)
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

    -- Invitations (FIX: was missing, caused P9001 exception for stream_type='user')
    WHEN 'user.invited' THEN PERFORM handle_user_invited(p_event);

    -- Unhandled event type
    ELSE
      RAISE EXCEPTION 'Unhandled event type "%" in process_user_event', p_event.event_type
        USING ERRCODE = 'P9001';
  END CASE;
END;
$$;

-- ---------------------------------------------------------------------------
-- Section 2: Fix CHECK constraint to include 'revoked'
-- ---------------------------------------------------------------------------

ALTER TABLE invitations_projection
  DROP CONSTRAINT IF EXISTS chk_invitation_status;

ALTER TABLE invitations_projection
  ADD CONSTRAINT chk_invitation_status
  CHECK (status = ANY (ARRAY['pending', 'accepted', 'expired', 'deleted', 'revoked']));

-- ---------------------------------------------------------------------------
-- Section 3: Reprocess any stuck user.invited events
-- ---------------------------------------------------------------------------
-- Clears processing_error and processed_at, which re-triggers the
-- BEFORE INSERT OR UPDATE trigger (process_domain_event). The router fix
-- above takes effect immediately within this transaction.
--
-- Currently matches 0 rows (verified 2026-02-08). Included as safety net
-- in case events were emitted between trigger removal and this fix.

UPDATE domain_events
SET processing_error = NULL, processed_at = NULL
WHERE event_type = 'user.invited'
  AND stream_type = 'user'
  AND processing_error IS NOT NULL;
