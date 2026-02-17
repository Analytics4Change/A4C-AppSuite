CREATE OR REPLACE FUNCTION public.handle_schedule_deleted(p_event record)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
BEGIN
    -- CASCADE will delete assignments
    DELETE FROM schedule_templates_projection
    WHERE id = (p_event.event_data->>'template_id')::uuid
      AND is_active = false;
END;
$function$;
