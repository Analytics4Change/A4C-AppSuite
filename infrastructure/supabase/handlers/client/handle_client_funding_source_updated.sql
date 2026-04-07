CREATE OR REPLACE FUNCTION public.handle_client_funding_source_updated(p_event record)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
BEGIN
    UPDATE client_funding_sources_projection SET
        source_type = COALESCE(p_event.event_data->>'source_type', source_type),
        source_name = COALESCE(p_event.event_data->>'source_name', source_name),
        reference_number = CASE WHEN p_event.event_data ? 'reference_number' THEN p_event.event_data->>'reference_number' ELSE reference_number END,
        start_date = CASE WHEN p_event.event_data ? 'start_date' THEN (p_event.event_data->>'start_date')::date ELSE start_date END,
        end_date = CASE WHEN p_event.event_data ? 'end_date' THEN (p_event.event_data->>'end_date')::date ELSE end_date END,
        custom_fields = CASE WHEN p_event.event_data ? 'custom_fields' THEN custom_fields || p_event.event_data->'custom_fields' ELSE custom_fields END,
        updated_at = p_event.created_at,
        last_event_id = p_event.id
    WHERE id = (p_event.event_data->>'funding_source_id')::uuid
      AND organization_id = (p_event.event_data->>'organization_id')::uuid;
END;
$function$;
