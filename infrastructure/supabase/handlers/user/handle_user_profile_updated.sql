CREATE OR REPLACE FUNCTION public.handle_user_profile_updated(p_event record)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE
    v_user_id uuid;
    v_first_name text;
    v_last_name text;
BEGIN
    v_user_id := (p_event.event_data->>'user_id')::uuid;
    v_first_name := p_event.event_data->>'first_name';
    v_last_name := p_event.event_data->>'last_name';

    -- Partial update via COALESCE: NULL values in event_data preserve the
    -- existing column value. Matches the partial-update semantics of
    -- api.update_user, which accepts p_first_name/p_last_name as DEFAULT NULL.
    UPDATE public.users
    SET
        first_name = COALESCE(v_first_name, first_name),
        last_name  = COALESCE(v_last_name, last_name),
        updated_at = NOW()
    WHERE id = v_user_id;

    -- Note: no IF NOT FOUND raise. The users row is created on signup; if
    -- it's missing, that's a more serious issue that earlier handlers would
    -- have surfaced. The api.update_user pre-emit guard already validates
    -- the user exists in the org (via user_roles_projection check); this
    -- handler runs after that guard.
END;
$function$;
