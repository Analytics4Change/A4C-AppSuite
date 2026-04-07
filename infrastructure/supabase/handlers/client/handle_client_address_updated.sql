CREATE OR REPLACE FUNCTION public.handle_client_address_updated(p_event record)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
BEGIN
    UPDATE client_addresses_projection SET
        address_type = COALESCE(p_event.event_data->>'address_type', address_type),
        street1 = COALESCE(p_event.event_data->>'street1', street1),
        street2 = CASE WHEN p_event.event_data ? 'street2' THEN p_event.event_data->>'street2' ELSE street2 END,
        city = COALESCE(p_event.event_data->>'city', city),
        state = COALESCE(p_event.event_data->>'state', state),
        zip = COALESCE(p_event.event_data->>'zip', zip),
        country = COALESCE(p_event.event_data->>'country', country),
        is_primary = CASE WHEN p_event.event_data ? 'is_primary' THEN (p_event.event_data->>'is_primary')::boolean ELSE is_primary END,
        updated_at = p_event.created_at,
        last_event_id = p_event.id
    WHERE id = (p_event.event_data->>'address_id')::uuid
      AND organization_id = (p_event.event_data->>'organization_id')::uuid;
END;
$function$;
