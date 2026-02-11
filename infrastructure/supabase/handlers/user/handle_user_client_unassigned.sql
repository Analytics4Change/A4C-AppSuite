CREATE OR REPLACE FUNCTION public.handle_user_client_unassigned(p_event record)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
BEGIN
  UPDATE user_client_assignments_projection SET
    is_active = false,
    assigned_until = now(),
    updated_at = now(),
    last_event_id = p_event.id
  WHERE user_id = p_event.aggregate_id
    AND client_id = (p_event.event_data->>'client_id')::uuid;
END;
$function$;
