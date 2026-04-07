CREATE OR REPLACE FUNCTION public.handle_client_discharged(p_event record)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE
    v_client_id uuid;
    v_org_id uuid;
    v_user_id uuid;
BEGIN
    v_client_id := p_event.stream_id;
    v_org_id := (p_event.event_data->>'organization_id')::uuid;
    v_user_id := COALESCE(
        (p_event.event_metadata->>'user_id')::uuid,
        '00000000-0000-0000-0000-000000000000'::uuid
    );

    UPDATE clients_projection SET
        status = 'discharged',
        -- Mandatory discharge fields (Decision 78)
        discharge_date = (p_event.event_data->>'discharge_date')::date,
        discharge_outcome = p_event.event_data->>'discharge_outcome',
        discharge_reason = p_event.event_data->>'discharge_reason',
        -- Optional discharge fields
        discharge_diagnosis = CASE WHEN p_event.event_data ? 'discharge_diagnosis' THEN p_event.event_data->'discharge_diagnosis' ELSE discharge_diagnosis END,
        discharge_placement = CASE WHEN p_event.event_data ? 'discharge_placement' THEN p_event.event_data->>'discharge_placement' ELSE discharge_placement END,
        -- Audit
        updated_at = p_event.created_at,
        updated_by = v_user_id,
        last_event_id = p_event.id
    WHERE id = v_client_id
      AND organization_id = v_org_id;
END;
$function$;
