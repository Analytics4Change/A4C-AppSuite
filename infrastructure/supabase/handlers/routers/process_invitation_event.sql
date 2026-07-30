CREATE OR REPLACE FUNCTION public.process_invitation_event(p_event record)
RETURNS void
LANGUAGE plpgsql
SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE
  v_invitation_id UUID;
BEGIN
  CASE p_event.event_type

    -- Handle invitation accepted
    WHEN 'invitation.accepted' THEN
      v_invitation_id := (p_event.event_data->>'invitation_id')::UUID;

      UPDATE invitations_projection
      SET
        status = 'accepted',
        accepted_at = (p_event.event_data->>'accepted_at')::TIMESTAMPTZ,
        updated_at = p_event.created_at
      WHERE id = v_invitation_id;

    -- Handle invitation revoked
    WHEN 'invitation.revoked' THEN
      v_invitation_id := (p_event.event_data->>'invitation_id')::UUID;

      UPDATE invitations_projection
      SET
        status = 'revoked',
        updated_at = p_event.created_at
      WHERE id = v_invitation_id;

    -- Handle invitation expired
    WHEN 'invitation.expired' THEN
      v_invitation_id := (p_event.event_data->>'invitation_id')::UUID;

      UPDATE invitations_projection
      SET
        status = 'expired',
        updated_at = p_event.created_at
      WHERE id = v_invitation_id;

    -- Handle invitation resent (NEW: was only in process_organization_event)
    WHEN 'invitation.resent' THEN
      PERFORM handle_invitation_resent(p_event);

    -- Unhandled event type (fixed: EXCEPTION instead of WARNING)
    ELSE
      RAISE EXCEPTION 'Unhandled event type "%" in process_invitation_event', p_event.event_type
        USING ERRCODE = 'P9001';
  END CASE;

END;
$function$;
