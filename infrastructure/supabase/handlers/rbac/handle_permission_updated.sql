CREATE OR REPLACE FUNCTION public.handle_permission_updated(p_event record)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
BEGIN
  UPDATE permissions_projection SET
    description = COALESCE(p_event.event_data->>'description', description),
    scope_type = COALESCE(p_event.event_data->>'scope_type', scope_type),
    requires_mfa = COALESCE(
      (p_event.event_data->>'requires_mfa')::boolean,
      requires_mfa
    )
  WHERE id = p_event.stream_id;
END;
$function$;
