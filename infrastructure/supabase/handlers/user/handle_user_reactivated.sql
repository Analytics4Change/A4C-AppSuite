CREATE OR REPLACE FUNCTION public.handle_user_reactivated(p_event record)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
BEGIN
    UPDATE public.users
       SET is_active = true,
           updated_at = p_event.created_at
     WHERE id = p_event.stream_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'User not found' USING ERRCODE = 'P0002';
    END IF;
END;
$function$;
