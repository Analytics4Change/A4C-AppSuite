CREATE OR REPLACE FUNCTION public.handle_schedule_user_assigned(p_event record)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
BEGIN
    INSERT INTO schedule_user_assignments_projection (
        schedule_template_id, user_id, organization_id,
        effective_from, effective_until,
        created_at, updated_at, last_event_id
    ) VALUES (
        (p_event.event_data->>'template_id')::uuid,
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
END;
$function$;
