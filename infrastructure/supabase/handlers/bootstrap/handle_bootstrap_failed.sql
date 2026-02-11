CREATE OR REPLACE FUNCTION public.handle_bootstrap_failed(p_event record)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
BEGIN
  IF p_event.stream_id IS NOT NULL THEN
    UPDATE organizations_projection SET
      is_active = false,
      deactivated_at = p_event.created_at,
      deleted_at = p_event.created_at,
      metadata = jsonb_set(
        COALESCE(metadata, '{}'),
        '{bootstrap}',
        jsonb_build_object(
          'bootstrap_id', p_event.event_data->>'bootstrap_id',
          'failed_at', p_event.created_at,
          'error', p_event.event_data->>'error_message'
        )
      ),
      updated_at = p_event.created_at
    WHERE id = p_event.stream_id;
  END IF;
END;
$function$;
