-- Migration: User Management Schema Updates
-- Purpose: Support multi-role invitations and proper user name fields
--
-- Changes:
-- 1. Add `roles` JSONB column to invitations_projection (array of {role_id, role_name})
-- 2. Add `first_name`, `last_name` columns to users table
-- 3. Backfill roles from existing role column
-- 4. Update event processor to handle new roles array format

-- ============================================================================
-- 1. INVITATIONS_PROJECTION: Add roles JSONB column
-- ============================================================================

-- Add new roles column (JSONB array)
ALTER TABLE invitations_projection
ADD COLUMN IF NOT EXISTS roles JSONB DEFAULT '[]'::jsonb;

-- Add comment explaining the structure
COMMENT ON COLUMN invitations_projection.roles IS
'Array of role assignments: [{role_id: UUID, role_name: string}]. Replaces legacy role column.';

-- Backfill roles from existing role column for pending/accepted invitations
-- This creates a single-element array with the legacy role name
UPDATE invitations_projection
SET roles = jsonb_build_array(
  jsonb_build_object(
    'role_id', NULL,
    'role_name', role
  )
)
WHERE roles = '[]'::jsonb
  AND role IS NOT NULL;

-- Note: We keep the `role` column for backward compatibility during transition
-- It can be dropped in a future migration after all code is updated

-- ============================================================================
-- 2. USERS TABLE: Add first_name, last_name columns
-- ============================================================================

-- Add first_name column
ALTER TABLE users
ADD COLUMN IF NOT EXISTS first_name TEXT;

-- Add last_name column
ALTER TABLE users
ADD COLUMN IF NOT EXISTS last_name TEXT;

-- Add comments
COMMENT ON COLUMN users.first_name IS 'User first name, copied from invitation on acceptance';
COMMENT ON COLUMN users.last_name IS 'User last name, copied from invitation on acceptance';

-- Backfill from existing name column (best effort split on first space)
-- Only update if first_name is NULL and name exists
UPDATE users
SET
  first_name = CASE
    WHEN name IS NOT NULL AND position(' ' in name) > 0
    THEN split_part(name, ' ', 1)
    ELSE name
  END,
  last_name = CASE
    WHEN name IS NOT NULL AND position(' ' in name) > 0
    THEN substring(name from position(' ' in name) + 1)
    ELSE NULL
  END
WHERE first_name IS NULL
  AND name IS NOT NULL;

-- ============================================================================
-- 3. UPDATE EVENT PROCESSOR: Handle user.invited with roles array
-- ============================================================================

-- Update the process_invitation_event function to handle both legacy role
-- and new roles array format
CREATE OR REPLACE FUNCTION process_invitation_event()
RETURNS TRIGGER AS $$
DECLARE
  v_event_data JSONB;
  v_invitation_id UUID;
  v_org_id UUID;
  v_email TEXT;
  v_first_name TEXT;
  v_last_name TEXT;
  v_role TEXT;
  v_roles JSONB;
  v_token TEXT;
  v_expires_at TIMESTAMPTZ;
  v_user_id UUID;
  v_accepted_at TIMESTAMPTZ;
  v_expired_at TIMESTAMPTZ;
  v_reason TEXT;
BEGIN
  v_event_data := NEW.event_data;

  -- Handle user.invited event
  IF NEW.event_type = 'user.invited' THEN
    v_invitation_id := (v_event_data->>'invitation_id')::UUID;
    v_org_id := (v_event_data->>'org_id')::UUID;
    v_email := v_event_data->>'email';
    v_first_name := v_event_data->>'first_name';
    v_last_name := v_event_data->>'last_name';
    v_token := v_event_data->>'token';
    v_expires_at := (v_event_data->>'expires_at')::TIMESTAMPTZ;

    -- Handle both legacy role (string) and new roles (array) format
    IF v_event_data ? 'roles' AND jsonb_typeof(v_event_data->'roles') = 'array' THEN
      -- New format: roles array
      v_roles := v_event_data->'roles';
      -- Extract first role name for legacy column compatibility
      v_role := v_roles->0->>'role_name';
    ELSE
      -- Legacy format: single role string
      v_role := v_event_data->>'role';
      v_roles := jsonb_build_array(
        jsonb_build_object('role_id', NULL, 'role_name', v_role)
      );
    END IF;

    -- Upsert into invitations_projection
    INSERT INTO invitations_projection (
      invitation_id, organization_id, email, first_name, last_name,
      role, roles, token, expires_at, status, created_at, updated_at
    ) VALUES (
      v_invitation_id, v_org_id, v_email, v_first_name, v_last_name,
      v_role, v_roles, v_token, v_expires_at, 'pending', NOW(), NOW()
    )
    ON CONFLICT (invitation_id) DO UPDATE SET
      email = EXCLUDED.email,
      first_name = EXCLUDED.first_name,
      last_name = EXCLUDED.last_name,
      role = EXCLUDED.role,
      roles = EXCLUDED.roles,
      token = EXCLUDED.token,
      expires_at = EXCLUDED.expires_at,
      updated_at = NOW();

  -- Handle invitation.accepted event
  ELSIF NEW.event_type = 'invitation.accepted' THEN
    v_invitation_id := (v_event_data->>'invitation_id')::UUID;
    v_user_id := (v_event_data->>'user_id')::UUID;
    v_accepted_at := (v_event_data->>'accepted_at')::TIMESTAMPTZ;

    -- Handle both legacy and new roles format for accepted event
    IF v_event_data ? 'roles' AND jsonb_typeof(v_event_data->'roles') = 'array' THEN
      v_roles := v_event_data->'roles';
      v_role := v_roles->0->>'role_name';
    ELSE
      v_role := v_event_data->>'role';
      v_roles := jsonb_build_array(
        jsonb_build_object('role_id', NULL, 'role_name', v_role)
      );
    END IF;

    UPDATE invitations_projection
    SET status = 'accepted',
        role = COALESCE(v_role, role),
        roles = CASE WHEN v_roles IS NOT NULL THEN v_roles ELSE roles END,
        accepted_at = v_accepted_at,
        updated_at = NOW()
    WHERE invitation_id = v_invitation_id;

  -- Handle invitation.expired event
  ELSIF NEW.event_type = 'invitation.expired' THEN
    v_invitation_id := (v_event_data->>'invitation_id')::UUID;
    v_expired_at := (v_event_data->>'expired_at')::TIMESTAMPTZ;

    UPDATE invitations_projection
    SET status = 'expired',
        updated_at = NOW()
    WHERE invitation_id = v_invitation_id
      AND status = 'pending';

  -- Handle invitation.revoked event
  ELSIF NEW.event_type = 'invitation.revoked' THEN
    v_invitation_id := (v_event_data->>'invitation_id')::UUID;
    v_reason := v_event_data->>'reason';

    UPDATE invitations_projection
    SET status = 'revoked',
        updated_at = NOW()
    WHERE invitation_id = v_invitation_id;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================================
-- 4. UPDATE USER EVENT PROCESSOR: Handle first_name, last_name
-- ============================================================================

-- Update the process_user_event function to handle first_name, last_name
CREATE OR REPLACE FUNCTION process_user_event()
RETURNS TRIGGER AS $$
DECLARE
  v_event_data JSONB;
  v_user_id UUID;
  v_email TEXT;
  v_first_name TEXT;
  v_last_name TEXT;
  v_name TEXT;
  v_organization_id UUID;
  v_is_active BOOLEAN;
BEGIN
  v_event_data := NEW.event_data;

  -- Handle user.created event
  IF NEW.event_type = 'user.created' THEN
    v_user_id := (v_event_data->>'user_id')::UUID;
    v_email := v_event_data->>'email';
    v_first_name := v_event_data->>'first_name';
    v_last_name := v_event_data->>'last_name';
    v_organization_id := (v_event_data->>'organization_id')::UUID;

    -- Build display name from first/last if not provided
    v_name := COALESCE(
      v_event_data->>'name',
      TRIM(COALESCE(v_first_name, '') || ' ' || COALESCE(v_last_name, ''))
    );
    IF v_name = '' THEN v_name := NULL; END IF;

    -- Upsert into users table
    INSERT INTO users (
      id, email, name, first_name, last_name,
      current_organization_id, is_active, created_at, updated_at
    ) VALUES (
      v_user_id, v_email, v_name, v_first_name, v_last_name,
      v_organization_id, TRUE, NOW(), NOW()
    )
    ON CONFLICT (id) DO UPDATE SET
      email = EXCLUDED.email,
      name = COALESCE(EXCLUDED.name, users.name),
      first_name = COALESCE(EXCLUDED.first_name, users.first_name),
      last_name = COALESCE(EXCLUDED.last_name, users.last_name),
      current_organization_id = COALESCE(EXCLUDED.current_organization_id, users.current_organization_id),
      updated_at = NOW();

  -- Handle user.synced_from_auth event
  ELSIF NEW.event_type = 'user.synced_from_auth' THEN
    v_user_id := (v_event_data->>'auth_user_id')::UUID;
    v_email := v_event_data->>'email';
    v_name := v_event_data->>'name';
    v_is_active := COALESCE((v_event_data->>'is_active')::BOOLEAN, TRUE);

    -- Upsert into users table
    INSERT INTO users (id, email, name, is_active, created_at, updated_at)
    VALUES (v_user_id, v_email, v_name, v_is_active, NOW(), NOW())
    ON CONFLICT (id) DO UPDATE SET
      email = EXCLUDED.email,
      name = COALESCE(EXCLUDED.name, users.name),
      is_active = EXCLUDED.is_active,
      updated_at = NOW();

  -- Handle user.deactivated event
  ELSIF NEW.event_type = 'user.deactivated' THEN
    v_user_id := (v_event_data->>'user_id')::UUID;

    UPDATE users
    SET is_active = FALSE, updated_at = NOW()
    WHERE id = v_user_id;

  -- Handle user.reactivated event
  ELSIF NEW.event_type = 'user.reactivated' THEN
    v_user_id := (v_event_data->>'user_id')::UUID;

    UPDATE users
    SET is_active = TRUE, updated_at = NOW()
    WHERE id = v_user_id;

  -- Handle user.organization_switched event
  ELSIF NEW.event_type = 'user.organization_switched' THEN
    v_user_id := (v_event_data->>'user_id')::UUID;
    v_organization_id := (v_event_data->>'to_organization_id')::UUID;

    UPDATE users
    SET current_organization_id = v_organization_id, updated_at = NOW()
    WHERE id = v_user_id;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================================
-- 5. ENSURE TRIGGERS EXIST
-- ============================================================================

-- Ensure invitation event trigger exists
DROP TRIGGER IF EXISTS process_invitation_events_trigger ON domain_events;
CREATE TRIGGER process_invitation_events_trigger
  AFTER INSERT ON domain_events
  FOR EACH ROW
  WHEN (NEW.event_type IN ('user.invited', 'invitation.accepted', 'invitation.expired', 'invitation.revoked'))
  EXECUTE FUNCTION process_invitation_event();

-- Ensure user event trigger exists
DROP TRIGGER IF EXISTS process_user_events_trigger ON domain_events;
CREATE TRIGGER process_user_events_trigger
  AFTER INSERT ON domain_events
  FOR EACH ROW
  WHEN (NEW.event_type IN ('user.created', 'user.synced_from_auth', 'user.deactivated', 'user.reactivated', 'user.organization_switched'))
  EXECUTE FUNCTION process_user_event();

-- ============================================================================
-- 6. CREATE INDEX FOR ROLES JSONB
-- ============================================================================

-- GIN index for efficient JSONB queries on roles
CREATE INDEX IF NOT EXISTS idx_invitations_projection_roles
ON invitations_projection USING GIN (roles);
