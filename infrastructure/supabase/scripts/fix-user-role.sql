-- Fix User Role for OAuth-authenticated User
-- This script adds a user record to public.users and assigns super_admin role
-- using the actual UUID from auth.users (not the hardcoded seed UUID)

DO $$
DECLARE
  v_auth_user_id UUID;
  v_user_email TEXT := 'lars.tice@gmail.com';
  v_stream_version INT;
BEGIN
  -- Get the actual auth.users UUID for the OAuth-authenticated user
  SELECT id INTO v_auth_user_id
  FROM auth.users
  WHERE email = v_user_email;

  IF v_auth_user_id IS NULL THEN
    RAISE EXCEPTION 'User % not found in auth.users. Please authenticate via OAuth first.', v_user_email;
  END IF;

  RAISE NOTICE 'Found auth user: % with UUID: %', v_user_email, v_auth_user_id;

  -- Check if user already exists in public.users
  IF EXISTS (SELECT 1 FROM users WHERE id = v_auth_user_id) THEN
    RAISE NOTICE 'User record already exists in public.users';
  ELSE
    -- Create user.synced_from_auth event
    v_stream_version := 1;

    INSERT INTO domain_events (stream_id, stream_type, stream_version, event_type, event_data, event_metadata)
    VALUES (
      v_auth_user_id,
      'user',
      v_stream_version,
      'user.synced_from_auth',
      jsonb_build_object(
        'email', v_user_email,
        'auth_user_id', v_auth_user_id::TEXT,
        'name', 'Lars Tice',
        'is_active', true
      ),
      jsonb_build_object(
        'user_id', v_auth_user_id::TEXT,
        'reason', 'OAuth sign-in: Creating user record for ' || v_user_email
      )
    )
    ON CONFLICT (stream_id, stream_type, stream_version) DO NOTHING;

    -- Create user projection
    INSERT INTO users (
      id,
      email,
      name,
      is_active,
      created_at
    ) VALUES (
      v_auth_user_id,
      v_user_email,
      'Lars Tice',
      true,
      NOW()
    )
    ON CONFLICT (id) DO NOTHING;

    RAISE NOTICE 'Created user record in public.users';
  END IF;

  -- Check if user already has super_admin role
  IF EXISTS (
    SELECT 1
    FROM user_roles_projection ur
    JOIN roles_projection r ON r.id = ur.role_id
    WHERE ur.user_id = v_auth_user_id
      AND r.name = 'super_admin'
  ) THEN
    RAISE NOTICE 'User already has super_admin role';
  ELSE
    -- Assign super_admin role
    v_stream_version := (
      SELECT COALESCE(MAX(stream_version), 0) + 1
      FROM domain_events
      WHERE stream_id = v_auth_user_id
        AND stream_type = 'user'
    );

    INSERT INTO domain_events (stream_id, stream_type, stream_version, event_type, event_data, event_metadata)
    VALUES (
      v_auth_user_id,
      'user',
      v_stream_version,
      'user.role.assigned',
      jsonb_build_object(
        'role_id', '11111111-1111-1111-1111-111111111111',  -- super_admin role UUID
        'role_name', 'super_admin',
        'org_id', NULL  -- NULL = global super admin scope
      ),
      jsonb_build_object(
        'user_id', v_auth_user_id::TEXT,
        'reason', 'OAuth sign-in: Assigning super_admin role to ' || v_user_email
      )
    )
    ON CONFLICT (stream_id, stream_type, stream_version) DO NOTHING;

    RAISE NOTICE 'Assigned super_admin role via domain event';

    -- Create user_roles_projection entry manually
    -- (Normally this would be done by an event processor trigger)
    INSERT INTO user_roles_projection (
      user_id,
      role_id,
      org_id,
      scope_path,
      is_active,
      granted_at
    )
    SELECT
      v_auth_user_id,
      '11111111-1111-1111-1111-111111111111'::UUID,  -- super_admin role
      NULL,  -- Global scope
      NULL,  -- No scope path for global super admin
      true,
      NOW()
    WHERE NOT EXISTS (
      SELECT 1
      FROM user_roles_projection
      WHERE user_id = v_auth_user_id
        AND role_id = '11111111-1111-1111-1111-111111111111'::UUID
    );

    RAISE NOTICE 'Created user_roles_projection entry';
  END IF;

  -- Verify the fix
  RAISE NOTICE '===== VERIFICATION =====';
  RAISE NOTICE 'User ID: %', v_auth_user_id;
  RAISE NOTICE 'Email: %', v_user_email;

  -- Show current role
  RAISE NOTICE 'Current role: %', (
    SELECT r.name
    FROM user_roles_projection ur
    JOIN roles_projection r ON r.id = ur.role_id
    WHERE ur.user_id = v_auth_user_id
    ORDER BY CASE WHEN r.name = 'super_admin' THEN 1 ELSE 2 END
    LIMIT 1
  );

  -- Show what JWT claims will be
  RAISE NOTICE 'JWT claims preview: %', (
    SELECT public.get_user_claims_preview(v_auth_user_id)
  );

  RAISE NOTICE '===== INSTRUCTIONS =====';
  RAISE NOTICE 'User record created and super_admin role assigned.';
  RAISE NOTICE 'To apply the new role:';
  RAISE NOTICE '1. Log out of the application';
  RAISE NOTICE '2. Log back in via Google OAuth';
  RAISE NOTICE '3. New JWT will include super_admin role and all permissions';

END $$;
