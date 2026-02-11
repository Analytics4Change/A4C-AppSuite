CREATE OR REPLACE FUNCTION public.handle_user_synced_from_auth(p_event record)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
BEGIN
  INSERT INTO users (id, email, name, is_active, created_at, updated_at)
  VALUES (
    (p_event.event_data->>'auth_user_id')::UUID,
    p_event.event_data->>'email',
    COALESCE(p_event.event_data->>'name', p_event.event_data->>'email'),
    COALESCE((p_event.event_data->>'is_active')::BOOLEAN, true),
    p_event.created_at,
    p_event.created_at
  ) ON CONFLICT (id) DO UPDATE SET
    email = EXCLUDED.email,
    name = COALESCE(EXCLUDED.name, users.name),
    is_active = EXCLUDED.is_active,
    updated_at = p_event.created_at;
END;
$function$;
