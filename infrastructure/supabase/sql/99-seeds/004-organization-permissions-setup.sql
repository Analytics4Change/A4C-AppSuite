-- Organization Permissions Setup
-- Initializes organization-related permissions via event sourcing
-- This script emits permission.defined events for organization lifecycle management

-- Function to emit permission.defined events during platform initialization
CREATE OR REPLACE FUNCTION initialize_organization_permissions()
RETURNS VOID AS $$
DECLARE
  v_permission_id UUID;
  v_current_time TIMESTAMPTZ := NOW();
BEGIN
  
  -- Define organization permissions via events (not direct inserts)
  
  -- 1. organization.create_root - Platform Owner only
  v_permission_id := gen_random_uuid();
  INSERT INTO domain_events (
    id, stream_id, stream_type, event_type, event_data, event_metadata, created_at
  ) VALUES (
    gen_random_uuid(),
    v_permission_id,
    'permission',
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
    ),
    v_current_time
  );

  -- 2. organization.create_sub - Provider Admin within their org
  v_permission_id := gen_random_uuid();
  INSERT INTO domain_events (
    id, stream_id, stream_type, event_type, event_data, event_metadata, created_at
  ) VALUES (
    gen_random_uuid(),
    v_permission_id,
    'permission',
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
    ),
    v_current_time
  );

  -- 3. organization.deactivate - Organization deactivation
  v_permission_id := gen_random_uuid();
  INSERT INTO domain_events (
    id, stream_id, stream_type, event_type, event_data, event_metadata, created_at
  ) VALUES (
    gen_random_uuid(),
    v_permission_id,
    'permission',
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
    ),
    v_current_time
  );

  -- 4. organization.delete - Organization deletion (dangerous operation)
  v_permission_id := gen_random_uuid();
  INSERT INTO domain_events (
    id, stream_id, stream_type, event_type, event_data, event_metadata, created_at
  ) VALUES (
    gen_random_uuid(),
    v_permission_id,
    'permission',
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
    ),
    v_current_time
  );

  -- 5. organization.business_profile_create - Business profile creation
  v_permission_id := gen_random_uuid();
  INSERT INTO domain_events (
    id, stream_id, stream_type, event_type, event_data, event_metadata, created_at
  ) VALUES (
    gen_random_uuid(),
    v_permission_id,
    'permission',
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
    ),
    v_current_time
  );

  -- 6. organization.business_profile_update - Business profile updates
  v_permission_id := gen_random_uuid();
  INSERT INTO domain_events (
    id, stream_id, stream_type, event_type, event_data, event_metadata, created_at
  ) VALUES (
    gen_random_uuid(),
    v_permission_id,
    'permission',
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
    ),
    v_current_time
  );

  -- 7. organization.view - View organization information
  v_permission_id := gen_random_uuid();
  INSERT INTO domain_events (
    id, stream_id, stream_type, event_type, event_data, event_metadata, created_at
  ) VALUES (
    gen_random_uuid(),
    v_permission_id,
    'permission',
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
    ),
    v_current_time
  );

  -- 8. organization.update - Update organization information
  v_permission_id := gen_random_uuid();
  INSERT INTO domain_events (
    id, stream_id, stream_type, event_type, event_data, event_metadata, created_at
  ) VALUES (
    gen_random_uuid(),
    v_permission_id,
    'permission',
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
    ),
    v_current_time
  );

  RAISE NOTICE 'Organization permissions initialized via permission.defined events';
END;
$$ LANGUAGE plpgsql;

-- Execute the initialization function
-- This can be run during platform setup/migration
SELECT initialize_organization_permissions();

-- Drop the initialization function after use (optional)
DROP FUNCTION IF EXISTS initialize_organization_permissions();

-- Comments
COMMENT ON FUNCTION initialize_organization_permissions IS 
  'One-time initialization function that emits permission.defined events for organization lifecycle management';