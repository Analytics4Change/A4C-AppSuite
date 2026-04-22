CREATE OR REPLACE FUNCTION public.handle_client_placement_changed(p_event record)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE
    v_client_id uuid;
    v_org_id uuid;
    v_new_placement text;
    v_start_date date;
    v_ou_id uuid;
BEGIN
    v_client_id := p_event.stream_id;
    v_org_id := (p_event.event_data->>'organization_id')::uuid;
    v_new_placement := p_event.event_data->>'placement_arrangement';
    v_start_date := (p_event.event_data->>'start_date')::date;
    v_ou_id := (p_event.event_data->>'organization_unit_id')::uuid;

    -- Close previous current placement
    UPDATE client_placement_history_projection SET
        is_current = false,
        end_date = v_start_date,
        updated_at = p_event.created_at,
        last_event_id = p_event.id
    WHERE client_id = v_client_id
      AND organization_id = v_org_id
      AND is_current = true;

    -- Insert new current placement
    INSERT INTO client_placement_history_projection (
        id, client_id, organization_id, placement_arrangement, organization_unit_id, start_date,
        is_current, reason, created_at, updated_at, last_event_id
    ) VALUES (
        (p_event.event_data->>'placement_id')::uuid,
        v_client_id,
        v_org_id,
        v_new_placement,
        v_ou_id,
        v_start_date,
        true,
        p_event.event_data->>'reason',
        p_event.created_at,
        p_event.created_at,
        p_event.id
    ) ON CONFLICT ON CONSTRAINT client_placement_history_projection_pkey DO UPDATE SET
        placement_arrangement = EXCLUDED.placement_arrangement,
        organization_unit_id = EXCLUDED.organization_unit_id,
        start_date = EXCLUDED.start_date,
        is_current = true,
        reason = EXCLUDED.reason,
        updated_at = EXCLUDED.updated_at,
        last_event_id = EXCLUDED.last_event_id;

    -- Denormalize current placement + OU onto clients_projection
    UPDATE clients_projection SET
        placement_arrangement = v_new_placement,
        organization_unit_id = v_ou_id,
        updated_at = p_event.created_at,
        last_event_id = p_event.id
    WHERE id = v_client_id
      AND organization_id = v_org_id;
END;
$function$;
