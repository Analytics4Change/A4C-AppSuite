CREATE OR REPLACE FUNCTION public.handle_client_funding_source_added(p_event record)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
BEGIN
    INSERT INTO client_funding_sources_projection (
        id, client_id, organization_id, source_type, source_name, reference_number,
        start_date, end_date, custom_fields,
        is_active, created_at, updated_at, last_event_id
    ) VALUES (
        (p_event.event_data->>'funding_source_id')::uuid,
        p_event.stream_id,
        (p_event.event_data->>'organization_id')::uuid,
        p_event.event_data->>'source_type',
        p_event.event_data->>'source_name',
        p_event.event_data->>'reference_number',
        (p_event.event_data->>'start_date')::date,
        (p_event.event_data->>'end_date')::date,
        COALESCE(p_event.event_data->'custom_fields', '{}'::jsonb),
        true,
        p_event.created_at,
        p_event.created_at,
        p_event.id
    ) ON CONFLICT ON CONSTRAINT client_funding_sources_projection_pkey DO UPDATE SET
        source_type = EXCLUDED.source_type,
        source_name = EXCLUDED.source_name,
        reference_number = EXCLUDED.reference_number,
        start_date = EXCLUDED.start_date,
        end_date = EXCLUDED.end_date,
        custom_fields = EXCLUDED.custom_fields,
        is_active = true,
        updated_at = EXCLUDED.updated_at,
        last_event_id = EXCLUDED.last_event_id;
END;
$function$;
