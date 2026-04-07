CREATE OR REPLACE FUNCTION public.handle_client_admitted(p_event record)
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
        status = 'active',
        admission_date = COALESCE((p_event.event_data->>'admission_date')::date, admission_date),
        admission_type = COALESCE(p_event.event_data->>'admission_type', admission_type),
        level_of_care = CASE WHEN p_event.event_data ? 'level_of_care' THEN p_event.event_data->>'level_of_care' ELSE level_of_care END,
        expected_length_of_stay = CASE WHEN p_event.event_data ? 'expected_length_of_stay' THEN (p_event.event_data->>'expected_length_of_stay')::integer ELSE expected_length_of_stay END,
        initial_risk_level = CASE WHEN p_event.event_data ? 'initial_risk_level' THEN p_event.event_data->>'initial_risk_level' ELSE initial_risk_level END,
        organization_unit_id = CASE WHEN p_event.event_data ? 'organization_unit_id' THEN (p_event.event_data->>'organization_unit_id')::uuid ELSE organization_unit_id END,
        primary_diagnosis = CASE WHEN p_event.event_data ? 'primary_diagnosis' THEN p_event.event_data->'primary_diagnosis' ELSE primary_diagnosis END,
        updated_at = p_event.created_at,
        updated_by = v_user_id,
        last_event_id = p_event.id
    WHERE id = v_client_id
      AND organization_id = v_org_id;
END;
$function$;
