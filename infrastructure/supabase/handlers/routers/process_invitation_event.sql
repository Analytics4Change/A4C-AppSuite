CREATE OR REPLACE FUNCTION public.process_invitation_event(p_event record)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE
  v_org_id UUID;
  v_invitation_id UUID;
BEGIN
  CASE p_event.event_type

    WHEN 'user.invited' THEN
      v_org_id := (p_event.event_data->>'org_id')::UUID;
      v_invitation_id := (p_event.event_data->>'invitation_id')::UUID;

      INSERT INTO invitations_projection (
        id, invitation_id, organization_id, email, first_name, last_name,
        roles, token, expires_at, access_start_date, access_expiration_date,
        notification_preferences, status, created_at, updated_at
      ) VALUES (
        v_invitation_id, v_invitation_id, v_org_id,
        p_event.event_data->>'email',
        p_event.event_data->>'first_name',
        p_event.event_data->>'last_name',
        p_event.event_data->'roles',
        p_event.event_data->>'token',
        (p_event.event_data->>'expires_at')::TIMESTAMPTZ,
        (p_event.event_data->>'access_start_date')::DATE,
        (p_event.event_data->>'access_expiration_date')::DATE,
        COALESCE(
          p_event.event_data->'notification_preferences',
          '{"email": true, "sms": {"enabled": false, "phone_id": null}, "in_app": false}'::jsonb
        ),
        'pending',
        p_event.created_at,
        p_event.created_at
      )
      ON CONFLICT (id) DO UPDATE SET
        email = EXCLUDED.email,
        first_name = EXCLUDED.first_name,
        last_name = EXCLUDED.last_name,
        roles = EXCLUDED.roles,
        token = EXCLUDED.token,
        expires_at = EXCLUDED.expires_at,
        access_start_date = EXCLUDED.access_start_date,
        access_expiration_date = EXCLUDED.access_expiration_date,
        notification_preferences = EXCLUDED.notification_preferences,
        updated_at = p_event.created_at;

    WHEN 'invitation.accepted' THEN
      v_invitation_id := (p_event.event_data->>'invitation_id')::UUID;
      UPDATE invitations_projection
      SET status = 'accepted',
          accepted_at = (p_event.event_data->>'accepted_at')::TIMESTAMPTZ,
          updated_at = p_event.created_at
      WHERE id = v_invitation_id;

    WHEN 'invitation.revoked' THEN
      v_invitation_id := (p_event.event_data->>'invitation_id')::UUID;
      UPDATE invitations_projection
      SET status = 'revoked', updated_at = p_event.created_at
      WHERE id = v_invitation_id;

    WHEN 'invitation.expired' THEN
      v_invitation_id := (p_event.event_data->>'invitation_id')::UUID;
      UPDATE invitations_projection
      SET status = 'expired', updated_at = p_event.created_at
      WHERE id = v_invitation_id;

    WHEN 'invitation.resent' THEN
      PERFORM handle_invitation_resent(p_event);

    ELSE
      RAISE EXCEPTION 'Unhandled event type "%" in process_invitation_event', p_event.event_type
        USING ERRCODE = 'P9001';
  END CASE;

END;
$function$;
