CREATE OR REPLACE FUNCTION public.handle_organization_deactivated(p_event record)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
BEGIN
  UPDATE organizations_projection SET
    is_active = false,
    deactivated_at = COALESCE(
      (p_event.event_data->>'deactivated_at')::timestamptz,
      p_event.created_at
    ),
    deleted_at = COALESCE(
      (p_event.event_data->>'deleted_at')::timestamptz,
      (p_event.event_data->>'deactivated_at')::timestamptz,
      p_event.created_at
    ),
    updated_at = p_event.created_at
  WHERE id = p_event.stream_id;
END;
$function$;
