CREATE OR REPLACE FUNCTION public.handle_schedule_user_unassigned(p_event record)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
BEGIN
    DELETE FROM schedule_user_assignments_projection
    WHERE schedule_template_id = (p_event.event_data->>'template_id')::uuid
      AND user_id = (p_event.event_data->>'user_id')::uuid;
END;
$function$;
