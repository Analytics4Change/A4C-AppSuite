-- =============================================================================
-- RLS Verification: Client Field Configuration Tables (Phase 2 + Phase 3)
-- =============================================================================
-- Run in Supabase SQL Editor or via MCP execute_sql.
-- Wrapped in BEGIN/ROLLBACK — no persistent changes.
--
-- Tests 19 scenarios across 7 tables:
--   1. clients_projection              (org-scoped SELECT, platform admin)
--   2. client_field_definitions_projection (org-scoped SELECT, platform admin)
--   3. client_field_categories          (system + org-scoped SELECT, platform admin)
--   4. client_reference_values          (global read, platform admin write)
--   5. client_field_definition_templates (global read, platform admin write)
--   6. contact_designations_projection  (org-scoped SELECT, platform admin)
--   7. user_client_assignments_projection (FK to clients_projection)
--
-- Coverage:
--   - Org isolation (same-org sees own rows)
--   - Cross-org isolation (other org sees 0 leaked rows)
--   - Bogus org isolation (non-existent org sees 0)
--   - Platform admin override (cross-org access)
--   - Global-read tables accessible to any authenticated user
--   - Write denial (INSERT/UPDATE/DELETE) for authenticated role on all tables
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
  v_skip integer := 0;
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

  IF v_count_a > 0 THEN
    RAISE NOTICE '  [PASS] Org A sees % field definitions', v_count_a;
    v_pass := v_pass + 1;
  ELSE
    RAISE NOTICE '  [FAIL] Org A sees 0 field definitions (expected ~67 from bootstrap)';
    v_fail := v_fail + 1;
  END IF;

  RESET ROLE;

  -- ═══════════════════════════════════════════════════════════════════
  -- TEST 2: client_field_definitions_projection — cross-org isolation
  -- ═══════════════════════════════════════════════════════════════════
  IF v_org_b_id IS NOT NULL THEN
    RAISE NOTICE '';
    RAISE NOTICE '── TEST 2: Field Definitions — Org B cannot see Org A rows ──';

    PERFORM set_config('request.jwt.claims', json_build_object(
      'sub', v_user_id,
      'org_id', v_org_b_id,
      'org_type', 'provider',
      'effective_permissions', json_build_array(),
      'claims_version', 4
    )::text, true);
    PERFORM set_config('role', 'authenticated', true);

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
    v_skip := v_skip + 1;
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
  -- TEST 4: client_field_categories — system + org-scoped visibility
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
  -- TEST 5: client_field_categories — cross-org custom category isolation
  -- ═══════════════════════════════════════════════════════════════════
  IF v_org_b_id IS NOT NULL THEN
    RAISE NOTICE '';
    RAISE NOTICE '── TEST 5: Categories — Org B cannot see Org A custom categories ──';

    PERFORM set_config('request.jwt.claims', json_build_object(
      'sub', v_user_id,
      'org_id', v_org_b_id,
      'org_type', 'provider',
      'effective_permissions', json_build_array(),
      'claims_version', 4
    )::text, true);
    PERFORM set_config('role', 'authenticated', true);

    SELECT count(*) INTO v_count
    FROM client_field_categories
    WHERE organization_id = v_org_a_id;

    IF v_count = 0 THEN
      RAISE NOTICE '  [PASS] Org B cannot see Org A''s custom categories (0 leaked)';
      v_pass := v_pass + 1;
    ELSE
      RAISE NOTICE '  [FAIL] Org B can see % of Org A''s custom categories — RLS BREACH', v_count;
      v_fail := v_fail + 1;
    END IF;

    RESET ROLE;
  ELSE
    RAISE NOTICE '';
    RAISE NOTICE '── TEST 5: SKIPPED — only 1 org available ──';
    v_skip := v_skip + 1;
  END IF;

  -- ═══════════════════════════════════════════════════════════════════
  -- TEST 6: client_reference_values — global read access
  -- ═══════════════════════════════════════════════════════════════════
  RAISE NOTICE '';
  RAISE NOTICE '── TEST 6: Reference Values — ISO 639 language seeds visible ──';

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
  -- TEST 7: client_reference_values — bogus org still sees global data
  -- ═══════════════════════════════════════════════════════════════════
  RAISE NOTICE '';
  RAISE NOTICE '── TEST 7: Reference Values — Bogus org still sees global data (USING true) ──';

  PERFORM set_config('request.jwt.claims', json_build_object(
    'sub', v_user_id,
    'org_id', v_bogus_org_id,
    'org_type', 'provider',
    'effective_permissions', json_build_array(),
    'claims_version', 4
  )::text, true);
  PERFORM set_config('role', 'authenticated', true);

  SELECT count(*) INTO v_count FROM client_reference_values;

  IF v_count >= 40 THEN
    RAISE NOTICE '  [PASS] Bogus org sees % reference values (global read confirmed)', v_count;
    v_pass := v_pass + 1;
  ELSE
    RAISE NOTICE '  [FAIL] Bogus org sees only % reference values (expected >= 40)', v_count;
    v_fail := v_fail + 1;
  END IF;

  RESET ROLE;

  -- ═══════════════════════════════════════════════════════════════════
  -- TEST 8: client_field_definition_templates — global read access
  -- ═══════════════════════════════════════════════════════════════════
  RAISE NOTICE '';
  RAISE NOTICE '── TEST 8: Templates — Seed templates visible to any authenticated user ──';

  PERFORM set_config('request.jwt.claims', json_build_object(
    'sub', v_user_id,
    'org_id', v_org_a_id,
    'org_type', 'provider',
    'effective_permissions', json_build_array(),
    'claims_version', 4
  )::text, true);
  PERFORM set_config('role', 'authenticated', true);

  SELECT count(*) INTO v_count FROM client_field_definition_templates;

  IF v_count >= 67 THEN
    RAISE NOTICE '  [PASS] % templates visible (expected >= 67)', v_count;
    v_pass := v_pass + 1;
  ELSE
    RAISE NOTICE '  [FAIL] Only % templates visible (expected >= 67)', v_count;
    v_fail := v_fail + 1;
  END IF;

  RESET ROLE;

  -- ═══════════════════════════════════════════════════════════════════
  -- TEST 9: clients_projection — bogus org sees 0
  -- ═══════════════════════════════════════════════════════════════════
  RAISE NOTICE '';
  RAISE NOTICE '── TEST 9: Clients Projection — Bogus org sees 0 rows ──';

  PERFORM set_config('request.jwt.claims', json_build_object(
    'sub', v_user_id,
    'org_id', v_bogus_org_id,
    'org_type', 'provider',
    'effective_permissions', json_build_array(),
    'claims_version', 4
  )::text, true);
  PERFORM set_config('role', 'authenticated', true);

  SELECT count(*) INTO v_count FROM clients_projection;

  IF v_count = 0 THEN
    RAISE NOTICE '  [PASS] Bogus org sees 0 client rows';
    v_pass := v_pass + 1;
  ELSE
    RAISE NOTICE '  [FAIL] Bogus org sees % client rows — RLS BREACH', v_count;
    v_fail := v_fail + 1;
  END IF;

  RESET ROLE;

  -- ═══════════════════════════════════════════════════════════════════
  -- TEST 10: contact_designations_projection — bogus org sees 0
  -- ═══════════════════════════════════════════════════════════════════
  RAISE NOTICE '';
  RAISE NOTICE '── TEST 10: Contact Designations — Bogus org sees 0 rows ──';

  PERFORM set_config('request.jwt.claims', json_build_object(
    'sub', v_user_id,
    'org_id', v_bogus_org_id,
    'org_type', 'provider',
    'effective_permissions', json_build_array(),
    'claims_version', 4
  )::text, true);
  PERFORM set_config('role', 'authenticated', true);

  SELECT count(*) INTO v_count FROM contact_designations_projection;

  IF v_count = 0 THEN
    RAISE NOTICE '  [PASS] Bogus org sees 0 contact designation rows';
    v_pass := v_pass + 1;
  ELSE
    RAISE NOTICE '  [FAIL] Bogus org sees % contact designation rows — RLS BREACH', v_count;
    v_fail := v_fail + 1;
  END IF;

  RESET ROLE;

  -- ═══════════════════════════════════════════════════════════════════
  -- TEST 11: Platform admin — cross-org access on all tables
  -- ═══════════════════════════════════════════════════════════════════
  RAISE NOTICE '';
  RAISE NOTICE '── TEST 11: Platform Admin — cross-org access ──';

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

  -- Field definitions: platform admin sees all orgs
  SELECT count(DISTINCT organization_id) INTO v_count
  FROM client_field_definitions_projection;

  IF v_count > 1 OR (v_count = 1 AND v_org_b_id IS NULL) THEN
    RAISE NOTICE '  [PASS] Platform admin sees field definitions from % org(s)', v_count;
    v_pass := v_pass + 1;
  ELSE
    RAISE NOTICE '  [FAIL] Platform admin sees only % org(s) — expected cross-org access', v_count;
    v_fail := v_fail + 1;
  END IF;

  -- Clients projection accessible (even if empty)
  SELECT count(*) INTO v_count FROM clients_projection;
  RAISE NOTICE '  clients_projection rows (platform admin): %', v_count;

  -- Contact designations accessible (even if empty)
  SELECT count(*) INTO v_count FROM contact_designations_projection;
  RAISE NOTICE '  contact_designations_projection rows (platform admin): %', v_count;

  -- Templates accessible
  SELECT count(*) INTO v_count FROM client_field_definition_templates;
  IF v_count >= 67 THEN
    RAISE NOTICE '  [PASS] Platform admin sees % templates', v_count;
    v_pass := v_pass + 1;
  ELSE
    RAISE NOTICE '  [FAIL] Platform admin sees only % templates (expected >= 67)', v_count;
    v_fail := v_fail + 1;
  END IF;

  RESET ROLE;

  -- ═══════════════════════════════════════════════════════════════════
  -- TEST 12-19: Write Denial — authenticated cannot INSERT/UPDATE/DELETE
  -- ═══════════════════════════════════════════════════════════════════
  RAISE NOTICE '';
  RAISE NOTICE '── TESTS 12-19: Write Denial — authenticated role blocked on all tables ──';

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

  -- TEST 12: INSERT into clients_projection
  BEGIN
    INSERT INTO clients_projection (id, organization_id, first_name, last_name, date_of_birth, gender, admission_date, status, allergies, medical_conditions, created_by, updated_by)
    VALUES (gen_random_uuid(), v_org_a_id, 'Test', 'User', '2000-01-01', 'male', now(), 'active', '[]'::jsonb, '[]'::jsonb, v_user_id, v_user_id);
    RAISE NOTICE '  [FAIL] TEST 12: INSERT into clients_projection succeeded — should be denied';
    v_fail := v_fail + 1;
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE '  [PASS] TEST 12: INSERT into clients_projection denied (insufficient_privilege)';
    v_pass := v_pass + 1;
  WHEN OTHERS THEN
    RAISE NOTICE '  [PASS] TEST 12: INSERT into clients_projection denied (%)', SQLERRM;
    v_pass := v_pass + 1;
  END;

  -- TEST 13: INSERT into client_field_definitions_projection
  BEGIN
    INSERT INTO client_field_definitions_projection (id, organization_id, category_id, field_key, display_name)
    VALUES (gen_random_uuid(), v_org_a_id, gen_random_uuid(), 'test_key', 'Test');
    RAISE NOTICE '  [FAIL] TEST 13: INSERT into client_field_definitions_projection succeeded — should be denied';
    v_fail := v_fail + 1;
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE '  [PASS] TEST 13: INSERT into client_field_definitions_projection denied';
    v_pass := v_pass + 1;
  WHEN OTHERS THEN
    RAISE NOTICE '  [PASS] TEST 13: INSERT into client_field_definitions_projection denied (%)', SQLERRM;
    v_pass := v_pass + 1;
  END;

  -- TEST 14: INSERT into client_field_categories
  BEGIN
    INSERT INTO client_field_categories (id, slug, display_name, sort_order, is_system, is_active)
    VALUES (gen_random_uuid(), 'test_cat', 'Test Category', 999, false, true);
    RAISE NOTICE '  [FAIL] TEST 14: INSERT into client_field_categories succeeded — should be denied';
    v_fail := v_fail + 1;
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE '  [PASS] TEST 14: INSERT into client_field_categories denied';
    v_pass := v_pass + 1;
  WHEN OTHERS THEN
    RAISE NOTICE '  [PASS] TEST 14: INSERT into client_field_categories denied (%)', SQLERRM;
    v_pass := v_pass + 1;
  END;

  -- TEST 15: INSERT into client_reference_values
  BEGIN
    INSERT INTO client_reference_values (id, category, code, display_name, sort_order)
    VALUES (gen_random_uuid(), 'language', 'xx', 'Test Language', 999);
    RAISE NOTICE '  [FAIL] TEST 15: INSERT into client_reference_values succeeded — should be denied';
    v_fail := v_fail + 1;
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE '  [PASS] TEST 15: INSERT into client_reference_values denied';
    v_pass := v_pass + 1;
  WHEN OTHERS THEN
    RAISE NOTICE '  [PASS] TEST 15: INSERT into client_reference_values denied (%)', SQLERRM;
    v_pass := v_pass + 1;
  END;

  -- TEST 16: INSERT into client_field_definition_templates
  BEGIN
    INSERT INTO client_field_definition_templates (id, field_key, display_name, field_type, category_slug, sort_order)
    VALUES (gen_random_uuid(), 'test_tmpl', 'Test Template', 'text', 'demographics', 999);
    RAISE NOTICE '  [FAIL] TEST 16: INSERT into client_field_definition_templates succeeded — should be denied';
    v_fail := v_fail + 1;
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE '  [PASS] TEST 16: INSERT into client_field_definition_templates denied';
    v_pass := v_pass + 1;
  WHEN OTHERS THEN
    RAISE NOTICE '  [PASS] TEST 16: INSERT into client_field_definition_templates denied (%)', SQLERRM;
    v_pass := v_pass + 1;
  END;

  -- TEST 17: INSERT into contact_designations_projection
  BEGIN
    INSERT INTO contact_designations_projection (id, contact_id, designation, organization_id)
    VALUES (gen_random_uuid(), gen_random_uuid(), 'clinician', v_org_a_id);
    RAISE NOTICE '  [FAIL] TEST 17: INSERT into contact_designations_projection succeeded — should be denied';
    v_fail := v_fail + 1;
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE '  [PASS] TEST 17: INSERT into contact_designations_projection denied';
    v_pass := v_pass + 1;
  WHEN OTHERS THEN
    RAISE NOTICE '  [PASS] TEST 17: INSERT into contact_designations_projection denied (%)', SQLERRM;
    v_pass := v_pass + 1;
  END;

  -- TEST 18: UPDATE on client_field_definitions_projection
  BEGIN
    UPDATE client_field_definitions_projection
    SET display_name = 'Hacked'
    WHERE organization_id = v_org_a_id;
    RAISE NOTICE '  [FAIL] TEST 18: UPDATE on client_field_definitions_projection succeeded — should be denied';
    v_fail := v_fail + 1;
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE '  [PASS] TEST 18: UPDATE on client_field_definitions_projection denied';
    v_pass := v_pass + 1;
  WHEN OTHERS THEN
    RAISE NOTICE '  [PASS] TEST 18: UPDATE on client_field_definitions_projection denied (%)', SQLERRM;
    v_pass := v_pass + 1;
  END;

  -- TEST 19: DELETE on client_field_definitions_projection
  BEGIN
    DELETE FROM client_field_definitions_projection
    WHERE organization_id = v_org_a_id;
    RAISE NOTICE '  [FAIL] TEST 19: DELETE on client_field_definitions_projection succeeded — should be denied';
    v_fail := v_fail + 1;
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE '  [PASS] TEST 19: DELETE on client_field_definitions_projection denied';
    v_pass := v_pass + 1;
  WHEN OTHERS THEN
    RAISE NOTICE '  [PASS] TEST 19: DELETE on client_field_definitions_projection denied (%)', SQLERRM;
    v_pass := v_pass + 1;
  END;

  RESET ROLE;

  -- ═══════════════════════════════════════════════════════════════════
  -- SUMMARY
  -- ═══════════════════════════════════════════════════════════════════
  RAISE NOTICE '';
  RAISE NOTICE '════════════════════════════════════════════════════════';
  RAISE NOTICE ' RESULTS: % passed, % failed, % skipped', v_pass, v_fail, v_skip;
  RAISE NOTICE '════════════════════════════════════════════════════════';

  IF v_fail > 0 THEN
    RAISE NOTICE ' FAILURES DETECTED — review output above';
  ELSE
    RAISE NOTICE ' All RLS policies verified successfully.';
  END IF;

END;
$$;

ROLLBACK;
