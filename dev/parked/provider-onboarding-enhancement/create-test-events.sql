-- ============================================================================
-- Create Test Events for Event Processor Verification
-- ============================================================================
-- Purpose: Insert tagged test events to verify event processors create
--          projections correctly. Does NOT trigger Temporal workflows.
--
-- Usage:
--   psql $DATABASE_URL -v batch_id='phase4-verify-20251119' \
--     -f dev/active/create-test-events.sql
--
-- Cleanup:
--   psql $DATABASE_URL -v batch_id='phase4-verify-20251119' \
--     -f dev/active/cleanup-test-data-by-tags.sql
--
-- NOTE: This file is NOT source controlled (in dev/active/).
-- ============================================================================

\echo '============================================'
\echo 'Create Test Events for Verification'
\echo '============================================'
\echo 'Batch ID:' :batch_id
\echo ''

BEGIN;

-- ----------------------------------------------------------------------------
-- Step 1: Generate test UUIDs
-- ----------------------------------------------------------------------------

\echo 'Step 1: Generating test UUIDs...'

DO $$
DECLARE
  v_org_id UUID := gen_random_uuid();
  v_contact_id UUID := gen_random_uuid();
  v_address_id UUID := gen_random_uuid();
  v_phone_id UUID := gen_random_uuid();
  v_batch_id TEXT := :'batch_id';
  v_timestamp TEXT := to_char(NOW(), 'YYYY-MM-DD"T"HH24:MI:SS"Z"');
  v_metadata JSONB;
BEGIN
  -- Build metadata with tags
  v_metadata := jsonb_build_object(
    'tags', jsonb_build_array('development', format('batch:%s', v_batch_id)),
    'timestamp', v_timestamp,
    'test_source', 'create-test-events.sql'
  );

  RAISE NOTICE 'Organization ID: %', v_org_id;
  RAISE NOTICE 'Contact ID: %', v_contact_id;
  RAISE NOTICE 'Address ID: %', v_address_id;
  RAISE NOTICE 'Phone ID: %', v_phone_id;

  -- --------------------------------------------------------------------------
  -- Step 2: Insert organization.created event
  -- --------------------------------------------------------------------------

  INSERT INTO domain_events (
    stream_id,
    stream_type,
    stream_version,
    event_type,
    event_data,
    event_metadata
  ) VALUES (
    v_org_id,
    'organization',
    1,
    'organization.created',
    jsonb_build_object(
      'id', v_org_id,
      'name', format('Test Org %s', v_batch_id),
      'display_name', format('Test Organization %s', v_batch_id),
      'slug', format('test-org-%s', replace(v_batch_id, ':', '-')),
      'type', 'provider',
      'path', format('root.test_%s', replace(v_batch_id::text, '-', '_')),
      'parent_path', NULL,
      'depth', 2,
      'tax_number', '12-3456789',
      'phone_number', '555-123-4567',
      'timezone', 'America/New_York',
      'metadata', '{}'::jsonb,
      'partner_type', NULL,
      'referring_partner_id', NULL,
      'subdomain', format('test-%s', replace(v_batch_id, ':', '-')),
      'subdomain_status', 'pending'
    ),
    v_metadata
  );

  RAISE NOTICE 'Inserted organization.created event';

  -- --------------------------------------------------------------------------
  -- Step 3: Insert contact.created event
  -- --------------------------------------------------------------------------

  INSERT INTO domain_events (
    stream_id,
    stream_type,
    stream_version,
    event_type,
    event_data,
    event_metadata
  ) VALUES (
    v_contact_id,
    'contact',
    1,
    'contact.created',
    jsonb_build_object(
      'id', v_contact_id,
      'organization_id', v_org_id,
      'label', 'Provider Admin',
      'type', 'billing',
      'first_name', 'Test',
      'last_name', 'Admin',
      'email', 'test-admin@example.com',
      'title', 'Administrator',
      'department', 'Operations'
    ),
    v_metadata
  );

  RAISE NOTICE 'Inserted contact.created event';

  -- --------------------------------------------------------------------------
  -- Step 4: Insert address.created event
  -- --------------------------------------------------------------------------

  INSERT INTO domain_events (
    stream_id,
    stream_type,
    stream_version,
    event_type,
    event_data,
    event_metadata
  ) VALUES (
    v_address_id,
    'address',
    1,
    'address.created',
    jsonb_build_object(
      'id', v_address_id,
      'organization_id', v_org_id,
      'label', 'Headquarters',
      'type', 'physical',
      'street1', '123 Test Street',
      'street2', 'Suite 100',
      'city', 'Test City',
      'state', 'TX',
      'zip_code', '12345'
    ),
    v_metadata
  );

  RAISE NOTICE 'Inserted address.created event';

  -- --------------------------------------------------------------------------
  -- Step 5: Insert phone.created event
  -- --------------------------------------------------------------------------

  INSERT INTO domain_events (
    stream_id,
    stream_type,
    stream_version,
    event_type,
    event_data,
    event_metadata
  ) VALUES (
    v_phone_id,
    'phone',
    1,
    'phone.created',
    jsonb_build_object(
      'id', v_phone_id,
      'organization_id', v_org_id,
      'label', 'Main Office',
      'type', 'office',
      'number', '555-123-4567',
      'extension', '101'
    ),
    v_metadata
  );

  RAISE NOTICE 'Inserted phone.created event';

  -- --------------------------------------------------------------------------
  -- Step 6: Insert junction link events
  -- --------------------------------------------------------------------------

  -- organization.contact.linked
  INSERT INTO domain_events (
    stream_id,
    stream_type,
    stream_version,
    event_type,
    event_data,
    event_metadata
  ) VALUES (
    v_org_id,
    'organization',
    2,
    'organization.contact.linked',
    jsonb_build_object(
      'organization_id', v_org_id,
      'contact_id', v_contact_id
    ),
    v_metadata
  );

  RAISE NOTICE 'Inserted organization.contact.linked event';

  -- organization.address.linked
  INSERT INTO domain_events (
    stream_id,
    stream_type,
    stream_version,
    event_type,
    event_data,
    event_metadata
  ) VALUES (
    v_org_id,
    'organization',
    3,
    'organization.address.linked',
    jsonb_build_object(
      'organization_id', v_org_id,
      'address_id', v_address_id
    ),
    v_metadata
  );

  RAISE NOTICE 'Inserted organization.address.linked event';

  -- organization.phone.linked
  INSERT INTO domain_events (
    stream_id,
    stream_type,
    stream_version,
    event_type,
    event_data,
    event_metadata
  ) VALUES (
    v_org_id,
    'organization',
    4,
    'organization.phone.linked',
    jsonb_build_object(
      'organization_id', v_org_id,
      'phone_id', v_phone_id
    ),
    v_metadata
  );

  RAISE NOTICE 'Inserted organization.phone.linked event';

  RAISE NOTICE '';
  RAISE NOTICE 'All events inserted successfully!';
  RAISE NOTICE '';
  RAISE NOTICE 'Organization ID for verification: %', v_org_id;

END $$;

COMMIT;

-- ----------------------------------------------------------------------------
-- Step 7: Verify projections were created
-- ----------------------------------------------------------------------------

\echo ''
\echo 'Step 7: Verifying projections...'
\echo ''

\echo 'Organizations created:'
SELECT id, name, type, subdomain, is_active
FROM organizations_projection
WHERE name LIKE '%' || :'batch_id' || '%';

\echo ''
\echo 'Contacts created:'
SELECT id, organization_id, label, type, first_name, last_name, email
FROM contacts_projection
WHERE email = 'test-admin@example.com';

\echo ''
\echo 'Addresses created:'
SELECT id, organization_id, label, type, city, state
FROM addresses_projection
WHERE city = 'Test City';

\echo ''
\echo 'Phones created:'
SELECT id, organization_id, label, type, number
FROM phones_projection
WHERE number = '555-123-4567';

\echo ''
\echo 'Organization-Contact junctions:'
SELECT oc.organization_id, oc.contact_id, o.name as org_name, c.email as contact_email
FROM organization_contacts oc
JOIN organizations_projection o ON o.id = oc.organization_id
JOIN contacts_projection c ON c.id = oc.contact_id
WHERE o.name LIKE '%' || :'batch_id' || '%';

\echo ''
\echo 'Organization-Address junctions:'
SELECT oa.organization_id, oa.address_id, o.name as org_name, a.city as address_city
FROM organization_addresses oa
JOIN organizations_projection o ON o.id = oa.organization_id
JOIN addresses_projection a ON a.id = oa.address_id
WHERE o.name LIKE '%' || :'batch_id' || '%';

\echo ''
\echo 'Organization-Phone junctions:'
SELECT op.organization_id, op.phone_id, o.name as org_name, p.number as phone_number
FROM organization_phones op
JOIN organizations_projection o ON o.id = op.organization_id
JOIN phones_projection p ON p.id = op.phone_id
WHERE o.name LIKE '%' || :'batch_id' || '%';

\echo ''
\echo 'Event count for this batch:'
SELECT
  event_type,
  COUNT(*) as count
FROM domain_events
WHERE event_metadata->'tags' ? 'development'
  AND event_metadata->'tags' ? format('batch:%s', :'batch_id')
GROUP BY event_type
ORDER BY event_type;

\echo ''
\echo '============================================'
\echo 'Test events created successfully!'
\echo ''
\echo 'To cleanup, run:'
\echo '  psql $DATABASE_URL -v batch_id=''' || :'batch_id' || ''' \'
\echo '    -f dev/active/cleanup-test-data-by-tags.sql'
\echo '============================================'
