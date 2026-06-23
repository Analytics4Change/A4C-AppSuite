CREATE OR REPLACE FUNCTION public.handle_user_synced_from_auth(p_event record)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
BEGIN
  INSERT INTO users (id, email, name, is_active, correlation_id, created_at, updated_at)  -- correlation: anchor column
  VALUES (
    (p_event.event_data->>'auth_user_id')::UUID,
    p_event.event_data->>'email',
    COALESCE(p_event.event_data->>'name', p_event.event_data->>'email'),
    COALESCE((p_event.event_data->>'is_active')::BOOLEAN, true),
    p_event.correlation_id,  -- correlation: anchor from the user.synced_from_auth event
    p_event.created_at,
    p_event.created_at
  ) ON CONFLICT (id) DO UPDATE SET
    email = EXCLUDED.email,
    name = COALESCE(EXCLUDED.name, users.name),
    is_active = EXCLUDED.is_active,
    correlation_id = COALESCE(users.correlation_id, EXCLUDED.correlation_id),  -- correlation: keep-existing on replay
    updated_at = p_event.created_at;
END;
$function$;
