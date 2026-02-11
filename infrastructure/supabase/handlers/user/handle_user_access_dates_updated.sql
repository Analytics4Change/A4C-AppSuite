CREATE OR REPLACE FUNCTION public.handle_user_access_dates_updated(p_event record)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE
  v_user_id UUID;
  v_org_id UUID;
BEGIN
  v_user_id := (p_event.event_data->>'user_id')::UUID;
  v_org_id := (p_event.event_data->>'org_id')::UUID;

  UPDATE user_organizations_projection
  SET access_start_date = (p_event.event_data->>'access_start_date')::DATE,
      access_expiration_date = (p_event.event_data->>'access_expiration_date')::DATE,
      updated_at = p_event.created_at
  WHERE user_id = v_user_id AND org_id = v_org_id;

  IF NOT FOUND THEN
    INSERT INTO user_organizations_projection (
      user_id, org_id, access_start_date, access_expiration_date, created_at, updated_at
    ) VALUES (
      v_user_id,
      v_org_id,
      (p_event.event_data->>'access_start_date')::DATE,
      (p_event.event_data->>'access_expiration_date')::DATE,
      p_event.created_at,
      p_event.created_at
    );
  END IF;
END;
$function$;
