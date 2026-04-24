CREATE OR REPLACE FUNCTION public.handle_user_deleted(p_event record)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
BEGIN
    -- COALESCE order: existing tombstone wins (replay-safe), then event
    -- payload's deleted_at, then event creation time as final fallback.
    UPDATE public.users
       SET deleted_at = COALESCE(
             deleted_at,
             (p_event.event_data->>'deleted_at')::timestamptz,
             p_event.created_at
           ),
           is_active = false,
           updated_at = p_event.created_at
     WHERE id = p_event.stream_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'User not found' USING ERRCODE = 'P0002';
    END IF;
END;
$function$;
