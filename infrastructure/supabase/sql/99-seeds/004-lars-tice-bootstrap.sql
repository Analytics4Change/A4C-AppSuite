-- Bootstrap Lars Tice as Platform Owner with Super Admin Role
-- Creates Lars's user account and assigns super_admin role

-- ============================================================================
-- Lars Tice User Creation
-- ============================================================================

DO $$
DECLARE
  -- Generate deterministic UUID from Lars's Zitadel user ID
  v_lars_uuid UUID := uuid_generate_v5(
    'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11'::UUID,  -- DNS namespace UUID
    '339658157368929074'  -- Lars's Zitadel user ID
  );
  v_lars_zitadel_id TEXT := '339658157368929074';
  v_lars_email TEXT := 'lars.tice@gmail.com';
  v_stream_version INT := 1;
BEGIN
  -- Create user.created event
  INSERT INTO domain_events (stream_id, stream_type, stream_version, event_type, event_data, event_metadata)
  VALUES (
    v_lars_uuid,
    'user',
    v_stream_version,
    'user.created',
    jsonb_build_object(
      'email', v_lars_email,
      'zitadel_user_id', v_lars_zitadel_id,
      'name', 'Lars Tice',
      'is_active', true
    ),
    jsonb_build_object(
      'user_id', '00000000-0000-0000-0000-000000000000',
      'reason', 'Bootstrap: Creating Lars Tice as platform owner'
    )
  );

  -- Create user projection manually (no user event processor yet in minimal bootstrap)
  INSERT INTO users (
    id,
    email,
    name,
    is_active,
    created_at
  ) VALUES (
    v_lars_uuid,
    v_lars_email,
    'Lars Tice',
    true,
    NOW()
  );

  -- Create Zitadel user mapping
  INSERT INTO zitadel_user_mapping (
    internal_user_id,
    zitadel_user_id,
    user_email,
    created_at
  ) VALUES (
    v_lars_uuid,
    v_lars_zitadel_id,
    v_lars_email,
    NOW()
  );

  -- Assign super_admin role to Lars (in A4C organization context)
  v_stream_version := v_stream_version + 1;

  INSERT INTO domain_events (stream_id, stream_type, stream_version, event_type, event_data, event_metadata)
  VALUES (
    v_lars_uuid,
    'user',
    v_stream_version,
    'user.role.assigned',
    jsonb_build_object(
      'role_id', '11111111-1111-1111-1111-111111111111',  -- super_admin role
      'role_name', 'super_admin',
      'org_id', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'  -- A4C organization (NULL for global role assignment)
    ),
    jsonb_build_object(
      'user_id', '00000000-0000-0000-0000-000000000000',
      'reason', 'Bootstrap: Assigning super_admin role to Lars Tice'
    )
  );

  RAISE NOTICE 'Created Lars Tice (%) with super_admin role', v_lars_uuid;
END $$;


-- ============================================================================
-- Verification
-- ============================================================================

-- Verify Lars exists and has super_admin role
DO $$
DECLARE
  v_lars_uuid UUID;
  v_role_count INT;
BEGIN
  -- Get Lars's internal UUID
  v_lars_uuid := get_internal_user_id('339658157368929074');

  IF v_lars_uuid IS NULL THEN
    RAISE EXCEPTION 'Lars Tice user mapping not found';
  END IF;

  -- Verify Lars has super_admin role
  SELECT COUNT(*) INTO v_role_count
  FROM user_roles_projection ur
  JOIN roles_projection r ON r.id = ur.role_id
  WHERE ur.user_id = v_lars_uuid
    AND r.name = 'super_admin';

  IF v_role_count = 0 THEN
    RAISE EXCEPTION 'Lars Tice does not have super_admin role';
  END IF;

  RAISE NOTICE 'Verification passed: Lars Tice (%) has super_admin role', v_lars_uuid;
END $$;
