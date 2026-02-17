CREATE OR REPLACE FUNCTION public.handle_schedule_updated(p_event record)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
BEGIN
    UPDATE schedule_templates_projection SET
        schedule_name = COALESCE(p_event.event_data->>'schedule_name', schedule_name),
        schedule = COALESCE(p_event.event_data->'schedule', schedule),
        org_unit_id = CASE
            WHEN p_event.event_data ? 'org_unit_id'
            THEN (p_event.event_data->>'org_unit_id')::uuid
            ELSE org_unit_id
        END,
        updated_at = p_event.created_at,
        last_event_id = p_event.id
    WHERE id = (p_event.event_data->>'template_id')::uuid;
END;
$function$;
