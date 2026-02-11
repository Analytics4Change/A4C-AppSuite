CREATE OR REPLACE FUNCTION public.handle_user_address_added(p_event record)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE
  v_user_id UUID;
  v_address_id UUID;
  v_org_id UUID;
BEGIN
  v_user_id := (p_event.event_data->>'user_id')::UUID;
  v_address_id := (p_event.event_data->>'address_id')::UUID;
  v_org_id := (p_event.event_data->>'org_id')::UUID;

  IF v_org_id IS NULL THEN
    INSERT INTO user_addresses (
      id, user_id, label, type, street1, street2, city, state, zip_code, country,
      is_primary, is_active, metadata, created_at, updated_at
    ) VALUES (
      v_address_id,
      v_user_id,
      p_event.event_data->>'label',
      (p_event.event_data->>'type')::address_type,
      p_event.event_data->>'street1',
      p_event.event_data->>'street2',
      p_event.event_data->>'city',
      p_event.event_data->>'state',
      p_event.event_data->>'zip_code',
      COALESCE(p_event.event_data->>'country', 'USA'),
      COALESCE((p_event.event_data->>'is_primary')::BOOLEAN, false),
      COALESCE((p_event.event_data->>'is_active')::BOOLEAN, true),
      COALESCE(p_event.event_data->'metadata', '{}'::jsonb),
      p_event.created_at,
      p_event.created_at
    ) ON CONFLICT (id) DO NOTHING;
  ELSE
    INSERT INTO user_org_address_overrides (
      id, user_id, org_id, label, type, street1, street2, city, state, zip_code, country,
      is_active, metadata, created_at, updated_at
    ) VALUES (
      v_address_id,
      v_user_id,
      v_org_id,
      p_event.event_data->>'label',
      (p_event.event_data->>'type')::address_type,
      p_event.event_data->>'street1',
      p_event.event_data->>'street2',
      p_event.event_data->>'city',
      p_event.event_data->>'state',
      p_event.event_data->>'zip_code',
      COALESCE(p_event.event_data->>'country', 'USA'),
      COALESCE((p_event.event_data->>'is_active')::BOOLEAN, true),
      COALESCE(p_event.event_data->'metadata', '{}'::jsonb),
      p_event.created_at,
      p_event.created_at
    ) ON CONFLICT (id) DO NOTHING;
  END IF;
END;
$function$;
