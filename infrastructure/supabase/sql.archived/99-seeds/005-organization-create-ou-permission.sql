-- Organization Create OU Permission Setup
-- Defines organization.create_ou permission for organizational unit management
--
-- IDEMPOTENT: Can be run multiple times safely
-- Uses conditional DO blocks to check for existing permissions before insertion
--
-- NOTE: This permission replaces 'organization.create_sub' for clarity.
--       'create_ou' = Create Organizational Unit (within existing hierarchy)
--       'create_sub' = Create Sub-organization (ambiguous - kept for compatibility)
--
-- Permission Scope:
-- - organization.create (HIGH risk, global) = Platform admins creating root-level orgs
-- - organization.create_ou (MEDIUM risk, organization) = Provider admins creating OUs within their org

-- ========================================
-- organization.create_ou Permission
-- ========================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM domain_events
    WHERE event_type = 'permission.defined'
      AND event_data->>'applet' = 'organization'
      AND event_data->>'action' = 'create_ou'
  ) THEN
    INSERT INTO domain_events (
      stream_id, stream_type, stream_version, event_type, event_data, event_metadata
    ) VALUES (
      gen_random_uuid(),
      'permission',
      1,
      'permission.defined',
      jsonb_build_object(
        'applet', 'organization',
        'action', 'create_ou',
        'name', 'organization.create_ou',
        'description', 'Create organizational units (departments, locations, campuses) within organization hierarchy',
        'scope_type', 'org',
        'requires_mfa', false
      ),
      jsonb_build_object(
        'user_id', '00000000-0000-0000-0000-000000000000',
        'reason', 'Platform initialization: defining organization.create_ou permission for OU management feature'
      )
    );
    RAISE NOTICE '✓ organization.create_ou permission defined';
  ELSE
    RAISE NOTICE '• organization.create_ou permission already exists (skipped)';
  END IF;
END $$;

-- ========================================
-- Grant to super_admin
-- ========================================

-- Note: The super_admin grant is handled automatically by 003-grant-super-admin-permissions.sql
-- which queries permissions_projection and grants ALL permissions to super_admin.
-- However, if running this file independently (e.g., after initial bootstrap),
-- we explicitly grant it here.

DO $$
DECLARE
  perm_id UUID;
  current_version INT;
BEGIN
  -- Get permission ID from projection
  SELECT id INTO perm_id
  FROM permissions_projection
  WHERE applet = 'organization' AND action = 'create_ou';

  -- Only proceed if permission exists in projection
  IF perm_id IS NOT NULL THEN
    -- Check if already granted to super_admin
    IF NOT EXISTS (
      SELECT 1 FROM role_permissions_projection
      WHERE role_id = '11111111-1111-1111-1111-111111111111'
        AND permission_id = perm_id
    ) THEN
      -- Get current max stream_version for super_admin role
      SELECT COALESCE(MAX(stream_version), 1) INTO current_version
      FROM domain_events
      WHERE stream_id = '11111111-1111-1111-1111-111111111111'
        AND stream_type = 'role';

      INSERT INTO domain_events (
        stream_id, stream_type, stream_version, event_type, event_data, event_metadata
      ) VALUES (
        '11111111-1111-1111-1111-111111111111',  -- super_admin role stream_id
        'role',
        current_version + 1,
        'role.permission.granted',
        jsonb_build_object(
          'permission_id', perm_id,
          'permission_name', 'organization.create_ou'
        ),
        jsonb_build_object(
          'user_id', '00000000-0000-0000-0000-000000000000',
          'reason', 'Granting organization.create_ou to super_admin for OU management'
        )
      );
      RAISE NOTICE '✓ organization.create_ou granted to super_admin';
    ELSE
      RAISE NOTICE '• organization.create_ou already granted to super_admin (skipped)';
    END IF;
  ELSE
    RAISE NOTICE '! organization.create_ou permission not yet in projection - run event processor first';
  END IF;
END $$;

-- ========================================
-- Verification
-- ========================================

DO $$
DECLARE
  perm_exists BOOLEAN;
  grant_exists BOOLEAN;
BEGIN
  -- Check permission exists
  SELECT EXISTS (
    SELECT 1 FROM permissions_projection
    WHERE applet = 'organization' AND action = 'create_ou'
  ) INTO perm_exists;

  -- Check grant exists
  SELECT EXISTS (
    SELECT 1 FROM role_permissions_projection rpp
    JOIN permissions_projection pp ON rpp.permission_id = pp.id
    WHERE rpp.role_id = '11111111-1111-1111-1111-111111111111'
      AND pp.applet = 'organization'
      AND pp.action = 'create_ou'
  ) INTO grant_exists;

  IF perm_exists THEN
    RAISE NOTICE '✓ Permission organization.create_ou exists in projection';
  ELSE
    RAISE NOTICE '! Permission organization.create_ou NOT in projection (event processor pending)';
  END IF;

  IF grant_exists THEN
    RAISE NOTICE '✓ super_admin has organization.create_ou permission';
  ELSE
    RAISE NOTICE '! super_admin does NOT have organization.create_ou permission';
  END IF;
END $$;

-- ========================================
-- Notes
-- ========================================

-- Provider Admin Permission Grant:
-- The provider_admin role gets organization.create_ou during organization provisioning,
-- NOT from seed data. This is handled by the Temporal organization bootstrap workflow
-- which grants appropriate permissions scoped to the specific organization being created.
--
-- See: workflows/src/activities/organization-bootstrap/ for the provisioning logic
-- See: documentation/architecture/authorization/rbac-architecture.md for permission model

