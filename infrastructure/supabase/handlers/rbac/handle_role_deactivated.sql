CREATE OR REPLACE FUNCTION public.handle_role_deactivated(p_event record)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
BEGIN
  UPDATE roles_projection
  SET is_active = false,
      updated_at = p_event.created_at
  WHERE id = p_event.stream_id;
END;
$function$;
