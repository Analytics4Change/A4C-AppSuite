-- =============================================================================
-- Drop deprecated `role` column from invitations_projection
-- =============================================================================
-- The singular `role` column was deprecated at the Day 0 v4 baseline (see
-- comment at baseline_v4.sql:12918) but kept for "backward compatibility with
-- bootstrap workflow." In practice no current emitter populates it:
--   - invite-user Edge Function emits `roles[]` only.
--   - bootstrap workflow (workflows/.../generate-invitations.ts) emits
--     `roles: [{role_id, role_name}]`.
--   - handle_user_invited writes safe_jsonb_extract_text(event_data, 'role')
--     which is always NULL for the above emitters.
--
-- The column's continued presence created a contract bug: api.get_invitation_by_token
-- COALESCEd from i.role first, returned NULL, the validate-invitation Edge Function
-- forwarded `role: null`, and the frontend's SupabaseInvitationService threw
-- "Invalid invitation response" on `!data?.role`. Fix is to drop the column,
-- update the read RPC and handler, and migrate the frontend to consume the
-- existing `roles` JSONB array directly.
--
-- WRITE-SITE AUDIT (verified before this migration):
--   * public.handle_user_invited(record)                      - writes role; UPDATED HERE.
--   * public.process_invitation_event(record) WHEN 'user.invited' (baseline_v4:11064)
--       - second INSERT site, but does NOT reference role. Verified dead code:
--       all current emitters set stream_type='user', which routes via
--       process_user_event -> handle_user_invited; this branch is never reached.
--   * public.process_invitation_event(record) WHEN 'invitation.accepted/revoked/expired'
--       (baseline_v4:11116/11127/11137) - UPDATEs only status/accepted_at/updated_at.
--       No role reference.
--
-- READ-SITE AUDIT:
--   * api.get_invitation_by_token(text)        - returns role; DROP+CREATE HERE.
--   * api.get_invitation_by_org_and_email(...)  - verified, does NOT return role.
--   * api.list_invitations(...)                 - verified, does NOT return role.
--
-- This migration is destructive (DROP COLUMN). A defensive backfill step
-- ensures any legacy row with role IS NOT NULL gets its data preserved into
-- the roles[] array before the column is dropped.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Step 1: Update handle_user_invited to stop writing the role column.
-- -----------------------------------------------------------------------------
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
    status = 'pending',
    phones = EXCLUDED.phones,
    notification_preferences = EXCLUDED.notification_preferences,
    correlation_id = COALESCE(invitations_projection.correlation_id, EXCLUDED.correlation_id),
    updated_at = EXCLUDED.updated_at;
END;
$function$;

-- -----------------------------------------------------------------------------
-- Step 2: DROP + CREATE api.get_invitation_by_token without `role` field.
--
-- Signature change requires DROP. Re-issue grants and the @a4c-rpc-shape
-- tag (DROP loses both per supabase/CLAUDE.md § "DROP + CREATE re-tag rule").
-- -----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS api.get_invitation_by_token(text);

CREATE OR REPLACE FUNCTION api.get_invitation_by_token(p_token text)
RETURNS TABLE(
  "id" uuid,
  "token" text,
  "email" text,
  "organization_id" uuid,
  "organization_name" text,
  "roles" jsonb,
  "first_name" text,
  "last_name" text,
  "status" text,
  "expires_at" timestamp with time zone,
  "accepted_at" timestamp with time zone,
  "correlation_id" uuid,
  "contact_id" uuid,
  "phones" jsonb,
  "notification_preferences" jsonb
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions', 'pg_temp'
AS $$
BEGIN
  RETURN QUERY
  SELECT
    i.id,
    i.token,
    i.email,
    i.organization_id,
    o.name AS organization_name,
    COALESCE(i.roles, '[]'::jsonb) AS roles,
    i.first_name,
    i.last_name,
    i.status,
    i.expires_at,
    i.accepted_at,
    i.correlation_id,
    i.contact_id,
    COALESCE(i.phones, '[]'::jsonb) AS phones,
    COALESCE(i.notification_preferences, '{"email": true, "sms": {"enabled": false, "phoneId": null}, "inApp": false}'::jsonb) AS notification_preferences
  FROM public.invitations_projection i
  LEFT JOIN public.organizations_projection o ON o.id = i.organization_id
  WHERE i.token = p_token;
END;
$$;

ALTER FUNCTION api.get_invitation_by_token(text) OWNER TO postgres;

GRANT EXECUTE ON FUNCTION api.get_invitation_by_token(text) TO anon;
GRANT EXECUTE ON FUNCTION api.get_invitation_by_token(text) TO authenticated;
GRANT EXECUTE ON FUNCTION api.get_invitation_by_token(text) TO service_role;

COMMENT ON FUNCTION api.get_invitation_by_token(text) IS
$comment$Get invitation details by token for validation. Returns correlation_id for lifecycle tracing, contact_id for contact-user linking, first_name/last_name/roles for user creation, and phones/notification_preferences for Phase 6 invitation flow.

@a4c-rpc-shape: read$comment$;

-- -----------------------------------------------------------------------------
-- Step 3: Defensive backfill - preserve any legacy role-only data into roles[]
-- before dropping the column. No-op on a clean DB; protects against any
-- unknown legacy rows that have role IS NOT NULL with empty roles[].
-- -----------------------------------------------------------------------------
UPDATE public.invitations_projection
SET roles = jsonb_build_array(
  jsonb_build_object('role_id', NULL, 'role_name', role)
)
WHERE role IS NOT NULL
  AND (roles IS NULL OR roles = '[]'::jsonb);

-- -----------------------------------------------------------------------------
-- Step 4: Drop the deprecated column.
-- -----------------------------------------------------------------------------
ALTER TABLE public.invitations_projection DROP COLUMN IF EXISTS role;
