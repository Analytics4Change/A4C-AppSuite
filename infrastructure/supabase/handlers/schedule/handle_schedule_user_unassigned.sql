CREATE OR REPLACE FUNCTION public.handle_schedule_user_unassigned(p_event record)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE
    v_template_id uuid;
BEGIN
    v_template_id := (p_event.event_data->>'template_id')::uuid;

    DELETE FROM schedule_user_assignments_projection
    WHERE schedule_template_id = v_template_id
      AND user_id = (p_event.event_data->>'user_id')::uuid;

    -- Recount assigned users (idempotent — handles replay where row already deleted)
    UPDATE schedule_templates_projection
    SET assigned_user_count = (
        SELECT count(*)::integer FROM schedule_user_assignments_projection
        WHERE schedule_template_id = v_template_id
    )
    WHERE id = v_template_id;
END;
$function$;
