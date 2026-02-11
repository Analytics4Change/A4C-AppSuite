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
