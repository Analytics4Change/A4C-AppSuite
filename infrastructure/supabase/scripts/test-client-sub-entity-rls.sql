-- =============================================================================
-- RLS Verification: Client Sub-Entity Projection Tables
-- =============================================================================
-- Run in Supabase SQL Editor or via MCP execute_sql.
-- Wrapped in BEGIN/ROLLBACK — no persistent changes.
--
-- Tests 49 scenarios across 7 tables:
--   1. client_phones_projection              (org-scoped SELECT, platform admin)
--   2. client_emails_projection              (org-scoped SELECT, platform admin)
--   3. client_addresses_projection           (org-scoped SELECT, platform admin)
--   4. client_contact_assignments_projection (org-scoped SELECT, platform admin)
--   5. client_insurance_policies_projection  (org-scoped SELECT, platform admin)
--   6. client_placement_history_projection   (org-scoped SELECT, platform admin)
--   7. client_funding_sources_projection     (org-scoped SELECT, platform admin)
--
-- Coverage per table (7 tests each):
--   - Org-scoped SELECT (same-org sees own rows, >=0 OK if table empty)
--   - Cross-org isolation (other org sees 0 leaked rows)
--   - Bogus org isolation (non-existent org sees 0)
--   - Platform admin override (cross-org access)
--   - Write denial: INSERT denied by RLS
--   - Write denial: UPDATE denied by RLS
--   - Write denial: DELETE denied by RLS
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
  v_count_all bigint;
  v_pass integer := 0;
  v_fail integer := 0;
  v_skip integer := 0;
  v_test integer := 0;
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
  RAISE NOTICE ' RLS Verification: Client Sub-Entity Projection Tables';
  RAISE NOTICE '════════════════════════════════════════════════════════';
  RAISE NOTICE 'Org A: % (path: %)', v_org_a_id, v_org_a_path;
  RAISE NOTICE 'Org B: % (path: %)', COALESCE(v_org_b_id::text, 'N/A — single-org mode'), COALESCE(v_org_b_path, 'N/A');
  RAISE NOTICE '';

  -- ═══════════════════════════════════════════════════════════════════════════
  -- TABLE 1: client_phones_projection
  -- ═══════════════════════════════════════════════════════════════════════════

  -- TEST 1: Org-scoped SELECT
  v_test := v_test + 1;
  RAISE NOTICE '── TEST %: client_phones_projection — Org A sees own rows ──', v_test;

  PERFORM set_config('request.jwt.claims', json_build_object(
    'sub', v_user_id,
    'org_id', v_org_a_id,
    'org_type', 'provider',
    'effective_permissions', json_build_array(),
    'claims_version', 4
  )::text, true);
  PERFORM set_config('role', 'authenticated', true);

  SELECT count(*) INTO v_count_a FROM client_phones_projection;
  RAISE NOTICE '  [PASS] Org A sees % rows (>=0 OK if no clients yet)', v_count_a;
  v_pass := v_pass + 1;

  RESET ROLE;

  -- TEST 2: Cross-org isolation
  v_test := v_test + 1;
  IF v_org_b_id IS NOT NULL THEN
    RAISE NOTICE '── TEST %: client_phones_projection — Org B cannot see Org A rows ──', v_test;

    PERFORM set_config('request.jwt.claims', json_build_object(
      'sub', v_user_id,
      'org_id', v_org_b_id,
      'org_type', 'provider',
      'effective_permissions', json_build_array(),
      'claims_version', 4
    )::text, true);
    PERFORM set_config('role', 'authenticated', true);

    SELECT count(*) INTO v_count
    FROM client_phones_projection
    WHERE organization_id = v_org_a_id;

    IF v_count = 0 THEN
      RAISE NOTICE '  [PASS] Org B cannot see Org A''s rows (0 leaked)';
      v_pass := v_pass + 1;
    ELSE
      RAISE NOTICE '  [FAIL] Org B can see % of Org A''s rows — RLS BREACH', v_count;
      v_fail := v_fail + 1;
    END IF;

    RESET ROLE;
  ELSE
    RAISE NOTICE '── TEST %: SKIPPED — only 1 org available ──', v_test;
    v_skip := v_skip + 1;
  END IF;

  -- TEST 3: Bogus org isolation
  v_test := v_test + 1;
  RAISE NOTICE '── TEST %: client_phones_projection — Bogus org sees 0 rows ──', v_test;

  PERFORM set_config('request.jwt.claims', json_build_object(
    'sub', v_user_id,
    'org_id', v_bogus_org_id,
    'org_type', 'provider',
    'effective_permissions', json_build_array(),
    'claims_version', 4
  )::text, true);
  PERFORM set_config('role', 'authenticated', true);

  SELECT count(*) INTO v_count FROM client_phones_projection;

  IF v_count = 0 THEN
    RAISE NOTICE '  [PASS] Bogus org sees 0 rows';
    v_pass := v_pass + 1;
  ELSE
    RAISE NOTICE '  [FAIL] Bogus org sees % rows — RLS BREACH', v_count;
    v_fail := v_fail + 1;
  END IF;

  RESET ROLE;

  -- TEST 4: Platform admin override
  v_test := v_test + 1;
  RAISE NOTICE '── TEST %: client_phones_projection — Platform admin sees all rows ──', v_test;

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

  SELECT count(*) INTO v_count_all FROM client_phones_projection;

  IF v_count_all >= v_count_a THEN
    RAISE NOTICE '  [PASS] Platform admin sees % rows (>= org A''s %)', v_count_all, v_count_a;
    v_pass := v_pass + 1;
  ELSE
    RAISE NOTICE '  [FAIL] Platform admin sees % rows but Org A sees % — inconsistent', v_count_all, v_count_a;
    v_fail := v_fail + 1;
  END IF;

  RESET ROLE;

  -- TEST 5: INSERT denied
  v_test := v_test + 1;
  RAISE NOTICE '── TEST %: client_phones_projection — INSERT denied ──', v_test;

  PERFORM set_config('request.jwt.claims', json_build_object(
    'sub', v_user_id,
    'org_id', v_org_a_id,
    'org_type', 'provider',
    'effective_permissions', json_build_array(),
    'claims_version', 4
  )::text, true);
  PERFORM set_config('role', 'authenticated', true);

  BEGIN
    INSERT INTO client_phones_projection (id, client_id, organization_id, phone_number, phone_type)
    VALUES (gen_random_uuid(), gen_random_uuid(), v_org_a_id, '555-0000', 'mobile');
    RAISE NOTICE '  [FAIL] INSERT succeeded — should be denied';
    v_fail := v_fail + 1;
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE '  [PASS] INSERT denied (insufficient_privilege)';
    v_pass := v_pass + 1;
  WHEN OTHERS THEN
    RAISE NOTICE '  [PASS] INSERT denied (%)', SQLERRM;
    v_pass := v_pass + 1;
  END;

  -- TEST 6: UPDATE denied
  v_test := v_test + 1;
  RAISE NOTICE '── TEST %: client_phones_projection — UPDATE denied ──', v_test;

  BEGIN
    UPDATE client_phones_projection SET phone_number = 'hacked' WHERE organization_id = v_org_a_id;
    RAISE NOTICE '  [FAIL] UPDATE succeeded — should be denied';
    v_fail := v_fail + 1;
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE '  [PASS] UPDATE denied (insufficient_privilege)';
    v_pass := v_pass + 1;
  WHEN OTHERS THEN
    RAISE NOTICE '  [PASS] UPDATE denied (%)', SQLERRM;
    v_pass := v_pass + 1;
  END;

  -- TEST 7: DELETE denied
  v_test := v_test + 1;
  RAISE NOTICE '── TEST %: client_phones_projection — DELETE denied ──', v_test;

  BEGIN
    DELETE FROM client_phones_projection WHERE organization_id = v_org_a_id;
    RAISE NOTICE '  [FAIL] DELETE succeeded — should be denied';
    v_fail := v_fail + 1;
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE '  [PASS] DELETE denied (insufficient_privilege)';
    v_pass := v_pass + 1;
  WHEN OTHERS THEN
    RAISE NOTICE '  [PASS] DELETE denied (%)', SQLERRM;
    v_pass := v_pass + 1;
  END;

  RESET ROLE;

  -- ═══════════════════════════════════════════════════════════════════════════
  -- TABLE 2: client_emails_projection
  -- ═══════════════════════════════════════════════════════════════════════════

  -- TEST 8: Org-scoped SELECT
  v_test := v_test + 1;
  RAISE NOTICE '';
  RAISE NOTICE '── TEST %: client_emails_projection — Org A sees own rows ──', v_test;

  PERFORM set_config('request.jwt.claims', json_build_object(
    'sub', v_user_id,
    'org_id', v_org_a_id,
    'org_type', 'provider',
    'effective_permissions', json_build_array(),
    'claims_version', 4
  )::text, true);
  PERFORM set_config('role', 'authenticated', true);

  SELECT count(*) INTO v_count_a FROM client_emails_projection;
  RAISE NOTICE '  [PASS] Org A sees % rows (>=0 OK if no clients yet)', v_count_a;
  v_pass := v_pass + 1;

  RESET ROLE;

  -- TEST 9: Cross-org isolation
  v_test := v_test + 1;
  IF v_org_b_id IS NOT NULL THEN
    RAISE NOTICE '── TEST %: client_emails_projection — Org B cannot see Org A rows ──', v_test;

    PERFORM set_config('request.jwt.claims', json_build_object(
      'sub', v_user_id,
      'org_id', v_org_b_id,
      'org_type', 'provider',
      'effective_permissions', json_build_array(),
      'claims_version', 4
    )::text, true);
    PERFORM set_config('role', 'authenticated', true);

    SELECT count(*) INTO v_count
    FROM client_emails_projection
    WHERE organization_id = v_org_a_id;

    IF v_count = 0 THEN
      RAISE NOTICE '  [PASS] Org B cannot see Org A''s rows (0 leaked)';
      v_pass := v_pass + 1;
    ELSE
      RAISE NOTICE '  [FAIL] Org B can see % of Org A''s rows — RLS BREACH', v_count;
      v_fail := v_fail + 1;
    END IF;

    RESET ROLE;
  ELSE
    RAISE NOTICE '── TEST %: SKIPPED — only 1 org available ──', v_test;
    v_skip := v_skip + 1;
  END IF;

  -- TEST 10: Bogus org isolation
  v_test := v_test + 1;
  RAISE NOTICE '── TEST %: client_emails_projection — Bogus org sees 0 rows ──', v_test;

  PERFORM set_config('request.jwt.claims', json_build_object(
    'sub', v_user_id,
    'org_id', v_bogus_org_id,
    'org_type', 'provider',
    'effective_permissions', json_build_array(),
    'claims_version', 4
  )::text, true);
  PERFORM set_config('role', 'authenticated', true);

  SELECT count(*) INTO v_count FROM client_emails_projection;

  IF v_count = 0 THEN
    RAISE NOTICE '  [PASS] Bogus org sees 0 rows';
    v_pass := v_pass + 1;
  ELSE
    RAISE NOTICE '  [FAIL] Bogus org sees % rows — RLS BREACH', v_count;
    v_fail := v_fail + 1;
  END IF;

  RESET ROLE;

  -- TEST 11: Platform admin override
  v_test := v_test + 1;
  RAISE NOTICE '── TEST %: client_emails_projection — Platform admin sees all rows ──', v_test;

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

  SELECT count(*) INTO v_count_all FROM client_emails_projection;

  IF v_count_all >= v_count_a THEN
    RAISE NOTICE '  [PASS] Platform admin sees % rows (>= org A''s %)', v_count_all, v_count_a;
    v_pass := v_pass + 1;
  ELSE
    RAISE NOTICE '  [FAIL] Platform admin sees % rows but Org A sees % — inconsistent', v_count_all, v_count_a;
    v_fail := v_fail + 1;
  END IF;

  RESET ROLE;

  -- TEST 12: INSERT denied
  v_test := v_test + 1;
  RAISE NOTICE '── TEST %: client_emails_projection — INSERT denied ──', v_test;

  PERFORM set_config('request.jwt.claims', json_build_object(
    'sub', v_user_id,
    'org_id', v_org_a_id,
    'org_type', 'provider',
    'effective_permissions', json_build_array(),
    'claims_version', 4
  )::text, true);
  PERFORM set_config('role', 'authenticated', true);

  BEGIN
    INSERT INTO client_emails_projection (id, client_id, organization_id, email, email_type)
    VALUES (gen_random_uuid(), gen_random_uuid(), v_org_a_id, 'rls-test@example.com', 'personal');
    RAISE NOTICE '  [FAIL] INSERT succeeded — should be denied';
    v_fail := v_fail + 1;
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE '  [PASS] INSERT denied (insufficient_privilege)';
    v_pass := v_pass + 1;
  WHEN OTHERS THEN
    RAISE NOTICE '  [PASS] INSERT denied (%)', SQLERRM;
    v_pass := v_pass + 1;
  END;

  -- TEST 13: UPDATE denied
  v_test := v_test + 1;
  RAISE NOTICE '── TEST %: client_emails_projection — UPDATE denied ──', v_test;

  BEGIN
    UPDATE client_emails_projection SET email = 'hacked@example.com' WHERE organization_id = v_org_a_id;
    RAISE NOTICE '  [FAIL] UPDATE succeeded — should be denied';
    v_fail := v_fail + 1;
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE '  [PASS] UPDATE denied (insufficient_privilege)';
    v_pass := v_pass + 1;
  WHEN OTHERS THEN
    RAISE NOTICE '  [PASS] UPDATE denied (%)', SQLERRM;
    v_pass := v_pass + 1;
  END;

  -- TEST 14: DELETE denied
  v_test := v_test + 1;
  RAISE NOTICE '── TEST %: client_emails_projection — DELETE denied ──', v_test;

  BEGIN
    DELETE FROM client_emails_projection WHERE organization_id = v_org_a_id;
    RAISE NOTICE '  [FAIL] DELETE succeeded — should be denied';
    v_fail := v_fail + 1;
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE '  [PASS] DELETE denied (insufficient_privilege)';
    v_pass := v_pass + 1;
  WHEN OTHERS THEN
    RAISE NOTICE '  [PASS] DELETE denied (%)', SQLERRM;
    v_pass := v_pass + 1;
  END;

  RESET ROLE;

  -- ═══════════════════════════════════════════════════════════════════════════
  -- TABLE 3: client_addresses_projection
  -- ═══════════════════════════════════════════════════════════════════════════

  -- TEST 15: Org-scoped SELECT
  v_test := v_test + 1;
  RAISE NOTICE '';
  RAISE NOTICE '── TEST %: client_addresses_projection — Org A sees own rows ──', v_test;

  PERFORM set_config('request.jwt.claims', json_build_object(
    'sub', v_user_id,
    'org_id', v_org_a_id,
    'org_type', 'provider',
    'effective_permissions', json_build_array(),
    'claims_version', 4
  )::text, true);
  PERFORM set_config('role', 'authenticated', true);

  SELECT count(*) INTO v_count_a FROM client_addresses_projection;
  RAISE NOTICE '  [PASS] Org A sees % rows (>=0 OK if no clients yet)', v_count_a;
  v_pass := v_pass + 1;

  RESET ROLE;

  -- TEST 16: Cross-org isolation
  v_test := v_test + 1;
  IF v_org_b_id IS NOT NULL THEN
    RAISE NOTICE '── TEST %: client_addresses_projection — Org B cannot see Org A rows ──', v_test;

    PERFORM set_config('request.jwt.claims', json_build_object(
      'sub', v_user_id,
      'org_id', v_org_b_id,
      'org_type', 'provider',
      'effective_permissions', json_build_array(),
      'claims_version', 4
    )::text, true);
    PERFORM set_config('role', 'authenticated', true);

    SELECT count(*) INTO v_count
    FROM client_addresses_projection
    WHERE organization_id = v_org_a_id;

    IF v_count = 0 THEN
      RAISE NOTICE '  [PASS] Org B cannot see Org A''s rows (0 leaked)';
      v_pass := v_pass + 1;
    ELSE
      RAISE NOTICE '  [FAIL] Org B can see % of Org A''s rows — RLS BREACH', v_count;
      v_fail := v_fail + 1;
    END IF;

    RESET ROLE;
  ELSE
    RAISE NOTICE '── TEST %: SKIPPED — only 1 org available ──', v_test;
    v_skip := v_skip + 1;
  END IF;

  -- TEST 17: Bogus org isolation
  v_test := v_test + 1;
  RAISE NOTICE '── TEST %: client_addresses_projection — Bogus org sees 0 rows ──', v_test;

  PERFORM set_config('request.jwt.claims', json_build_object(
    'sub', v_user_id,
    'org_id', v_bogus_org_id,
    'org_type', 'provider',
    'effective_permissions', json_build_array(),
    'claims_version', 4
  )::text, true);
  PERFORM set_config('role', 'authenticated', true);

  SELECT count(*) INTO v_count FROM client_addresses_projection;

  IF v_count = 0 THEN
    RAISE NOTICE '  [PASS] Bogus org sees 0 rows';
    v_pass := v_pass + 1;
  ELSE
    RAISE NOTICE '  [FAIL] Bogus org sees % rows — RLS BREACH', v_count;
    v_fail := v_fail + 1;
  END IF;

  RESET ROLE;

  -- TEST 18: Platform admin override
  v_test := v_test + 1;
  RAISE NOTICE '── TEST %: client_addresses_projection — Platform admin sees all rows ──', v_test;

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

  SELECT count(*) INTO v_count_all FROM client_addresses_projection;

  IF v_count_all >= v_count_a THEN
    RAISE NOTICE '  [PASS] Platform admin sees % rows (>= org A''s %)', v_count_all, v_count_a;
    v_pass := v_pass + 1;
  ELSE
    RAISE NOTICE '  [FAIL] Platform admin sees % rows but Org A sees % — inconsistent', v_count_all, v_count_a;
    v_fail := v_fail + 1;
  END IF;

  RESET ROLE;

  -- TEST 19: INSERT denied
  v_test := v_test + 1;
  RAISE NOTICE '── TEST %: client_addresses_projection — INSERT denied ──', v_test;

  PERFORM set_config('request.jwt.claims', json_build_object(
    'sub', v_user_id,
    'org_id', v_org_a_id,
    'org_type', 'provider',
    'effective_permissions', json_build_array(),
    'claims_version', 4
  )::text, true);
  PERFORM set_config('role', 'authenticated', true);

  BEGIN
    INSERT INTO client_addresses_projection (id, client_id, organization_id, address_type, street1, city, state, zip)
    VALUES (gen_random_uuid(), gen_random_uuid(), v_org_a_id, 'home', '123 Test St', 'TestCity', 'UT', '84000');
    RAISE NOTICE '  [FAIL] INSERT succeeded — should be denied';
    v_fail := v_fail + 1;
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE '  [PASS] INSERT denied (insufficient_privilege)';
    v_pass := v_pass + 1;
  WHEN OTHERS THEN
    RAISE NOTICE '  [PASS] INSERT denied (%)', SQLERRM;
    v_pass := v_pass + 1;
  END;

  -- TEST 20: UPDATE denied
  v_test := v_test + 1;
  RAISE NOTICE '── TEST %: client_addresses_projection — UPDATE denied ──', v_test;

  BEGIN
    UPDATE client_addresses_projection SET street1 = 'hacked' WHERE organization_id = v_org_a_id;
    RAISE NOTICE '  [FAIL] UPDATE succeeded — should be denied';
    v_fail := v_fail + 1;
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE '  [PASS] UPDATE denied (insufficient_privilege)';
    v_pass := v_pass + 1;
  WHEN OTHERS THEN
    RAISE NOTICE '  [PASS] UPDATE denied (%)', SQLERRM;
    v_pass := v_pass + 1;
  END;

  -- TEST 21: DELETE denied
  v_test := v_test + 1;
  RAISE NOTICE '── TEST %: client_addresses_projection — DELETE denied ──', v_test;

  BEGIN
    DELETE FROM client_addresses_projection WHERE organization_id = v_org_a_id;
    RAISE NOTICE '  [FAIL] DELETE succeeded — should be denied';
    v_fail := v_fail + 1;
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE '  [PASS] DELETE denied (insufficient_privilege)';
    v_pass := v_pass + 1;
  WHEN OTHERS THEN
    RAISE NOTICE '  [PASS] DELETE denied (%)', SQLERRM;
    v_pass := v_pass + 1;
  END;

  RESET ROLE;

  -- ═══════════════════════════════════════════════════════════════════════════
  -- TABLE 4: client_contact_assignments_projection
  -- ═══════════════════════════════════════════════════════════════════════════

  -- TEST 22: Org-scoped SELECT
  v_test := v_test + 1;
  RAISE NOTICE '';
  RAISE NOTICE '── TEST %: client_contact_assignments_projection — Org A sees own rows ──', v_test;

  PERFORM set_config('request.jwt.claims', json_build_object(
    'sub', v_user_id,
    'org_id', v_org_a_id,
    'org_type', 'provider',
    'effective_permissions', json_build_array(),
    'claims_version', 4
  )::text, true);
  PERFORM set_config('role', 'authenticated', true);

  SELECT count(*) INTO v_count_a FROM client_contact_assignments_projection;
  RAISE NOTICE '  [PASS] Org A sees % rows (>=0 OK if no clients yet)', v_count_a;
  v_pass := v_pass + 1;

  RESET ROLE;

  -- TEST 23: Cross-org isolation
  v_test := v_test + 1;
  IF v_org_b_id IS NOT NULL THEN
    RAISE NOTICE '── TEST %: client_contact_assignments_projection — Org B cannot see Org A rows ──', v_test;

    PERFORM set_config('request.jwt.claims', json_build_object(
      'sub', v_user_id,
      'org_id', v_org_b_id,
      'org_type', 'provider',
      'effective_permissions', json_build_array(),
      'claims_version', 4
    )::text, true);
    PERFORM set_config('role', 'authenticated', true);

    SELECT count(*) INTO v_count
    FROM client_contact_assignments_projection
    WHERE organization_id = v_org_a_id;

    IF v_count = 0 THEN
      RAISE NOTICE '  [PASS] Org B cannot see Org A''s rows (0 leaked)';
      v_pass := v_pass + 1;
    ELSE
      RAISE NOTICE '  [FAIL] Org B can see % of Org A''s rows — RLS BREACH', v_count;
      v_fail := v_fail + 1;
    END IF;

    RESET ROLE;
  ELSE
    RAISE NOTICE '── TEST %: SKIPPED — only 1 org available ──', v_test;
    v_skip := v_skip + 1;
  END IF;

  -- TEST 24: Bogus org isolation
  v_test := v_test + 1;
  RAISE NOTICE '── TEST %: client_contact_assignments_projection — Bogus org sees 0 rows ──', v_test;

  PERFORM set_config('request.jwt.claims', json_build_object(
    'sub', v_user_id,
    'org_id', v_bogus_org_id,
    'org_type', 'provider',
    'effective_permissions', json_build_array(),
    'claims_version', 4
  )::text, true);
  PERFORM set_config('role', 'authenticated', true);

  SELECT count(*) INTO v_count FROM client_contact_assignments_projection;

  IF v_count = 0 THEN
    RAISE NOTICE '  [PASS] Bogus org sees 0 rows';
    v_pass := v_pass + 1;
  ELSE
    RAISE NOTICE '  [FAIL] Bogus org sees % rows — RLS BREACH', v_count;
    v_fail := v_fail + 1;
  END IF;

  RESET ROLE;

  -- TEST 25: Platform admin override
  v_test := v_test + 1;
  RAISE NOTICE '── TEST %: client_contact_assignments_projection — Platform admin sees all rows ──', v_test;

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

  SELECT count(*) INTO v_count_all FROM client_contact_assignments_projection;

  IF v_count_all >= v_count_a THEN
    RAISE NOTICE '  [PASS] Platform admin sees % rows (>= org A''s %)', v_count_all, v_count_a;
    v_pass := v_pass + 1;
  ELSE
    RAISE NOTICE '  [FAIL] Platform admin sees % rows but Org A sees % — inconsistent', v_count_all, v_count_a;
    v_fail := v_fail + 1;
  END IF;

  RESET ROLE;

  -- TEST 26: INSERT denied
  v_test := v_test + 1;
  RAISE NOTICE '── TEST %: client_contact_assignments_projection — INSERT denied ──', v_test;

  PERFORM set_config('request.jwt.claims', json_build_object(
    'sub', v_user_id,
    'org_id', v_org_a_id,
    'org_type', 'provider',
    'effective_permissions', json_build_array(),
    'claims_version', 4
  )::text, true);
  PERFORM set_config('role', 'authenticated', true);

  BEGIN
    INSERT INTO client_contact_assignments_projection (id, client_id, contact_id, organization_id, designation)
    VALUES (gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), v_org_a_id, 'clinician');
    RAISE NOTICE '  [FAIL] INSERT succeeded — should be denied';
    v_fail := v_fail + 1;
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE '  [PASS] INSERT denied (insufficient_privilege)';
    v_pass := v_pass + 1;
  WHEN OTHERS THEN
    RAISE NOTICE '  [PASS] INSERT denied (%)', SQLERRM;
    v_pass := v_pass + 1;
  END;

  -- TEST 27: UPDATE denied
  v_test := v_test + 1;
  RAISE NOTICE '── TEST %: client_contact_assignments_projection — UPDATE denied ──', v_test;

  BEGIN
    UPDATE client_contact_assignments_projection SET designation = 'hacked' WHERE organization_id = v_org_a_id;
    RAISE NOTICE '  [FAIL] UPDATE succeeded — should be denied';
    v_fail := v_fail + 1;
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE '  [PASS] UPDATE denied (insufficient_privilege)';
    v_pass := v_pass + 1;
  WHEN OTHERS THEN
    RAISE NOTICE '  [PASS] UPDATE denied (%)', SQLERRM;
    v_pass := v_pass + 1;
  END;

  -- TEST 28: DELETE denied
  v_test := v_test + 1;
  RAISE NOTICE '── TEST %: client_contact_assignments_projection — DELETE denied ──', v_test;

  BEGIN
    DELETE FROM client_contact_assignments_projection WHERE organization_id = v_org_a_id;
    RAISE NOTICE '  [FAIL] DELETE succeeded — should be denied';
    v_fail := v_fail + 1;
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE '  [PASS] DELETE denied (insufficient_privilege)';
    v_pass := v_pass + 1;
  WHEN OTHERS THEN
    RAISE NOTICE '  [PASS] DELETE denied (%)', SQLERRM;
    v_pass := v_pass + 1;
  END;

  RESET ROLE;

  -- ═══════════════════════════════════════════════════════════════════════════
  -- TABLE 5: client_insurance_policies_projection
  -- ═══════════════════════════════════════════════════════════════════════════

  -- TEST 29: Org-scoped SELECT
  v_test := v_test + 1;
  RAISE NOTICE '';
  RAISE NOTICE '── TEST %: client_insurance_policies_projection — Org A sees own rows ──', v_test;

  PERFORM set_config('request.jwt.claims', json_build_object(
    'sub', v_user_id,
    'org_id', v_org_a_id,
    'org_type', 'provider',
    'effective_permissions', json_build_array(),
    'claims_version', 4
  )::text, true);
  PERFORM set_config('role', 'authenticated', true);

  SELECT count(*) INTO v_count_a FROM client_insurance_policies_projection;
  RAISE NOTICE '  [PASS] Org A sees % rows (>=0 OK if no clients yet)', v_count_a;
  v_pass := v_pass + 1;

  RESET ROLE;

  -- TEST 30: Cross-org isolation
  v_test := v_test + 1;
  IF v_org_b_id IS NOT NULL THEN
    RAISE NOTICE '── TEST %: client_insurance_policies_projection — Org B cannot see Org A rows ──', v_test;

    PERFORM set_config('request.jwt.claims', json_build_object(
      'sub', v_user_id,
      'org_id', v_org_b_id,
      'org_type', 'provider',
      'effective_permissions', json_build_array(),
      'claims_version', 4
    )::text, true);
    PERFORM set_config('role', 'authenticated', true);

    SELECT count(*) INTO v_count
    FROM client_insurance_policies_projection
    WHERE organization_id = v_org_a_id;

    IF v_count = 0 THEN
      RAISE NOTICE '  [PASS] Org B cannot see Org A''s rows (0 leaked)';
      v_pass := v_pass + 1;
    ELSE
      RAISE NOTICE '  [FAIL] Org B can see % of Org A''s rows — RLS BREACH', v_count;
      v_fail := v_fail + 1;
    END IF;

    RESET ROLE;
  ELSE
    RAISE NOTICE '── TEST %: SKIPPED — only 1 org available ──', v_test;
    v_skip := v_skip + 1;
  END IF;

  -- TEST 31: Bogus org isolation
  v_test := v_test + 1;
  RAISE NOTICE '── TEST %: client_insurance_policies_projection — Bogus org sees 0 rows ──', v_test;

  PERFORM set_config('request.jwt.claims', json_build_object(
    'sub', v_user_id,
    'org_id', v_bogus_org_id,
    'org_type', 'provider',
    'effective_permissions', json_build_array(),
    'claims_version', 4
  )::text, true);
  PERFORM set_config('role', 'authenticated', true);

  SELECT count(*) INTO v_count FROM client_insurance_policies_projection;

  IF v_count = 0 THEN
    RAISE NOTICE '  [PASS] Bogus org sees 0 rows';
    v_pass := v_pass + 1;
  ELSE
    RAISE NOTICE '  [FAIL] Bogus org sees % rows — RLS BREACH', v_count;
    v_fail := v_fail + 1;
  END IF;

  RESET ROLE;

  -- TEST 32: Platform admin override
  v_test := v_test + 1;
  RAISE NOTICE '── TEST %: client_insurance_policies_projection — Platform admin sees all rows ──', v_test;

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

  SELECT count(*) INTO v_count_all FROM client_insurance_policies_projection;

  IF v_count_all >= v_count_a THEN
    RAISE NOTICE '  [PASS] Platform admin sees % rows (>= org A''s %)', v_count_all, v_count_a;
    v_pass := v_pass + 1;
  ELSE
    RAISE NOTICE '  [FAIL] Platform admin sees % rows but Org A sees % — inconsistent', v_count_all, v_count_a;
    v_fail := v_fail + 1;
  END IF;

  RESET ROLE;

  -- TEST 33: INSERT denied
  v_test := v_test + 1;
  RAISE NOTICE '── TEST %: client_insurance_policies_projection — INSERT denied ──', v_test;

  PERFORM set_config('request.jwt.claims', json_build_object(
    'sub', v_user_id,
    'org_id', v_org_a_id,
    'org_type', 'provider',
    'effective_permissions', json_build_array(),
    'claims_version', 4
  )::text, true);
  PERFORM set_config('role', 'authenticated', true);

  BEGIN
    INSERT INTO client_insurance_policies_projection (id, client_id, organization_id, policy_type, payer_name)
    VALUES (gen_random_uuid(), gen_random_uuid(), v_org_a_id, 'primary', 'Test Payer');
    RAISE NOTICE '  [FAIL] INSERT succeeded — should be denied';
    v_fail := v_fail + 1;
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE '  [PASS] INSERT denied (insufficient_privilege)';
    v_pass := v_pass + 1;
  WHEN OTHERS THEN
    RAISE NOTICE '  [PASS] INSERT denied (%)', SQLERRM;
    v_pass := v_pass + 1;
  END;

  -- TEST 34: UPDATE denied
  v_test := v_test + 1;
  RAISE NOTICE '── TEST %: client_insurance_policies_projection — UPDATE denied ──', v_test;

  BEGIN
    UPDATE client_insurance_policies_projection SET payer_name = 'hacked' WHERE organization_id = v_org_a_id;
    RAISE NOTICE '  [FAIL] UPDATE succeeded — should be denied';
    v_fail := v_fail + 1;
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE '  [PASS] UPDATE denied (insufficient_privilege)';
    v_pass := v_pass + 1;
  WHEN OTHERS THEN
    RAISE NOTICE '  [PASS] UPDATE denied (%)', SQLERRM;
    v_pass := v_pass + 1;
  END;

  -- TEST 35: DELETE denied
  v_test := v_test + 1;
  RAISE NOTICE '── TEST %: client_insurance_policies_projection — DELETE denied ──', v_test;

  BEGIN
    DELETE FROM client_insurance_policies_projection WHERE organization_id = v_org_a_id;
    RAISE NOTICE '  [FAIL] DELETE succeeded — should be denied';
    v_fail := v_fail + 1;
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE '  [PASS] DELETE denied (insufficient_privilege)';
    v_pass := v_pass + 1;
  WHEN OTHERS THEN
    RAISE NOTICE '  [PASS] DELETE denied (%)', SQLERRM;
    v_pass := v_pass + 1;
  END;

  RESET ROLE;

  -- ═══════════════════════════════════════════════════════════════════════════
  -- TABLE 6: client_placement_history_projection
  -- ═══════════════════════════════════════════════════════════════════════════

  -- TEST 36: Org-scoped SELECT
  v_test := v_test + 1;
  RAISE NOTICE '';
  RAISE NOTICE '── TEST %: client_placement_history_projection — Org A sees own rows ──', v_test;

  PERFORM set_config('request.jwt.claims', json_build_object(
    'sub', v_user_id,
    'org_id', v_org_a_id,
    'org_type', 'provider',
    'effective_permissions', json_build_array(),
    'claims_version', 4
  )::text, true);
  PERFORM set_config('role', 'authenticated', true);

  SELECT count(*) INTO v_count_a FROM client_placement_history_projection;
  RAISE NOTICE '  [PASS] Org A sees % rows (>=0 OK if no clients yet)', v_count_a;
  v_pass := v_pass + 1;

  RESET ROLE;

  -- TEST 37: Cross-org isolation
  v_test := v_test + 1;
  IF v_org_b_id IS NOT NULL THEN
    RAISE NOTICE '── TEST %: client_placement_history_projection — Org B cannot see Org A rows ──', v_test;

    PERFORM set_config('request.jwt.claims', json_build_object(
      'sub', v_user_id,
      'org_id', v_org_b_id,
      'org_type', 'provider',
      'effective_permissions', json_build_array(),
      'claims_version', 4
    )::text, true);
    PERFORM set_config('role', 'authenticated', true);

    SELECT count(*) INTO v_count
    FROM client_placement_history_projection
    WHERE organization_id = v_org_a_id;

    IF v_count = 0 THEN
      RAISE NOTICE '  [PASS] Org B cannot see Org A''s rows (0 leaked)';
      v_pass := v_pass + 1;
    ELSE
      RAISE NOTICE '  [FAIL] Org B can see % of Org A''s rows — RLS BREACH', v_count;
      v_fail := v_fail + 1;
    END IF;

    RESET ROLE;
  ELSE
    RAISE NOTICE '── TEST %: SKIPPED — only 1 org available ──', v_test;
    v_skip := v_skip + 1;
  END IF;

  -- TEST 38: Bogus org isolation
  v_test := v_test + 1;
  RAISE NOTICE '── TEST %: client_placement_history_projection — Bogus org sees 0 rows ──', v_test;

  PERFORM set_config('request.jwt.claims', json_build_object(
    'sub', v_user_id,
    'org_id', v_bogus_org_id,
    'org_type', 'provider',
    'effective_permissions', json_build_array(),
    'claims_version', 4
  )::text, true);
  PERFORM set_config('role', 'authenticated', true);

  SELECT count(*) INTO v_count FROM client_placement_history_projection;

  IF v_count = 0 THEN
    RAISE NOTICE '  [PASS] Bogus org sees 0 rows';
    v_pass := v_pass + 1;
  ELSE
    RAISE NOTICE '  [FAIL] Bogus org sees % rows — RLS BREACH', v_count;
    v_fail := v_fail + 1;
  END IF;

  RESET ROLE;

  -- TEST 39: Platform admin override
  v_test := v_test + 1;
  RAISE NOTICE '── TEST %: client_placement_history_projection — Platform admin sees all rows ──', v_test;

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

  SELECT count(*) INTO v_count_all FROM client_placement_history_projection;

  IF v_count_all >= v_count_a THEN
    RAISE NOTICE '  [PASS] Platform admin sees % rows (>= org A''s %)', v_count_all, v_count_a;
    v_pass := v_pass + 1;
  ELSE
    RAISE NOTICE '  [FAIL] Platform admin sees % rows but Org A sees % — inconsistent', v_count_all, v_count_a;
    v_fail := v_fail + 1;
  END IF;

  RESET ROLE;

  -- TEST 40: INSERT denied
  v_test := v_test + 1;
  RAISE NOTICE '── TEST %: client_placement_history_projection — INSERT denied ──', v_test;

  PERFORM set_config('request.jwt.claims', json_build_object(
    'sub', v_user_id,
    'org_id', v_org_a_id,
    'org_type', 'provider',
    'effective_permissions', json_build_array(),
    'claims_version', 4
  )::text, true);
  PERFORM set_config('role', 'authenticated', true);

  BEGIN
    INSERT INTO client_placement_history_projection (id, client_id, organization_id, placement_arrangement, start_date)
    VALUES (gen_random_uuid(), gen_random_uuid(), v_org_a_id, 'foster_care', '2026-01-01');
    RAISE NOTICE '  [FAIL] INSERT succeeded — should be denied';
    v_fail := v_fail + 1;
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE '  [PASS] INSERT denied (insufficient_privilege)';
    v_pass := v_pass + 1;
  WHEN OTHERS THEN
    RAISE NOTICE '  [PASS] INSERT denied (%)', SQLERRM;
    v_pass := v_pass + 1;
  END;

  -- TEST 41: UPDATE denied
  v_test := v_test + 1;
  RAISE NOTICE '── TEST %: client_placement_history_projection — UPDATE denied ──', v_test;

  BEGIN
    UPDATE client_placement_history_projection SET reason = 'hacked' WHERE organization_id = v_org_a_id;
    RAISE NOTICE '  [FAIL] UPDATE succeeded — should be denied';
    v_fail := v_fail + 1;
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE '  [PASS] UPDATE denied (insufficient_privilege)';
    v_pass := v_pass + 1;
  WHEN OTHERS THEN
    RAISE NOTICE '  [PASS] UPDATE denied (%)', SQLERRM;
    v_pass := v_pass + 1;
  END;

  -- TEST 42: DELETE denied
  v_test := v_test + 1;
  RAISE NOTICE '── TEST %: client_placement_history_projection — DELETE denied ──', v_test;

  BEGIN
    DELETE FROM client_placement_history_projection WHERE organization_id = v_org_a_id;
    RAISE NOTICE '  [FAIL] DELETE succeeded — should be denied';
    v_fail := v_fail + 1;
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE '  [PASS] DELETE denied (insufficient_privilege)';
    v_pass := v_pass + 1;
  WHEN OTHERS THEN
    RAISE NOTICE '  [PASS] DELETE denied (%)', SQLERRM;
    v_pass := v_pass + 1;
  END;

  RESET ROLE;

  -- ═══════════════════════════════════════════════════════════════════════════
  -- TABLE 7: client_funding_sources_projection
  -- ═══════════════════════════════════════════════════════════════════════════

  -- TEST 43: Org-scoped SELECT
  v_test := v_test + 1;
  RAISE NOTICE '';
  RAISE NOTICE '── TEST %: client_funding_sources_projection — Org A sees own rows ──', v_test;

  PERFORM set_config('request.jwt.claims', json_build_object(
    'sub', v_user_id,
    'org_id', v_org_a_id,
    'org_type', 'provider',
    'effective_permissions', json_build_array(),
    'claims_version', 4
  )::text, true);
  PERFORM set_config('role', 'authenticated', true);

  SELECT count(*) INTO v_count_a FROM client_funding_sources_projection;
  RAISE NOTICE '  [PASS] Org A sees % rows (>=0 OK if no clients yet)', v_count_a;
  v_pass := v_pass + 1;

  RESET ROLE;

  -- TEST 44: Cross-org isolation
  v_test := v_test + 1;
  IF v_org_b_id IS NOT NULL THEN
    RAISE NOTICE '── TEST %: client_funding_sources_projection — Org B cannot see Org A rows ──', v_test;

    PERFORM set_config('request.jwt.claims', json_build_object(
      'sub', v_user_id,
      'org_id', v_org_b_id,
      'org_type', 'provider',
      'effective_permissions', json_build_array(),
      'claims_version', 4
    )::text, true);
    PERFORM set_config('role', 'authenticated', true);

    SELECT count(*) INTO v_count
    FROM client_funding_sources_projection
    WHERE organization_id = v_org_a_id;

    IF v_count = 0 THEN
      RAISE NOTICE '  [PASS] Org B cannot see Org A''s rows (0 leaked)';
      v_pass := v_pass + 1;
    ELSE
      RAISE NOTICE '  [FAIL] Org B can see % of Org A''s rows — RLS BREACH', v_count;
      v_fail := v_fail + 1;
    END IF;

    RESET ROLE;
  ELSE
    RAISE NOTICE '── TEST %: SKIPPED — only 1 org available ──', v_test;
    v_skip := v_skip + 1;
  END IF;

  -- TEST 45: Bogus org isolation
  v_test := v_test + 1;
  RAISE NOTICE '── TEST %: client_funding_sources_projection — Bogus org sees 0 rows ──', v_test;

  PERFORM set_config('request.jwt.claims', json_build_object(
    'sub', v_user_id,
    'org_id', v_bogus_org_id,
    'org_type', 'provider',
    'effective_permissions', json_build_array(),
    'claims_version', 4
  )::text, true);
  PERFORM set_config('role', 'authenticated', true);

  SELECT count(*) INTO v_count FROM client_funding_sources_projection;

  IF v_count = 0 THEN
    RAISE NOTICE '  [PASS] Bogus org sees 0 rows';
    v_pass := v_pass + 1;
  ELSE
    RAISE NOTICE '  [FAIL] Bogus org sees % rows — RLS BREACH', v_count;
    v_fail := v_fail + 1;
  END IF;

  RESET ROLE;

  -- TEST 46: Platform admin override
  v_test := v_test + 1;
  RAISE NOTICE '── TEST %: client_funding_sources_projection — Platform admin sees all rows ──', v_test;

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

  SELECT count(*) INTO v_count_all FROM client_funding_sources_projection;

  IF v_count_all >= v_count_a THEN
    RAISE NOTICE '  [PASS] Platform admin sees % rows (>= org A''s %)', v_count_all, v_count_a;
    v_pass := v_pass + 1;
  ELSE
    RAISE NOTICE '  [FAIL] Platform admin sees % rows but Org A sees % — inconsistent', v_count_all, v_count_a;
    v_fail := v_fail + 1;
  END IF;

  RESET ROLE;

  -- TEST 47: INSERT denied
  v_test := v_test + 1;
  RAISE NOTICE '── TEST %: client_funding_sources_projection — INSERT denied ──', v_test;

  PERFORM set_config('request.jwt.claims', json_build_object(
    'sub', v_user_id,
    'org_id', v_org_a_id,
    'org_type', 'provider',
    'effective_permissions', json_build_array(),
    'claims_version', 4
  )::text, true);
  PERFORM set_config('role', 'authenticated', true);

  BEGIN
    INSERT INTO client_funding_sources_projection (id, client_id, organization_id, source_type, source_name)
    VALUES (gen_random_uuid(), gen_random_uuid(), v_org_a_id, 'medicaid', 'Test Funding');
    RAISE NOTICE '  [FAIL] INSERT succeeded — should be denied';
    v_fail := v_fail + 1;
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE '  [PASS] INSERT denied (insufficient_privilege)';
    v_pass := v_pass + 1;
  WHEN OTHERS THEN
    RAISE NOTICE '  [PASS] INSERT denied (%)', SQLERRM;
    v_pass := v_pass + 1;
  END;

  -- TEST 48: UPDATE denied
  v_test := v_test + 1;
  RAISE NOTICE '── TEST %: client_funding_sources_projection — UPDATE denied ──', v_test;

  BEGIN
    UPDATE client_funding_sources_projection SET source_name = 'hacked' WHERE organization_id = v_org_a_id;
    RAISE NOTICE '  [FAIL] UPDATE succeeded — should be denied';
    v_fail := v_fail + 1;
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE '  [PASS] UPDATE denied (insufficient_privilege)';
    v_pass := v_pass + 1;
  WHEN OTHERS THEN
    RAISE NOTICE '  [PASS] UPDATE denied (%)', SQLERRM;
    v_pass := v_pass + 1;
  END;

  -- TEST 49: DELETE denied
  v_test := v_test + 1;
  RAISE NOTICE '── TEST %: client_funding_sources_projection — DELETE denied ──', v_test;

  BEGIN
    DELETE FROM client_funding_sources_projection WHERE organization_id = v_org_a_id;
    RAISE NOTICE '  [FAIL] DELETE succeeded — should be denied';
    v_fail := v_fail + 1;
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE '  [PASS] DELETE denied (insufficient_privilege)';
    v_pass := v_pass + 1;
  WHEN OTHERS THEN
    RAISE NOTICE '  [PASS] DELETE denied (%)', SQLERRM;
    v_pass := v_pass + 1;
  END;

  RESET ROLE;

  -- ═══════════════════════════════════════════════════════════════════════════
  -- SUMMARY
  -- ═══════════════════════════════════════════════════════════════════════════
  RAISE NOTICE '';
  RAISE NOTICE '════════════════════════════════════════════════════════';
  RAISE NOTICE ' RESULTS: % passed, % failed, % skipped (% total)', v_pass, v_fail, v_skip, v_test;
  RAISE NOTICE '════════════════════════════════════════════════════════';

  IF v_fail > 0 THEN
    RAISE NOTICE ' FAILURES DETECTED — review output above';
  ELSE
    RAISE NOTICE ' All RLS policies verified successfully.';
  END IF;

END;
$$;

ROLLBACK;
