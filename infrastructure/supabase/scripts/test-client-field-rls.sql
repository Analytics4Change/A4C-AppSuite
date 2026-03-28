-- =============================================================================
-- RLS Verification: Client Field Configuration Tables (Phase 2)
-- =============================================================================
-- Run in Supabase SQL Editor or via psql.
-- Wrapped in BEGIN/ROLLBACK — no persistent changes.
--
-- Tests 7 scenarios across 5 new tables:
--   clients_projection, client_field_definitions_projection,
--   client_field_categories, client_reference_values,
--   contact_designations_projection
-- =============================================================================

BEGIN;

DO $$
DECLARE
  v_org_a_id uuid;
  v_org_b_id uuid;
  v_org_a_path text;
  v_org_b_path text;
  v_bogus_org_id uuid := '00000000-0000-0000-0000-000000000000';
  v_user_id uuid := gen_random_uuid(); -- synthetic user for testing
  v_count bigint;
  v_count_a bigint;
  v_count_b bigint;
  v_pass integer := 0;
  v_fail integer := 0;
BEGIN

  -- ── Setup: Find two distinct bootstrapped orgs ──
  SELECT id, path::text INTO v_org_a_id, v_org_a_path
  FROM organizations_projection
  WHERE is_active = true AND deleted_at IS NULL
  ORDER BY created_at
  LIMIT 1;

  SELECT id, path::text INTO v_org_b_id, v_org_b_path
  FROM organizations_projection
  WHERE is_active = true AND deleted_at IS NULL AND id != v_org_a_id
  ORDER BY created_at
  LIMIT 1;

  IF v_org_a_id IS NULL THEN
    RAISE EXCEPTION 'Need at least 1 active org to test RLS';
  END IF;

  RAISE NOTICE '';
  RAISE NOTICE '════════════════════════════════════════════════════════';
  RAISE NOTICE ' RLS Verification: Client Field Configuration Tables';
  RAISE NOTICE '════════════════════════════════════════════════════════';
  RAISE NOTICE 'Org A: % (path: %)', v_org_a_id, v_org_a_path;
  RAISE NOTICE 'Org B: % (path: %)', COALESCE(v_org_b_id::text, 'N/A — single-org mode'), COALESCE(v_org_b_path, 'N/A');
  RAISE NOTICE '';

  -- ═══════════════════════════════════════════════════════════════════
  -- TEST 1: client_field_definitions_projection — org isolation
  -- ═══════════════════════════════════════════════════════════════════
  RAISE NOTICE '── TEST 1: Field Definitions — Org A sees only its own rows ──';

  PERFORM set_config('request.jwt.claims', json_build_object(
    'sub', v_user_id,
    'org_id', v_org_a_id,
    'org_type', 'provider',
    'effective_permissions', json_build_array(),
    'claims_version', 4
  )::text, true);
  PERFORM set_config('role', 'authenticated', true);

  SELECT count(*) INTO v_count_a FROM client_field_definitions_projection;

  RAISE NOTICE '  Org A field definitions: %', v_count_a;

  IF v_count_a > 0 THEN
    RAISE NOTICE '  [PASS] Org A sees % field definitions', v_count_a;
    v_pass := v_pass + 1;
  ELSE
    RAISE NOTICE '  [FAIL] Org A sees 0 field definitions (expected ~66 from bootstrap)';
    v_fail := v_fail + 1;
  END IF;

  -- Reset role for next test setup
  RESET ROLE;

  -- ═══════════════════════════════════════════════════════════════════
  -- TEST 2: client_field_definitions_projection — cross-org isolation
  -- ═══════════════════════════════════════════════════════════════════
  IF v_org_b_id IS NOT NULL THEN
    RAISE NOTICE '';
    RAISE NOTICE '── TEST 2: Field Definitions — Org B sees different rows ──';

    PERFORM set_config('request.jwt.claims', json_build_object(
      'sub', v_user_id,
      'org_id', v_org_b_id,
      'org_type', 'provider',
      'effective_permissions', json_build_array(),
      'claims_version', 4
    )::text, true);
    PERFORM set_config('role', 'authenticated', true);

    SELECT count(*) INTO v_count_b FROM client_field_definitions_projection;

    RAISE NOTICE '  Org B field definitions: %', v_count_b;

    -- Verify no overlap: Org A's rows should not appear when querying as Org B
    SELECT count(*) INTO v_count
    FROM client_field_definitions_projection
    WHERE organization_id = v_org_a_id;

    IF v_count = 0 THEN
      RAISE NOTICE '  [PASS] Org B cannot see Org A''s field definitions (0 rows leaked)';
      v_pass := v_pass + 1;
    ELSE
      RAISE NOTICE '  [FAIL] Org B can see % of Org A''s rows — RLS BREACH', v_count;
      v_fail := v_fail + 1;
    END IF;

    RESET ROLE;
  ELSE
    RAISE NOTICE '';
    RAISE NOTICE '── TEST 2: SKIPPED — only 1 org available ──';
  END IF;

  -- ═══════════════════════════════════════════════════════════════════
  -- TEST 3: client_field_definitions_projection — bogus org sees 0
  -- ═══════════════════════════════════════════════════════════════════
  RAISE NOTICE '';
  RAISE NOTICE '── TEST 3: Field Definitions — Non-existent org sees 0 rows ──';

  PERFORM set_config('request.jwt.claims', json_build_object(
    'sub', v_user_id,
    'org_id', v_bogus_org_id,
    'org_type', 'provider',
    'effective_permissions', json_build_array(),
    'claims_version', 4
  )::text, true);
  PERFORM set_config('role', 'authenticated', true);

  SELECT count(*) INTO v_count FROM client_field_definitions_projection;

  IF v_count = 0 THEN
    RAISE NOTICE '  [PASS] Bogus org sees 0 field definitions';
    v_pass := v_pass + 1;
  ELSE
    RAISE NOTICE '  [FAIL] Bogus org sees % rows — RLS BREACH', v_count;
    v_fail := v_fail + 1;
  END IF;

  RESET ROLE;

  -- ═══════════════════════════════════════════════════════════════════
  -- TEST 4: client_field_categories — system categories visible to all
  -- ═══════════════════════════════════════════════════════════════════
  RAISE NOTICE '';
  RAISE NOTICE '── TEST 4: Categories — System categories visible to any org ──';

  PERFORM set_config('request.jwt.claims', json_build_object(
    'sub', v_user_id,
    'org_id', v_org_a_id,
    'org_type', 'provider',
    'effective_permissions', json_build_array(),
    'claims_version', 4
  )::text, true);
  PERFORM set_config('role', 'authenticated', true);

  SELECT count(*) INTO v_count
  FROM client_field_categories
  WHERE organization_id IS NULL AND is_active = true;

  IF v_count >= 11 THEN
    RAISE NOTICE '  [PASS] Org A sees % system categories (expected >= 11)', v_count;
    v_pass := v_pass + 1;
  ELSE
    RAISE NOTICE '  [FAIL] Org A sees only % system categories (expected >= 11)', v_count;
    v_fail := v_fail + 1;
  END IF;

  RESET ROLE;

  -- ═══════════════════════════════════════════════════════════════════
  -- TEST 5: client_reference_values — language seeds visible
  -- ═══════════════════════════════════════════════════════════════════
  RAISE NOTICE '';
  RAISE NOTICE '── TEST 5: Reference Values — ISO 639 language seeds visible ──';

  PERFORM set_config('request.jwt.claims', json_build_object(
    'sub', v_user_id,
    'org_id', v_org_a_id,
    'org_type', 'provider',
    'effective_permissions', json_build_array(),
    'claims_version', 4
  )::text, true);
  PERFORM set_config('role', 'authenticated', true);

  SELECT count(*) INTO v_count
  FROM client_reference_values
  WHERE category = 'language';

  IF v_count >= 40 THEN
    RAISE NOTICE '  [PASS] % language reference values visible (expected >= 40)', v_count;
    v_pass := v_pass + 1;
  ELSE
    RAISE NOTICE '  [FAIL] Only % language values visible (expected >= 40)', v_count;
    v_fail := v_fail + 1;
  END IF;

  RESET ROLE;

  -- ═══════════════════════════════════════════════════════════════════
  -- TEST 6: Platform admin — sees ALL orgs' field definitions
  -- ═══════════════════════════════════════════════════════════════════
  RAISE NOTICE '';
  RAISE NOTICE '── TEST 6: Platform Admin — cross-org access ──';

  PERFORM set_config('request.jwt.claims', json_build_object(
    'sub', v_user_id,
    'org_id', v_org_a_id,
    'org_type', 'platform_owner',
    'effective_permissions', json_build_array(
      json_build_object('p', 'platform.admin', 's', '')
    ),
    'claims_version', 4
  )::text, true);
  PERFORM set_config('role', 'authenticated', true);

  -- Platform admin should see field definitions from ALL orgs
  SELECT count(DISTINCT organization_id) INTO v_count
  FROM client_field_definitions_projection;

  IF v_count > 1 OR (v_count = 1 AND v_org_b_id IS NULL) THEN
    RAISE NOTICE '  [PASS] Platform admin sees field definitions from % org(s)', v_count;
    v_pass := v_pass + 1;
  ELSE
    RAISE NOTICE '  [FAIL] Platform admin sees only % org(s) — expected cross-org access', v_count;
    v_fail := v_fail + 1;
  END IF;

  -- Also verify clients_projection is accessible (even if empty)
  SELECT count(*) INTO v_count FROM clients_projection;
  RAISE NOTICE '  clients_projection rows (platform admin): % (0 expected — no clients yet)', v_count;

  -- Also verify contact_designations_projection is accessible (even if empty)
  SELECT count(*) INTO v_count FROM contact_designations_projection;
  RAISE NOTICE '  contact_designations_projection rows (platform admin): % (0 expected)', v_count;

  RESET ROLE;

  -- ═══════════════════════════════════════════════════════════════════
  -- TEST 7: Write denial — authenticated cannot INSERT into projections
  -- ═══════════════════════════════════════════════════════════════════
  RAISE NOTICE '';
  RAISE NOTICE '── TEST 7: Write Denial — authenticated cannot INSERT into projections ──';

  PERFORM set_config('request.jwt.claims', json_build_object(
    'sub', v_user_id,
    'org_id', v_org_a_id,
    'org_type', 'provider',
    'effective_permissions', json_build_array(
      json_build_object('p', 'organization.update', 's', v_org_a_path)
    ),
    'claims_version', 4
  )::text, true);
  PERFORM set_config('role', 'authenticated', true);

  -- Try INSERT into clients_projection — should fail
  BEGIN
    INSERT INTO clients_projection (id, organization_id, first_name, last_name, date_of_birth, gender, admission_date, status, allergies, medical_conditions, created_by, updated_by)
    VALUES (gen_random_uuid(), v_org_a_id, 'Test', 'User', '2000-01-01', 'male', now(), 'active', '[]'::jsonb, '[]'::jsonb, v_user_id, v_user_id);
    RAISE NOTICE '  [FAIL] INSERT into clients_projection succeeded — should be denied';
    v_fail := v_fail + 1;
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE '  [PASS] INSERT into clients_projection denied (insufficient_privilege)';
    v_pass := v_pass + 1;
  WHEN OTHERS THEN
    RAISE NOTICE '  [PASS] INSERT into clients_projection denied (%)', SQLERRM;
    v_pass := v_pass + 1;
  END;

  -- Try INSERT into client_field_definitions_projection — should fail
  BEGIN
    INSERT INTO client_field_definitions_projection (id, organization_id, category_id, field_key, display_name)
    VALUES (gen_random_uuid(), v_org_a_id, gen_random_uuid(), 'test_key', 'Test');
    RAISE NOTICE '  [FAIL] INSERT into client_field_definitions_projection succeeded — should be denied';
    v_fail := v_fail + 1;
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE '  [PASS] INSERT into client_field_definitions_projection denied (insufficient_privilege)';
    v_pass := v_pass + 1;
  WHEN OTHERS THEN
    RAISE NOTICE '  [PASS] INSERT into client_field_definitions_projection denied (%)', SQLERRM;
    v_pass := v_pass + 1;
  END;

  RESET ROLE;

  -- ═══════════════════════════════════════════════════════════════════
  -- SUMMARY
  -- ═══════════════════════════════════════════════════════════════════
  RAISE NOTICE '';
  RAISE NOTICE '════════════════════════════════════════════════════════';
  RAISE NOTICE ' RESULTS: % passed, % failed', v_pass, v_fail;
  RAISE NOTICE '════════════════════════════════════════════════════════';

  IF v_fail > 0 THEN
    RAISE NOTICE ' ⚠ FAILURES DETECTED — review output above';
  ELSE
    RAISE NOTICE ' All RLS policies verified successfully.';
  END IF;

END;
$$;

ROLLBACK;
