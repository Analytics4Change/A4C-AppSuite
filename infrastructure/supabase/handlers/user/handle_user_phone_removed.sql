CREATE OR REPLACE FUNCTION public.handle_user_phone_removed(p_event record)
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

  IF p_event.event_data->>'removal_type' = 'hard_delete' THEN
    IF v_org_id IS NULL THEN
      DELETE FROM user_phones WHERE id = v_phone_id;
    ELSE
      DELETE FROM user_org_phone_overrides WHERE id = v_phone_id;
    END IF;
  ELSE
    IF v_org_id IS NULL THEN
      UPDATE user_phones
      SET is_active = false, updated_at = p_event.created_at
      WHERE id = v_phone_id;
    ELSE
      UPDATE user_org_phone_overrides
      SET is_active = false, updated_at = p_event.created_at
      WHERE id = v_phone_id;
    END IF;
  END IF;
END;
$function$;
