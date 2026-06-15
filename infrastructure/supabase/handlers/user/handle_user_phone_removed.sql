CREATE OR REPLACE FUNCTION public.handle_user_phone_removed(p_event record)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE
  v_phone_id UUID := (p_event.event_data->>'phone_id')::UUID;
BEGIN
  -- Global user phones only (per-user org-override removed 2026-06).
  IF p_event.event_data->>'removal_type' = 'hard_delete' THEN
    DELETE FROM user_phones WHERE id = v_phone_id;
  ELSE
    UPDATE user_phones SET is_active = false, updated_at = p_event.created_at WHERE id = v_phone_id;
  END IF;
END;
$function$;
