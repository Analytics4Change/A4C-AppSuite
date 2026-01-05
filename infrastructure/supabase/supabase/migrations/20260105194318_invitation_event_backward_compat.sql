-- Migration: Update invitation event processor for backward compatibility
-- Purpose: Handle both 'role' (singular string) and 'roles' (jsonb array) in events
--
-- Background:
-- - Bootstrap workflow emits events with 'role' (singular string): { role: "provider_admin" }
-- - Frontend emits events with 'roles' (jsonb array): { roles: [{roleId: "...", roleName: "..."}] }
-- - Event processor must handle both formats gracefully
--
-- Solution:
-- - Check for 'roles' array first (new format)
-- - Fall back to 'role' string (legacy format), converting to array
-- - Populate legacy 'role' column when role string is provided
-- - Default to empty array if neither present

-- Update the invitation event processor function
CREATE OR REPLACE FUNCTION "public"."process_invitation_event"("p_event" "record")
    RETURNS void
    LANGUAGE "plpgsql"
    SECURITY DEFINER
    AS $$
DECLARE
  v_org_id UUID;
  v_invitation_id UUID;
  v_roles jsonb;
  v_role text;
BEGIN
  CASE p_event.event_type

    -- Handle user invitation
    WHEN 'user.invited' THEN
      v_org_id := (p_event.event_data->>'org_id')::UUID;
      v_invitation_id := (p_event.event_data->>'invitation_id')::UUID;

      -- Handle both 'roles' (array) and 'role' (string) formats
      -- Priority: roles array > role string > empty array
      v_roles := COALESCE(
        -- New format: roles is already a jsonb array
        p_event.event_data->'roles',
        -- Legacy format: convert single role string to array format
        CASE
          WHEN p_event.event_data->>'role' IS NOT NULL
          THEN jsonb_build_array(
            jsonb_build_object(
              'roleId', NULL::text,
              'roleName', p_event.event_data->>'role'
            )
          )
          ELSE '[]'::jsonb
        END
      );

      -- Extract legacy role string for backward compatibility
      v_role := p_event.event_data->>'role';

      INSERT INTO invitations_projection (
        id,
        organization_id,
        email,
        first_name,
        last_name,
        roles,
        role,
        token,
        expires_at,
        access_start_date,
        access_expiration_date,
        notification_preferences,
        status,
        created_at,
        updated_at
      ) VALUES (
        v_invitation_id,
        v_org_id,
        p_event.event_data->>'email',
        p_event.event_data->>'first_name',
        p_event.event_data->>'last_name',
        v_roles,
        v_role,  -- May be NULL (that's ok now)
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
        role = EXCLUDED.role,
        token = EXCLUDED.token,
        expires_at = EXCLUDED.expires_at,
        access_start_date = EXCLUDED.access_start_date,
        access_expiration_date = EXCLUDED.access_expiration_date,
        notification_preferences = EXCLUDED.notification_preferences,
        updated_at = p_event.created_at;

    -- Handle invitation accepted
    WHEN 'invitation.accepted' THEN
      v_invitation_id := (p_event.event_data->>'invitation_id')::UUID;

      UPDATE invitations_projection
      SET
        status = 'accepted',
        accepted_at = (p_event.event_data->>'accepted_at')::TIMESTAMPTZ,
        accepted_user_id = (p_event.event_data->>'user_id')::UUID,
        updated_at = p_event.created_at
      WHERE id = v_invitation_id;

    -- Handle invitation revoked
    WHEN 'invitation.revoked' THEN
      v_invitation_id := (p_event.event_data->>'invitation_id')::UUID;

      UPDATE invitations_projection
      SET
        status = 'revoked',
        revoked_at = (p_event.event_data->>'revoked_at')::TIMESTAMPTZ,
        revoke_reason = p_event.event_data->>'reason',
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

    ELSE
      RAISE WARNING 'Unknown invitation event type: %', p_event.event_type;
  END CASE;

END;
$$;

COMMENT ON FUNCTION "public"."process_invitation_event"("p_event" "record")
    IS 'Invitation event processor v3 - handles both legacy role (string) and new roles (array) formats for backward compatibility with bootstrap workflow.';
