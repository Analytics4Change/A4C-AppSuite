-- Migration: User invitation lookup RPC functions
-- Purpose: Support smart email lookup for invite-user Edge Function

-------------------------------------------------------------------------------
-- 1. check_user_org_membership - Check if a user has membership in an org
-------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION api.check_user_org_membership(
  p_email TEXT,
  p_org_id UUID
)
RETURNS TABLE (
  user_id UUID,
  is_active BOOLEAN
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
BEGIN
  RETURN QUERY
  SELECT u.id as user_id, u.is_active
  FROM users u
  INNER JOIN user_roles_projection urp ON u.id = urp.user_id
  WHERE u.email = p_email
    AND urp.organization_id = p_org_id
  LIMIT 1;
END;
$$;

COMMENT ON FUNCTION api.check_user_org_membership(TEXT, UUID)
  IS 'Check if a user with given email has membership (active or deactivated) in the specified organization';

-- Grant execute to service role
GRANT EXECUTE ON FUNCTION api.check_user_org_membership(TEXT, UUID) TO service_role;

-------------------------------------------------------------------------------
-- 2. check_pending_invitation - Check for pending invitation in an org
-------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION api.check_pending_invitation(
  p_email TEXT,
  p_org_id UUID
)
RETURNS TABLE (
  id UUID,
  email TEXT,
  expires_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
BEGIN
  RETURN QUERY
  SELECT ip.id, ip.email, ip.expires_at
  FROM invitations_projection ip
  WHERE ip.email = p_email
    AND ip.organization_id = p_org_id
    AND ip.status = 'pending'
  ORDER BY ip.created_at DESC
  LIMIT 1;
END;
$$;

COMMENT ON FUNCTION api.check_pending_invitation(TEXT, UUID)
  IS 'Check if there is a pending invitation for the given email in the specified organization';

-- Grant execute to service role
GRANT EXECUTE ON FUNCTION api.check_pending_invitation(TEXT, UUID) TO service_role;

-------------------------------------------------------------------------------
-- 3. check_user_exists - Check if a user exists in the system (any org)
-------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION api.check_user_exists(
  p_email TEXT
)
RETURNS TABLE (
  user_id UUID,
  email TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
BEGIN
  RETURN QUERY
  SELECT u.id as user_id, u.email
  FROM users u
  WHERE u.email = p_email
  LIMIT 1;
END;
$$;

COMMENT ON FUNCTION api.check_user_exists(TEXT)
  IS 'Check if a user with the given email exists anywhere in the system';

-- Grant execute to service role
GRANT EXECUTE ON FUNCTION api.check_user_exists(TEXT) TO service_role;

-------------------------------------------------------------------------------
-- 4. resend_invitation - Update invitation with new token and expiry
-- Used for resending expired or pending invitations
-------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION api.resend_invitation(
  p_invitation_id UUID,
  p_new_token TEXT,
  p_new_expires_at TIMESTAMPTZ
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_updated_count INTEGER;
BEGIN
  UPDATE invitations_projection
  SET
    token = p_new_token,
    expires_at = p_new_expires_at,
    status = 'pending',
    updated_at = NOW()
  WHERE id = p_invitation_id
    AND status IN ('pending', 'expired');

  GET DIAGNOSTICS v_updated_count = ROW_COUNT;
  RETURN v_updated_count > 0;
END;
$$;

COMMENT ON FUNCTION api.resend_invitation(UUID, TEXT, TIMESTAMPTZ)
  IS 'Update an invitation with a new token and expiry date for resending';

-- Grant execute to service role
GRANT EXECUTE ON FUNCTION api.resend_invitation(UUID, TEXT, TIMESTAMPTZ) TO service_role;

-------------------------------------------------------------------------------
-- 5. revoke_invitation - Revoke a pending invitation
-------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION api.revoke_invitation(
  p_invitation_id UUID,
  p_reason TEXT DEFAULT 'manual_revocation'
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_updated_count INTEGER;
BEGIN
  UPDATE invitations_projection
  SET
    status = 'revoked',
    revoked_at = NOW(),
    revoke_reason = p_reason,
    updated_at = NOW()
  WHERE id = p_invitation_id
    AND status = 'pending';

  GET DIAGNOSTICS v_updated_count = ROW_COUNT;
  RETURN v_updated_count > 0;
END;
$$;

COMMENT ON FUNCTION api.revoke_invitation(UUID, TEXT)
  IS 'Revoke a pending invitation';

-- Grant execute to service role
GRANT EXECUTE ON FUNCTION api.revoke_invitation(UUID, TEXT) TO service_role;

-------------------------------------------------------------------------------
-- 6. get_user_org_details - Get user details for manage-user Edge Function
-------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION api.get_user_org_details(
  p_user_id UUID,
  p_org_id UUID
)
RETURNS TABLE (
  user_id UUID,
  email TEXT,
  is_active BOOLEAN
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
BEGIN
  RETURN QUERY
  SELECT u.id as user_id, u.email, u.is_active
  FROM users u
  INNER JOIN user_roles_projection urp ON u.id = urp.user_id
  WHERE u.id = p_user_id
    AND urp.organization_id = p_org_id
  LIMIT 1;
END;
$$;

COMMENT ON FUNCTION api.get_user_org_details(UUID, UUID)
  IS 'Get user details including active status for a specific user in an organization';

-- Grant execute to service role
GRANT EXECUTE ON FUNCTION api.get_user_org_details(UUID, UUID) TO service_role;

-------------------------------------------------------------------------------
-- 7. Update process_user_event to handle deactivation/reactivation
-------------------------------------------------------------------------------

-- Add cases for user.deactivated and user.reactivated to process_user_event
-- Note: We need to update the existing function to add these cases

CREATE OR REPLACE FUNCTION "public"."process_user_event"("p_event" "record") RETURNS "void"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public', 'extensions', 'pg_temp'
    AS $$
DECLARE
  v_org_path LTREE;
  v_org_id UUID;
  v_scope_path LTREE;
  v_platform_org_id UUID := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::UUID;
  v_address_id UUID;
  v_phone_id UUID;
  v_user_id UUID;
BEGIN
  CASE p_event.event_type

    -- =========================================================================
    -- User Lifecycle Events
    -- =========================================================================

    -- Handle user creation (from invitation acceptance)
    WHEN 'user.created' THEN
      v_user_id := (p_event.event_data->>'user_id')::UUID;
      v_org_id := (p_event.event_data->>'organization_id')::UUID;

      INSERT INTO users (
        id,
        email,
        name,
        first_name,
        last_name,
        current_organization_id,
        accessible_organizations,
        roles,
        metadata,
        is_active,
        created_at,
        updated_at
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
      )
      ON CONFLICT (id) DO UPDATE SET
        email = EXCLUDED.email,
        name = EXCLUDED.name,
        first_name = COALESCE(EXCLUDED.first_name, users.first_name),
        last_name = COALESCE(EXCLUDED.last_name, users.last_name),
        current_organization_id = COALESCE(users.current_organization_id, EXCLUDED.current_organization_id),
        accessible_organizations = ARRAY(
          SELECT DISTINCT unnest(users.accessible_organizations || EXCLUDED.accessible_organizations)
        ),
        updated_at = p_event.created_at;

      INSERT INTO user_org_access (
        user_id,
        org_id,
        access_start_date,
        access_expiration_date,
        notification_preferences,
        created_at,
        updated_at
      ) VALUES (
        v_user_id,
        v_org_id,
        (p_event.event_data->>'access_start_date')::DATE,
        (p_event.event_data->>'access_expiration_date')::DATE,
        COALESCE(
          p_event.event_data->'notification_preferences',
          '{"email": true, "sms": {"enabled": false, "phone_id": null}, "in_app": false}'::jsonb
        ),
        p_event.created_at,
        p_event.created_at
      )
      ON CONFLICT (user_id, org_id) DO UPDATE SET
        access_start_date = COALESCE(EXCLUDED.access_start_date, user_org_access.access_start_date),
        access_expiration_date = COALESCE(EXCLUDED.access_expiration_date, user_org_access.access_expiration_date),
        notification_preferences = COALESCE(EXCLUDED.notification_preferences, user_org_access.notification_preferences),
        updated_at = p_event.created_at;

    -- Handle user deactivation
    WHEN 'user.deactivated' THEN
      v_user_id := (p_event.event_data->>'user_id')::UUID;
      v_org_id := (p_event.event_data->>'org_id')::UUID;

      -- Update user is_active status
      UPDATE users
      SET
        is_active = false,
        updated_at = p_event.created_at
      WHERE id = v_user_id;

      -- Also update user_org_access to record the deactivation
      UPDATE user_org_access
      SET
        is_active = false,
        updated_at = p_event.created_at
      WHERE user_id = v_user_id
        AND org_id = v_org_id;

    -- Handle user reactivation
    WHEN 'user.reactivated' THEN
      v_user_id := (p_event.event_data->>'user_id')::UUID;
      v_org_id := (p_event.event_data->>'org_id')::UUID;

      -- Update user is_active status
      UPDATE users
      SET
        is_active = true,
        updated_at = p_event.created_at
      WHERE id = v_user_id;

      -- Also update user_org_access to record the reactivation
      UPDATE user_org_access
      SET
        is_active = true,
        updated_at = p_event.created_at
      WHERE user_id = v_user_id
        AND org_id = v_org_id;

    -- Handle user sync from Supabase Auth
    WHEN 'user.synced_from_auth' THEN
      INSERT INTO users (
        id,
        email,
        name,
        is_active,
        created_at,
        updated_at
      ) VALUES (
        (p_event.event_data->>'auth_user_id')::UUID,
        p_event.event_data->>'email',
        COALESCE(p_event.event_data->>'name', p_event.event_data->>'email'),
        COALESCE((p_event.event_data->>'is_active')::BOOLEAN, true),
        p_event.created_at,
        p_event.created_at
      )
      ON CONFLICT (id) DO UPDATE SET
        email = EXCLUDED.email,
        name = COALESCE(EXCLUDED.name, users.name),
        is_active = EXCLUDED.is_active,
        updated_at = p_event.created_at;

    -- Handle role assignment
    WHEN 'user.role.assigned' THEN
      IF p_event.event_data->>'org_id' = '*'
         OR (p_event.event_data->>'org_id')::UUID = v_platform_org_id THEN
        v_org_id := NULL;
        v_scope_path := NULL;
      ELSE
        v_org_id := (p_event.event_data->>'org_id')::UUID;

        IF p_event.event_data->>'scope_path' IS NOT NULL
           AND p_event.event_data->>'scope_path' != '*' THEN
          v_scope_path := (p_event.event_data->>'scope_path')::LTREE;
        ELSE
          SELECT path INTO v_scope_path
          FROM organizations_projection
          WHERE id = v_org_id;
        END IF;

        IF v_org_id IS NOT NULL AND v_scope_path IS NULL THEN
          RAISE WARNING 'Cannot assign role: org_id % has no scope_path', v_org_id;
          RETURN;
        END IF;
      END IF;

      INSERT INTO user_roles_projection (
        user_id,
        role_id,
        organization_id,
        scope_path,
        role_valid_from,
        role_valid_until,
        assigned_at
      ) VALUES (
        p_event.stream_id,
        (p_event.event_data->>'role_id')::UUID,
        v_org_id,
        v_scope_path,
        (p_event.event_data->>'role_valid_from')::DATE,
        (p_event.event_data->>'role_valid_until')::DATE,
        p_event.created_at
      )
      ON CONFLICT ON CONSTRAINT user_roles_projection_user_id_role_id_org_id_key DO UPDATE SET
        role_valid_from = COALESCE(EXCLUDED.role_valid_from, user_roles_projection.role_valid_from),
        role_valid_until = COALESCE(EXCLUDED.role_valid_until, user_roles_projection.role_valid_until);

      UPDATE users
      SET
        roles = ARRAY(
          SELECT DISTINCT unnest(roles || ARRAY[p_event.event_data->>'role_name'])
        ),
        updated_at = p_event.created_at
      WHERE id = p_event.stream_id;

    -- =========================================================================
    -- Access Dates Events
    -- =========================================================================

    WHEN 'user.access_dates.updated' THEN
      v_user_id := (p_event.event_data->>'user_id')::UUID;
      v_org_id := (p_event.event_data->>'org_id')::UUID;

      UPDATE user_org_access
      SET
        access_start_date = (p_event.event_data->>'access_start_date')::DATE,
        access_expiration_date = (p_event.event_data->>'access_expiration_date')::DATE,
        updated_at = p_event.created_at
      WHERE user_id = v_user_id
        AND org_id = v_org_id;

      IF NOT FOUND THEN
        INSERT INTO user_org_access (
          user_id, org_id, access_start_date, access_expiration_date, created_at, updated_at
        ) VALUES (
          v_user_id, v_org_id,
          (p_event.event_data->>'access_start_date')::DATE,
          (p_event.event_data->>'access_expiration_date')::DATE,
          p_event.created_at, p_event.created_at
        );
      END IF;

    -- =========================================================================
    -- Notification Preferences Events
    -- =========================================================================

    WHEN 'user.notification_preferences.updated' THEN
      v_user_id := (p_event.event_data->>'user_id')::UUID;
      v_org_id := (p_event.event_data->>'org_id')::UUID;

      UPDATE user_org_access
      SET
        notification_preferences = p_event.event_data->'notification_preferences',
        updated_at = p_event.created_at
      WHERE user_id = v_user_id
        AND org_id = v_org_id;

      IF NOT FOUND THEN
        INSERT INTO user_org_access (
          user_id, org_id, notification_preferences, created_at, updated_at
        ) VALUES (
          v_user_id, v_org_id,
          p_event.event_data->'notification_preferences',
          p_event.created_at, p_event.created_at
        );
      END IF;

    -- =========================================================================
    -- Address Events
    -- =========================================================================

    WHEN 'user.address.added' THEN
      v_user_id := (p_event.event_data->>'user_id')::UUID;
      v_address_id := (p_event.event_data->>'address_id')::UUID;
      v_org_id := (p_event.event_data->>'org_id')::UUID;

      IF v_org_id IS NULL THEN
        INSERT INTO user_addresses (
          id, user_id, label, type, street1, street2, city, state, zip_code, country,
          is_primary, is_active, metadata, created_at, updated_at
        ) VALUES (
          v_address_id,
          v_user_id,
          p_event.event_data->>'label',
          (p_event.event_data->>'type')::address_type,
          p_event.event_data->>'street1',
          p_event.event_data->>'street2',
          p_event.event_data->>'city',
          p_event.event_data->>'state',
          p_event.event_data->>'zip_code',
          COALESCE(p_event.event_data->>'country', 'USA'),
          COALESCE((p_event.event_data->>'is_primary')::BOOLEAN, false),
          COALESCE((p_event.event_data->>'is_active')::BOOLEAN, true),
          COALESCE(p_event.event_data->'metadata', '{}'::jsonb),
          p_event.created_at,
          p_event.created_at
        )
        ON CONFLICT (id) DO NOTHING;
      ELSE
        INSERT INTO user_org_address_overrides (
          id, user_id, org_id, label, type, street1, street2, city, state, zip_code, country,
          is_active, metadata, created_at, updated_at
        ) VALUES (
          v_address_id,
          v_user_id,
          v_org_id,
          p_event.event_data->>'label',
          (p_event.event_data->>'type')::address_type,
          p_event.event_data->>'street1',
          p_event.event_data->>'street2',
          p_event.event_data->>'city',
          p_event.event_data->>'state',
          p_event.event_data->>'zip_code',
          COALESCE(p_event.event_data->>'country', 'USA'),
          COALESCE((p_event.event_data->>'is_active')::BOOLEAN, true),
          COALESCE(p_event.event_data->'metadata', '{}'::jsonb),
          p_event.created_at,
          p_event.created_at
        )
        ON CONFLICT (id) DO NOTHING;
      END IF;

    WHEN 'user.address.updated' THEN
      v_address_id := (p_event.event_data->>'address_id')::UUID;
      v_org_id := (p_event.event_data->>'org_id')::UUID;

      IF v_org_id IS NULL THEN
        UPDATE user_addresses SET
          label = COALESCE(p_event.event_data->>'label', label),
          type = COALESCE((p_event.event_data->>'type')::address_type, type),
          street1 = COALESCE(p_event.event_data->>'street1', street1),
          street2 = p_event.event_data->>'street2',
          city = COALESCE(p_event.event_data->>'city', city),
          state = COALESCE(p_event.event_data->>'state', state),
          zip_code = COALESCE(p_event.event_data->>'zip_code', zip_code),
          country = COALESCE(p_event.event_data->>'country', country),
          is_primary = COALESCE((p_event.event_data->>'is_primary')::BOOLEAN, is_primary),
          is_active = COALESCE((p_event.event_data->>'is_active')::BOOLEAN, is_active),
          metadata = COALESCE(p_event.event_data->'metadata', metadata),
          updated_at = p_event.created_at
        WHERE id = v_address_id;
      ELSE
        UPDATE user_org_address_overrides SET
          label = COALESCE(p_event.event_data->>'label', label),
          type = COALESCE((p_event.event_data->>'type')::address_type, type),
          street1 = COALESCE(p_event.event_data->>'street1', street1),
          street2 = p_event.event_data->>'street2',
          city = COALESCE(p_event.event_data->>'city', city),
          state = COALESCE(p_event.event_data->>'state', state),
          zip_code = COALESCE(p_event.event_data->>'zip_code', zip_code),
          country = COALESCE(p_event.event_data->>'country', country),
          is_active = COALESCE((p_event.event_data->>'is_active')::BOOLEAN, is_active),
          metadata = COALESCE(p_event.event_data->'metadata', metadata),
          updated_at = p_event.created_at
        WHERE id = v_address_id;
      END IF;

    WHEN 'user.address.removed' THEN
      v_address_id := (p_event.event_data->>'address_id')::UUID;
      v_org_id := (p_event.event_data->>'org_id')::UUID;

      IF p_event.event_data->>'removal_type' = 'hard_delete' THEN
        IF v_org_id IS NULL THEN
          DELETE FROM user_addresses WHERE id = v_address_id;
        ELSE
          DELETE FROM user_org_address_overrides WHERE id = v_address_id;
        END IF;
      ELSE
        IF v_org_id IS NULL THEN
          UPDATE user_addresses SET is_active = false, updated_at = p_event.created_at
          WHERE id = v_address_id;
        ELSE
          UPDATE user_org_address_overrides SET is_active = false, updated_at = p_event.created_at
          WHERE id = v_address_id;
        END IF;
      END IF;

    -- =========================================================================
    -- Phone Events
    -- =========================================================================

    WHEN 'user.phone.added' THEN
      v_user_id := (p_event.event_data->>'user_id')::UUID;
      v_phone_id := (p_event.event_data->>'phone_id')::UUID;
      v_org_id := (p_event.event_data->>'org_id')::UUID;

      IF v_org_id IS NULL THEN
        INSERT INTO user_phones (
          id, user_id, label, type, number, extension, country_code,
          is_primary, is_active, sms_capable, metadata, created_at, updated_at
        ) VALUES (
          v_phone_id,
          v_user_id,
          p_event.event_data->>'label',
          (p_event.event_data->>'type')::phone_type,
          p_event.event_data->>'number',
          p_event.event_data->>'extension',
          COALESCE(p_event.event_data->>'country_code', '+1'),
          COALESCE((p_event.event_data->>'is_primary')::BOOLEAN, false),
          COALESCE((p_event.event_data->>'is_active')::BOOLEAN, true),
          COALESCE((p_event.event_data->>'sms_capable')::BOOLEAN, false),
          COALESCE(p_event.event_data->'metadata', '{}'::jsonb),
          p_event.created_at,
          p_event.created_at
        )
        ON CONFLICT (id) DO NOTHING;
      ELSE
        INSERT INTO user_org_phone_overrides (
          id, user_id, org_id, label, type, number, extension, country_code,
          is_active, sms_capable, metadata, created_at, updated_at
        ) VALUES (
          v_phone_id,
          v_user_id,
          v_org_id,
          p_event.event_data->>'label',
          (p_event.event_data->>'type')::phone_type,
          p_event.event_data->>'number',
          p_event.event_data->>'extension',
          COALESCE(p_event.event_data->>'country_code', '+1'),
          COALESCE((p_event.event_data->>'is_active')::BOOLEAN, true),
          COALESCE((p_event.event_data->>'sms_capable')::BOOLEAN, false),
          COALESCE(p_event.event_data->'metadata', '{}'::jsonb),
          p_event.created_at,
          p_event.created_at
        )
        ON CONFLICT (id) DO NOTHING;
      END IF;

    WHEN 'user.phone.updated' THEN
      v_phone_id := (p_event.event_data->>'phone_id')::UUID;
      v_org_id := (p_event.event_data->>'org_id')::UUID;

      IF v_org_id IS NULL THEN
        UPDATE user_phones SET
          label = COALESCE(p_event.event_data->>'label', label),
          type = COALESCE((p_event.event_data->>'type')::phone_type, type),
          number = COALESCE(p_event.event_data->>'number', number),
          extension = p_event.event_data->>'extension',
          country_code = COALESCE(p_event.event_data->>'country_code', country_code),
          is_primary = COALESCE((p_event.event_data->>'is_primary')::BOOLEAN, is_primary),
          is_active = COALESCE((p_event.event_data->>'is_active')::BOOLEAN, is_active),
          sms_capable = COALESCE((p_event.event_data->>'sms_capable')::BOOLEAN, sms_capable),
          metadata = COALESCE(p_event.event_data->'metadata', metadata),
          updated_at = p_event.created_at
        WHERE id = v_phone_id;
      ELSE
        UPDATE user_org_phone_overrides SET
          label = COALESCE(p_event.event_data->>'label', label),
          type = COALESCE((p_event.event_data->>'type')::phone_type, type),
          number = COALESCE(p_event.event_data->>'number', number),
          extension = p_event.event_data->>'extension',
          country_code = COALESCE(p_event.event_data->>'country_code', country_code),
          is_active = COALESCE((p_event.event_data->>'is_active')::BOOLEAN, is_active),
          sms_capable = COALESCE((p_event.event_data->>'sms_capable')::BOOLEAN, sms_capable),
          metadata = COALESCE(p_event.event_data->'metadata', metadata),
          updated_at = p_event.created_at
        WHERE id = v_phone_id;
      END IF;

    WHEN 'user.phone.removed' THEN
      v_phone_id := (p_event.event_data->>'phone_id')::UUID;
      v_org_id := (p_event.event_data->>'org_id')::UUID;

      IF p_event.event_data->>'removal_type' = 'hard_delete' THEN
        IF v_org_id IS NULL THEN
          DELETE FROM user_phones WHERE id = v_phone_id;
        ELSE
          DELETE FROM user_org_phone_overrides WHERE id = v_phone_id;
        END IF;
      ELSE
        IF v_org_id IS NULL THEN
          UPDATE user_phones SET is_active = false, updated_at = p_event.created_at
          WHERE id = v_phone_id;
        ELSE
          UPDATE user_org_phone_overrides SET is_active = false, updated_at = p_event.created_at
          WHERE id = v_phone_id;
        END IF;
      END IF;

    ELSE
      RAISE WARNING 'Unknown user event type: %', p_event.event_type;
  END CASE;

END;
$$;

COMMENT ON FUNCTION "public"."process_user_event"("p_event" "record")
    IS 'User event processor v4 - handles user lifecycle (create, deactivate, reactivate), role assignment, access dates, notification preferences, addresses, and phones. Supports both global and org-specific data with proper scope handling.';
