CREATE OR REPLACE FUNCTION public.handle_role_updated(p_event record)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
BEGIN
  UPDATE roles_projection SET
    name = COALESCE(p_event.event_data->>'name', name),
    description = COALESCE(p_event.event_data->>'description', description),
    updated_at = p_event.created_at
  WHERE id = p_event.stream_id;
END;
$function$;
