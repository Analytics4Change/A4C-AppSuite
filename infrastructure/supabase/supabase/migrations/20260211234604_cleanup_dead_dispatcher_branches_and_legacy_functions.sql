-- ============================================================================
-- Migration: Clean up dead dispatcher CASE branches and legacy functions
-- ============================================================================
-- Removes:
--   1. 4 dead CASE branches in process_domain_event() for stream_types that
--      have no corresponding router function (client, medication,
--      medication_history, dosage). These now hit the ELSE RAISE EXCEPTION path.
--   2. 3 dead CASE lines in process_user_event() for handler functions that
--      don't exist (handle_user_deactivated, handle_user_reactivated,
--      handle_user_organization_switched).
--   3. 2 legacy functions: process_rbac_events (plural, superseded by
--      process_rbac_event) and process_program_event (not dispatched).
-- ============================================================================

-- 1. Replace process_domain_event() — remove 4 dead stream_type branches
CREATE OR REPLACE FUNCTION public.process_domain_event()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE
  v_error_msg TEXT;
  v_error_detail TEXT;
BEGIN
  -- Skip already-processed events (idempotency)
  IF NEW.processed_at IS NOT NULL THEN
    RETURN NEW;
  END IF;

  BEGIN
    IF NEW.event_type LIKE '%.linked' OR NEW.event_type LIKE '%.unlinked' THEN
      PERFORM process_junction_event(NEW);
    ELSE
      CASE NEW.stream_type
        WHEN 'role' THEN PERFORM process_rbac_event(NEW);
        WHEN 'permission' THEN PERFORM process_rbac_event(NEW);
        WHEN 'user' THEN PERFORM process_user_event(NEW);
        WHEN 'organization' THEN PERFORM process_organization_event(NEW);
        WHEN 'organization_unit' THEN PERFORM process_organization_unit_event(NEW);
        WHEN 'contact' THEN PERFORM process_contact_event(NEW);
        WHEN 'address' THEN PERFORM process_address_event(NEW);
        WHEN 'phone' THEN PERFORM process_phone_event(NEW);
        WHEN 'email' THEN PERFORM process_email_event(NEW);
        WHEN 'invitation' THEN PERFORM process_invitation_event(NEW);
        WHEN 'access_grant' THEN PERFORM process_access_grant_event(NEW);
        WHEN 'impersonation' THEN PERFORM process_impersonation_event(NEW);
        -- Administrative stream_types — No projection needed
        WHEN 'platform_admin' THEN NULL;
        WHEN 'workflow_queue' THEN NULL;
        WHEN 'test' THEN NULL;
        ELSE
          RAISE EXCEPTION 'Unknown stream_type "%" for event %', NEW.stream_type, NEW.id
            USING ERRCODE = 'P9002';
      END CASE;
    END IF;

    NEW.processed_at = clock_timestamp();
    NEW.processing_error = NULL;

  EXCEPTION
    WHEN OTHERS THEN
      GET STACKED DIAGNOSTICS v_error_msg = MESSAGE_TEXT, v_error_detail = PG_EXCEPTION_DETAIL;
      RAISE WARNING 'Event processing error for event %: % - %', NEW.id, v_error_msg, COALESCE(v_error_detail, '');
      NEW.processing_error = v_error_msg || ' - ' || COALESCE(v_error_detail, '');
  END;

  RETURN NEW;
END;
$function$;

-- 2. Replace process_user_event() — remove 3 dead handler references
CREATE OR REPLACE FUNCTION public.process_user_event(p_event record)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
BEGIN
  CASE p_event.event_type
    -- User lifecycle
    WHEN 'user.created' THEN PERFORM handle_user_created(p_event);
    WHEN 'user.synced_from_auth' THEN PERFORM handle_user_synced_from_auth(p_event);

    -- Role assignments
    WHEN 'user.role.assigned' THEN PERFORM handle_user_role_assigned(p_event);
    WHEN 'user.role.revoked' THEN PERFORM handle_user_role_revoked(p_event);

    -- Access dates
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

    -- Invitations
    WHEN 'user.invited' THEN PERFORM handle_user_invited(p_event);

    -- Unhandled event type
    ELSE
      RAISE EXCEPTION 'Unhandled event type "%" in process_user_event', p_event.event_type
        USING ERRCODE = 'P9001';
  END CASE;
END;
$function$;

-- 3. Drop legacy functions
-- process_rbac_events uses domain_events type param (not record)
DROP FUNCTION IF EXISTS public.process_rbac_events(domain_events);
DROP FUNCTION IF EXISTS public.process_rbac_events(record);
DROP FUNCTION IF EXISTS public.process_program_event(domain_events);
DROP FUNCTION IF EXISTS public.process_program_event(record);
