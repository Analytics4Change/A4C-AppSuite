CREATE OR REPLACE FUNCTION public.process_schedule_event(p_event record)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
BEGIN
    CASE p_event.event_type
        -- Template lifecycle
        WHEN 'schedule.created'       THEN PERFORM handle_schedule_created(p_event);
        WHEN 'schedule.updated'       THEN PERFORM handle_schedule_updated(p_event);
        WHEN 'schedule.deactivated'   THEN PERFORM handle_schedule_deactivated(p_event);
        WHEN 'schedule.reactivated'   THEN PERFORM handle_schedule_reactivated(p_event);
        WHEN 'schedule.deleted'       THEN PERFORM handle_schedule_deleted(p_event);
        -- Assignment lifecycle
        WHEN 'schedule.user_assigned'   THEN PERFORM handle_schedule_user_assigned(p_event);
        WHEN 'schedule.user_unassigned' THEN PERFORM handle_schedule_user_unassigned(p_event);
        ELSE
            RAISE EXCEPTION 'Unhandled event type "%" in process_schedule_event', p_event.event_type
                USING ERRCODE = 'P9001';
    END CASE;
END;
$function$;
