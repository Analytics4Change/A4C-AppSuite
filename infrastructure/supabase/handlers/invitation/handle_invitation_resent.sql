CREATE OR REPLACE FUNCTION public.handle_invitation_resent(p_event record)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
BEGIN
  UPDATE invitations_projection SET
    token = safe_jsonb_extract_text(p_event.event_data, 'token'),
    expires_at = safe_jsonb_extract_timestamp(p_event.event_data, 'expires_at'),
    status = 'pending',
    updated_at = p_event.created_at
  WHERE invitation_id = safe_jsonb_extract_uuid(p_event.event_data, 'invitation_id');
END;
$function$;
