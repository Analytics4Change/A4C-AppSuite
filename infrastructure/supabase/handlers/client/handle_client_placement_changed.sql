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
    v_new_ou_id uuid;
    v_current_placement_id uuid;
BEGIN
    v_client_id := p_event.stream_id;
    v_org_id := (p_event.event_data->>'organization_id')::uuid;
    v_new_placement := p_event.event_data->>'placement_arrangement';
    v_start_date := (p_event.event_data->>'start_date')::date;

    -- OU is optional on the event (historical events have no OU); cast is nullable-safe
    v_new_ou_id := NULLIF(p_event.event_data->>'organization_unit_id', '')::uuid;

    -- C4: Lock the existing current placement row (if any) before the transition.
    -- Concurrent placement events for the same client serialize here.
    SELECT id INTO v_current_placement_id
    FROM client_placement_history_projection
    WHERE client_id = v_client_id
      AND organization_id = v_org_id
      AND is_current = true
    FOR UPDATE;

    -- Close previous current placement (no-op if first placement)
    IF v_current_placement_id IS NOT NULL THEN
        UPDATE client_placement_history_projection SET
            is_current = false,
            end_date = v_start_date,
            updated_at = p_event.created_at,
            last_event_id = p_event.id
        WHERE id = v_current_placement_id;
    END IF;

    -- Insert new current placement (includes OU)
    INSERT INTO client_placement_history_projection (
        id, client_id, organization_id, placement_arrangement, start_date,
        is_current, reason, organization_unit_id,
        created_at, updated_at, last_event_id
    ) VALUES (
        (p_event.event_data->>'placement_id')::uuid,
        v_client_id,
        v_org_id,
        v_new_placement,
        v_start_date,
        true,
        p_event.event_data->>'reason',
        v_new_ou_id,
        p_event.created_at,
        p_event.created_at,
        p_event.id
    ) ON CONFLICT ON CONSTRAINT client_placement_history_projection_pkey DO UPDATE SET
        placement_arrangement = EXCLUDED.placement_arrangement,
        start_date = EXCLUDED.start_date,
        is_current = true,
        reason = EXCLUDED.reason,
        organization_unit_id = EXCLUDED.organization_unit_id,
        updated_at = EXCLUDED.updated_at,
        last_event_id = EXCLUDED.last_event_id;

    -- Denormalize current placement + OU onto clients_projection
    -- This is the SOLE mutation path for clients_projection.organization_unit_id
    -- after client creation (C3).
    UPDATE clients_projection SET
        placement_arrangement = v_new_placement,
        organization_unit_id = v_new_ou_id,
        updated_at = p_event.created_at,
        last_event_id = p_event.id
    WHERE id = v_client_id
      AND organization_id = v_org_id;
END;
$function$;
