CREATE OR REPLACE FUNCTION public.handle_client_address_added(p_event record)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
BEGIN
    INSERT INTO client_addresses_projection (
        id, client_id, organization_id, address_type, street1, street2,
        city, state, zip, country, is_primary,
        is_active, created_at, updated_at, last_event_id
    ) VALUES (
        (p_event.event_data->>'address_id')::uuid,
        p_event.stream_id,
        (p_event.event_data->>'organization_id')::uuid,
        COALESCE(p_event.event_data->>'address_type', 'home'),
        p_event.event_data->>'street1',
        p_event.event_data->>'street2',
        p_event.event_data->>'city',
        p_event.event_data->>'state',
        p_event.event_data->>'zip',
        COALESCE(p_event.event_data->>'country', 'US'),
        COALESCE((p_event.event_data->>'is_primary')::boolean, false),
        true,
        p_event.created_at,
        p_event.created_at,
        p_event.id
    ) ON CONFLICT (client_id, address_type) DO UPDATE SET
        street1 = EXCLUDED.street1,
        street2 = EXCLUDED.street2,
        city = EXCLUDED.city,
        state = EXCLUDED.state,
        zip = EXCLUDED.zip,
        country = EXCLUDED.country,
        is_primary = EXCLUDED.is_primary,
        is_active = true,
        updated_at = EXCLUDED.updated_at,
        last_event_id = EXCLUDED.last_event_id;
END;
$function$;
