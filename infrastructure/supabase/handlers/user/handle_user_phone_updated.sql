CREATE OR REPLACE FUNCTION public.handle_user_phone_updated(p_event record)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE
  v_phone_id UUID;
  v_org_id UUID;
BEGIN
  v_phone_id := (p_event.event_data->>'phone_id')::UUID;
  v_org_id := (p_event.event_data->>'org_id')::UUID;

  IF v_org_id IS NULL THEN
    UPDATE user_phones SET
      label = COALESCE(p_event.event_data->>'label', label),
      type = COALESCE((p_event.event_data->>'type')::phone_type, type),
      number = COALESCE(p_event.event_data->>'number', number),
      extension = p_event.event_data->>'extension',
      country_code = COALESCE(p_event.event_data->>'country_code', country_code),
      is_primary = COALESCE((p_event.event_data->>'is_primary')::BOOLEAN, is_primary),
      is_active = COALESCE((p_event.event_data->>'is_active')::BOOLEAN, is_active),
      sms_capable = COALESCE((p_event.event_data->>'sms_capable')::BOOLEAN, sms_capable),
      metadata = COALESCE(p_event.event_data->'metadata', metadata),
      updated_at = p_event.created_at
    WHERE id = v_phone_id;
  ELSE
    UPDATE user_org_phone_overrides SET
      label = COALESCE(p_event.event_data->>'label', label),
      type = COALESCE((p_event.event_data->>'type')::phone_type, type),
      number = COALESCE(p_event.event_data->>'number', number),
      extension = p_event.event_data->>'extension',
      country_code = COALESCE(p_event.event_data->>'country_code', country_code),
      is_active = COALESCE((p_event.event_data->>'is_active')::BOOLEAN, is_active),
      sms_capable = COALESCE((p_event.event_data->>'sms_capable')::BOOLEAN, sms_capable),
      metadata = COALESCE(p_event.event_data->'metadata', metadata),
      updated_at = p_event.created_at
    WHERE id = v_phone_id;
  END IF;
END;
$function$;
