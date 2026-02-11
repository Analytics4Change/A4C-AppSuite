CREATE OR REPLACE FUNCTION public.handle_user_created(p_event record)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE
  v_user_id UUID;
  v_org_id UUID;
  v_sms_enabled BOOLEAN;
  v_sms_phone_id UUID;
  v_in_app_enabled BOOLEAN;
  v_email_enabled BOOLEAN;
BEGIN
  v_user_id := (p_event.event_data->>'user_id')::UUID;
  v_org_id := (p_event.event_data->>'organization_id')::UUID;

  INSERT INTO users (
    id, email, name, first_name, last_name, current_organization_id,
    accessible_organizations, roles, metadata, is_active, created_at, updated_at
  ) VALUES (
    v_user_id,
    p_event.event_data->>'email',
    COALESCE(
      NULLIF(TRIM(CONCAT(p_event.event_data->>'first_name', ' ', p_event.event_data->>'last_name')), ''),
      p_event.event_data->>'name',
      p_event.event_data->>'email'
    ),
    p_event.event_data->>'first_name',
    p_event.event_data->>'last_name',
    v_org_id,
    ARRAY[v_org_id],
    '{}',
    jsonb_build_object(
      'auth_method', p_event.event_data->>'auth_method',
      'invited_via', p_event.event_data->>'invited_via'
    ),
    true,
    p_event.created_at,
    p_event.created_at
  ) ON CONFLICT (id) DO UPDATE SET
    email = EXCLUDED.email,
    name = EXCLUDED.name,
    first_name = COALESCE(EXCLUDED.first_name, users.first_name),
    last_name = COALESCE(EXCLUDED.last_name, users.last_name),
    current_organization_id = COALESCE(users.current_organization_id, EXCLUDED.current_organization_id),
    accessible_organizations = ARRAY(
      SELECT DISTINCT unnest(users.accessible_organizations || EXCLUDED.accessible_organizations)
    ),
    updated_at = p_event.created_at;

  INSERT INTO user_organizations_projection (
    user_id, org_id, access_start_date, access_expiration_date, created_at, updated_at
  ) VALUES (
    v_user_id,
    v_org_id,
    (p_event.event_data->>'access_start_date')::DATE,
    (p_event.event_data->>'access_expiration_date')::DATE,
    p_event.created_at,
    p_event.created_at
  ) ON CONFLICT (user_id, org_id) DO UPDATE SET
    access_start_date = COALESCE(EXCLUDED.access_start_date, user_organizations_projection.access_start_date),
    access_expiration_date = COALESCE(EXCLUDED.access_expiration_date, user_organizations_projection.access_expiration_date),
    updated_at = p_event.created_at;

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

  INSERT INTO user_notification_preferences_projection (
    user_id, organization_id, email_enabled, sms_enabled, sms_phone_id,
    in_app_enabled, created_at, updated_at
  ) VALUES (
    v_user_id, v_org_id, v_email_enabled, v_sms_enabled, v_sms_phone_id,
    v_in_app_enabled, p_event.created_at, p_event.created_at
  ) ON CONFLICT (user_id, organization_id) DO UPDATE SET
    email_enabled = COALESCE(EXCLUDED.email_enabled, user_notification_preferences_projection.email_enabled),
    sms_enabled = COALESCE(EXCLUDED.sms_enabled, user_notification_preferences_projection.sms_enabled),
    sms_phone_id = COALESCE(EXCLUDED.sms_phone_id, user_notification_preferences_projection.sms_phone_id),
    in_app_enabled = COALESCE(EXCLUDED.in_app_enabled, user_notification_preferences_projection.in_app_enabled),
    updated_at = p_event.created_at;
END;
$function$;
