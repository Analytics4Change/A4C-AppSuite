-- ============================================
-- BACKFILL ORPHANED DOMAIN EVENTS
-- ============================================
-- This migration backfills missing domain events for projections that
-- were created without corresponding events (breaking CQRS invariant).
--
-- Root cause: Day 0 baseline captured projection state via pg_dump,
-- or direct inserts bypassed event sourcing.
--
-- Backfills:
-- 1. user.registered events for orphaned users (5 users)
-- 2. user.role.assigned events for orphaned role assignments
-- 3. invitation.created events for orphaned invitations (2 invitations)
-- ============================================

-- ============================================
-- Step 1: Clean up test data first
-- ============================================
DELETE FROM user_roles_projection
WHERE organization_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

-- ============================================
-- Step 2: Backfill user.registered events
-- ============================================
-- Using DO block to handle each user individually and avoid version conflicts

DO $$
DECLARE
  r RECORD;
  v_next_version INT;
BEGIN
  FOR r IN
    SELECT u.id, u.email, u.created_at
    FROM users u
    LEFT JOIN domain_events de ON de.stream_id = u.id AND de.event_type = 'user.registered'
    WHERE de.id IS NULL
  LOOP
    -- Get next stream version for this user
    SELECT COALESCE(MAX(stream_version), 0) + 1 INTO v_next_version
    FROM domain_events
    WHERE stream_id = r.id AND stream_type = 'user';

    INSERT INTO domain_events (stream_id, stream_type, stream_version, event_type, event_data, event_metadata)
    VALUES (
      r.id,
      'user',
      v_next_version,
      'user.registered',
      jsonb_build_object(
        'email', r.email,
        'created_at', r.created_at
      ),
      jsonb_build_object(
        'user_id', '00000000-0000-0000-0000-000000000000',
        'reason', 'Event sourcing backfill: Orphaned user from Day 0 baseline'
      )
    );

    RAISE NOTICE 'Backfilled user.registered for user %', r.email;
  END LOOP;
END;
$$;

-- ============================================
-- Step 3: Backfill user.role.assigned events
-- ============================================
-- Note: We only backfill role assignments that don't have events

DO $$
DECLARE
  r RECORD;
  v_next_version INT;
BEGIN
  FOR r IN
    SELECT ur.user_id, ur.role_id, ur.organization_id, ur.scope_path, ur.assigned_at
    FROM user_roles_projection ur
    WHERE NOT EXISTS (
      SELECT 1 FROM domain_events de
      WHERE de.event_type = 'user.role.assigned'
        AND de.stream_id = ur.user_id
        AND de.event_data->>'role_id' = ur.role_id::TEXT
    )
  LOOP
    -- Get next stream version for this user
    SELECT COALESCE(MAX(stream_version), 0) + 1 INTO v_next_version
    FROM domain_events
    WHERE stream_id = r.user_id AND stream_type = 'user';

    INSERT INTO domain_events (stream_id, stream_type, stream_version, event_type, event_data, event_metadata)
    VALUES (
      r.user_id,
      'user',
      v_next_version,
      'user.role.assigned',
      jsonb_build_object(
        'role_id', r.role_id,
        'org_id', CASE WHEN r.organization_id IS NULL THEN '*' ELSE r.organization_id::TEXT END,
        'scope_path', CASE WHEN r.scope_path IS NULL THEN '*' ELSE r.scope_path::TEXT END
      ),
      jsonb_build_object(
        'user_id', '00000000-0000-0000-0000-000000000000',
        'reason', 'Event sourcing backfill: Orphaned role assignment from Day 0 baseline'
      )
    );

    RAISE NOTICE 'Backfilled user.role.assigned for user % role %', r.user_id, r.role_id;
  END LOOP;
END;
$$;

-- ============================================
-- Step 4: Backfill invitation.created events
-- ============================================
-- invitations_projection schema: id, invitation_id, organization_id, email,
-- first_name, last_name, role (TEXT), token, expires_at, status,
-- accepted_at, created_at, updated_at, tags

DO $$
DECLARE
  r RECORD;
  v_next_version INT;
BEGIN
  FOR r IN
    SELECT i.id, i.email, i.organization_id, i.role, i.status, i.expires_at, i.created_at
    FROM invitations_projection i
    LEFT JOIN domain_events de ON de.stream_id = i.id AND de.event_type = 'invitation.created'
    WHERE de.id IS NULL
  LOOP
    -- Get next stream version for this invitation
    SELECT COALESCE(MAX(stream_version), 0) + 1 INTO v_next_version
    FROM domain_events
    WHERE stream_id = r.id AND stream_type = 'invitation';

    INSERT INTO domain_events (stream_id, stream_type, stream_version, event_type, event_data, event_metadata)
    VALUES (
      r.id,
      'invitation',
      v_next_version,
      'invitation.created',
      jsonb_build_object(
        'email', r.email,
        'organization_id', r.organization_id,
        'role', r.role,
        'status', r.status,
        'expires_at', r.expires_at,
        'created_at', r.created_at
      ),
      jsonb_build_object(
        'user_id', '00000000-0000-0000-0000-000000000000',
        'reason', 'Event sourcing backfill: Orphaned invitation'
      )
    );

    RAISE NOTICE 'Backfilled invitation.created for %', r.email;
  END LOOP;
END;
$$;

-- ============================================
-- VERIFICATION
-- ============================================
DO $$
DECLARE
  v_orphaned_users INT;
  v_orphaned_invitations INT;
  v_test_data_count INT;
BEGIN
  -- Check orphaned users
  SELECT COUNT(*) INTO v_orphaned_users
  FROM users u
  LEFT JOIN domain_events de ON de.stream_id = u.id AND de.event_type = 'user.registered'
  WHERE de.id IS NULL;

  -- Check orphaned invitations
  SELECT COUNT(*) INTO v_orphaned_invitations
  FROM invitations_projection i
  LEFT JOIN domain_events de ON de.stream_id = i.id AND de.event_type = 'invitation.created'
  WHERE de.id IS NULL;

  -- Check test data removed
  SELECT COUNT(*) INTO v_test_data_count
  FROM user_roles_projection
  WHERE organization_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

  RAISE NOTICE 'Verification: orphaned_users=%, orphaned_invitations=%, test_data_remaining=%',
    v_orphaned_users, v_orphaned_invitations, v_test_data_count;

  IF v_orphaned_users > 0 OR v_orphaned_invitations > 0 THEN
    RAISE WARNING 'Some orphaned data remains!';
  ELSE
    RAISE NOTICE 'SUCCESS: All orphaned data has been backfilled';
  END IF;
END;
$$;
