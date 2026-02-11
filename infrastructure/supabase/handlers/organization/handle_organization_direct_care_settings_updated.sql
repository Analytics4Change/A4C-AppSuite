CREATE OR REPLACE FUNCTION public.handle_organization_direct_care_settings_updated(p_event record)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
BEGIN
  UPDATE organizations_projection SET
    direct_care_settings = p_event.event_data->'settings',
    updated_at = p_event.created_at
  WHERE id = p_event.stream_id;
END;
$function$;
