CREATE OR REPLACE FUNCTION public.handle_schedule_deactivated(p_event record)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
BEGIN
    UPDATE schedule_templates_projection SET
        is_active = false,
        updated_at = p_event.created_at,
        last_event_id = p_event.id
    WHERE id = (p_event.event_data->>'template_id')::uuid;
END;
$function$;
