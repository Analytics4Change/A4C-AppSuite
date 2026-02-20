CREATE OR REPLACE FUNCTION public.process_access_grant_event(p_event record)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE
  v_grant_id UUID;
BEGIN
  CASE p_event.event_type

    WHEN 'access_grant.created' THEN
      INSERT INTO cross_tenant_access_grants_projection (
        id, consultant_org_id, consultant_user_id, provider_org_id,
        scope, scope_id, authorization_type, legal_reference,
        granted_by, granted_at, expires_at, permissions, terms,
        status, created_at, updated_at
      ) VALUES (
        p_event.stream_id,
        safe_jsonb_extract_uuid(p_event.event_data, 'consultant_org_id'),
        safe_jsonb_extract_uuid(p_event.event_data, 'consultant_user_id'),
        safe_jsonb_extract_uuid(p_event.event_data, 'provider_org_id'),
        safe_jsonb_extract_text(p_event.event_data, 'scope'),
        safe_jsonb_extract_uuid(p_event.event_data, 'scope_id'),
        safe_jsonb_extract_text(p_event.event_data, 'authorization_type'),
        safe_jsonb_extract_text(p_event.event_data, 'legal_reference'),
        safe_jsonb_extract_uuid(p_event.event_data, 'granted_by'),
        p_event.created_at,
        safe_jsonb_extract_timestamp(p_event.event_data, 'expires_at'),
        COALESCE(p_event.event_data->'permissions', '[]'::jsonb),
        COALESCE(p_event.event_data->'terms', '{}'::jsonb),
        'active',
        p_event.created_at,
        p_event.created_at
      );

    WHEN 'access_grant.revoked' THEN
      v_grant_id := safe_jsonb_extract_uuid(p_event.event_data, 'grant_id');
      UPDATE cross_tenant_access_grants_projection
      SET status = 'revoked',
          revoked_at = p_event.created_at,
          revoked_by = safe_jsonb_extract_uuid(p_event.event_data, 'revoked_by'),
          revocation_reason = safe_jsonb_extract_text(p_event.event_data, 'revocation_reason'),
          revocation_details = safe_jsonb_extract_text(p_event.event_data, 'revocation_details'),
          updated_at = p_event.created_at
      WHERE id = v_grant_id;

    WHEN 'access_grant.expired' THEN
      v_grant_id := safe_jsonb_extract_uuid(p_event.event_data, 'grant_id');
      UPDATE cross_tenant_access_grants_projection
      SET status = 'expired',
          expired_at = p_event.created_at,
          expiration_type = safe_jsonb_extract_text(p_event.event_data, 'expiration_type'),
          updated_at = p_event.created_at
      WHERE id = v_grant_id;

    WHEN 'access_grant.suspended' THEN
      v_grant_id := safe_jsonb_extract_uuid(p_event.event_data, 'grant_id');
      UPDATE cross_tenant_access_grants_projection
      SET status = 'suspended',
          suspended_at = p_event.created_at,
          suspended_by = safe_jsonb_extract_uuid(p_event.event_data, 'suspended_by'),
          suspension_reason = safe_jsonb_extract_text(p_event.event_data, 'suspension_reason'),
          suspension_details = safe_jsonb_extract_text(p_event.event_data, 'suspension_details'),
          expected_resolution_date = safe_jsonb_extract_timestamp(p_event.event_data, 'expected_resolution_date'),
          updated_at = p_event.created_at
      WHERE id = v_grant_id;

    WHEN 'access_grant.reactivated' THEN
      v_grant_id := safe_jsonb_extract_uuid(p_event.event_data, 'grant_id');
      UPDATE cross_tenant_access_grants_projection
      SET status = 'active',
          suspended_at = NULL, suspended_by = NULL,
          suspension_reason = NULL, suspension_details = NULL,
          expected_resolution_date = NULL,
          reactivated_at = p_event.created_at,
          reactivated_by = safe_jsonb_extract_uuid(p_event.event_data, 'reactivated_by'),
          resolution_details = safe_jsonb_extract_text(p_event.event_data, 'resolution_details'),
          expires_at = COALESCE(
            safe_jsonb_extract_timestamp(p_event.event_data, 'new_expires_at'),
            expires_at
          ),
          updated_at = p_event.created_at
      WHERE id = v_grant_id;

    ELSE
      RAISE EXCEPTION 'Unhandled event type "%" in process_access_grant_event', p_event.event_type
          USING ERRCODE = 'P9001';
  END CASE;

END;
$function$;
