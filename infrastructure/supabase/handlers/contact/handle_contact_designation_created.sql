CREATE OR REPLACE FUNCTION public.handle_contact_designation_created(p_event record)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
BEGIN
    INSERT INTO contact_designations_projection (
        id, contact_id, designation, organization_id,
        is_active, created_at, updated_at, last_event_id
    ) VALUES (
        (p_event.event_data->>'designation_id')::uuid,
        p_event.stream_id,
        p_event.event_data->>'designation',
        (p_event.event_data->>'organization_id')::uuid,
        true,
        p_event.created_at,
        p_event.created_at,
        p_event.id
    ) ON CONFLICT (contact_id, designation, organization_id) DO UPDATE SET
        is_active = true,
        updated_at = EXCLUDED.updated_at,
        last_event_id = EXCLUDED.last_event_id;
END;
$function$;
