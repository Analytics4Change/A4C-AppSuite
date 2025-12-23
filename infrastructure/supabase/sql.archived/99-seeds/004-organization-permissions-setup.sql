-- Organization Permissions Setup
-- Initializes organization-related permissions via event sourcing
-- This script emits permission.defined events for organization lifecycle management
--
-- IDEMPOTENT: Can be run multiple times safely
-- Uses conditional DO blocks to check for existing permissions before insertion

-- ========================================
-- Organization Lifecycle Permissions
-- ========================================

-- organization.create_root
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM domain_events
    WHERE event_type = 'permission.defined'
      AND event_data->>'applet' = 'organization'
      AND event_data->>'action' = 'create_root'
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
        'action', 'create_root',
        'name', 'organization.create_root',
        'description', 'Create top-level organizations (Platform Owner only)',
        'scope_type', 'global',
        'requires_mfa', true
      ),
      jsonb_build_object(
        'user_id', '00000000-0000-0000-0000-000000000000',
        'reason', 'Platform initialization: defining organization.create_root permission'
      )
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
    INSERT INTO domain_events (
      stream_id, stream_type, stream_version, event_type, event_data, event_metadata
    ) VALUES (
      gen_random_uuid(),
      'permission',
      1,
      'permission.defined',
      jsonb_build_object(
        'applet', 'organization',
        'action', 'create_sub',
        'name', 'organization.create_sub',
        'description', 'Create sub-organizations within hierarchy',
        'scope_type', 'org',
        'requires_mfa', false
      ),
      jsonb_build_object(
        'user_id', '00000000-0000-0000-0000-000000000000',
        'reason', 'Platform initialization: defining organization.create_sub permission'
      )
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
    INSERT INTO domain_events (
      stream_id, stream_type, stream_version, event_type, event_data, event_metadata
    ) VALUES (
      gen_random_uuid(),
      'permission',
      1,
      'permission.defined',
      jsonb_build_object(
        'applet', 'organization',
        'action', 'deactivate',
        'name', 'organization.deactivate',
        'description', 'Deactivate organizations (billing, compliance, operational)',
        'scope_type', 'org',
        'requires_mfa', true
      ),
      jsonb_build_object(
        'user_id', '00000000-0000-0000-0000-000000000000',
        'reason', 'Platform initialization: defining organization.deactivate permission'
      )
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
    INSERT INTO domain_events (
      stream_id, stream_type, stream_version, event_type, event_data, event_metadata
    ) VALUES (
      gen_random_uuid(),
      'permission',
      1,
      'permission.defined',
      jsonb_build_object(
        'applet', 'organization',
        'action', 'delete',
        'name', 'organization.delete',
        'description', 'Delete organizations with cascade handling',
        'scope_type', 'global',
        'requires_mfa', true
      ),
      jsonb_build_object(
        'user_id', '00000000-0000-0000-0000-000000000000',
        'reason', 'Platform initialization: defining organization.delete permission'
      )
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
    INSERT INTO domain_events (
      stream_id, stream_type, stream_version, event_type, event_data, event_metadata
    ) VALUES (
      gen_random_uuid(),
      'permission',
      1,
      'permission.defined',
      jsonb_build_object(
        'applet', 'organization',
        'action', 'business_profile_create',
        'name', 'organization.business_profile_create',
        'description', 'Create business profiles (Platform Owner only)',
        'scope_type', 'global',
        'requires_mfa', true
      ),
      jsonb_build_object(
        'user_id', '00000000-0000-0000-0000-000000000000',
        'reason', 'Platform initialization: defining organization.business_profile_create permission'
      )
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
    INSERT INTO domain_events (
      stream_id, stream_type, stream_version, event_type, event_data, event_metadata
    ) VALUES (
      gen_random_uuid(),
      'permission',
      1,
      'permission.defined',
      jsonb_build_object(
        'applet', 'organization',
        'action', 'business_profile_update',
        'name', 'organization.business_profile_update',
        'description', 'Update business profiles',
        'scope_type', 'org',
        'requires_mfa', false
      ),
      jsonb_build_object(
        'user_id', '00000000-0000-0000-0000-000000000000',
        'reason', 'Platform initialization: defining organization.business_profile_update permission'
      )
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
    INSERT INTO domain_events (
      stream_id, stream_type, stream_version, event_type, event_data, event_metadata
    ) VALUES (
      gen_random_uuid(),
      'permission',
      1,
      'permission.defined',
      jsonb_build_object(
        'applet', 'organization',
        'action', 'view',
        'name', 'organization.view',
        'description', 'View organization information and hierarchy',
        'scope_type', 'org',
        'requires_mfa', false
      ),
      jsonb_build_object(
        'user_id', '00000000-0000-0000-0000-000000000000',
        'reason', 'Platform initialization: defining organization.view permission'
      )
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
    INSERT INTO domain_events (
      stream_id, stream_type, stream_version, event_type, event_data, event_metadata
    ) VALUES (
      gen_random_uuid(),
      'permission',
      1,
      'permission.defined',
      jsonb_build_object(
        'applet', 'organization',
        'action', 'update',
        'name', 'organization.update',
        'description', 'Update organization information',
        'scope_type', 'org',
        'requires_mfa', false
      ),
      jsonb_build_object(
        'user_id', '00000000-0000-0000-0000-000000000000',
        'reason', 'Platform initialization: defining organization.update permission'
      )
    );
  END IF;
END $$;

-- ========================================
-- Verification
-- ========================================

DO $$
DECLARE
  org_permission_count INTEGER;
BEGIN
  -- Count organization permissions
  SELECT COUNT(*) INTO org_permission_count
  FROM domain_events
  WHERE event_type = 'permission.defined'
    AND event_data->>'applet' = 'organization';

  RAISE NOTICE 'Total organization permissions defined: %', org_permission_count;
  RAISE NOTICE 'Organization permissions from this file: 8';
  RAISE NOTICE '✓ Organization permissions seeded successfully!';
END $$;
