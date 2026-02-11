CREATE OR REPLACE FUNCTION public.handle_organization_unit_deleted(p_event record)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
BEGIN
  UPDATE organization_units_projection SET
    deleted_at = p_event.created_at,
    updated_at = p_event.created_at
  WHERE id = p_event.stream_id
    AND deleted_at IS NULL;

  IF NOT FOUND THEN
    RAISE WARNING 'Organization unit % not found or already deleted', p_event.stream_id;
  END IF;
END;
$function$;
