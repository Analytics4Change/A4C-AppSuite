CREATE OR REPLACE FUNCTION public.handle_user_notification_preferences_updated(p_event record)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE
  v_user_id UUID;
  v_org_id UUID;
  v_email_enabled BOOLEAN;
  v_sms_enabled BOOLEAN;
  v_sms_phone_id UUID;
  v_in_app_enabled BOOLEAN;
BEGIN
  v_user_id := (p_event.event_data->>'user_id')::UUID;
  v_org_id := (p_event.event_data->>'org_id')::UUID;

  v_email_enabled := COALESCE((p_event.event_data->'notification_preferences'->>'email')::BOOLEAN, true);
  v_sms_enabled := COALESCE((p_event.event_data->'notification_preferences'->'sms'->>'enabled')::BOOLEAN, false);
  v_sms_phone_id := COALESCE(
    (p_event.event_data->'notification_preferences'->'sms'->>'phone_id')::UUID,
    (p_event.event_data->'notification_preferences'->'sms'->>'phoneId')::UUID
  );
  v_in_app_enabled := COALESCE(
    (p_event.event_data->'notification_preferences'->>'in_app')::BOOLEAN,
    (p_event.event_data->'notification_preferences'->>'inApp')::BOOLEAN,
    false
  );

  UPDATE user_notification_preferences_projection
  SET email_enabled = v_email_enabled,
      sms_enabled = v_sms_enabled,
      sms_phone_id = v_sms_phone_id,
      in_app_enabled = v_in_app_enabled,
      updated_at = p_event.created_at
  WHERE user_id = v_user_id AND organization_id = v_org_id;

  IF NOT FOUND THEN
    INSERT INTO user_notification_preferences_projection (
      user_id, organization_id, email_enabled, sms_enabled, sms_phone_id,
      in_app_enabled, created_at, updated_at
    ) VALUES (
      v_user_id, v_org_id, v_email_enabled, v_sms_enabled, v_sms_phone_id,
      v_in_app_enabled, p_event.created_at, p_event.created_at
    );
  END IF;
END;
$function$;
