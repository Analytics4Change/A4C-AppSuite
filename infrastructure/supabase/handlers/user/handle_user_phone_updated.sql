CREATE OR REPLACE FUNCTION public.handle_user_phone_updated(p_event record)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
BEGIN
  -- Global user phones only (per-user org-override removed 2026-06).
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
  WHERE id = (p_event.event_data->>'phone_id')::UUID;
END;
$function$;
