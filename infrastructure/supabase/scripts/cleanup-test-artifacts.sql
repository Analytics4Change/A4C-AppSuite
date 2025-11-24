-- =====================================================
-- Comprehensive Test Artifact Cleanup Script
-- =====================================================
-- Purpose: Hard delete ALL test artifacts from validation testing
--
-- DANGER: This performs HARD DELETES (not soft deletes).
--         Use ONLY for test data marked with test=true in event_metadata
--         or organization names containing "Test Validation"
--
-- Scope: Deletes from:
--   - domain_events (all test events)
--   - organizations_projection (test organizations)
--   - user_roles_projection (roles for test organizations)
--   - organization_contacts (junction table)
--   - organization_addresses (junction table)
--   - organization_phones (junction table)
--   - contacts_projection (contacts for test orgs)
--   - addresses_projection (addresses for test orgs)
--   - phones_projection (phones for test orgs)
--
-- Author: A4C Infrastructure Team
-- Created: 2025-11-24
-- =====================================================

DO $$
DECLARE
  v_test_org_ids UUID[];
  v_test_org_count INT;
  v_deleted_events INT := 0;
  v_deleted_orgs INT := 0;
  v_deleted_roles INT := 0;
  v_deleted_contacts INT := 0;
  v_deleted_addresses INT := 0;
  v_deleted_phones INT := 0;
  v_deleted_contact_records INT := 0;
  v_deleted_address_records INT := 0;
  v_deleted_phone_records INT := 0;
BEGIN
  RAISE NOTICE '';
  RAISE NOTICE '=================================================================';
  RAISE NOTICE '  COMPREHENSIVE TEST ARTIFACT CLEANUP';
  RAISE NOTICE '  Date: %', NOW();
  RAISE NOTICE '=================================================================';
  RAISE NOTICE '';

  -- ========================================
  -- Step 1: Identify Test Organizations
  -- ========================================
  RAISE NOTICE '[Step 1/9] Identifying test organizations...';

  -- Find all test organization IDs from domain_events
  SELECT ARRAY_AGG(DISTINCT stream_id)
  INTO v_test_org_ids
  FROM domain_events
  WHERE stream_type = 'organization'
    AND (
      event_metadata->>'test' = 'true'
      OR event_metadata->>'source' LIKE '%validation%'
      OR event_data->>'organization_name' LIKE '%Test Validation%'
      OR event_data->>'name' LIKE '%Test Validation%'
    );

  v_test_org_count := COALESCE(array_length(v_test_org_ids, 1), 0);
  RAISE NOTICE '  → Found % test organization(s)', v_test_org_count;

  IF v_test_org_count = 0 THEN
    RAISE NOTICE '';
    RAISE NOTICE 'No test organizations found. Nothing to clean up.';
    RAISE NOTICE '';
    RETURN;
  END IF;

  RAISE NOTICE '  → Organization IDs: %', v_test_org_ids;
  RAISE NOTICE '';

  -- ========================================
  -- Step 2: Delete Junction Tables First
  -- ========================================
  RAISE NOTICE '[Step 2/9] Deleting junction table records...';

  -- organization_contacts
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'organization_contacts') THEN
    DELETE FROM organization_contacts
    WHERE organization_id = ANY(v_test_org_ids);
    GET DIAGNOSTICS v_deleted_contacts = ROW_COUNT;
    RAISE NOTICE '  → Deleted % organization_contacts', v_deleted_contacts;
  ELSE
    RAISE NOTICE '  → Table organization_contacts does not exist (skipping)';
  END IF;

  -- organization_addresses
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'organization_addresses') THEN
    DELETE FROM organization_addresses
    WHERE organization_id = ANY(v_test_org_ids);
    GET DIAGNOSTICS v_deleted_addresses = ROW_COUNT;
    RAISE NOTICE '  → Deleted % organization_addresses', v_deleted_addresses;
  ELSE
    RAISE NOTICE '  → Table organization_addresses does not exist (skipping)';
  END IF;

  -- organization_phones
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'organization_phones') THEN
    DELETE FROM organization_phones
    WHERE organization_id = ANY(v_test_org_ids);
    GET DIAGNOSTICS v_deleted_phones = ROW_COUNT;
    RAISE NOTICE '  → Deleted % organization_phones', v_deleted_phones;
  ELSE
    RAISE NOTICE '  → Table organization_phones does not exist (skipping)';
  END IF;

  RAISE NOTICE '';

  -- ========================================
  -- Step 3: Delete Contact/Address/Phone Records
  -- ========================================
  RAISE NOTICE '[Step 3/9] Deleting contact/address/phone records...';

  -- contacts_projection
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'contacts_projection') THEN
    DELETE FROM contacts_projection
    WHERE organization_id = ANY(v_test_org_ids);
    GET DIAGNOSTICS v_deleted_contact_records = ROW_COUNT;
    RAISE NOTICE '  → Deleted % contacts_projection', v_deleted_contact_records;
  ELSE
    RAISE NOTICE '  → Table contacts_projection does not exist (skipping)';
  END IF;

  -- addresses_projection
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'addresses_projection') THEN
    DELETE FROM addresses_projection
    WHERE organization_id = ANY(v_test_org_ids);
    GET DIAGNOSTICS v_deleted_address_records = ROW_COUNT;
    RAISE NOTICE '  → Deleted % addresses_projection', v_deleted_address_records;
  ELSE
    RAISE NOTICE '  → Table addresses_projection does not exist (skipping)';
  END IF;

  -- phones_projection
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'phones_projection') THEN
    DELETE FROM phones_projection
    WHERE organization_id = ANY(v_test_org_ids);
    GET DIAGNOSTICS v_deleted_phone_records = ROW_COUNT;
    RAISE NOTICE '  → Deleted % phones_projection', v_deleted_phone_records;
  ELSE
    RAISE NOTICE '  → Table phones_projection does not exist (skipping)';
  END IF;

  RAISE NOTICE '';

  -- ========================================
  -- Step 4: Delete User Roles
  -- ========================================
  RAISE NOTICE '[Step 4/9] Deleting user roles for test organizations...';

  DELETE FROM user_roles_projection
  WHERE organization_id = ANY(v_test_org_ids);
  GET DIAGNOSTICS v_deleted_roles = ROW_COUNT;
  RAISE NOTICE '  → Deleted % user_roles', v_deleted_roles;
  RAISE NOTICE '';

  -- ========================================
  -- Step 5: Delete Organizations Projection
  -- ========================================
  RAISE NOTICE '[Step 5/9] Deleting organizations from projection table...';

  DELETE FROM organizations_projection
  WHERE id = ANY(v_test_org_ids)
    OR name LIKE '%Test Validation%';
  GET DIAGNOSTICS v_deleted_orgs = ROW_COUNT;
  RAISE NOTICE '  → Deleted % organizations_projection', v_deleted_orgs;
  RAISE NOTICE '';

  -- ========================================
  -- Step 6: Delete Domain Events
  -- ========================================
  RAISE NOTICE '[Step 6/9] Deleting domain events (event store)...';

  DELETE FROM domain_events
  WHERE stream_type = 'organization'
    AND (
      event_metadata->>'test' = 'true'
      OR event_metadata->>'source' LIKE '%validation%'
      OR event_data->>'organization_name' LIKE '%Test Validation%'
      OR event_data->>'name' LIKE '%Test Validation%'
      OR stream_id = ANY(v_test_org_ids)
    );
  GET DIAGNOSTICS v_deleted_events = ROW_COUNT;
  RAISE NOTICE '  → Deleted % domain_events', v_deleted_events;
  RAISE NOTICE '';

  -- ========================================
  -- Step 7: Verify Cleanup
  -- ========================================
  RAISE NOTICE '[Step 7/9] Verifying cleanup...';

  -- Check for remaining test events
  DECLARE
    v_remaining_events INT;
    v_remaining_orgs INT;
  BEGIN
    SELECT COUNT(*)
    INTO v_remaining_events
    FROM domain_events
    WHERE event_metadata->>'test' = 'true'
      OR event_metadata->>'source' LIKE '%validation%'
      OR event_data->>'organization_name' LIKE '%Test Validation%';

    SELECT COUNT(*)
    INTO v_remaining_orgs
    FROM organizations_projection
    WHERE name LIKE '%Test Validation%';

    IF v_remaining_events > 0 OR v_remaining_orgs > 0 THEN
      RAISE WARNING '  ⚠️  Cleanup incomplete: % events, % orgs remaining',
        v_remaining_events, v_remaining_orgs;
    ELSE
      RAISE NOTICE '  ✓ Cleanup verified: No test artifacts remaining';
    END IF;
  END;

  RAISE NOTICE '';

  -- ========================================
  -- Step 8: Summary Report
  -- ========================================
  RAISE NOTICE '=================================================================';
  RAISE NOTICE '  CLEANUP SUMMARY';
  RAISE NOTICE '=================================================================';
  RAISE NOTICE '';
  RAISE NOTICE 'Test Organizations:       % (identified)', v_test_org_count;
  RAISE NOTICE '';
  RAISE NOTICE 'Domain Events:            % deleted', v_deleted_events;
  RAISE NOTICE 'Organizations Projection: % deleted', v_deleted_orgs;
  RAISE NOTICE 'User Roles:               % deleted', v_deleted_roles;
  RAISE NOTICE '';
  RAISE NOTICE 'Junction Tables:';
  RAISE NOTICE '  organization_contacts:  % deleted', v_deleted_contacts;
  RAISE NOTICE '  organization_addresses: % deleted', v_deleted_addresses;
  RAISE NOTICE '  organization_phones:    % deleted', v_deleted_phones;
  RAISE NOTICE '';
  RAISE NOTICE 'Entity Projections:';
  RAISE NOTICE '  contacts_projection:    % deleted', v_deleted_contact_records;
  RAISE NOTICE '  addresses_projection:   % deleted', v_deleted_address_records;
  RAISE NOTICE '  phones_projection:      % deleted', v_deleted_phone_records;
  RAISE NOTICE '';
  RAISE NOTICE 'Total Records Deleted:    %', (
    v_deleted_events +
    v_deleted_orgs +
    v_deleted_roles +
    v_deleted_contacts +
    v_deleted_addresses +
    v_deleted_phones +
    v_deleted_contact_records +
    v_deleted_address_records +
    v_deleted_phone_records
  );
  RAISE NOTICE '';
  RAISE NOTICE '=================================================================';
  RAISE NOTICE '  CLEANUP COMPLETE';
  RAISE NOTICE '  Status: SUCCESS';
  RAISE NOTICE '  Time: %', NOW();
  RAISE NOTICE '=================================================================';
  RAISE NOTICE '';

END $$;
