-- =============================================================================
-- Test: Schedule Assignment RPC Functions
-- Purpose: Validate column references, return types, and basic behavior for
--          api.list_users_for_schedule_management and api.sync_schedule_assignments
--
-- Usage:
--   Execute via MCP execute_sql or psql against the target database.
--   All tests run in a transaction and ROLLBACK at the end (no side effects).
--
-- Prerequisites:
--   - At least 1 organization with users
--   - At least 1 schedule template
-- =============================================================================

BEGIN;

DO $$
DECLARE
  v_org_id UUID;
  v_org_path TEXT;
  v_user_id UUID;
  v_template_id UUID;
  v_result RECORD;
  v_count INT;
  v_sync_result JSONB;
  v_test_name TEXT;
  v_tests_passed INT := 0;
  v_tests_failed INT := 0;
BEGIN
  -- =========================================================================
  -- Setup: Find test fixtures from existing data
  -- =========================================================================
  RAISE NOTICE '=== Schedule Assignment RPC Test Suite ===';
  RAISE NOTICE '';

  -- Find an org with at least one user and one schedule template
  SELECT u.current_organization_id, u.id
  INTO v_org_id, v_user_id
  FROM users u
  WHERE u.current_organization_id IS NOT NULL
    AND u.deleted_at IS NULL
    AND u.is_active = true
  LIMIT 1;

  IF v_org_id IS NULL THEN
    RAISE EXCEPTION 'TEST SETUP FAILED: No active user with an organization found';
  END IF;

  -- Get the org's ltree path for permission simulation
  SELECT op.path::text INTO v_org_path
  FROM organizations_projection op
  WHERE op.id = v_org_id;

  IF v_org_path IS NULL THEN
    RAISE EXCEPTION 'TEST SETUP FAILED: Organization % has no path in organizations_projection', v_org_id;
  END IF;

  -- Find a schedule template in this org
  SELECT st.id INTO v_template_id
  FROM schedule_templates_projection st
  WHERE st.organization_id = v_org_id
  LIMIT 1;

  IF v_template_id IS NULL THEN
    RAISE EXCEPTION 'TEST SETUP FAILED: No schedule template found for org %', v_org_id;
  END IF;

  RAISE NOTICE 'Test fixtures: org=%, user=%, template=%, path=%',
    v_org_id, v_user_id, v_template_id, v_org_path;
  RAISE NOTICE '';

  -- =========================================================================
  -- Simulate authenticated JWT context
  -- =========================================================================
  PERFORM set_config('request.jwt.claims', json_build_object(
    'sub', v_user_id,
    'org_id', v_org_id,
    'org_type', 'provider',
    'effective_permissions', json_build_array(
      json_build_object('p', 'user.schedule_manage', 's', v_org_path)
    ),
    'claims_version', 4
  )::text, true);
  PERFORM set_config('role', 'authenticated', true);

  -- =========================================================================
  -- TEST 1: list_users_for_schedule_management — no column errors
  -- =========================================================================
  v_test_name := 'list_users: executes without column errors';
  BEGIN
    SELECT count(*) INTO v_count
    FROM api.list_users_for_schedule_management(v_template_id, NULL, 100, 0);

    RAISE NOTICE '[PASS] %  (% rows returned)', v_test_name, v_count;
    v_tests_passed := v_tests_passed + 1;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE '[FAIL] %  — %: %', v_test_name, SQLSTATE, SQLERRM;
    v_tests_failed := v_tests_failed + 1;
  END;

  -- =========================================================================
  -- TEST 2: list_users — all 7 output columns are non-null where expected
  -- =========================================================================
  v_test_name := 'list_users: all output columns resolve correctly';
  BEGIN
    SELECT * INTO v_result
    FROM api.list_users_for_schedule_management(v_template_id, NULL, 1, 0);

    IF v_result IS NULL THEN
      RAISE EXCEPTION 'No rows returned — need at least 1 user in org';
    END IF;

    -- Validate each column is present and has correct type
    IF v_result.id IS NULL THEN
      RAISE EXCEPTION 'Column "id" is NULL — should be user UUID';
    END IF;
    IF v_result.email IS NULL THEN
      RAISE EXCEPTION 'Column "email" is NULL — should be user email';
    END IF;
    IF v_result.display_name IS NULL THEN
      RAISE EXCEPTION 'Column "display_name" is NULL — should be COALESCE(name, email)';
    END IF;
    IF v_result.is_active IS NULL THEN
      RAISE EXCEPTION 'Column "is_active" is NULL — should be boolean';
    END IF;
    IF v_result.is_assigned IS NULL THEN
      RAISE EXCEPTION 'Column "is_assigned" is NULL — should be boolean';
    END IF;
    -- current_schedule_id and current_schedule_name CAN be null (user not on another template)

    RAISE NOTICE '[PASS] %  (id=%, email=%, display_name=%, is_active=%, is_assigned=%)',
      v_test_name, v_result.id, v_result.email, v_result.display_name,
      v_result.is_active, v_result.is_assigned;
    v_tests_passed := v_tests_passed + 1;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE '[FAIL] %  — %: %', v_test_name, SQLSTATE, SQLERRM;
    v_tests_failed := v_tests_failed + 1;
  END;

  -- =========================================================================
  -- TEST 3: list_users — search filter works (no column errors in ILIKE)
  -- =========================================================================
  v_test_name := 'list_users: search_term filter works';
  BEGIN
    SELECT count(*) INTO v_count
    FROM api.list_users_for_schedule_management(v_template_id, 'zzz_no_match_zzz', 100, 0);

    IF v_count <> 0 THEN
      RAISE EXCEPTION 'Expected 0 rows for nonsense search, got %', v_count;
    END IF;

    RAISE NOTICE '[PASS] %  (0 rows for no-match search)', v_test_name;
    v_tests_passed := v_tests_passed + 1;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE '[FAIL] %  — %: %', v_test_name, SQLSTATE, SQLERRM;
    v_tests_failed := v_tests_failed + 1;
  END;

  -- =========================================================================
  -- TEST 4: list_users — pagination works
  -- =========================================================================
  v_test_name := 'list_users: limit and offset work';
  BEGIN
    SELECT count(*) INTO v_count
    FROM api.list_users_for_schedule_management(v_template_id, NULL, 1, 0);

    IF v_count > 1 THEN
      RAISE EXCEPTION 'LIMIT 1 returned % rows', v_count;
    END IF;

    RAISE NOTICE '[PASS] %  (limit=1 returned % row(s))', v_test_name, v_count;
    v_tests_passed := v_tests_passed + 1;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE '[FAIL] %  — %: %', v_test_name, SQLSTATE, SQLERRM;
    v_tests_failed := v_tests_failed + 1;
  END;

  -- =========================================================================
  -- TEST 5: sync_schedule_assignments — no-op (empty arrays) works
  -- =========================================================================
  v_test_name := 'sync_assignments: empty arrays return valid result';
  BEGIN
    SELECT api.sync_schedule_assignments(
      v_template_id,
      ARRAY[]::UUID[],
      ARRAY[]::UUID[]
    ) INTO v_sync_result;

    IF v_sync_result IS NULL THEN
      RAISE EXCEPTION 'Returned NULL';
    END IF;
    IF NOT (v_sync_result ? 'added') THEN
      RAISE EXCEPTION 'Missing "added" key in result';
    END IF;
    IF NOT (v_sync_result ? 'removed') THEN
      RAISE EXCEPTION 'Missing "removed" key in result';
    END IF;
    IF NOT (v_sync_result ? 'transferred') THEN
      RAISE EXCEPTION 'Missing "transferred" key in result';
    END IF;
    IF NOT (v_sync_result ? 'correlationId') THEN
      RAISE EXCEPTION 'Missing "correlationId" key in result';
    END IF;

    RAISE NOTICE '[PASS] %  (result keys: added, removed, transferred, correlationId)', v_test_name;
    v_tests_passed := v_tests_passed + 1;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE '[FAIL] %  — %: %', v_test_name, SQLSTATE, SQLERRM;
    v_tests_failed := v_tests_failed + 1;
  END;

  -- =========================================================================
  -- TEST 6: sync_schedule_assignments — add a user works (column refs valid)
  -- =========================================================================
  v_test_name := 'sync_assignments: add user resolves all column references';
  BEGIN
    SELECT api.sync_schedule_assignments(
      v_template_id,
      ARRAY[v_user_id],
      ARRAY[]::UUID[]
    ) INTO v_sync_result;

    IF v_sync_result IS NULL THEN
      RAISE EXCEPTION 'Returned NULL';
    END IF;

    -- Check that the user appears in added.successful
    IF NOT (v_sync_result->'added'->'successful' @> to_jsonb(ARRAY[v_user_id])) THEN
      -- Could be in failed if already assigned (check failed array too)
      IF jsonb_array_length(v_sync_result->'added'->'failed') > 0 THEN
        RAISE NOTICE '  (user add reported as failed: %)', v_sync_result->'added'->'failed';
        RAISE EXCEPTION 'User add failed: %', v_sync_result->'added'->'failed';
      END IF;
    END IF;

    RAISE NOTICE '[PASS] %  (result: %)', v_test_name,
      jsonb_build_object(
        'added_ok', jsonb_array_length(v_sync_result->'added'->'successful'),
        'added_fail', jsonb_array_length(v_sync_result->'added'->'failed')
      );
    v_tests_passed := v_tests_passed + 1;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE '[FAIL] %  — %: %', v_test_name, SQLSTATE, SQLERRM;
    v_tests_failed := v_tests_failed + 1;
  END;

  -- =========================================================================
  -- TEST 7: list_users — user now shows as assigned
  -- =========================================================================
  v_test_name := 'list_users: assigned user shows is_assigned=true';
  BEGIN
    SELECT * INTO v_result
    FROM api.list_users_for_schedule_management(v_template_id, NULL, 100, 0)
    WHERE id = v_user_id;

    IF v_result IS NULL THEN
      RAISE EXCEPTION 'User % not found in results', v_user_id;
    END IF;

    IF v_result.is_assigned <> true THEN
      RAISE EXCEPTION 'Expected is_assigned=true, got %', v_result.is_assigned;
    END IF;

    RAISE NOTICE '[PASS] %  (user % is_assigned=true)', v_test_name, v_user_id;
    v_tests_passed := v_tests_passed + 1;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE '[FAIL] %  — %: %', v_test_name, SQLSTATE, SQLERRM;
    v_tests_failed := v_tests_failed + 1;
  END;

  -- =========================================================================
  -- TEST 8: sync_schedule_assignments — remove the user works
  -- =========================================================================
  v_test_name := 'sync_assignments: remove user resolves all column references';
  BEGIN
    SELECT api.sync_schedule_assignments(
      v_template_id,
      ARRAY[]::UUID[],
      ARRAY[v_user_id]
    ) INTO v_sync_result;

    IF v_sync_result IS NULL THEN
      RAISE EXCEPTION 'Returned NULL';
    END IF;

    IF NOT (v_sync_result->'removed'->'successful' @> to_jsonb(ARRAY[v_user_id])) THEN
      RAISE EXCEPTION 'User not in removed.successful: %', v_sync_result;
    END IF;

    RAISE NOTICE '[PASS] %  (removed_ok: %)', v_test_name,
      jsonb_array_length(v_sync_result->'removed'->'successful');
    v_tests_passed := v_tests_passed + 1;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE '[FAIL] %  — %: %', v_test_name, SQLSTATE, SQLERRM;
    v_tests_failed := v_tests_failed + 1;
  END;

  -- =========================================================================
  -- TEST 9: sync_schedule_assignments — invalid template returns error
  -- =========================================================================
  v_test_name := 'sync_assignments: invalid template_id raises P0002';
  BEGIN
    SELECT api.sync_schedule_assignments(
      '00000000-0000-0000-0000-000000000000'::UUID,
      ARRAY[v_user_id],
      ARRAY[]::UUID[]
    ) INTO v_sync_result;

    -- Should not reach here
    RAISE EXCEPTION 'Expected P0002 exception, got result: %', v_sync_result;
  EXCEPTION
    WHEN SQLSTATE 'P0002' THEN
      RAISE NOTICE '[PASS] %  (got P0002 as expected)', v_test_name;
      v_tests_passed := v_tests_passed + 1;
    WHEN OTHERS THEN
      RAISE NOTICE '[FAIL] %  — expected P0002, got %: %', v_test_name, SQLSTATE, SQLERRM;
      v_tests_failed := v_tests_failed + 1;
  END;

  -- =========================================================================
  -- Summary
  -- =========================================================================
  RAISE NOTICE '';
  RAISE NOTICE '=== Results: % passed, % failed, % total ===',
    v_tests_passed, v_tests_failed, v_tests_passed + v_tests_failed;

  IF v_tests_failed > 0 THEN
    RAISE EXCEPTION 'TEST SUITE FAILED: % test(s) failed', v_tests_failed;
  END IF;

  -- Reset role
  PERFORM set_config('role', 'postgres', true);
END;
$$;

-- Rollback: no side effects from test run
ROLLBACK;
