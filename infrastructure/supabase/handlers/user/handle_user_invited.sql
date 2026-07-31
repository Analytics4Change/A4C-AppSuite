CREATE OR REPLACE FUNCTION public.handle_user_invited(p_event record)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE
  v_correlation_id UUID;
BEGIN
  v_correlation_id := (p_event.event_metadata->>'correlation_id')::UUID;

  INSERT INTO invitations_projection (
    invitation_id, organization_id, email, first_name, last_name,
    roles, token, expires_at, status,
    access_start_date, access_expiration_date, notification_preferences,
    phones, correlation_id, tags, created_at, updated_at
  ) VALUES (
    safe_jsonb_extract_uuid(p_event.event_data, 'invitation_id'),
    safe_jsonb_extract_uuid(p_event.event_data, 'org_id'),
    safe_jsonb_extract_text(p_event.event_data, 'email'),
    safe_jsonb_extract_text(p_event.event_data, 'first_name'),
    safe_jsonb_extract_text(p_event.event_data, 'last_name'),
    COALESCE(p_event.event_data->'roles', '[]'::jsonb),
    safe_jsonb_extract_text(p_event.event_data, 'token'),
    safe_jsonb_extract_timestamp(p_event.event_data, 'expires_at'),
    'pending',
    (p_event.event_data->>'access_start_date')::DATE,
    (p_event.event_data->>'access_expiration_date')::DATE,
    COALESCE(
      p_event.event_data->'notification_preferences',
      '{"email": true, "sms": {"enabled": false, "phoneId": null}, "inApp": false}'::jsonb
    ),
    COALESCE(p_event.event_data->'phones', '[]'::jsonb),
    v_correlation_id,
    COALESCE(ARRAY(SELECT jsonb_array_elements_text(p_event.event_data->'tags')), '{}'::TEXT[]),
    p_event.created_at,
    p_event.created_at
  ) ON CONFLICT (invitation_id) DO UPDATE SET
    token = EXCLUDED.token,
    expires_at = EXCLUDED.expires_at,
    -- `status` DELIBERATELY OMITTED (20260731005639). It was `status = 'pending'`
    -- here, which resurrected accepted/revoked/expired invitations on any event
    -- replay (Temporal activity retry, api.retry_failed_event) and could then
    -- collide with a live pending invitation for the same address under
    -- uq_invitations_pending_org_email — a 23505 raised inside a handler, which
    -- process_domain_event absorbs silently. Status transitions belong to the
    -- lifecycle handlers, not to a replay of the creation event.
    phones = EXCLUDED.phones,
    notification_preferences = EXCLUDED.notification_preferences,
    correlation_id = COALESCE(invitations_projection.correlation_id, EXCLUDED.correlation_id),
    updated_at = EXCLUDED.updated_at;
END;
$function$;
