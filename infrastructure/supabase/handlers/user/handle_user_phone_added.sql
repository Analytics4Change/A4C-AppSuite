CREATE OR REPLACE FUNCTION public.handle_user_phone_added(p_event record)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE
  v_user_id UUID;
  v_phone_id UUID;
  v_org_id UUID;
BEGIN
  v_user_id := (p_event.event_data->>'user_id')::UUID;
  v_phone_id := (p_event.event_data->>'phone_id')::UUID;
  v_org_id := (p_event.event_data->>'org_id')::UUID;

  IF v_org_id IS NULL THEN
    INSERT INTO user_phones (
      id, user_id, label, type, number, extension, country_code,
      is_primary, is_active, sms_capable, metadata, created_at, updated_at
    ) VALUES (
      v_phone_id,
      v_user_id,
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
  ELSE
    INSERT INTO user_org_phone_overrides (
      id, user_id, org_id, label, type, number, extension, country_code,
      is_active, sms_capable, metadata, created_at, updated_at
    ) VALUES (
      v_phone_id,
      v_user_id,
      v_org_id,
      p_event.event_data->>'label',
      (p_event.event_data->>'type')::phone_type,
      p_event.event_data->>'number',
      p_event.event_data->>'extension',
      COALESCE(p_event.event_data->>'country_code', '+1'),
      COALESCE((p_event.event_data->>'is_active')::BOOLEAN, true),
      COALESCE((p_event.event_data->>'sms_capable')::BOOLEAN, false),
      COALESCE(p_event.event_data->'metadata', '{}'::jsonb),
      p_event.created_at,
      p_event.created_at
    ) ON CONFLICT (id) DO NOTHING;
  END IF;
END;
$function$;
