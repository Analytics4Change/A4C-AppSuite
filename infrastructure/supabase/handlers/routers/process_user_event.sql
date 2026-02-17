CREATE OR REPLACE FUNCTION public.process_user_event(p_event record)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
BEGIN
    CASE p_event.event_type
        -- User lifecycle
        WHEN 'user.synced_from_auth'                THEN PERFORM handle_user_synced_from_auth(p_event);
        WHEN 'user.created'                         THEN PERFORM handle_user_created(p_event);
        WHEN 'user.profile.updated'                 THEN PERFORM handle_user_profile_updated(p_event);
        WHEN 'user.organization_switched'            THEN PERFORM handle_user_organization_switched(p_event);
        WHEN 'user.deactivated'                      THEN PERFORM handle_user_deactivated(p_event);
        WHEN 'user.reactivated'                      THEN PERFORM handle_user_reactivated(p_event);
        WHEN 'user.deleted'                          THEN PERFORM handle_user_deleted(p_event);
        -- Contact information
        WHEN 'user.phone.added'                      THEN PERFORM handle_user_phone_added(p_event);
        WHEN 'user.phone.updated'                    THEN PERFORM handle_user_phone_updated(p_event);
        WHEN 'user.phone.removed'                    THEN PERFORM handle_user_phone_removed(p_event);
        WHEN 'user.address.added'                    THEN PERFORM handle_user_address_added(p_event);
        WHEN 'user.address.updated'                  THEN PERFORM handle_user_address_updated(p_event);
        WHEN 'user.address.removed'                  THEN PERFORM handle_user_address_removed(p_event);
        -- Access / preferences
        WHEN 'user.access_dates.updated'             THEN PERFORM handle_user_access_dates_updated(p_event);
        WHEN 'user.notification_preferences.updated' THEN PERFORM handle_user_notification_preferences_updated(p_event);
        -- Client assignments
        WHEN 'user.client.assigned'                  THEN PERFORM handle_user_client_assigned(p_event);
        WHEN 'user.client.unassigned'                THEN PERFORM handle_user_client_unassigned(p_event);
        ELSE
            RAISE EXCEPTION 'Unhandled event type "%" in process_user_event', p_event.event_type
                USING ERRCODE = 'P9001';
    END CASE;
END;
$function$;
