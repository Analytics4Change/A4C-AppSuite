-- ============================================================================
-- Migration: Fix User Event Handlers Schema
-- Purpose: Update split event handlers to use correct table names and schema
--
-- Root Cause: The split_event_handlers migration (20260119212104) was written
-- with outdated code that references:
--   1. user_org_access (renamed to user_organizations_projection on Jan 5)
--   2. notification_preferences JSONB column (removed on Jan 15)
--
-- This migration fixes all three affected handlers to use current schema.
-- ============================================================================

-- ============================================================================
-- 1. Fix handle_user_created
-- Changes:
--   - user_org_access → user_organizations_projection
--   - REMOVE notification_preferences column (doesn't exist anymore)
--   - ADD separate INSERT into user_notification_preferences_projection
-- ============================================================================

CREATE OR REPLACE FUNCTION handle_user_created(p_event record)
RETURNS void
LANGUAGE plpgsql
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_user_id UUID;
  v_org_id UUID;
  v_sms_enabled BOOLEAN;
  v_sms_phone_id UUID;
  v_in_app_enabled BOOLEAN;
  v_email_enabled BOOLEAN;
BEGIN
  v_user_id := (p_event.event_data->>'user_id')::UUID;
  v_org_id := (p_event.event_data->>'organization_id')::UUID;

  -- Insert user record
  INSERT INTO users (
    id, email, name, first_name, last_name, current_organization_id,
    accessible_organizations, roles, metadata, is_active, created_at, updated_at
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

  -- Create user_organizations_projection record (access dates only, NO notification_preferences)
  INSERT INTO user_organizations_projection (
    user_id, org_id, access_start_date, access_expiration_date, created_at, updated_at
  ) VALUES (
    v_user_id,
    v_org_id,
    (p_event.event_data->>'access_start_date')::DATE,
    (p_event.event_data->>'access_expiration_date')::DATE,
    p_event.created_at,
    p_event.created_at
  )
  ON CONFLICT (user_id, org_id) DO UPDATE SET
    access_start_date = COALESCE(EXCLUDED.access_start_date, user_organizations_projection.access_start_date),
    access_expiration_date = COALESCE(EXCLUDED.access_expiration_date, user_organizations_projection.access_expiration_date),
    updated_at = p_event.created_at;

  -- Create user_notification_preferences_projection record (normalized columns)
  -- Parse from nested JSONB with backwards compatibility for camelCase
  v_email_enabled := COALESCE(
    (p_event.event_data->'notification_preferences'->>'email')::BOOLEAN,
    true  -- Default to email enabled
  );
  v_sms_enabled := COALESCE(
    (p_event.event_data->'notification_preferences'->'sms'->>'enabled')::BOOLEAN,
    false
  );
  v_sms_phone_id := COALESCE(
    (p_event.event_data->'notification_preferences'->'sms'->>'phone_id')::UUID,
    (p_event.event_data->'notification_preferences'->'sms'->>'phoneId')::UUID  -- camelCase fallback
  );
  v_in_app_enabled := COALESCE(
    (p_event.event_data->'notification_preferences'->>'in_app')::BOOLEAN,
    (p_event.event_data->'notification_preferences'->>'inApp')::BOOLEAN,  -- camelCase fallback
    false
  );

  INSERT INTO user_notification_preferences_projection (
    user_id, organization_id, email_enabled, sms_enabled, sms_phone_id, in_app_enabled,
    created_at, updated_at
  ) VALUES (
    v_user_id,
    v_org_id,
    v_email_enabled,
    v_sms_enabled,
    v_sms_phone_id,
    v_in_app_enabled,
    p_event.created_at,
    p_event.created_at
  )
  ON CONFLICT (user_id, organization_id) DO UPDATE SET
    email_enabled = COALESCE(EXCLUDED.email_enabled, user_notification_preferences_projection.email_enabled),
    sms_enabled = COALESCE(EXCLUDED.sms_enabled, user_notification_preferences_projection.sms_enabled),
    sms_phone_id = COALESCE(EXCLUDED.sms_phone_id, user_notification_preferences_projection.sms_phone_id),
    in_app_enabled = COALESCE(EXCLUDED.in_app_enabled, user_notification_preferences_projection.in_app_enabled),
    updated_at = p_event.created_at;
END;
$$;

COMMENT ON FUNCTION handle_user_created(record) IS
  'Handle user.created events - creates user record, org membership, and notification preferences (v2: fixed table names and schema)';

-- ============================================================================
-- 2. Fix handle_user_access_dates_updated
-- Changes:
--   - user_org_access → user_organizations_projection (simple rename)
-- ============================================================================

CREATE OR REPLACE FUNCTION handle_user_access_dates_updated(p_event record)
RETURNS void
LANGUAGE plpgsql
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_user_id UUID;
  v_org_id UUID;
BEGIN
  v_user_id := (p_event.event_data->>'user_id')::UUID;
  v_org_id := (p_event.event_data->>'org_id')::UUID;

  UPDATE user_organizations_projection
  SET
    access_start_date = (p_event.event_data->>'access_start_date')::DATE,
    access_expiration_date = (p_event.event_data->>'access_expiration_date')::DATE,
    updated_at = p_event.created_at
  WHERE user_id = v_user_id AND org_id = v_org_id;

  IF NOT FOUND THEN
    INSERT INTO user_organizations_projection (
      user_id, org_id, access_start_date, access_expiration_date, created_at, updated_at
    ) VALUES (
      v_user_id, v_org_id,
      (p_event.event_data->>'access_start_date')::DATE,
      (p_event.event_data->>'access_expiration_date')::DATE,
      p_event.created_at, p_event.created_at
    );
  END IF;
END;
$$;

COMMENT ON FUNCTION handle_user_access_dates_updated(record) IS
  'Handle user.access_dates.updated events - updates org membership access window (v2: fixed table name)';

-- ============================================================================
-- 3. Fix handle_user_notification_preferences_updated
-- Changes:
--   - Target: user_notification_preferences_projection (NOT user_org_access)
--   - Parse JSONB event_data into normalized columns with camelCase fallback
-- ============================================================================

CREATE OR REPLACE FUNCTION handle_user_notification_preferences_updated(p_event record)
RETURNS void
LANGUAGE plpgsql
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_user_id UUID;
  v_org_id UUID;
  v_email_enabled BOOLEAN;
  v_sms_enabled BOOLEAN;
  v_sms_phone_id UUID;
  v_in_app_enabled BOOLEAN;
BEGIN
  v_user_id := (p_event.event_data->>'user_id')::UUID;
  v_org_id := (p_event.event_data->>'org_id')::UUID;

  -- Parse notification preferences from JSONB with backwards compatibility for camelCase
  v_email_enabled := COALESCE(
    (p_event.event_data->'notification_preferences'->>'email')::BOOLEAN,
    true
  );
  v_sms_enabled := COALESCE(
    (p_event.event_data->'notification_preferences'->'sms'->>'enabled')::BOOLEAN,
    false
  );
  v_sms_phone_id := COALESCE(
    (p_event.event_data->'notification_preferences'->'sms'->>'phone_id')::UUID,
    (p_event.event_data->'notification_preferences'->'sms'->>'phoneId')::UUID  -- camelCase fallback
  );
  v_in_app_enabled := COALESCE(
    (p_event.event_data->'notification_preferences'->>'in_app')::BOOLEAN,
    (p_event.event_data->'notification_preferences'->>'inApp')::BOOLEAN,  -- camelCase fallback
    false
  );

  -- Update user_notification_preferences_projection (normalized table)
  UPDATE user_notification_preferences_projection
  SET
    email_enabled = v_email_enabled,
    sms_enabled = v_sms_enabled,
    sms_phone_id = v_sms_phone_id,
    in_app_enabled = v_in_app_enabled,
    updated_at = p_event.created_at
  WHERE user_id = v_user_id AND organization_id = v_org_id;

  -- Create record if it doesn't exist
  IF NOT FOUND THEN
    INSERT INTO user_notification_preferences_projection (
      user_id, organization_id, email_enabled, sms_enabled, sms_phone_id, in_app_enabled,
      created_at, updated_at
    ) VALUES (
      v_user_id, v_org_id,
      v_email_enabled, v_sms_enabled, v_sms_phone_id, v_in_app_enabled,
      p_event.created_at, p_event.created_at
    );
  END IF;
END;
$$;

COMMENT ON FUNCTION handle_user_notification_preferences_updated(record) IS
  'Handle user.notification_preferences.updated events - updates normalized preferences table (v2: fixed to use correct table with normalized columns)';

-- ============================================================================
-- 4. Reset failed events for reprocessing
-- Clear processing_error so the trigger will retry them
-- ============================================================================

UPDATE domain_events
SET
  processing_error = NULL,
  processed_at = NULL,
  retry_count = COALESCE(retry_count, 0) + 1
WHERE processing_error LIKE '%user_org_access%'
  AND dismissed_at IS NULL;

-- Log how many events were reset
DO $$
DECLARE
  v_count INTEGER;
BEGIN
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RAISE NOTICE 'Reset % failed events for reprocessing', v_count;
END $$;
