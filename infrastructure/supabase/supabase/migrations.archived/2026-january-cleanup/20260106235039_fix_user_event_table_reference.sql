-- Migration: Fix process_user_event and process_invitation_event table references
--
-- Bug 1: process_user_event() references non-existent table 'user_org_access'
--        (renamed to 'user_organizations_projection' in 20260105162527)
--
-- Bug 2: process_invitation_event() references non-existent column 'accepted_user_id'
--        in invitations_projection
--
-- This migration:
-- 1. Fixes process_user_event() to use user_organizations_projection
-- 2. Fixes process_invitation_event() to not reference accepted_user_id
-- 3. Backfills user_organizations_projection for existing users
-- 4. Resets failed events so they can be reprocessed

-------------------------------------------------------------------------------
-- 1. Fix process_user_event(p_event record)
-------------------------------------------------------------------------------

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

      -- FIXED: Use user_organizations_projection instead of user_org_access
      INSERT INTO user_organizations_projection (
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
        access_start_date = COALESCE(EXCLUDED.access_start_date, user_organizations_projection.access_start_date),
        access_expiration_date = COALESCE(EXCLUDED.access_expiration_date, user_organizations_projection.access_expiration_date),
        notification_preferences = COALESCE(EXCLUDED.notification_preferences, user_organizations_projection.notification_preferences),
        updated_at = p_event.created_at;

    -- Handle user deactivation
    WHEN 'user.deactivated' THEN
      v_user_id := (p_event.event_data->>'user_id')::UUID;

      -- Update user is_active status
      UPDATE users
      SET
        is_active = false,
        updated_at = p_event.created_at
      WHERE id = v_user_id;
      -- Note: user_organizations_projection doesn't have is_active column

    -- Handle user reactivation
    WHEN 'user.reactivated' THEN
      v_user_id := (p_event.event_data->>'user_id')::UUID;

      -- Update user is_active status
      UPDATE users
      SET
        is_active = true,
        updated_at = p_event.created_at
      WHERE id = v_user_id;
      -- Note: user_organizations_projection doesn't have is_active column

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

      -- FIXED: Use user_organizations_projection instead of user_org_access
      UPDATE user_organizations_projection
      SET
        access_start_date = (p_event.event_data->>'access_start_date')::DATE,
        access_expiration_date = (p_event.event_data->>'access_expiration_date')::DATE,
        updated_at = p_event.created_at
      WHERE user_id = v_user_id
        AND org_id = v_org_id;

      IF NOT FOUND THEN
        INSERT INTO user_organizations_projection (
          user_id, org_id, access_start_date, access_expiration_date,
          notification_preferences, created_at, updated_at
        ) VALUES (
          v_user_id, v_org_id,
          (p_event.event_data->>'access_start_date')::DATE,
          (p_event.event_data->>'access_expiration_date')::DATE,
          '{"email": true, "sms": {"enabled": false, "phone_id": null}, "in_app": false}'::jsonb,
          p_event.created_at, p_event.created_at
        );
      END IF;

    -- =========================================================================
    -- Notification Preferences Events
    -- =========================================================================

    WHEN 'user.notification_preferences.updated' THEN
      v_user_id := (p_event.event_data->>'user_id')::UUID;
      v_org_id := (p_event.event_data->>'org_id')::UUID;

      -- FIXED: Use user_organizations_projection instead of user_org_access
      UPDATE user_organizations_projection
      SET
        notification_preferences = p_event.event_data->'notification_preferences',
        updated_at = p_event.created_at
      WHERE user_id = v_user_id
        AND org_id = v_org_id;

      IF NOT FOUND THEN
        INSERT INTO user_organizations_projection (
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
    IS 'User event processor v4 - Fixed to use user_organizations_projection instead of user_org_access (renamed in 20260105162527).';

-------------------------------------------------------------------------------
-- 2. Fix process_invitation_event(p_event record)
--    Remove reference to non-existent accepted_user_id column
-------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION "public"."process_invitation_event"("p_event" "record") RETURNS "void"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public', 'extensions', 'pg_temp'
    AS $$
DECLARE
  v_org_id UUID;
  v_invitation_id UUID;
BEGIN
  CASE p_event.event_type

    -- Handle user invitation
    WHEN 'user.invited' THEN
      v_org_id := (p_event.event_data->>'org_id')::UUID;
      v_invitation_id := (p_event.event_data->>'invitation_id')::UUID;

      INSERT INTO invitations_projection (
        id,
        invitation_id,
        organization_id,
        email,
        first_name,
        last_name,
        roles,
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
        v_invitation_id,
        v_org_id,
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

    -- Handle invitation accepted
    -- FIXED: Removed accepted_user_id column which doesn't exist
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

    ELSE
      RAISE WARNING 'Unknown invitation event type: %', p_event.event_type;
  END CASE;

END;
$$;

COMMENT ON FUNCTION "public"."process_invitation_event"("p_event" "record")
    IS 'Invitation event processor v3 - Fixed to not reference non-existent accepted_user_id column.';

-------------------------------------------------------------------------------
-- 3. Backfill user_organizations_projection for existing users
-------------------------------------------------------------------------------

INSERT INTO user_organizations_projection (user_id, org_id, access_start_date, notification_preferences, created_at, updated_at)
SELECT
  u.id,
  u.current_organization_id,
  u.created_at::DATE,
  '{"email": true, "sms": {"enabled": false, "phone_id": null}, "in_app": false}'::jsonb,
  u.created_at,
  NOW()
FROM users u
WHERE u.current_organization_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM user_organizations_projection uop
    WHERE uop.user_id = u.id AND uop.org_id = u.current_organization_id
  );

-------------------------------------------------------------------------------
-- 4. Reset failed events so they can be reprocessed
-------------------------------------------------------------------------------

-- Reset user.created events that failed due to user_org_access reference
UPDATE domain_events
SET
  processed_at = NULL,
  processing_error = NULL
WHERE event_type = 'user.created'
  AND processed_at IS NULL
  AND processing_error LIKE '%user_org_access%';

-- Reset invitation.accepted events that failed due to accepted_user_id reference
UPDATE domain_events
SET
  processed_at = NULL,
  processing_error = NULL
WHERE event_type = 'invitation.accepted'
  AND processed_at IS NULL
  AND processing_error LIKE '%accepted_user_id%';
