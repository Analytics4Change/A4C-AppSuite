-- Migration: Add api.update_user() RPC and user.profile.updated event handler
--
-- Purpose: Enable updating user profile fields (first_name, last_name) via CQRS pattern
--
-- Components:
-- 1. api.update_user() RPC function - emits user.profile.updated event
-- 2. Event handler in process_user_event() - updates users table

-- ============================================================================
-- 1. api.update_user() RPC Function
-- ============================================================================

DROP FUNCTION IF EXISTS api.update_user(UUID, UUID, TEXT, TEXT);

CREATE OR REPLACE FUNCTION api.update_user(
  p_user_id UUID,
  p_org_id UUID,
  p_first_name TEXT DEFAULT NULL,
  p_last_name TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, api
AS $$
DECLARE
  v_event_id UUID;
  v_current_user_id UUID;
BEGIN
  v_current_user_id := auth.uid();

  -- Verify caller is authenticated
  IF v_current_user_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Not authenticated');
  END IF;

  -- Verify user exists and belongs to org (via user_roles_projection)
  IF NOT EXISTS (
    SELECT 1 FROM public.user_roles_projection
    WHERE user_id = p_user_id AND organization_id = p_org_id
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'User not found in organization');
  END IF;

  -- Emit domain event
  INSERT INTO public.domain_events (
    stream_type,
    stream_id,
    event_type,
    event_data,
    event_metadata
  ) VALUES (
    'user',
    p_user_id,
    'user.profile.updated',
    jsonb_build_object(
      'user_id', p_user_id,
      'organization_id', p_org_id,
      'first_name', p_first_name,
      'last_name', p_last_name
    ),
    jsonb_build_object(
      'user_id', v_current_user_id,
      'reason', 'User profile updated via UI'
    )
  )
  RETURNING id INTO v_event_id;

  RETURN jsonb_build_object('success', true, 'event_id', v_event_id);
END;
$$;

-- Grant execute to authenticated users
GRANT EXECUTE ON FUNCTION api.update_user(UUID, UUID, TEXT, TEXT) TO authenticated;

-- Documentation
COMMENT ON FUNCTION api.update_user IS
'Update user profile fields (first_name, last_name).

Parameters:
- p_user_id: UUID of user to update
- p_org_id: Organization UUID (validates user belongs to org)
- p_first_name: New first name (optional, NULL to keep existing)
- p_last_name: New last name (optional, NULL to keep existing)

Returns:
- {success: true, event_id: UUID} on success
- {success: false, error: string} on failure

Emits: user.profile.updated event
Event processor updates: users.first_name, users.last_name, users.name, users.updated_at';


-- ============================================================================
-- 2. Update process_user_event() to handle user.profile.updated
-- ============================================================================

-- Re-create process_user_event with the new event handler
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
  v_new_name TEXT;
BEGIN
  CASE p_event.event_type

    -- =========================================================================
    -- User profile update
    -- =========================================================================

    WHEN 'user.profile.updated' THEN
      v_user_id := (p_event.event_data->>'user_id')::UUID;

      -- Build the new name from first_name and last_name
      -- Use COALESCE to only update if new value provided
      UPDATE users
      SET
        first_name = COALESCE(p_event.event_data->>'first_name', first_name),
        last_name = COALESCE(p_event.event_data->>'last_name', last_name),
        name = COALESCE(
          NULLIF(TRIM(CONCAT(
            COALESCE(p_event.event_data->>'first_name', first_name), ' ',
            COALESCE(p_event.event_data->>'last_name', last_name)
          )), ''),
          name  -- Keep existing name if both are null/empty
        ),
        updated_at = p_event.created_at
      WHERE id = v_user_id;

    -- =========================================================================
    -- Existing event handlers
    -- =========================================================================

    -- Handle user creation (from invitation acceptance)
    WHEN 'user.created' THEN
      v_user_id := (p_event.event_data->>'user_id')::UUID;
      v_org_id := (p_event.event_data->>'organization_id')::UUID;

      -- Insert user record
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
        '{}',  -- Roles populated by user.role.assigned events
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

      -- Create user_org_access record with access dates and notification preferences
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
      -- Determine if this is a global scope assignment
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

      -- Insert role assignment with role-level access dates
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

      -- Update user's roles array
      UPDATE users
      SET
        roles = ARRAY(
          SELECT DISTINCT unnest(roles || ARRAY[p_event.event_data->>'role_name'])
        ),
        updated_at = p_event.created_at
      WHERE id = p_event.stream_id;

    -- =========================================================================
    -- Access Dates events
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

    -- =========================================================================
    -- Notification Preferences events
    -- =========================================================================

    WHEN 'user.notification_preferences.updated' THEN
      v_user_id := (p_event.event_data->>'user_id')::UUID;
      v_org_id := (p_event.event_data->>'org_id')::UUID;

      -- Update notification_preferences_projection (new table) - UPSERT pattern
      INSERT INTO notification_preferences_projection (
        user_id,
        org_id,
        email_enabled,
        sms_enabled,
        sms_phone_id,
        in_app_enabled,
        created_at,
        updated_at
      )
      VALUES (
        v_user_id,
        v_org_id,
        COALESCE((p_event.event_data->'preferences'->>'email')::BOOLEAN, TRUE),
        COALESCE((p_event.event_data->'preferences'->'sms'->>'enabled')::BOOLEAN, FALSE),
        NULLIF(p_event.event_data->'preferences'->'sms'->>'phone_id', '')::UUID,
        COALESCE((p_event.event_data->'preferences'->>'in_app')::BOOLEAN, FALSE),
        p_event.created_at,
        p_event.created_at
      )
      ON CONFLICT (user_id, org_id) DO UPDATE SET
        email_enabled = EXCLUDED.email_enabled,
        sms_enabled = EXCLUDED.sms_enabled,
        sms_phone_id = EXCLUDED.sms_phone_id,
        in_app_enabled = EXCLUDED.in_app_enabled,
        updated_at = p_event.created_at;

    -- =========================================================================
    -- Address events
    -- =========================================================================

    WHEN 'user.address.added' THEN
      v_user_id := (p_event.event_data->>'user_id')::UUID;
      v_org_id := NULLIF(p_event.event_data->>'org_id', '')::UUID;
      v_address_id := COALESCE(
        (p_event.event_data->>'address_id')::UUID,
        gen_random_uuid()
      );

      -- If primary, clear primary on other addresses for this scope
      IF (p_event.event_data->>'is_primary')::BOOLEAN THEN
        UPDATE user_addresses
        SET is_primary = false
        WHERE user_id = v_user_id
          AND (
            (v_org_id IS NULL AND org_id IS NULL) OR
            (v_org_id IS NOT NULL AND org_id = v_org_id)
          );
      END IF;

      INSERT INTO user_addresses (
        id,
        user_id,
        org_id,
        label,
        address_type,
        street_address_1,
        street_address_2,
        city,
        state_province,
        postal_code,
        country,
        is_primary,
        is_active,
        created_at,
        updated_at
      ) VALUES (
        v_address_id,
        v_user_id,
        v_org_id,
        p_event.event_data->>'label',
        p_event.event_data->>'address_type',
        p_event.event_data->>'street_address_1',
        p_event.event_data->>'street_address_2',
        p_event.event_data->>'city',
        p_event.event_data->>'state_province',
        p_event.event_data->>'postal_code',
        p_event.event_data->>'country',
        COALESCE((p_event.event_data->>'is_primary')::BOOLEAN, false),
        true,
        p_event.created_at,
        p_event.created_at
      );

    WHEN 'user.address.updated' THEN
      v_address_id := (p_event.event_data->>'address_id')::UUID;
      v_user_id := (p_event.event_data->>'user_id')::UUID;
      v_org_id := NULLIF(p_event.event_data->>'org_id', '')::UUID;

      -- If setting as primary, clear primary on others
      IF (p_event.event_data->'updates'->>'is_primary')::BOOLEAN THEN
        UPDATE user_addresses
        SET is_primary = false
        WHERE user_id = v_user_id
          AND id != v_address_id
          AND (
            (v_org_id IS NULL AND org_id IS NULL) OR
            (v_org_id IS NOT NULL AND org_id = v_org_id)
          );
      END IF;

      UPDATE user_addresses
      SET
        label = COALESCE(p_event.event_data->'updates'->>'label', label),
        address_type = COALESCE(p_event.event_data->'updates'->>'address_type', address_type),
        street_address_1 = COALESCE(p_event.event_data->'updates'->>'street_address_1', street_address_1),
        street_address_2 = COALESCE(p_event.event_data->'updates'->>'street_address_2', street_address_2),
        city = COALESCE(p_event.event_data->'updates'->>'city', city),
        state_province = COALESCE(p_event.event_data->'updates'->>'state_province', state_province),
        postal_code = COALESCE(p_event.event_data->'updates'->>'postal_code', postal_code),
        country = COALESCE(p_event.event_data->'updates'->>'country', country),
        is_primary = COALESCE((p_event.event_data->'updates'->>'is_primary')::BOOLEAN, is_primary),
        updated_at = p_event.created_at
      WHERE id = v_address_id;

    WHEN 'user.address.removed' THEN
      v_address_id := (p_event.event_data->>'address_id')::UUID;

      IF (p_event.event_data->>'hard_delete')::BOOLEAN THEN
        DELETE FROM user_addresses WHERE id = v_address_id;
      ELSE
        UPDATE user_addresses
        SET is_active = false, updated_at = p_event.created_at
        WHERE id = v_address_id;
      END IF;

    -- =========================================================================
    -- Phone events
    -- =========================================================================

    WHEN 'user.phone.added' THEN
      v_user_id := (p_event.event_data->>'user_id')::UUID;
      v_org_id := NULLIF(p_event.event_data->>'org_id', '')::UUID;
      v_phone_id := COALESCE(
        (p_event.event_data->>'phone_id')::UUID,
        gen_random_uuid()
      );

      -- If primary, clear primary on other phones for this scope
      IF (p_event.event_data->>'is_primary')::BOOLEAN THEN
        UPDATE user_phones
        SET is_primary = false
        WHERE user_id = v_user_id
          AND (
            (v_org_id IS NULL AND org_id IS NULL) OR
            (v_org_id IS NOT NULL AND org_id = v_org_id)
          );
      END IF;

      INSERT INTO user_phones (
        id,
        user_id,
        org_id,
        label,
        phone_type,
        phone_number,
        extension,
        country_code,
        is_primary,
        sms_capable,
        is_active,
        created_at,
        updated_at
      ) VALUES (
        v_phone_id,
        v_user_id,
        v_org_id,
        p_event.event_data->>'label',
        p_event.event_data->>'phone_type',
        p_event.event_data->>'phone_number',
        p_event.event_data->>'extension',
        COALESCE(p_event.event_data->>'country_code', '+1'),
        COALESCE((p_event.event_data->>'is_primary')::BOOLEAN, false),
        COALESCE((p_event.event_data->>'sms_capable')::BOOLEAN, false),
        true,
        p_event.created_at,
        p_event.created_at
      );

    WHEN 'user.phone.updated' THEN
      v_phone_id := (p_event.event_data->>'phone_id')::UUID;
      v_user_id := (p_event.event_data->>'user_id')::UUID;
      v_org_id := NULLIF(p_event.event_data->>'org_id', '')::UUID;

      -- If setting as primary, clear primary on others
      IF (p_event.event_data->'updates'->>'is_primary')::BOOLEAN THEN
        UPDATE user_phones
        SET is_primary = false
        WHERE user_id = v_user_id
          AND id != v_phone_id
          AND (
            (v_org_id IS NULL AND org_id IS NULL) OR
            (v_org_id IS NOT NULL AND org_id = v_org_id)
          );
      END IF;

      UPDATE user_phones
      SET
        label = COALESCE(p_event.event_data->'updates'->>'label', label),
        phone_type = COALESCE(p_event.event_data->'updates'->>'phone_type', phone_type),
        phone_number = COALESCE(p_event.event_data->'updates'->>'phone_number', phone_number),
        extension = COALESCE(p_event.event_data->'updates'->>'extension', extension),
        country_code = COALESCE(p_event.event_data->'updates'->>'country_code', country_code),
        is_primary = COALESCE((p_event.event_data->'updates'->>'is_primary')::BOOLEAN, is_primary),
        sms_capable = COALESCE((p_event.event_data->'updates'->>'sms_capable')::BOOLEAN, sms_capable),
        updated_at = p_event.created_at
      WHERE id = v_phone_id;

    WHEN 'user.phone.removed' THEN
      v_phone_id := (p_event.event_data->>'phone_id')::UUID;

      IF (p_event.event_data->>'hard_delete')::BOOLEAN THEN
        DELETE FROM user_phones WHERE id = v_phone_id;
      ELSE
        UPDATE user_phones
        SET is_active = false, updated_at = p_event.created_at
        WHERE id = v_phone_id;
      END IF;

    -- =========================================================================
    -- Lifecycle events
    -- =========================================================================

    WHEN 'user.deactivated' THEN
      UPDATE users
      SET is_active = false, updated_at = p_event.created_at
      WHERE id = p_event.stream_id;

    WHEN 'user.reactivated' THEN
      UPDATE users
      SET is_active = true, updated_at = p_event.created_at
      WHERE id = p_event.stream_id;

    WHEN 'user.deleted' THEN
      -- Soft delete by default - could be extended for hard delete
      UPDATE users
      SET is_active = false, updated_at = p_event.created_at
      WHERE id = p_event.stream_id;

    ELSE
      -- Unknown event type - log warning
      RAISE WARNING 'Unknown user event type: %', p_event.event_type;
  END CASE;
END;
$$;

ALTER FUNCTION "public"."process_user_event"("record") OWNER TO "postgres";

COMMENT ON FUNCTION "public"."process_user_event"("record") IS
'Process user-related domain events and update projections.

Handles event types:
- user.profile.updated: Update first_name, last_name, name
- user.created: Create user record from invitation acceptance
- user.synced_from_auth: Sync from Supabase Auth
- user.role.assigned: Assign role to user
- user.access_dates.updated: Update access date range
- user.notification_preferences.updated: Update notification settings
- user.address.*: Address CRUD
- user.phone.*: Phone CRUD
- user.deactivated/reactivated/deleted: Lifecycle events';


-- ============================================================================
-- Reload PostgREST schema cache
-- ============================================================================

NOTIFY pgrst, 'reload schema';
