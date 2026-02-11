CREATE OR REPLACE FUNCTION public.handle_organization_unit_reactivated(p_event record)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
BEGIN
  UPDATE organization_units_projection SET
    is_active = true,
    deactivated_at = NULL,
    updated_at = p_event.created_at
  WHERE path <@ (p_event.event_data->>'path')::ltree
    AND is_active = false
    AND deleted_at IS NULL;

  IF NOT FOUND THEN
    RAISE WARNING 'Organization unit % not found for reactivation event', p_event.stream_id;
  END IF;
END;
$function$;
