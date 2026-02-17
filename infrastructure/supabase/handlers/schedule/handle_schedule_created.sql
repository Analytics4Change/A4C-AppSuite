CREATE OR REPLACE FUNCTION public.handle_schedule_created(p_event record)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE
    v_template_id uuid;
    v_user_id uuid;
    v_user_ids jsonb;
BEGIN
    v_template_id := (p_event.event_data->>'template_id')::uuid;

    -- Insert template
    INSERT INTO schedule_templates_projection (
        id, organization_id, org_unit_id, schedule_name, schedule,
        created_by, created_at, updated_at, last_event_id
    ) VALUES (
        v_template_id,
        (p_event.event_data->>'organization_id')::uuid,
        (p_event.event_data->>'org_unit_id')::uuid,
        p_event.event_data->>'schedule_name',
        p_event.event_data->'schedule',
        (p_event.event_data->>'created_by')::uuid,
        p_event.created_at,
        p_event.created_at,
        p_event.id
    ) ON CONFLICT (id) DO UPDATE SET
        schedule_name = EXCLUDED.schedule_name,
        schedule = EXCLUDED.schedule,
        org_unit_id = EXCLUDED.org_unit_id,
        updated_at = p_event.created_at,
        last_event_id = p_event.id;

    -- Create initial assignments if user_ids provided
    v_user_ids := p_event.event_data->'user_ids';
    IF v_user_ids IS NOT NULL AND jsonb_array_length(v_user_ids) > 0 THEN
        FOR v_user_id IN SELECT jsonb_array_elements_text(v_user_ids)::uuid
        LOOP
            INSERT INTO schedule_user_assignments_projection (
                schedule_template_id, user_id, organization_id,
                created_at, updated_at, last_event_id
            ) VALUES (
                v_template_id,
                v_user_id,
                (p_event.event_data->>'organization_id')::uuid,
                p_event.created_at,
                p_event.created_at,
                p_event.id
            ) ON CONFLICT (schedule_template_id, user_id) DO NOTHING;
        END LOOP;
    END IF;
END;
$function$;
