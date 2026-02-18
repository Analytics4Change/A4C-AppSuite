CREATE OR REPLACE FUNCTION public.handle_schedule_user_assigned(p_event record)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE
    v_template_id uuid;
BEGIN
    v_template_id := (p_event.event_data->>'template_id')::uuid;

    INSERT INTO schedule_user_assignments_projection (
        schedule_template_id, user_id, organization_id,
        effective_from, effective_until,
        created_at, updated_at, last_event_id
    ) VALUES (
        v_template_id,
        (p_event.event_data->>'user_id')::uuid,
        (p_event.event_data->>'organization_id')::uuid,
        (p_event.event_data->>'effective_from')::date,
        (p_event.event_data->>'effective_until')::date,
        p_event.created_at,
        p_event.created_at,
        p_event.id
    ) ON CONFLICT (schedule_template_id, user_id) DO UPDATE SET
        effective_from = EXCLUDED.effective_from,
        effective_until = EXCLUDED.effective_until,
        is_active = true,
        updated_at = p_event.created_at,
        last_event_id = p_event.id;

    -- Recount assigned users (idempotent — handles both INSERT and ON CONFLICT)
    UPDATE schedule_templates_projection
    SET assigned_user_count = (
        SELECT count(*)::integer FROM schedule_user_assignments_projection
        WHERE schedule_template_id = v_template_id
    )
    WHERE id = v_template_id;
END;
$function$;
