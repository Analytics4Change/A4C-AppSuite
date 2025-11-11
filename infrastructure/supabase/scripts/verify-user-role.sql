-- Verify User Role Setup
-- Checks if user record and role assignment exist correctly

DO $$
DECLARE
  v_user_id UUID := '5a975b95-a14d-4ddd-bdb6-949033dab0b8';
  v_user_email TEXT := 'lars.tice@gmail.com';
BEGIN
  RAISE NOTICE '===== USER VERIFICATION =====';

  -- Check auth.users
  RAISE NOTICE 'auth.users: %', (
    SELECT CASE
      WHEN EXISTS (SELECT 1 FROM auth.users WHERE id = v_user_id)
      THEN 'EXISTS'
      ELSE 'NOT FOUND'
    END
  );

  -- Check public.users
  RAISE NOTICE 'public.users: %', (
    SELECT CASE
      WHEN EXISTS (SELECT 1 FROM users WHERE id = v_user_id)
      THEN 'EXISTS - ' || (SELECT name FROM users WHERE id = v_user_id)
      ELSE 'NOT FOUND'
    END
  );

  -- Check roles_projection (what roles exist)
  RAISE NOTICE '===== AVAILABLE ROLES =====';
  RAISE NOTICE 'roles_projection:';
  FOR v_rec IN
    SELECT id, name FROM roles_projection ORDER BY name
  LOOP
    RAISE NOTICE '  - % (%)', v_rec.name, v_rec.id;
  END LOOP;

  -- Check user_roles_projection
  RAISE NOTICE '===== USER ROLE ASSIGNMENT =====';
  RAISE NOTICE 'user_roles_projection for user:';

  IF EXISTS (SELECT 1 FROM user_roles_projection WHERE user_id = v_user_id) THEN
    FOR v_rec IN
      SELECT
        ur.role_id,
        r.name as role_name,
        ur.org_id,
        ur.is_active,
        ur.granted_at
      FROM user_roles_projection ur
      LEFT JOIN roles_projection r ON r.id = ur.role_id
      WHERE ur.user_id = v_user_id
    LOOP
      RAISE NOTICE '  - Role: % (%) | Org: % | Active: % | Granted: %',
        v_rec.role_name, v_rec.role_id, v_rec.org_id, v_rec.is_active, v_rec.granted_at;
    END LOOP;
  ELSE
    RAISE NOTICE '  NO ROLES ASSIGNED';
  END IF;

  -- Check domain_events
  RAISE NOTICE '===== DOMAIN EVENTS =====';
  RAISE NOTICE 'domain_events for user:';
  FOR v_rec IN
    SELECT event_type, stream_version, created_at
    FROM domain_events
    WHERE stream_id = v_user_id
      AND stream_type = 'user'
    ORDER BY stream_version
  LOOP
    RAISE NOTICE '  - v% : % (at %)', v_rec.stream_version, v_rec.event_type, v_rec.created_at;
  END LOOP;

  -- Show what JWT claims will return
  RAISE NOTICE '===== JWT CLAIMS PREVIEW =====';
  BEGIN
    RAISE NOTICE 'Claims: %', (
      SELECT public.get_user_claims_preview(v_user_id)
    );
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'JWT claims preview failed: %', SQLERRM;
  END;

END $$;
