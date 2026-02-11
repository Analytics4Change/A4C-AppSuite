CREATE OR REPLACE FUNCTION public.handle_user_role_revoked(p_event record)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE
  v_role_name TEXT;
BEGIN
  SELECT name INTO v_role_name
  FROM roles_projection
  WHERE id = (p_event.event_data->>'role_id')::UUID;

  DELETE FROM user_roles_projection
  WHERE user_id = p_event.stream_id
    AND role_id = (p_event.event_data->>'role_id')::UUID;

  IF v_role_name IS NOT NULL THEN
    UPDATE users
    SET roles = array_remove(roles, v_role_name),
        updated_at = p_event.created_at
    WHERE id = p_event.stream_id;
  END IF;
END;
$function$;
