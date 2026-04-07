CREATE OR REPLACE FUNCTION public.handle_client_contact_assigned(p_event record)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
BEGIN
    INSERT INTO client_contact_assignments_projection (
        id, client_id, contact_id, organization_id, designation, assigned_at,
        is_active, created_at, updated_at, last_event_id
    ) VALUES (
        (p_event.event_data->>'assignment_id')::uuid,
        p_event.stream_id,
        (p_event.event_data->>'contact_id')::uuid,
        (p_event.event_data->>'organization_id')::uuid,
        p_event.event_data->>'designation',
        p_event.created_at,
        true,
        p_event.created_at,
        p_event.created_at,
        p_event.id
    ) ON CONFLICT (client_id, contact_id, designation) DO UPDATE SET
        is_active = true,
        assigned_at = EXCLUDED.assigned_at,
        updated_at = EXCLUDED.updated_at,
        last_event_id = EXCLUDED.last_event_id;
END;
$function$;
