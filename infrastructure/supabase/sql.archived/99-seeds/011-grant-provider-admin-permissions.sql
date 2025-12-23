-- Grant Canonical Permissions to Existing provider_admin Roles
-- IDEMPOTENT: Can be run multiple times safely
--
-- This migration grants the canonical 16 permissions to all existing
-- provider_admin roles that were created by the bootstrap workflow
-- but never had permissions assigned.
--
-- See: documentation/architecture/authorization/permissions-reference.md

-- ========================================
-- Canonical provider_admin Permissions (16)
-- ========================================
-- Organization (4): view_ou, create_ou, view, update
-- Client (4): create, view, update, delete
-- Medication (2): create, view
-- Role (3): create, assign, view
-- User (3): create, view, update

DO $$
DECLARE
  provider_admin_role RECORD;
  permission RECORD;
  current_version INT;
  grants_added INT := 0;
  roles_processed INT := 0;
  canonical_permissions TEXT[] := ARRAY[
    'organization.view_ou',
    'organization.create_ou',
    'organization.view',
    'organization.update',
    'client.create',
    'client.view',
    'client.update',
    'client.delete',
    'medication.create',
    'medication.view',
    'role.create',
    'role.assign',
    'role.view',
    'user.create',
    'user.view',
    'user.update'
  ];
  perm_name TEXT;
  perm_id UUID;
BEGIN
  -- Iterate over all provider_admin roles
  FOR provider_admin_role IN
    SELECT id, name, org_id
    FROM roles_projection
    WHERE name = 'provider_admin'
  LOOP
    roles_processed := roles_processed + 1;

    -- Get current max stream_version for this role
    SELECT COALESCE(MAX(stream_version), 0) INTO current_version
    FROM domain_events
    WHERE stream_id = provider_admin_role.id
      AND stream_type = 'role';

    -- Grant each canonical permission
    FOREACH perm_name IN ARRAY canonical_permissions
    LOOP
      -- Get permission ID
      SELECT id INTO perm_id
      FROM permissions_projection
      WHERE name = perm_name;

      -- Skip if permission doesn't exist yet
      IF perm_id IS NULL THEN
        RAISE NOTICE 'Permission % not found in projection (skipping)', perm_name;
        CONTINUE;
      END IF;

      -- Check if already granted
      IF NOT EXISTS (
        SELECT 1 FROM role_permissions_projection
        WHERE role_id = provider_admin_role.id
          AND permission_id = perm_id
      ) THEN
        -- Increment version for each event
        current_version := current_version + 1;

        -- Emit role.permission.granted event
        INSERT INTO domain_events (
          stream_id, stream_type, stream_version, event_type, event_data, event_metadata
        ) VALUES (
          provider_admin_role.id,
          'role',
          current_version,
          'role.permission.granted',
          jsonb_build_object(
            'permission_id', perm_id,
            'permission_name', perm_name
          ),
          jsonb_build_object(
            'user_id', '00000000-0000-0000-0000-000000000000',
            'reason', 'provider_admin_bootstrap_fix: Backfilling canonical permissions'
          )
        );

        grants_added := grants_added + 1;
      END IF;
    END LOOP;
  END LOOP;

  RAISE NOTICE 'Processed % provider_admin roles', roles_processed;
  RAISE NOTICE 'Added % permission grants', grants_added;
END $$;

-- ========================================
-- Verification
-- ========================================

DO $$
DECLARE
  role_record RECORD;
  perm_count INT;
BEGIN
  RAISE NOTICE '--- Permission Grant Verification ---';

  FOR role_record IN
    SELECT r.id, r.name, r.org_id,
           (SELECT COUNT(*) FROM role_permissions_projection WHERE role_id = r.id) as perm_count
    FROM roles_projection r
    WHERE r.name = 'provider_admin'
    ORDER BY r.id
  LOOP
    RAISE NOTICE 'Role % (org: %): % permissions',
      role_record.id,
      COALESCE(role_record.org_id::text, 'NULL'),
      role_record.perm_count;
  END LOOP;
END $$;
