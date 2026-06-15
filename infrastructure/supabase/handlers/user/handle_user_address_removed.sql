CREATE OR REPLACE FUNCTION public.handle_user_address_removed(p_event record)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE
  v_address_id UUID := (p_event.event_data->>'address_id')::UUID;
BEGIN
  -- Global user addresses only (per-user org-override removed 2026-06).
  IF p_event.event_data->>'removal_type' = 'hard_delete' THEN
    DELETE FROM user_addresses WHERE id = v_address_id;
  ELSE
    UPDATE user_addresses SET is_active = false, updated_at = p_event.created_at WHERE id = v_address_id;
  END IF;
END;
$function$;
