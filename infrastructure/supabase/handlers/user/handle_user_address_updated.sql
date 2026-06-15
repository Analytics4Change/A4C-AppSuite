CREATE OR REPLACE FUNCTION public.handle_user_address_updated(p_event record)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
BEGIN
  -- Global user addresses only (per-user org-override removed 2026-06).
  UPDATE user_addresses SET
    label = COALESCE(p_event.event_data->>'label', label),
    type = COALESCE((p_event.event_data->>'type')::address_type, type),
    street1 = COALESCE(p_event.event_data->>'street1', street1),
    street2 = p_event.event_data->>'street2',
    city = COALESCE(p_event.event_data->>'city', city),
    state = COALESCE(p_event.event_data->>'state', state),
    zip_code = COALESCE(p_event.event_data->>'zip_code', zip_code),
    country = COALESCE(p_event.event_data->>'country', country),
    is_primary = COALESCE((p_event.event_data->>'is_primary')::BOOLEAN, is_primary),
    is_active = COALESCE((p_event.event_data->>'is_active')::BOOLEAN, is_active),
    metadata = COALESCE(p_event.event_data->'metadata', metadata),
    updated_at = p_event.created_at
  WHERE id = (p_event.event_data->>'address_id')::UUID;
END;
$function$;
