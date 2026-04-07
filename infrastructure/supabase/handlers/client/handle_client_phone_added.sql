CREATE OR REPLACE FUNCTION public.handle_client_phone_added(p_event record)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
BEGIN
    INSERT INTO client_phones_projection (
        id, client_id, organization_id, phone_number, phone_type, is_primary,
        is_active, created_at, updated_at, last_event_id
    ) VALUES (
        (p_event.event_data->>'phone_id')::uuid,
        p_event.stream_id,
        (p_event.event_data->>'organization_id')::uuid,
        p_event.event_data->>'phone_number',
        COALESCE(p_event.event_data->>'phone_type', 'mobile'),
        COALESCE((p_event.event_data->>'is_primary')::boolean, false),
        true,
        p_event.created_at,
        p_event.created_at,
        p_event.id
    ) ON CONFLICT (client_id, phone_number) DO UPDATE SET
        phone_type = EXCLUDED.phone_type,
        is_primary = EXCLUDED.is_primary,
        is_active = true,
        updated_at = EXCLUDED.updated_at,
        last_event_id = EXCLUDED.last_event_id;
END;
$function$;
