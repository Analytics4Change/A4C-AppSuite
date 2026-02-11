CREATE OR REPLACE FUNCTION public.handle_role_permission_revoked(p_event record)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
BEGIN
  DELETE FROM role_permissions_projection
  WHERE role_id = p_event.stream_id
    AND permission_id = (p_event.event_data->>'permission_id')::UUID;
END;
$function$;
