CREATE OR REPLACE FUNCTION public.handle_user_phone_added(p_event record)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
BEGIN
  -- Global user phones only (per-user org-override removed 2026-06; org_id always NULL).
  INSERT INTO user_phones (
    id, user_id, label, type, number, extension, country_code,
    is_primary, is_active, sms_capable, metadata, created_at, updated_at
  ) VALUES (
    (p_event.event_data->>'phone_id')::UUID,
    (p_event.event_data->>'user_id')::UUID,
    p_event.event_data->>'label',
    (p_event.event_data->>'type')::phone_type,
    p_event.event_data->>'number',
    p_event.event_data->>'extension',
    COALESCE(p_event.event_data->>'country_code', '+1'),
    COALESCE((p_event.event_data->>'is_primary')::BOOLEAN, false),
    COALESCE((p_event.event_data->>'is_active')::BOOLEAN, true),
    COALESCE((p_event.event_data->>'sms_capable')::BOOLEAN, false),
    COALESCE(p_event.event_data->'metadata', '{}'::jsonb),
    p_event.created_at,
    p_event.created_at
  ) ON CONFLICT (id) DO NOTHING;
END;
$function$;
