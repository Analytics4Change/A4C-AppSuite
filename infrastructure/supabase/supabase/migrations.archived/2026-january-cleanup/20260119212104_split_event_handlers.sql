-- ============================================================================
-- Migration: Split Event Processors into Individual Handlers
-- Purpose: Refactor monolithic event processors into small, focused handler
--          functions for better maintainability and independent validation.
--
-- Architecture:
--   - Each event type gets its own handler function: handle_<aggregate>_<action>()
--   - Routers use explicit CASE statements (validated by plpgsql_check)
--   - No per-handler error handling (centralized in process_domain_event)
--
-- Benefits:
--   - Add new event: Create handler + add 1 CASE line
--   - Bug fix: Modify only affected handler
--   - plpgsql_check validates each handler independently
--   - Smaller blast radius for errors
-- ============================================================================

-- ============================================================================
-- PART 1: USER EVENT HANDLERS (11 handlers)
-- ============================================================================

-- ---------------------------------------------------------------------------
-- handle_user_created
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION handle_user_created(p_event record)
RETURNS void
LANGUAGE plpgsql
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_user_id UUID;
  v_org_id UUID;
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

  -- Create user_org_access record
  INSERT INTO user_org_access (
    user_id, org_id, access_start_date, access_expiration_date,
    notification_preferences, created_at, updated_at
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
END;
$$;

-- ---------------------------------------------------------------------------
-- handle_user_synced_from_auth
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION handle_user_synced_from_auth(p_event record)
RETURNS void
LANGUAGE plpgsql
SET search_path = public, extensions, pg_temp
AS $$
BEGIN
  INSERT INTO users (
    id, email, name, is_active, created_at, updated_at
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
END;
$$;

-- ---------------------------------------------------------------------------
-- handle_user_role_assigned (in user processor context)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION handle_user_role_assigned(p_event record)
RETURNS void
LANGUAGE plpgsql
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_platform_org_id UUID := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::UUID;
  v_org_id UUID;
  v_scope_path LTREE;
BEGIN
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
    user_id, role_id, organization_id, scope_path,
    role_valid_from, role_valid_until, assigned_at
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
END;
$$;

-- ---------------------------------------------------------------------------
-- handle_user_access_dates_updated
-- ---------------------------------------------------------------------------
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

  UPDATE user_org_access
  SET
    access_start_date = (p_event.event_data->>'access_start_date')::DATE,
    access_expiration_date = (p_event.event_data->>'access_expiration_date')::DATE,
    updated_at = p_event.created_at
  WHERE user_id = v_user_id AND org_id = v_org_id;

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
END;
$$;

-- ---------------------------------------------------------------------------
-- handle_user_notification_preferences_updated
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION handle_user_notification_preferences_updated(p_event record)
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

  UPDATE user_org_access
  SET
    notification_preferences = p_event.event_data->'notification_preferences',
    updated_at = p_event.created_at
  WHERE user_id = v_user_id AND org_id = v_org_id;

  IF NOT FOUND THEN
    INSERT INTO user_org_access (
      user_id, org_id, notification_preferences, created_at, updated_at
    ) VALUES (
      v_user_id, v_org_id,
      p_event.event_data->'notification_preferences',
      p_event.created_at, p_event.created_at
    );
  END IF;
END;
$$;

-- ---------------------------------------------------------------------------
-- handle_user_address_added
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION handle_user_address_added(p_event record)
RETURNS void
LANGUAGE plpgsql
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_user_id UUID;
  v_address_id UUID;
  v_org_id UUID;
BEGIN
  v_user_id := (p_event.event_data->>'user_id')::UUID;
  v_address_id := (p_event.event_data->>'address_id')::UUID;
  v_org_id := (p_event.event_data->>'org_id')::UUID;

  IF v_org_id IS NULL THEN
    -- Global address
    INSERT INTO user_addresses (
      id, user_id, label, type, street1, street2, city, state, zip_code, country,
      is_primary, is_active, metadata, created_at, updated_at
    ) VALUES (
      v_address_id, v_user_id,
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
      v_address_id, v_user_id, v_org_id,
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
END;
$$;

-- ---------------------------------------------------------------------------
-- handle_user_address_updated
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION handle_user_address_updated(p_event record)
RETURNS void
LANGUAGE plpgsql
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_address_id UUID;
  v_org_id UUID;
BEGIN
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
END;
$$;

-- ---------------------------------------------------------------------------
-- handle_user_address_removed
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION handle_user_address_removed(p_event record)
RETURNS void
LANGUAGE plpgsql
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_address_id UUID;
  v_org_id UUID;
BEGIN
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
END;
$$;

-- ---------------------------------------------------------------------------
-- handle_user_phone_added
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION handle_user_phone_added(p_event record)
RETURNS void
LANGUAGE plpgsql
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_user_id UUID;
  v_phone_id UUID;
  v_org_id UUID;
BEGIN
  v_user_id := (p_event.event_data->>'user_id')::UUID;
  v_phone_id := (p_event.event_data->>'phone_id')::UUID;
  v_org_id := (p_event.event_data->>'org_id')::UUID;

  IF v_org_id IS NULL THEN
    -- Global phone
    INSERT INTO user_phones (
      id, user_id, label, type, number, extension, country_code,
      is_primary, is_active, sms_capable, metadata, created_at, updated_at
    ) VALUES (
      v_phone_id, v_user_id,
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
      v_phone_id, v_user_id, v_org_id,
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
END;
$$;

-- ---------------------------------------------------------------------------
-- handle_user_phone_updated
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION handle_user_phone_updated(p_event record)
RETURNS void
LANGUAGE plpgsql
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_phone_id UUID;
  v_org_id UUID;
BEGIN
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
END;
$$;

-- ---------------------------------------------------------------------------
-- handle_user_phone_removed
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION handle_user_phone_removed(p_event record)
RETURNS void
LANGUAGE plpgsql
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_phone_id UUID;
  v_org_id UUID;
BEGIN
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
END;
$$;

-- ============================================================================
-- PART 2: ORGANIZATION EVENT HANDLERS (11 handlers)
-- ============================================================================

-- ---------------------------------------------------------------------------
-- handle_organization_created
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION handle_organization_created(p_event record)
RETURNS void
LANGUAGE plpgsql
SET search_path = public, extensions, pg_temp
AS $$
BEGIN
  INSERT INTO organizations_projection (
    id, name, subdomain, subdomain_status, is_active, parent_path,
    organization_type, metadata, tags, created_at, updated_at
  ) VALUES (
    p_event.stream_id,
    safe_jsonb_extract_text(p_event.event_data, 'name'),
    safe_jsonb_extract_text(p_event.event_data, 'subdomain'),
    COALESCE(safe_jsonb_extract_text(p_event.event_data, 'subdomain_status'), 'pending'),
    true,
    COALESCE(
      safe_jsonb_extract_text(p_event.event_data, 'parent_path')::ltree,
      p_event.stream_id::text::ltree
    ),
    COALESCE(safe_jsonb_extract_text(p_event.event_data, 'organization_type'), 'provider')::organization_type,
    COALESCE(p_event.event_data->'metadata', '{}'::jsonb),
    COALESCE(
      ARRAY(SELECT jsonb_array_elements_text(p_event.event_data->'tags')),
      '{}'::TEXT[]
    ),
    p_event.created_at,
    p_event.created_at
  )
  ON CONFLICT (id) DO NOTHING;
END;
$$;

-- ---------------------------------------------------------------------------
-- handle_organization_updated
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION handle_organization_updated(p_event record)
RETURNS void
LANGUAGE plpgsql
SET search_path = public, extensions, pg_temp
AS $$
BEGIN
  UPDATE organizations_projection
  SET
    name = COALESCE(safe_jsonb_extract_text(p_event.event_data, 'name'), name),
    subdomain = COALESCE(safe_jsonb_extract_text(p_event.event_data, 'subdomain'), subdomain),
    subdomain_status = COALESCE(safe_jsonb_extract_text(p_event.event_data, 'subdomain_status'), subdomain_status),
    organization_type = COALESCE(safe_jsonb_extract_text(p_event.event_data, 'organization_type')::organization_type, organization_type),
    metadata = CASE
      WHEN p_event.event_data ? 'metadata' THEN p_event.event_data->'metadata'
      ELSE metadata
    END,
    tags = CASE
      WHEN p_event.event_data ? 'tags' THEN
        COALESCE(ARRAY(SELECT jsonb_array_elements_text(p_event.event_data->'tags')), '{}'::TEXT[])
      ELSE tags
    END,
    updated_at = p_event.created_at
  WHERE id = p_event.stream_id;
END;
$$;

-- ---------------------------------------------------------------------------
-- handle_organization_subdomain_status_changed
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION handle_organization_subdomain_status_changed(p_event record)
RETURNS void
LANGUAGE plpgsql
SET search_path = public, extensions, pg_temp
AS $$
BEGIN
  UPDATE organizations_projection
  SET
    subdomain_status = COALESCE(safe_jsonb_extract_text(p_event.event_data, 'status'), subdomain_status),
    updated_at = p_event.created_at
  WHERE id = p_event.stream_id;
END;
$$;

-- ---------------------------------------------------------------------------
-- handle_organization_deactivated
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION handle_organization_deactivated(p_event record)
RETURNS void
LANGUAGE plpgsql
SET search_path = public, extensions, pg_temp
AS $$
BEGIN
  UPDATE organizations_projection
  SET
    is_active = false,
    updated_at = p_event.created_at
  WHERE id = p_event.stream_id;
END;
$$;

-- ---------------------------------------------------------------------------
-- handle_organization_reactivated
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION handle_organization_reactivated(p_event record)
RETURNS void
LANGUAGE plpgsql
SET search_path = public, extensions, pg_temp
AS $$
BEGIN
  UPDATE organizations_projection
  SET
    is_active = true,
    updated_at = p_event.created_at
  WHERE id = p_event.stream_id;
END;
$$;

-- ---------------------------------------------------------------------------
-- handle_organization_deleted
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION handle_organization_deleted(p_event record)
RETURNS void
LANGUAGE plpgsql
SET search_path = public, extensions, pg_temp
AS $$
BEGIN
  UPDATE organizations_projection
  SET
    deleted_at = p_event.created_at,
    is_active = false,
    updated_at = p_event.created_at
  WHERE id = p_event.stream_id;
END;
$$;

-- ---------------------------------------------------------------------------
-- handle_bootstrap_completed
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION handle_bootstrap_completed(p_event record)
RETURNS void
LANGUAGE plpgsql
SET search_path = public, extensions, pg_temp
AS $$
BEGIN
  IF p_event.stream_id IS NOT NULL THEN
    UPDATE organizations_projection
    SET
      metadata = jsonb_set(
        COALESCE(metadata, '{}'),
        '{bootstrap}',
        jsonb_build_object(
          'bootstrap_id', p_event.event_data->>'bootstrap_id',
          'completed_at', p_event.created_at,
          'workflow_id', p_event.event_data->>'workflowId'
        )
      ),
      updated_at = p_event.created_at
    WHERE id = p_event.stream_id;
  END IF;
END;
$$;

-- ---------------------------------------------------------------------------
-- handle_bootstrap_failed
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION handle_bootstrap_failed(p_event record)
RETURNS void
LANGUAGE plpgsql
SET search_path = public, extensions, pg_temp
AS $$
BEGIN
  IF p_event.stream_id IS NOT NULL THEN
    UPDATE organizations_projection
    SET
      metadata = jsonb_set(
        COALESCE(metadata, '{}'),
        '{bootstrap}',
        jsonb_build_object(
          'bootstrap_id', p_event.event_data->>'bootstrap_id',
          'failed_at', p_event.created_at,
          'error', p_event.event_data->>'error',
          'workflow_id', p_event.event_data->>'workflowId'
        )
      ),
      updated_at = p_event.created_at
    WHERE id = p_event.stream_id;
  END IF;
END;
$$;

-- ---------------------------------------------------------------------------
-- handle_bootstrap_cancelled
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION handle_bootstrap_cancelled(p_event record)
RETURNS void
LANGUAGE plpgsql
SET search_path = public, extensions, pg_temp
AS $$
BEGIN
  IF p_event.stream_id IS NOT NULL THEN
    UPDATE organizations_projection
    SET
      metadata = jsonb_set(
        COALESCE(metadata, '{}'),
        '{bootstrap}',
        jsonb_build_object(
          'bootstrap_id', p_event.event_data->>'bootstrap_id',
          'cancelled_at', p_event.created_at,
          'cleanup_completed', p_event.event_data->>'cleanup_completed'
        )
      ),
      updated_at = p_event.created_at
    WHERE id = p_event.stream_id;
  END IF;
END;
$$;

-- ---------------------------------------------------------------------------
-- handle_user_invited
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION handle_user_invited(p_event record)
RETURNS void
LANGUAGE plpgsql
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_correlation_id UUID;
BEGIN
  v_correlation_id := (p_event.event_metadata->>'correlation_id')::UUID;

  INSERT INTO invitations_projection (
    invitation_id, organization_id, email, first_name, last_name,
    role, roles, token, expires_at, status,
    access_start_date, access_expiration_date, notification_preferences,
    phones, correlation_id, tags, created_at, updated_at
  ) VALUES (
    safe_jsonb_extract_uuid(p_event.event_data, 'invitation_id'),
    safe_jsonb_extract_uuid(p_event.event_data, 'org_id'),
    safe_jsonb_extract_text(p_event.event_data, 'email'),
    safe_jsonb_extract_text(p_event.event_data, 'first_name'),
    safe_jsonb_extract_text(p_event.event_data, 'last_name'),
    safe_jsonb_extract_text(p_event.event_data, 'role'),
    COALESCE(p_event.event_data->'roles', '[]'::jsonb),
    safe_jsonb_extract_text(p_event.event_data, 'token'),
    safe_jsonb_extract_timestamp(p_event.event_data, 'expires_at'),
    'pending',
    (p_event.event_data->>'access_start_date')::DATE,
    (p_event.event_data->>'access_expiration_date')::DATE,
    COALESCE(p_event.event_data->'notification_preferences', '{"email": true, "sms": {"enabled": false, "phoneId": null}, "inApp": false}'::jsonb),
    COALESCE(p_event.event_data->'phones', '[]'::jsonb),
    v_correlation_id,
    COALESCE(
      ARRAY(SELECT jsonb_array_elements_text(p_event.event_data->'tags')),
      '{}'::TEXT[]
    ),
    p_event.created_at,
    p_event.created_at
  )
  ON CONFLICT (invitation_id) DO UPDATE SET
    token = EXCLUDED.token,
    expires_at = EXCLUDED.expires_at,
    status = 'pending',
    phones = EXCLUDED.phones,
    notification_preferences = EXCLUDED.notification_preferences,
    correlation_id = COALESCE(invitations_projection.correlation_id, EXCLUDED.correlation_id),
    updated_at = EXCLUDED.updated_at;
END;
$$;

-- ---------------------------------------------------------------------------
-- handle_invitation_resent
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION handle_invitation_resent(p_event record)
RETURNS void
LANGUAGE plpgsql
SET search_path = public, extensions, pg_temp
AS $$
BEGIN
  UPDATE invitations_projection
  SET
    token = safe_jsonb_extract_text(p_event.event_data, 'token'),
    expires_at = safe_jsonb_extract_timestamp(p_event.event_data, 'expires_at'),
    status = 'pending',
    updated_at = p_event.created_at
  WHERE invitation_id = safe_jsonb_extract_uuid(p_event.event_data, 'invitation_id');
END;
$$;

-- ============================================================================
-- PART 3: ORGANIZATION UNIT EVENT HANDLERS (5 handlers)
-- ============================================================================

-- ---------------------------------------------------------------------------
-- handle_organization_unit_created
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION handle_organization_unit_created(p_event record)
RETURNS void
LANGUAGE plpgsql
SET search_path = public, extensions, pg_temp
AS $$
BEGIN
  -- Validate parent path exists
  IF NOT EXISTS (
    SELECT 1 FROM organizations_projection WHERE path = (p_event.event_data->>'parent_path')::LTREE
    UNION ALL
    SELECT 1 FROM organization_units_projection WHERE path = (p_event.event_data->>'parent_path')::LTREE
  ) THEN
    RAISE WARNING 'Parent path % does not exist for organization unit %',
      p_event.event_data->>'parent_path', p_event.stream_id;
  END IF;

  INSERT INTO organization_units_projection (
    id, organization_id, name, display_name, slug, path, parent_path,
    timezone, is_active, created_at, updated_at
  ) VALUES (
    p_event.stream_id,
    safe_jsonb_extract_uuid(p_event.event_data, 'organization_id'),
    safe_jsonb_extract_text(p_event.event_data, 'name'),
    COALESCE(safe_jsonb_extract_text(p_event.event_data, 'display_name'), safe_jsonb_extract_text(p_event.event_data, 'name')),
    safe_jsonb_extract_text(p_event.event_data, 'slug'),
    (p_event.event_data->>'path')::LTREE,
    (p_event.event_data->>'parent_path')::LTREE,
    COALESCE(safe_jsonb_extract_text(p_event.event_data, 'timezone'), 'UTC'),
    true,
    p_event.created_at,
    p_event.created_at
  )
  ON CONFLICT (id) DO UPDATE SET
    name = EXCLUDED.name,
    display_name = EXCLUDED.display_name,
    slug = EXCLUDED.slug,
    path = EXCLUDED.path,
    parent_path = EXCLUDED.parent_path,
    timezone = EXCLUDED.timezone,
    updated_at = EXCLUDED.updated_at;
END;
$$;

-- ---------------------------------------------------------------------------
-- handle_organization_unit_updated
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION handle_organization_unit_updated(p_event record)
RETURNS void
LANGUAGE plpgsql
SET search_path = public, extensions, pg_temp
AS $$
BEGIN
  UPDATE organization_units_projection
  SET
    name = COALESCE(safe_jsonb_extract_text(p_event.event_data, 'name'), name),
    display_name = COALESCE(safe_jsonb_extract_text(p_event.event_data, 'display_name'), display_name),
    timezone = COALESCE(safe_jsonb_extract_text(p_event.event_data, 'timezone'), timezone),
    updated_at = p_event.created_at
  WHERE id = p_event.stream_id;

  IF NOT FOUND THEN
    RAISE WARNING 'Organization unit % not found for update event', p_event.stream_id;
  END IF;
END;
$$;

-- ---------------------------------------------------------------------------
-- handle_organization_unit_deactivated
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION handle_organization_unit_deactivated(p_event record)
RETURNS void
LANGUAGE plpgsql
SET search_path = public, extensions, pg_temp
AS $$
BEGIN
  -- Cascade deactivate using ltree containment
  UPDATE organization_units_projection
  SET
    is_active = false,
    deactivated_at = p_event.created_at,
    updated_at = p_event.created_at
  WHERE path <@ (p_event.event_data->>'path')::ltree
    AND is_active = true
    AND deleted_at IS NULL;

  IF NOT FOUND THEN
    RAISE WARNING 'Organization unit % not found for deactivation event', p_event.stream_id;
  END IF;
END;
$$;

-- ---------------------------------------------------------------------------
-- handle_organization_unit_reactivated
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION handle_organization_unit_reactivated(p_event record)
RETURNS void
LANGUAGE plpgsql
SET search_path = public, extensions, pg_temp
AS $$
BEGIN
  -- Cascade reactivate using ltree containment
  UPDATE organization_units_projection
  SET
    is_active = true,
    deactivated_at = NULL,
    updated_at = p_event.created_at
  WHERE path <@ (p_event.event_data->>'path')::ltree
    AND is_active = false
    AND deleted_at IS NULL;

  IF NOT FOUND THEN
    RAISE WARNING 'Organization unit % not found for reactivation event', p_event.stream_id;
  END IF;
END;
$$;

-- ---------------------------------------------------------------------------
-- handle_organization_unit_deleted
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION handle_organization_unit_deleted(p_event record)
RETURNS void
LANGUAGE plpgsql
SET search_path = public, extensions, pg_temp
AS $$
BEGIN
  UPDATE organization_units_projection
  SET
    deleted_at = p_event.created_at,
    updated_at = p_event.created_at
  WHERE id = p_event.stream_id
    AND deleted_at IS NULL;

  IF NOT FOUND THEN
    RAISE WARNING 'Organization unit % not found or already deleted', p_event.stream_id;
  END IF;
END;
$$;

-- ============================================================================
-- PART 4: RBAC EVENT HANDLERS (10 handlers)
-- ============================================================================

-- ---------------------------------------------------------------------------
-- handle_role_created
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION handle_role_created(p_event record)
RETURNS void
LANGUAGE plpgsql
SET search_path = public, extensions, pg_temp
AS $$
BEGIN
  INSERT INTO roles_projection (
    id, name, description, organization_id, org_hierarchy_scope,
    is_active, created_at, updated_at
  ) VALUES (
    p_event.stream_id,
    p_event.event_data->>'name',
    p_event.event_data->>'description',
    (p_event.event_data->>'organization_id')::UUID,
    (p_event.event_data->>'org_hierarchy_scope')::LTREE,
    true,
    p_event.created_at,
    p_event.created_at
  )
  ON CONFLICT (id) DO UPDATE SET
    name = EXCLUDED.name,
    description = EXCLUDED.description,
    organization_id = EXCLUDED.organization_id,
    org_hierarchy_scope = EXCLUDED.org_hierarchy_scope,
    updated_at = EXCLUDED.updated_at;
END;
$$;

-- ---------------------------------------------------------------------------
-- handle_role_updated
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION handle_role_updated(p_event record)
RETURNS void
LANGUAGE plpgsql
SET search_path = public, extensions, pg_temp
AS $$
BEGIN
  UPDATE roles_projection SET
    name = COALESCE(p_event.event_data->>'name', name),
    description = COALESCE(p_event.event_data->>'description', description),
    updated_at = p_event.created_at
  WHERE id = p_event.stream_id;
END;
$$;

-- ---------------------------------------------------------------------------
-- handle_role_deactivated
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION handle_role_deactivated(p_event record)
RETURNS void
LANGUAGE plpgsql
SET search_path = public, extensions, pg_temp
AS $$
BEGIN
  UPDATE roles_projection SET
    is_active = false,
    updated_at = p_event.created_at
  WHERE id = p_event.stream_id;
END;
$$;

-- ---------------------------------------------------------------------------
-- handle_role_reactivated
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION handle_role_reactivated(p_event record)
RETURNS void
LANGUAGE plpgsql
SET search_path = public, extensions, pg_temp
AS $$
BEGIN
  UPDATE roles_projection SET
    is_active = true,
    updated_at = p_event.created_at
  WHERE id = p_event.stream_id;
END;
$$;

-- ---------------------------------------------------------------------------
-- handle_role_deleted
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION handle_role_deleted(p_event record)
RETURNS void
LANGUAGE plpgsql
SET search_path = public, extensions, pg_temp
AS $$
BEGIN
  UPDATE roles_projection SET
    deleted_at = p_event.created_at,
    updated_at = p_event.created_at
  WHERE id = p_event.stream_id;
END;
$$;

-- ---------------------------------------------------------------------------
-- handle_role_permission_granted
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION handle_role_permission_granted(p_event record)
RETURNS void
LANGUAGE plpgsql
SET search_path = public, extensions, pg_temp
AS $$
BEGIN
  INSERT INTO role_permissions_projection (role_id, permission_id, granted_at)
  VALUES (
    p_event.stream_id,
    (p_event.event_data->>'permission_id')::UUID,
    p_event.created_at
  )
  ON CONFLICT (role_id, permission_id) DO NOTHING;
END;
$$;

-- ---------------------------------------------------------------------------
-- handle_role_permission_revoked
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION handle_role_permission_revoked(p_event record)
RETURNS void
LANGUAGE plpgsql
SET search_path = public, extensions, pg_temp
AS $$
BEGIN
  DELETE FROM role_permissions_projection
  WHERE role_id = p_event.stream_id
    AND permission_id = (p_event.event_data->>'permission_id')::UUID;
END;
$$;

-- ---------------------------------------------------------------------------
-- handle_permission_defined
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION handle_permission_defined(p_event record)
RETURNS void
LANGUAGE plpgsql
SET search_path = public, extensions, pg_temp
AS $$
BEGIN
  INSERT INTO permissions_projection (
    id, applet, action, description, scope_type, requires_mfa, created_at
  ) VALUES (
    p_event.stream_id,
    p_event.event_data->>'applet',
    p_event.event_data->>'action',
    p_event.event_data->>'description',
    p_event.event_data->>'scope_type',
    COALESCE((p_event.event_data->>'requires_mfa')::BOOLEAN, false),
    p_event.created_at
  )
  ON CONFLICT (id) DO UPDATE SET
    description = EXCLUDED.description,
    scope_type = EXCLUDED.scope_type,
    requires_mfa = EXCLUDED.requires_mfa;
END;
$$;

-- ---------------------------------------------------------------------------
-- handle_rbac_user_role_assigned (RBAC context - different from user context)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION handle_rbac_user_role_assigned(p_event record)
RETURNS void
LANGUAGE plpgsql
SET search_path = public, extensions, pg_temp
AS $$
BEGIN
  INSERT INTO user_roles_projection (user_id, role_id, org_id, scope_path, assigned_at)
  VALUES (
    p_event.stream_id,
    (p_event.event_data->>'role_id')::UUID,
    CASE WHEN p_event.event_data->>'org_id' = '*' THEN NULL ELSE (p_event.event_data->>'org_id')::UUID END,
    CASE WHEN p_event.event_data->>'scope_path' = '*' THEN NULL ELSE (p_event.event_data->>'scope_path')::LTREE END,
    p_event.created_at
  )
  ON CONFLICT (user_id, role_id, org_id) DO NOTHING;
END;
$$;

-- ---------------------------------------------------------------------------
-- handle_user_role_revoked
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION handle_user_role_revoked(p_event record)
RETURNS void
LANGUAGE plpgsql
SET search_path = public, extensions, pg_temp
AS $$
BEGIN
  DELETE FROM user_roles_projection
  WHERE user_id = p_event.stream_id
    AND role_id = (p_event.event_data->>'role_id')::UUID;
END;
$$;

-- ============================================================================
-- PART 5: ROUTERS (Explicit CASE dispatch)
-- ============================================================================

-- ---------------------------------------------------------------------------
-- process_user_event - Router v4 (handler dispatch)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION process_user_event(p_event record)
RETURNS void
LANGUAGE plpgsql
SET search_path = public, extensions, pg_temp
AS $$
BEGIN
  CASE p_event.event_type
    -- User lifecycle
    WHEN 'user.created' THEN PERFORM handle_user_created(p_event);
    WHEN 'user.synced_from_auth' THEN PERFORM handle_user_synced_from_auth(p_event);
    WHEN 'user.role.assigned' THEN PERFORM handle_user_role_assigned(p_event);

    -- Access dates
    WHEN 'user.access_dates.updated' THEN PERFORM handle_user_access_dates_updated(p_event);

    -- Notification preferences
    WHEN 'user.notification_preferences.updated' THEN PERFORM handle_user_notification_preferences_updated(p_event);

    -- Addresses
    WHEN 'user.address.added' THEN PERFORM handle_user_address_added(p_event);
    WHEN 'user.address.updated' THEN PERFORM handle_user_address_updated(p_event);
    WHEN 'user.address.removed' THEN PERFORM handle_user_address_removed(p_event);

    -- Phones
    WHEN 'user.phone.added' THEN PERFORM handle_user_phone_added(p_event);
    WHEN 'user.phone.updated' THEN PERFORM handle_user_phone_updated(p_event);
    WHEN 'user.phone.removed' THEN PERFORM handle_user_phone_removed(p_event);

    ELSE
      RAISE WARNING 'Unknown user event type: %', p_event.event_type;
  END CASE;
END;
$$;

COMMENT ON FUNCTION process_user_event(record) IS
'User event router v4 - dispatches to individual handler functions.
Handlers: handle_user_created, handle_user_synced_from_auth, handle_user_role_assigned,
handle_user_access_dates_updated, handle_user_notification_preferences_updated,
handle_user_address_added/updated/removed, handle_user_phone_added/updated/removed';

-- ---------------------------------------------------------------------------
-- process_organization_event - Router v2 (handler dispatch)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION process_organization_event(p_event record)
RETURNS void
LANGUAGE plpgsql
SET search_path = public, extensions, pg_temp
AS $$
BEGIN
  CASE p_event.event_type
    -- Organization lifecycle
    WHEN 'organization.created' THEN PERFORM handle_organization_created(p_event);
    WHEN 'organization.updated' THEN PERFORM handle_organization_updated(p_event);
    WHEN 'organization.subdomain_status.changed' THEN PERFORM handle_organization_subdomain_status_changed(p_event);
    WHEN 'organization.deactivated' THEN PERFORM handle_organization_deactivated(p_event);
    WHEN 'organization.reactivated' THEN PERFORM handle_organization_reactivated(p_event);
    WHEN 'organization.deleted' THEN PERFORM handle_organization_deleted(p_event);

    -- Bootstrap
    WHEN 'bootstrap.completed' THEN PERFORM handle_bootstrap_completed(p_event);
    WHEN 'bootstrap.failed' THEN PERFORM handle_bootstrap_failed(p_event);
    WHEN 'bootstrap.cancelled' THEN PERFORM handle_bootstrap_cancelled(p_event);

    -- Invitations
    WHEN 'user.invited' THEN PERFORM handle_user_invited(p_event);
    WHEN 'invitation.resent' THEN PERFORM handle_invitation_resent(p_event);

    ELSE
      RAISE WARNING 'Unknown organization event type: %', p_event.event_type;
  END CASE;
END;
$$;

COMMENT ON FUNCTION process_organization_event(record) IS
'Organization event router v2 - dispatches to individual handler functions.
Handlers: handle_organization_created/updated/deactivated/reactivated/deleted,
handle_organization_subdomain_status_changed, handle_bootstrap_completed/failed/cancelled,
handle_user_invited, handle_invitation_resent';

-- ---------------------------------------------------------------------------
-- process_organization_unit_event - Router v2 (handler dispatch)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION process_organization_unit_event(p_event record)
RETURNS void
LANGUAGE plpgsql
SET search_path = public, extensions, pg_temp
AS $$
BEGIN
  CASE p_event.event_type
    WHEN 'organization_unit.created' THEN PERFORM handle_organization_unit_created(p_event);
    WHEN 'organization_unit.updated' THEN PERFORM handle_organization_unit_updated(p_event);
    WHEN 'organization_unit.deactivated' THEN PERFORM handle_organization_unit_deactivated(p_event);
    WHEN 'organization_unit.reactivated' THEN PERFORM handle_organization_unit_reactivated(p_event);
    WHEN 'organization_unit.deleted' THEN PERFORM handle_organization_unit_deleted(p_event);

    ELSE
      RAISE WARNING 'Unknown organization_unit event type: %', p_event.event_type;
  END CASE;
END;
$$;

COMMENT ON FUNCTION process_organization_unit_event(record) IS
'Organization unit event router v2 - dispatches to individual handler functions.
Handlers: handle_organization_unit_created/updated/deactivated/reactivated/deleted';

-- ---------------------------------------------------------------------------
-- process_rbac_event - Router v2 (handler dispatch)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION process_rbac_event(p_event record)
RETURNS void
LANGUAGE plpgsql
SET search_path = public, extensions, pg_temp
AS $$
BEGIN
  CASE p_event.event_type
    -- Role lifecycle
    WHEN 'role.created' THEN PERFORM handle_role_created(p_event);
    WHEN 'role.updated' THEN PERFORM handle_role_updated(p_event);
    WHEN 'role.deactivated' THEN PERFORM handle_role_deactivated(p_event);
    WHEN 'role.reactivated' THEN PERFORM handle_role_reactivated(p_event);
    WHEN 'role.deleted' THEN PERFORM handle_role_deleted(p_event);

    -- Role permissions
    WHEN 'role.permission.granted' THEN PERFORM handle_role_permission_granted(p_event);
    WHEN 'role.permission.revoked' THEN PERFORM handle_role_permission_revoked(p_event);

    -- Permission definition
    WHEN 'permission.defined' THEN PERFORM handle_permission_defined(p_event);

    -- User role assignment
    WHEN 'user.role.assigned' THEN PERFORM handle_rbac_user_role_assigned(p_event);
    WHEN 'user.role.revoked' THEN PERFORM handle_user_role_revoked(p_event);

    ELSE
      RAISE WARNING 'Unknown RBAC event type: %', p_event.event_type;
  END CASE;
END;
$$;

COMMENT ON FUNCTION process_rbac_event(record) IS
'RBAC event router v2 - dispatches to individual handler functions.
Handlers: handle_role_created/updated/deactivated/reactivated/deleted,
handle_role_permission_granted/revoked, handle_permission_defined,
handle_rbac_user_role_assigned, handle_user_role_revoked';
