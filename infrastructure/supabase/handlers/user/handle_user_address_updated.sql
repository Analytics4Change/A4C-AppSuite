CREATE OR REPLACE FUNCTION public.handle_user_address_updated(p_event record)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE
  v_address_id UUID;
  v_org_id UUID;
BEGIN
  v_address_id := (p_event.event_data->>'address_id')::UUID;
  v_org_id := (p_event.event_data->>'org_id')::UUID;

  IF v_org_id IS NULL THEN
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
    WHERE id = v_address_id;
  ELSE
    UPDATE user_org_address_overrides SET
      label = COALESCE(p_event.event_data->>'label', label),
      type = COALESCE((p_event.event_data->>'type')::address_type, type),
      street1 = COALESCE(p_event.event_data->>'street1', street1),
      street2 = p_event.event_data->>'street2',
      city = COALESCE(p_event.event_data->>'city', city),
      state = COALESCE(p_event.event_data->>'state', state),
      zip_code = COALESCE(p_event.event_data->>'zip_code', zip_code),
      country = COALESCE(p_event.event_data->>'country', country),
      is_active = COALESCE((p_event.event_data->>'is_active')::BOOLEAN, is_active),
      metadata = COALESCE(p_event.event_data->'metadata', metadata),
      updated_at = p_event.created_at
    WHERE id = v_address_id;
  END IF;
END;
$function$;
