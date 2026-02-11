CREATE OR REPLACE FUNCTION public.handle_role_permission_granted(p_event record)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
BEGIN
  INSERT INTO role_permissions_projection (
    role_id, permission_id, granted_at
  ) VALUES (
    p_event.stream_id,
    (p_event.event_data->>'permission_id')::UUID,
    p_event.created_at
  ) ON CONFLICT (role_id, permission_id) DO NOTHING;
END;
$function$;
