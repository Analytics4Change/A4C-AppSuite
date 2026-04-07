CREATE OR REPLACE FUNCTION public.handle_client_contact_unassigned(p_event record)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
BEGIN
    UPDATE client_contact_assignments_projection SET
        is_active = false,
        updated_at = p_event.created_at,
        last_event_id = p_event.id
    WHERE client_id = p_event.stream_id
      AND contact_id = (p_event.event_data->>'contact_id')::uuid
      AND designation = p_event.event_data->>'designation'
      AND organization_id = (p_event.event_data->>'organization_id')::uuid;
END;
$function$;
