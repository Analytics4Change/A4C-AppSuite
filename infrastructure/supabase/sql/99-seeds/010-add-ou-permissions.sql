-- Add Organizational Unit Permissions
-- IDEMPOTENT: Can be run multiple times safely
--
-- Adds organization.view_ou and organization.create_ou permissions
-- for provider_admin users to manage organizational units within their org.

-- ========================================
-- organization.view_ou Permission
-- ========================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM domain_events
    WHERE event_type = 'permission.defined'
      AND event_data->>'name' = 'organization.view_ou'
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
        'action', 'view_ou',
        'name', 'organization.view_ou',
        'description', 'View organizational units (departments, locations, campuses)',
        'scope_type', 'org',
        'requires_mfa', false
      ),
      jsonb_build_object(
        'user_id', '00000000-0000-0000-0000-000000000000',
        'reason', 'provider_admin_bootstrap_fix: Adding view_ou permission for OU management'
      )
    );
    RAISE NOTICE 'organization.view_ou permission defined';
  ELSE
    RAISE NOTICE 'organization.view_ou permission already exists (skipped)';
  END IF;
END $$;

-- ========================================
-- organization.create_ou Permission
-- ========================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM domain_events
    WHERE event_type = 'permission.defined'
      AND event_data->>'name' = 'organization.create_ou'
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
        'description', 'Create organizational units (departments, locations, campuses) within hierarchy',
        'scope_type', 'org',
        'requires_mfa', false
      ),
      jsonb_build_object(
        'user_id', '00000000-0000-0000-0000-000000000000',
        'reason', 'provider_admin_bootstrap_fix: Adding create_ou permission for OU management'
      )
    );
    RAISE NOTICE 'organization.create_ou permission defined';
  ELSE
    RAISE NOTICE 'organization.create_ou permission already exists (skipped)';
  END IF;
END $$;

-- ========================================
-- Verification
-- ========================================

DO $$
DECLARE
  view_ou_exists BOOLEAN;
  create_ou_exists BOOLEAN;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM permissions_projection WHERE name = 'organization.view_ou'
  ) INTO view_ou_exists;

  SELECT EXISTS (
    SELECT 1 FROM permissions_projection WHERE name = 'organization.create_ou'
  ) INTO create_ou_exists;

  IF view_ou_exists THEN
    RAISE NOTICE 'organization.view_ou exists in permissions_projection';
  ELSE
    RAISE NOTICE 'organization.view_ou NOT in projection (event processor pending)';
  END IF;

  IF create_ou_exists THEN
    RAISE NOTICE 'organization.create_ou exists in permissions_projection';
  ELSE
    RAISE NOTICE 'organization.create_ou NOT in projection (event processor pending)';
  END IF;
END $$;
