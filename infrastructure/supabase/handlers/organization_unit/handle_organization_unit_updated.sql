CREATE OR REPLACE FUNCTION public.handle_organization_unit_updated(p_event record)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
BEGIN
  UPDATE organization_units_projection SET
    name = COALESCE(safe_jsonb_extract_text(p_event.event_data, 'name'), name),
    display_name = COALESCE(safe_jsonb_extract_text(p_event.event_data, 'display_name'), display_name),
    timezone = COALESCE(safe_jsonb_extract_text(p_event.event_data, 'timezone'), timezone),
    updated_at = p_event.created_at
  WHERE id = p_event.stream_id;

  IF NOT FOUND THEN
    RAISE WARNING 'Organization unit % not found for update event', p_event.stream_id;
  END IF;
END;
$function$;
