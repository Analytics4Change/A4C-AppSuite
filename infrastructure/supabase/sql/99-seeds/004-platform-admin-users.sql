-- Bootstrap Platform Admin Users
-- Creates platform admin users and assigns super_admin role
--
-- USAGE: To add more users, add entries to the platform_admin_users VALUES array
-- Each user needs their actual Supabase Auth UUID from: SELECT id FROM auth.users WHERE email = '<email>';

-- ============================================================================
-- Platform Admin User Creation
-- ============================================================================

DO $$
DECLARE
  user_record RECORD;
  v_stream_version INT;  -- Renamed to avoid ambiguity with column name
BEGIN
  -- Define platform admin users
  -- Format: (auth_user_id, email, full_name)
  FOR user_record IN
    SELECT * FROM (VALUES
      ('5a975b95-a14d-4ddd-bdb6-949033dab0b8'::UUID, 'lars.tice@gmail.com', 'Lars Tice')
      ,('7c8dbdef-ee7b-4d5a-89e7-ef82efe9fe41'::UUID, 'troygshaw@gmail.com', 'Troy Shaw')
      ,('f4951f70-41eb-476d-a635-9f36e7a35c67'::UUID, 'ticerachel@gmail.com', 'Rachel Tice')
    ) AS t(auth_user_id, email, full_name)
  LOOP
    v_stream_version := 1;

    -- Create user.synced_from_auth event
    INSERT INTO domain_events (stream_id, stream_type, stream_version, event_type, event_data, event_metadata)
    VALUES (
      user_record.auth_user_id,
      'user',
      v_stream_version,
      'user.synced_from_auth',
      jsonb_build_object(
        'email', user_record.email,
        'auth_user_id', user_record.auth_user_id::TEXT,
        'name', user_record.full_name,
        'is_active', true
      ),
      jsonb_build_object(
        'user_id', '00000000-0000-0000-0000-000000000000',
        'reason', 'Bootstrap: Creating ' || user_record.full_name || ' as platform admin'
      )
    )
    ON CONFLICT (stream_id, stream_type, stream_version) DO NOTHING;

    -- Create user projection manually (no user event processor yet in minimal bootstrap)
    INSERT INTO users (
      id,
      email,
      name,
      is_active,
      created_at
    ) VALUES (
      user_record.auth_user_id,
      user_record.email,
      user_record.full_name,
      true,
      NOW()
    )
    ON CONFLICT (id) DO NOTHING;

    -- Assign super_admin role to user (in A4C organization context)
    v_stream_version := v_stream_version + 1;

    INSERT INTO domain_events (stream_id, stream_type, stream_version, event_type, event_data, event_metadata)
    VALUES (
      user_record.auth_user_id,
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
        'reason', 'Bootstrap: Assigning super_admin role to ' || user_record.full_name
      )
    )
    ON CONFLICT (stream_id, stream_type, stream_version) DO NOTHING;

    -- Create user_roles_projection entry manually
    -- NOTE: The event router routes stream_type='user' to process_user_event() which doesn't exist,
    -- so user.role.assigned events are NOT automatically processed into user_roles_projection.
    -- This direct insert is required until a proper process_user_event function is implemented.
    INSERT INTO user_roles_projection (
      user_id,
      role_id,
      org_id,
      scope_path,
      assigned_at
    ) VALUES (
      user_record.auth_user_id,
      '11111111-1111-1111-1111-111111111111'::UUID,  -- super_admin role
      'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::UUID,  -- A4C organization
      'a4c'::ltree,  -- scope_path required when org_id is set (CHECK constraint)
      NOW()
    )
    ON CONFLICT (user_id, role_id, org_id) DO NOTHING;

    RAISE NOTICE 'Created platform admin: % (%) with super_admin role', user_record.full_name, user_record.auth_user_id;
  END LOOP;
END $$;


-- ============================================================================
-- Verification
-- ============================================================================

-- Verify all users exist and have super_admin role
DO $$
DECLARE
  user_record RECORD;
  role_count INT;
BEGIN
  FOR user_record IN
    SELECT * FROM (VALUES
      ('5a975b95-a14d-4ddd-bdb6-949033dab0b8'::UUID, 'lars.tice@gmail.com', 'Lars Tice')
      ,('7c8dbdef-ee7b-4d5a-89e7-ef82efe9fe41'::UUID, 'troygshaw@gmail.com', 'Troy Shaw')
      ,('f4951f70-41eb-476d-a635-9f36e7a35c67'::UUID, 'ticerachel@gmail.com', 'Rachel Tice')
    ) AS t(auth_user_id, email, full_name)
  LOOP
    -- Verify user exists
    IF NOT EXISTS (SELECT 1 FROM users WHERE id = user_record.auth_user_id) THEN
      RAISE WARNING '% (%) not found in users table', user_record.full_name, user_record.email;
      CONTINUE;
    END IF;

    -- Verify user has super_admin role
    SELECT COUNT(*) INTO role_count
    FROM user_roles_projection ur
    JOIN roles_projection r ON r.id = ur.role_id
    WHERE ur.user_id = user_record.auth_user_id
      AND r.name = 'super_admin';

    IF role_count = 0 THEN
      RAISE WARNING '% (%) does not have super_admin role yet', user_record.full_name, user_record.auth_user_id;
    ELSE
      RAISE NOTICE 'Verification passed: % (%) has super_admin role', user_record.full_name, user_record.auth_user_id;
    END IF;
  END LOOP;
END $$;
