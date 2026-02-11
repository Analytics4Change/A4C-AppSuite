CREATE OR REPLACE FUNCTION public.handle_permission_defined(p_event record)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
BEGIN
  INSERT INTO permissions_projection (
    id, applet, action, description, scope_type, requires_mfa, created_at
  ) VALUES (
    p_event.stream_id,
    p_event.event_data->>'applet',
    p_event.event_data->>'action',
    p_event.event_data->>'description',
    p_event.event_data->>'scope_type',
    COALESCE((p_event.event_data->>'requires_mfa')::BOOLEAN, false),
    p_event.created_at
  ) ON CONFLICT (id) DO UPDATE SET
    description = EXCLUDED.description,
    scope_type = EXCLUDED.scope_type,
    requires_mfa = EXCLUDED.requires_mfa;
END;
$function$;
