CREATE OR REPLACE FUNCTION public.handle_client_placement_ended(p_event record)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
BEGIN
    UPDATE client_placement_history_projection SET
        is_current = false,
        end_date = COALESCE((p_event.event_data->>'end_date')::date, CURRENT_DATE),
        reason = COALESCE(p_event.event_data->>'reason', reason),
        updated_at = p_event.created_at,
        last_event_id = p_event.id
    WHERE client_id = p_event.stream_id
      AND organization_id = (p_event.event_data->>'organization_id')::uuid
      AND is_current = true;

    -- Clear denormalized placement on clients_projection
    UPDATE clients_projection SET
        placement_arrangement = NULL,
        updated_at = p_event.created_at,
        last_event_id = p_event.id
    WHERE id = p_event.stream_id
      AND organization_id = (p_event.event_data->>'organization_id')::uuid;
END;
$function$;
