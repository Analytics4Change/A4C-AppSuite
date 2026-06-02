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
      -- Phase 1 Step 14 extension: authorization_reference column populated
      -- from event_data. Column added by Step 14a; CHECK enforces NON-NULL
      -- except for emergency_access via Step 14b.
      INSERT INTO cross_tenant_access_grants_projection (
        id, consultant_org_id, consultant_user_id, provider_org_id,
        scope, scope_id, authorization_type, legal_reference,
        granted_by, granted_at, expires_at, permissions, terms,
        status, created_at, updated_at,
        authorization_reference
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
        p_event.created_at,
        safe_jsonb_extract_uuid(p_event.event_data, 'authorization_reference')
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

    -- NEW (Phase 1 Step 10) — Decision B.3 policy override application.
    -- Handler-only; emit RPC api.revoke_permission_across_grants ships Phase 2.
    -- REPLACES (not merges) permissions jsonb. Pre-conditions enforced per
    -- plan.md L114-126 DBC. F4 (Step 10 architect review 2026-06-02):
    -- jsonb_typeof check enforces "well-formed jsonb array" pre-condition.
    WHEN 'access_grant.policy_override_applied' THEN
      -- Pre-condition: event_data must carry a permissions JSONB ARRAY.
      IF p_event.event_data->'permissions' IS NULL
         OR jsonb_typeof(p_event.event_data->'permissions') <> 'array' THEN
        RAISE EXCEPTION 'access_grant.policy_override_applied missing or non-array required field: permissions'
          USING ERRCODE = 'P9001';
      END IF;

      IF COALESCE(p_event.event_data->>'override_reason', '') = '' THEN
        RAISE EXCEPTION 'access_grant.policy_override_applied missing required field: override_reason'
          USING ERRCODE = 'P9001';
      END IF;

      UPDATE cross_tenant_access_grants_projection
      SET permissions = p_event.event_data->'permissions',
          updated_at = p_event.created_at
      WHERE id = p_event.stream_id;

      IF NOT FOUND THEN
        RAISE EXCEPTION 'Grant not found for policy_override_applied'
          USING ERRCODE = 'P0002';
      END IF;

    ELSE
      RAISE EXCEPTION 'Unhandled event type "%" in process_access_grant_event', p_event.event_type
          USING ERRCODE = 'P9001';
  END CASE;

END;
$function$;
