CREATE OR REPLACE FUNCTION public.handle_user_schedule_deleted(p_event record)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
BEGIN
  DELETE FROM user_schedule_policies_projection
  WHERE id = (p_event.event_data->>'schedule_id')::uuid
    AND organization_id = (p_event.event_data->>'organization_id')::uuid
    AND is_active = false;
END;
$function$;
