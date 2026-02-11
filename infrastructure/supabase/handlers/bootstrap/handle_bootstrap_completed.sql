CREATE OR REPLACE FUNCTION public.handle_bootstrap_completed(p_event record)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
BEGIN
  IF p_event.stream_id IS NOT NULL THEN
    UPDATE organizations_projection SET
      is_active = true,
      metadata = jsonb_set(
        COALESCE(metadata, '{}'),
        '{bootstrap}',
        jsonb_build_object(
          'bootstrap_id', p_event.event_data->>'bootstrap_id',
          'completed_at', p_event.created_at
        )
      ),
      updated_at = p_event.created_at
    WHERE id = p_event.stream_id;
  END IF;
END;
$function$;
