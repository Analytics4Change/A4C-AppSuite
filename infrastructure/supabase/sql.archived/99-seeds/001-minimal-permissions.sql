-- Minimal Permissions Seed: 22 Core Permissions for Bootstrap
-- All permissions inserted via permission.defined events for event sourcing integrity
--
-- IDEMPOTENT: Can be run multiple times safely
-- Each permission is checked before insertion to prevent duplicates

-- ============================================================================
-- Organization Management Permissions (8)
-- ============================================================================

-- organization.create_root
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM domain_events
    WHERE event_type = 'permission.defined'
      AND event_data->>'applet' = 'organization'
      AND event_data->>'action' = 'create_root'
  ) THEN
    INSERT INTO domain_events (stream_id, stream_type, stream_version, event_type, event_data, event_metadata)
    VALUES (
      gen_random_uuid(), 'permission', 1, 'permission.defined',
      '{"applet": "organization", "action": "create_root", "description": "Create new root tenant organizations", "scope_type": "global", "requires_mfa": false}'::jsonb,
      '{"user_id": "00000000-0000-0000-0000-000000000000", "reason": "Bootstrap: Super Admin tenant onboarding"}'::jsonb
    );
  END IF;
END $$;

-- organization.create_sub
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM domain_events
    WHERE event_type = 'permission.defined'
      AND event_data->>'applet' = 'organization'
      AND event_data->>'action' = 'create_sub'
  ) THEN
    INSERT INTO domain_events (stream_id, stream_type, stream_version, event_type, event_data, event_metadata)
    VALUES (
      gen_random_uuid(), 'permission', 1, 'permission.defined',
      '{"applet": "organization", "action": "create_sub", "description": "Create sub-organizations within organizational hierarchy", "scope_type": "org", "requires_mfa": false}'::jsonb,
      '{"user_id": "00000000-0000-0000-0000-000000000000", "reason": "Bootstrap: Organization hierarchy management"}'::jsonb
    );
  END IF;
END $$;

-- organization.view
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM domain_events
    WHERE event_type = 'permission.defined'
      AND event_data->>'applet' = 'organization'
      AND event_data->>'action' = 'view'
  ) THEN
    INSERT INTO domain_events (stream_id, stream_type, stream_version, event_type, event_data, event_metadata)
    VALUES (
      gen_random_uuid(), 'permission', 1, 'permission.defined',
      '{"applet": "organization", "action": "view", "description": "View organization details", "scope_type": "org", "requires_mfa": false}'::jsonb,
      '{"user_id": "00000000-0000-0000-0000-000000000000", "reason": "Bootstrap: Organization visibility"}'::jsonb
    );
  END IF;
END $$;

-- organization.update
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM domain_events
    WHERE event_type = 'permission.defined'
      AND event_data->>'applet' = 'organization'
      AND event_data->>'action' = 'update'
  ) THEN
    INSERT INTO domain_events (stream_id, stream_type, stream_version, event_type, event_data, event_metadata)
    VALUES (
      gen_random_uuid(), 'permission', 1, 'permission.defined',
      '{"applet": "organization", "action": "update", "description": "Update organization details and settings", "scope_type": "org", "requires_mfa": false}'::jsonb,
      '{"user_id": "00000000-0000-0000-0000-000000000000", "reason": "Bootstrap: Organization management"}'::jsonb
    );
  END IF;
END $$;

-- organization.deactivate
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM domain_events
    WHERE event_type = 'permission.defined'
      AND event_data->>'applet' = 'organization'
      AND event_data->>'action' = 'deactivate'
  ) THEN
    INSERT INTO domain_events (stream_id, stream_type, stream_version, event_type, event_data, event_metadata)
    VALUES (
      gen_random_uuid(), 'permission', 1, 'permission.defined',
      '{"applet": "organization", "action": "deactivate", "description": "Deactivate organization (soft delete, reversible)", "scope_type": "global", "requires_mfa": true}'::jsonb,
      '{"user_id": "00000000-0000-0000-0000-000000000000", "reason": "Bootstrap: Organization lifecycle management"}'::jsonb
    );
  END IF;
END $$;

-- organization.delete
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM domain_events
    WHERE event_type = 'permission.defined'
      AND event_data->>'applet' = 'organization'
      AND event_data->>'action' = 'delete'
  ) THEN
    INSERT INTO domain_events (stream_id, stream_type, stream_version, event_type, event_data, event_metadata)
    VALUES (
      gen_random_uuid(), 'permission', 1, 'permission.defined',
      '{"applet": "organization", "action": "delete", "description": "Permanently delete organization (irreversible)", "scope_type": "global", "requires_mfa": true}'::jsonb,
      '{"user_id": "00000000-0000-0000-0000-000000000000", "reason": "Bootstrap: Organization lifecycle management"}'::jsonb
    );
  END IF;
END $$;

-- organization.business_profile_create
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM domain_events
    WHERE event_type = 'permission.defined'
      AND event_data->>'applet' = 'organization'
      AND event_data->>'action' = 'business_profile_create'
  ) THEN
    INSERT INTO domain_events (stream_id, stream_type, stream_version, event_type, event_data, event_metadata)
    VALUES (
      gen_random_uuid(), 'permission', 1, 'permission.defined',
      '{"applet": "organization", "action": "business_profile_create", "description": "Create business profile for organization", "scope_type": "org", "requires_mfa": false}'::jsonb,
      '{"user_id": "00000000-0000-0000-0000-000000000000", "reason": "Bootstrap: Organization profile management"}'::jsonb
    );
  END IF;
END $$;

-- organization.business_profile_update
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM domain_events
    WHERE event_type = 'permission.defined'
      AND event_data->>'applet' = 'organization'
      AND event_data->>'action' = 'business_profile_update'
  ) THEN
    INSERT INTO domain_events (stream_id, stream_type, stream_version, event_type, event_data, event_metadata)
    VALUES (
      gen_random_uuid(), 'permission', 1, 'permission.defined',
      '{"applet": "organization", "action": "business_profile_update", "description": "Update business profile for organization", "scope_type": "org", "requires_mfa": false}'::jsonb,
      '{"user_id": "00000000-0000-0000-0000-000000000000", "reason": "Bootstrap: Organization profile management"}'::jsonb
    );
  END IF;
END $$;


-- ============================================================================
-- Role Management Permissions (5)
-- ============================================================================

-- role.create
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM domain_events
    WHERE event_type = 'permission.defined'
      AND event_data->>'applet' = 'role'
      AND event_data->>'action' = 'create'
  ) THEN
    INSERT INTO domain_events (stream_id, stream_type, stream_version, event_type, event_data, event_metadata)
    VALUES (
      gen_random_uuid(), 'permission', 1, 'permission.defined',
      '{"applet": "role", "action": "create", "description": "Create new roles within organization", "scope_type": "org", "requires_mfa": false}'::jsonb,
      '{"user_id": "00000000-0000-0000-0000-000000000000", "reason": "Bootstrap: Role management"}'::jsonb
    );
  END IF;
END $$;

-- role.view
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM domain_events
    WHERE event_type = 'permission.defined'
      AND event_data->>'applet' = 'role'
      AND event_data->>'action' = 'view'
  ) THEN
    INSERT INTO domain_events (stream_id, stream_type, stream_version, event_type, event_data, event_metadata)
    VALUES (
      gen_random_uuid(), 'permission', 1, 'permission.defined',
      '{"applet": "role", "action": "view", "description": "View roles and their permissions", "scope_type": "org", "requires_mfa": false}'::jsonb,
      '{"user_id": "00000000-0000-0000-0000-000000000000", "reason": "Bootstrap: Role visibility"}'::jsonb
    );
  END IF;
END $$;

-- role.update
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM domain_events
    WHERE event_type = 'permission.defined'
      AND event_data->>'applet' = 'role'
      AND event_data->>'action' = 'update'
  ) THEN
    INSERT INTO domain_events (stream_id, stream_type, stream_version, event_type, event_data, event_metadata)
    VALUES (
      gen_random_uuid(), 'permission', 1, 'permission.defined',
      '{"applet": "role", "action": "update", "description": "Modify role details and description", "scope_type": "org", "requires_mfa": false}'::jsonb,
      '{"user_id": "00000000-0000-0000-0000-000000000000", "reason": "Bootstrap: Role management"}'::jsonb
    );
  END IF;
END $$;

-- role.delete
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM domain_events
    WHERE event_type = 'permission.defined'
      AND event_data->>'applet' = 'role'
      AND event_data->>'action' = 'delete'
  ) THEN
    INSERT INTO domain_events (stream_id, stream_type, stream_version, event_type, event_data, event_metadata)
    VALUES (
      gen_random_uuid(), 'permission', 1, 'permission.defined',
      '{"applet": "role", "action": "delete", "description": "Delete role (soft delete, removes from all users)", "scope_type": "org", "requires_mfa": true}'::jsonb,
      '{"user_id": "00000000-0000-0000-0000-000000000000", "reason": "Bootstrap: Role management"}'::jsonb
    );
  END IF;
END $$;

-- role.grant
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM domain_events
    WHERE event_type = 'permission.defined'
      AND event_data->>'applet' = 'role'
      AND event_data->>'action' = 'grant'
  ) THEN
    INSERT INTO domain_events (stream_id, stream_type, stream_version, event_type, event_data, event_metadata)
    VALUES (
      gen_random_uuid(), 'permission', 1, 'permission.defined',
      '{"applet": "role", "action": "grant", "description": "Assign roles to users", "scope_type": "org", "requires_mfa": false}'::jsonb,
      '{"user_id": "00000000-0000-0000-0000-000000000000", "reason": "Bootstrap: User role assignment"}'::jsonb
    );
  END IF;
END $$;


-- ============================================================================
-- Permission Management Permissions (3)
-- ============================================================================

-- permission.grant
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM domain_events
    WHERE event_type = 'permission.defined'
      AND event_data->>'applet' = 'permission'
      AND event_data->>'action' = 'grant'
  ) THEN
    INSERT INTO domain_events (stream_id, stream_type, stream_version, event_type, event_data, event_metadata)
    VALUES (
      gen_random_uuid(), 'permission', 1, 'permission.defined',
      '{"applet": "permission", "action": "grant", "description": "Grant permissions to roles", "scope_type": "global", "requires_mfa": true}'::jsonb,
      '{"user_id": "00000000-0000-0000-0000-000000000000", "reason": "Bootstrap: RBAC management"}'::jsonb
    );
  END IF;
END $$;

-- permission.revoke
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM domain_events
    WHERE event_type = 'permission.defined'
      AND event_data->>'applet' = 'permission'
      AND event_data->>'action' = 'revoke'
  ) THEN
    INSERT INTO domain_events (stream_id, stream_type, stream_version, event_type, event_data, event_metadata)
    VALUES (
      gen_random_uuid(), 'permission', 1, 'permission.defined',
      '{"applet": "permission", "action": "revoke", "description": "Revoke permissions from roles", "scope_type": "global", "requires_mfa": true}'::jsonb,
      '{"user_id": "00000000-0000-0000-0000-000000000000", "reason": "Bootstrap: RBAC management"}'::jsonb
    );
  END IF;
END $$;

-- permission.view
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM domain_events
    WHERE event_type = 'permission.defined'
      AND event_data->>'applet' = 'permission'
      AND event_data->>'action' = 'view'
  ) THEN
    INSERT INTO domain_events (stream_id, stream_type, stream_version, event_type, event_data, event_metadata)
    VALUES (
      gen_random_uuid(), 'permission', 1, 'permission.defined',
      '{"applet": "permission", "action": "view", "description": "View available permissions and grants", "scope_type": "global", "requires_mfa": false}'::jsonb,
      '{"user_id": "00000000-0000-0000-0000-000000000000", "reason": "Bootstrap: Permission visibility"}'::jsonb
    );
  END IF;
END $$;


-- ============================================================================
-- User Management Permissions (6)
-- ============================================================================

-- user.create
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM domain_events
    WHERE event_type = 'permission.defined'
      AND event_data->>'applet' = 'user'
      AND event_data->>'action' = 'create'
  ) THEN
    INSERT INTO domain_events (stream_id, stream_type, stream_version, event_type, event_data, event_metadata)
    VALUES (
      gen_random_uuid(), 'permission', 1, 'permission.defined',
      '{"applet": "user", "action": "create", "description": "Create new users in organization", "scope_type": "org", "requires_mfa": false}'::jsonb,
      '{"user_id": "00000000-0000-0000-0000-000000000000", "reason": "Bootstrap: User management"}'::jsonb
    );
  END IF;
END $$;

-- user.view
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM domain_events
    WHERE event_type = 'permission.defined'
      AND event_data->>'applet' = 'user'
      AND event_data->>'action' = 'view'
  ) THEN
    INSERT INTO domain_events (stream_id, stream_type, stream_version, event_type, event_data, event_metadata)
    VALUES (
      gen_random_uuid(), 'permission', 1, 'permission.defined',
      '{"applet": "user", "action": "view", "description": "View user profiles and details", "scope_type": "org", "requires_mfa": false}'::jsonb,
      '{"user_id": "00000000-0000-0000-0000-000000000000", "reason": "Bootstrap: User visibility"}'::jsonb
    );
  END IF;
END $$;

-- user.update
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM domain_events
    WHERE event_type = 'permission.defined'
      AND event_data->>'applet' = 'user'
      AND event_data->>'action' = 'update'
  ) THEN
    INSERT INTO domain_events (stream_id, stream_type, stream_version, event_type, event_data, event_metadata)
    VALUES (
      gen_random_uuid(), 'permission', 1, 'permission.defined',
      '{"applet": "user", "action": "update", "description": "Update user profile information", "scope_type": "org", "requires_mfa": false}'::jsonb,
      '{"user_id": "00000000-0000-0000-0000-000000000000", "reason": "Bootstrap: User management"}'::jsonb
    );
  END IF;
END $$;

-- user.delete
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM domain_events
    WHERE event_type = 'permission.defined'
      AND event_data->>'applet' = 'user'
      AND event_data->>'action' = 'delete'
  ) THEN
    INSERT INTO domain_events (stream_id, stream_type, stream_version, event_type, event_data, event_metadata)
    VALUES (
      gen_random_uuid(), 'permission', 1, 'permission.defined',
      '{"applet": "user", "action": "delete", "description": "Delete user account (soft delete)", "scope_type": "org", "requires_mfa": true}'::jsonb,
      '{"user_id": "00000000-0000-0000-0000-000000000000", "reason": "Bootstrap: User management"}'::jsonb
    );
  END IF;
END $$;

-- user.role_assign
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM domain_events
    WHERE event_type = 'permission.defined'
      AND event_data->>'applet' = 'user'
      AND event_data->>'action' = 'role_assign'
  ) THEN
    INSERT INTO domain_events (stream_id, stream_type, stream_version, event_type, event_data, event_metadata)
    VALUES (
      gen_random_uuid(), 'permission', 1, 'permission.defined',
      '{"applet": "user", "action": "role_assign", "description": "Assign roles to users (creates user.role.assigned event)", "scope_type": "org", "requires_mfa": false}'::jsonb,
      '{"user_id": "00000000-0000-0000-0000-000000000000", "reason": "Bootstrap: User role management"}'::jsonb
    );
  END IF;
END $$;

-- user.role_revoke
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM domain_events
    WHERE event_type = 'permission.defined'
      AND event_data->>'applet' = 'user'
      AND event_data->>'action' = 'role_revoke'
  ) THEN
    INSERT INTO domain_events (stream_id, stream_type, stream_version, event_type, event_data, event_metadata)
    VALUES (
      gen_random_uuid(), 'permission', 1, 'permission.defined',
      '{"applet": "user", "action": "role_revoke", "description": "Revoke roles from users (creates user.role.revoked event)", "scope_type": "org", "requires_mfa": false}'::jsonb,
      '{"user_id": "00000000-0000-0000-0000-000000000000", "reason": "Bootstrap: User role management"}'::jsonb
    );
  END IF;
END $$;


-- ============================================================================
-- Verification
-- ============================================================================

-- Display count of permissions after seeding (for verification)
DO $$
DECLARE
  permission_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO permission_count
  FROM domain_events
  WHERE event_type = 'permission.defined';

  RAISE NOTICE 'Total permissions defined: %', permission_count;
  RAISE NOTICE 'Expected: 22 (8 organization + 5 role + 3 permission + 6 user)';

  IF permission_count < 22 THEN
    RAISE WARNING 'Permission count is less than expected! Check for errors.';
  ELSIF permission_count > 22 THEN
    RAISE NOTICE 'Permission count is higher than expected - may include additional custom permissions.';
  ELSE
    RAISE NOTICE '✓ All core permissions seeded successfully!';
  END IF;
END $$;
