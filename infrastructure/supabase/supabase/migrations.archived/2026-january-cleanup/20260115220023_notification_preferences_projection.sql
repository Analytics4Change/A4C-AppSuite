-- ============================================================================
-- Migration: Notification Preferences Projection Table
-- Purpose: Dedicated projection for user notification preferences (CQRS pattern)
--          Replaces JSONB column in user_organizations_projection
-- ============================================================================

-- ============================================================================
-- Part A: Create Notification Preferences Projection Table
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.user_notification_preferences_projection (
  -- Composite primary key: user preferences are per-organization
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL,

  -- Normalized preference columns (not JSONB)
  email_enabled BOOLEAN NOT NULL DEFAULT true,
  sms_enabled BOOLEAN NOT NULL DEFAULT false,
  sms_phone_id UUID REFERENCES public.user_phones(id) ON DELETE SET NULL,
  in_app_enabled BOOLEAN NOT NULL DEFAULT false,

  -- Audit timestamps
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Primary key
  PRIMARY KEY (user_id, organization_id)
);

-- ============================================================================
-- Part B: Indexes for Common Query Patterns
-- ============================================================================

-- Index for querying SMS-enabled users (bulk notification targeting)
CREATE INDEX IF NOT EXISTS idx_user_notification_prefs_sms_enabled
  ON public.user_notification_preferences_projection (organization_id)
  WHERE sms_enabled = true;

-- Index for querying by phone_id (when phone deleted, find affected prefs)
CREATE INDEX IF NOT EXISTS idx_user_notification_prefs_sms_phone
  ON public.user_notification_preferences_projection (sms_phone_id)
  WHERE sms_phone_id IS NOT NULL;

-- Index for user lookup across all orgs
CREATE INDEX IF NOT EXISTS idx_user_notification_prefs_user
  ON public.user_notification_preferences_projection (user_id);

-- ============================================================================
-- Part C: Enable Row Level Security
-- ============================================================================

ALTER TABLE public.user_notification_preferences_projection ENABLE ROW LEVEL SECURITY;

-- Users can view their own notification preferences
DROP POLICY IF EXISTS "user_notification_prefs_select_own" ON public.user_notification_preferences_projection;
CREATE POLICY "user_notification_prefs_select_own"
  ON public.user_notification_preferences_projection
  FOR SELECT
  USING (
    user_id = auth.uid()
    OR (auth.jwt() -> 'app_metadata' ->> 'org_id')::uuid = organization_id
  );

-- Users can update their own notification preferences
DROP POLICY IF EXISTS "user_notification_prefs_update_own" ON public.user_notification_preferences_projection;
CREATE POLICY "user_notification_prefs_update_own"
  ON public.user_notification_preferences_projection
  FOR UPDATE
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- Service role has full access (for event processors)
DROP POLICY IF EXISTS "user_notification_prefs_service_role" ON public.user_notification_preferences_projection;
CREATE POLICY "user_notification_prefs_service_role"
  ON public.user_notification_preferences_projection
  FOR ALL
  USING (current_setting('role') = 'service_role');

-- ============================================================================
-- Part D: Migrate Existing Data from JSONB Column
-- ============================================================================

-- Migrate from user_organizations_projection.notification_preferences JSONB
-- Note: This assumes the JSONB structure is:
-- {
--   "email": true,
--   "sms": { "enabled": false, "phoneId": "uuid" },
--   "inApp": false
-- }

INSERT INTO public.user_notification_preferences_projection (
  user_id,
  organization_id,
  email_enabled,
  sms_enabled,
  sms_phone_id,
  in_app_enabled,
  created_at,
  updated_at
)
SELECT
  uop.user_id,
  uop.org_id,  -- Note: column is org_id in user_organizations_projection
  COALESCE((uop.notification_preferences->>'email')::boolean, true),
  COALESCE((uop.notification_preferences->'sms'->>'enabled')::boolean, false),
  (uop.notification_preferences->'sms'->>'phoneId')::uuid,
  COALESCE((uop.notification_preferences->>'inApp')::boolean, false),
  COALESCE(uop.created_at, now()),
  COALESCE(uop.updated_at, now())
FROM public.user_organizations_projection uop
WHERE uop.notification_preferences IS NOT NULL
  AND uop.notification_preferences != '{}'::jsonb
ON CONFLICT (user_id, organization_id) DO NOTHING;

-- ============================================================================
-- Part E: Update process_user_event to write to BOTH tables
-- ============================================================================

-- Extend the existing user.notification_preferences.updated handler to ALSO
-- write to the new normalized projection table. This ensures backward
-- compatibility during migration - both JSONB and normalized tables stay in sync.

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

      -- Also populate the new normalized notification preferences projection
      INSERT INTO user_notification_preferences_projection (
        user_id,
        organization_id,
        email_enabled,
        sms_enabled,
        sms_phone_id,
        in_app_enabled,
        created_at,
        updated_at
      ) VALUES (
        v_user_id,
        v_org_id,
        COALESCE((p_event.event_data->'notification_preferences'->>'email')::boolean, true),
        COALESCE((p_event.event_data->'notification_preferences'->'sms'->>'enabled')::boolean, false),
        (p_event.event_data->'notification_preferences'->'sms'->>'phoneId')::uuid,
        COALESCE((p_event.event_data->'notification_preferences'->>'inApp')::boolean, false),
        p_event.created_at,
        p_event.created_at
      )
      ON CONFLICT (user_id, organization_id) DO NOTHING;

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
    -- New event handlers: Access Dates
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

      -- If no row exists, create it
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
    -- Notification Preferences (writes to BOTH legacy JSONB and new projection)
    -- =========================================================================

    WHEN 'user.notification_preferences.updated' THEN
      v_user_id := (p_event.event_data->>'user_id')::UUID;
      v_org_id := (p_event.event_data->>'org_id')::UUID;

      -- Write to legacy JSONB column (backward compatibility)
      UPDATE user_org_access
      SET
        notification_preferences = p_event.event_data->'notification_preferences',
        updated_at = p_event.created_at
      WHERE user_id = v_user_id
        AND org_id = v_org_id;

      -- If no row exists, create it
      IF NOT FOUND THEN
        INSERT INTO user_org_access (
          user_id, org_id, notification_preferences, created_at, updated_at
        ) VALUES (
          v_user_id, v_org_id,
          p_event.event_data->'notification_preferences',
          p_event.created_at, p_event.created_at
        );
      END IF;

      -- ALSO write to new normalized projection table
      INSERT INTO user_notification_preferences_projection (
        user_id,
        organization_id,
        email_enabled,
        sms_enabled,
        sms_phone_id,
        in_app_enabled,
        created_at,
        updated_at
      ) VALUES (
        v_user_id,
        v_org_id,
        COALESCE((p_event.event_data->'notification_preferences'->>'email')::boolean, true),
        COALESCE((p_event.event_data->'notification_preferences'->'sms'->>'enabled')::boolean, false),
        (p_event.event_data->'notification_preferences'->'sms'->>'phoneId')::uuid,
        COALESCE((p_event.event_data->'notification_preferences'->>'inApp')::boolean, false),
        p_event.created_at,
        p_event.created_at
      )
      ON CONFLICT (user_id, organization_id) DO UPDATE SET
        email_enabled = EXCLUDED.email_enabled,
        sms_enabled = EXCLUDED.sms_enabled,
        sms_phone_id = EXCLUDED.sms_phone_id,
        in_app_enabled = EXCLUDED.in_app_enabled,
        updated_at = EXCLUDED.updated_at;

    -- =========================================================================
    -- New event handlers: User Addresses
    -- =========================================================================

    WHEN 'user.address.added' THEN
      v_user_id := (p_event.event_data->>'user_id')::UUID;
      v_address_id := (p_event.event_data->>'address_id')::UUID;
      v_org_id := (p_event.event_data->>'org_id')::UUID;

      IF v_org_id IS NULL THEN
        -- Global address
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
        -- Org-specific override
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
        -- Global address update
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
        -- Org override update
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
        -- Soft delete (deactivate)
        IF v_org_id IS NULL THEN
          UPDATE user_addresses SET is_active = false, updated_at = p_event.created_at
          WHERE id = v_address_id;
        ELSE
          UPDATE user_org_address_overrides SET is_active = false, updated_at = p_event.created_at
          WHERE id = v_address_id;
        END IF;
      END IF;

    -- =========================================================================
    -- New event handlers: User Phones
    -- =========================================================================

    WHEN 'user.phone.added' THEN
      v_user_id := (p_event.event_data->>'user_id')::UUID;
      v_phone_id := (p_event.event_data->>'phone_id')::UUID;
      v_org_id := (p_event.event_data->>'org_id')::UUID;

      IF v_org_id IS NULL THEN
        -- Global phone
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
        -- Org-specific override
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
        -- Global phone update
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
        -- Org override update
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
        -- Soft delete (deactivate)
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
    IS 'User event processor v4 - handles user lifecycle, role assignment, access dates, notification preferences (dual-write to JSONB and normalized table), addresses, and phones. Supports both global and org-specific data with proper scope handling.';

-- ============================================================================
-- Part G: Comments and Documentation
-- ============================================================================

COMMENT ON TABLE public.user_notification_preferences_projection IS
  'CQRS projection for user notification preferences. Normalized columns for email, SMS, and in-app notification settings per organization.';

COMMENT ON COLUMN public.user_notification_preferences_projection.user_id IS
  'User ID - references auth.users';

COMMENT ON COLUMN public.user_notification_preferences_projection.organization_id IS
  'Organization context for these preferences';

COMMENT ON COLUMN public.user_notification_preferences_projection.email_enabled IS
  'Whether email notifications are enabled for this user in this org';

COMMENT ON COLUMN public.user_notification_preferences_projection.sms_enabled IS
  'Whether SMS notifications are enabled for this user in this org';

COMMENT ON COLUMN public.user_notification_preferences_projection.sms_phone_id IS
  'The user_phone to use for SMS notifications (NULL if SMS disabled)';

COMMENT ON COLUMN public.user_notification_preferences_projection.in_app_enabled IS
  'Whether in-app notifications are enabled for this user in this org';

