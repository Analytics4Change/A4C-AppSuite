-- ============================================================================
-- Cleanup Test Data by Tags
-- ============================================================================
-- Purpose: Delete test/development data from domain_events and projections
--          using metadata tags for precise identification.
--
-- Usage:
--   psql $DATABASE_URL -v batch_id='phase4-verify-20251119' \
--     -f dev/active/cleanup-test-data-by-tags.sql
--
-- Tag Format:
--   - 'development'                : Dev environment flag
--   - 'mode:test'                  : Workflow mode
--   - 'created:YYYY-MM-DD'         : Date created
--   - 'batch:<batch_id>'           : Batch ID for atomic cleanup
--
-- NOTE: This file is NOT source controlled (in dev/active/).
-- ============================================================================

\echo '============================================'
\echo 'Cleanup Test Data by Batch Tag'
\echo '============================================'
\echo 'Batch ID:' :batch_id
\echo ''

BEGIN;

-- ----------------------------------------------------------------------------
-- Step 1: Collect tagged entities by stream_type
-- ----------------------------------------------------------------------------

\echo 'Step 1: Identifying tagged entities...'

-- Create temporary tables for tagged entity IDs
CREATE TEMP TABLE tagged_orgs AS
  SELECT DISTINCT stream_id
  FROM domain_events
  WHERE event_metadata->'tags' ? 'development'
    AND event_metadata->'tags' ? format('batch:%s', :'batch_id')
    AND stream_type = 'organization'
    AND processed_at IS NOT NULL;

CREATE TEMP TABLE tagged_contacts AS
  SELECT DISTINCT stream_id
  FROM domain_events
  WHERE event_metadata->'tags' ? 'development'
    AND event_metadata->'tags' ? format('batch:%s', :'batch_id')
    AND stream_type = 'contact'
    AND processed_at IS NOT NULL;

CREATE TEMP TABLE tagged_addresses AS
  SELECT DISTINCT stream_id
  FROM domain_events
  WHERE event_metadata->'tags' ? 'development'
    AND event_metadata->'tags' ? format('batch:%s', :'batch_id')
    AND stream_type = 'address'
    AND processed_at IS NOT NULL;

CREATE TEMP TABLE tagged_phones AS
  SELECT DISTINCT stream_id
  FROM domain_events
  WHERE event_metadata->'tags' ? 'development'
    AND event_metadata->'tags' ? format('batch:%s', :'batch_id')
    AND stream_type = 'phone'
    AND processed_at IS NOT NULL;

-- ----------------------------------------------------------------------------
-- Step 2: Preview entities to be cleaned up
-- ----------------------------------------------------------------------------

\echo ''
\echo 'Step 2: Preview - Entities to be cleaned up:'

SELECT 'organizations' AS entity_type, COUNT(*) AS count FROM tagged_orgs
UNION ALL SELECT 'contacts', COUNT(*) FROM tagged_contacts
UNION ALL SELECT 'addresses', COUNT(*) FROM tagged_addresses
UNION ALL SELECT 'phones', COUNT(*) FROM tagged_phones;

-- Preview event types
\echo ''
\echo 'Event types to be deleted:'

SELECT
  stream_type,
  event_type,
  COUNT(*) as event_count
FROM domain_events
WHERE event_metadata->'tags' ? 'development'
  AND event_metadata->'tags' ? format('batch:%s', :'batch_id')
  AND processed_at IS NOT NULL
GROUP BY stream_type, event_type
ORDER BY stream_type, event_type;

-- ----------------------------------------------------------------------------
-- Step 3: Delete junction table entries
-- Filter by BOTH foreign keys to ensure only test data is deleted
-- ----------------------------------------------------------------------------

\echo ''
\echo 'Step 3: Deleting junction table entries...'

-- Organization-Contact junctions
DELETE FROM organization_contacts
WHERE organization_id IN (SELECT stream_id FROM tagged_orgs)
  AND contact_id IN (SELECT stream_id FROM tagged_contacts);

-- Organization-Address junctions
DELETE FROM organization_addresses
WHERE organization_id IN (SELECT stream_id FROM tagged_orgs)
  AND address_id IN (SELECT stream_id FROM tagged_addresses);

-- Organization-Phone junctions
DELETE FROM organization_phones
WHERE organization_id IN (SELECT stream_id FROM tagged_orgs)
  AND phone_id IN (SELECT stream_id FROM tagged_phones);

-- Contact-Address junctions
DELETE FROM contact_addresses
WHERE contact_id IN (SELECT stream_id FROM tagged_contacts)
  AND address_id IN (SELECT stream_id FROM tagged_addresses);

-- Contact-Phone junctions
DELETE FROM contact_phones
WHERE contact_id IN (SELECT stream_id FROM tagged_contacts)
  AND phone_id IN (SELECT stream_id FROM tagged_phones);

-- Phone-Address junctions
DELETE FROM phone_addresses
WHERE phone_id IN (SELECT stream_id FROM tagged_phones)
  AND address_id IN (SELECT stream_id FROM tagged_addresses);

\echo 'Junction table entries deleted.'

-- ----------------------------------------------------------------------------
-- Step 4: Soft-delete projections
-- ----------------------------------------------------------------------------

\echo ''
\echo 'Step 4: Soft-deleting projections...'

-- Contacts
UPDATE contacts_projection
SET deleted_at = NOW(), is_active = false
WHERE id IN (SELECT stream_id FROM tagged_contacts)
  AND deleted_at IS NULL;

-- Addresses
UPDATE addresses_projection
SET deleted_at = NOW(), is_active = false
WHERE id IN (SELECT stream_id FROM tagged_addresses)
  AND deleted_at IS NULL;

-- Phones
UPDATE phones_projection
SET deleted_at = NOW(), is_active = false
WHERE id IN (SELECT stream_id FROM tagged_phones)
  AND deleted_at IS NULL;

-- Organizations (last, after children)
UPDATE organizations_projection
SET deleted_at = NOW(), is_active = false
WHERE id IN (SELECT stream_id FROM tagged_orgs)
  AND deleted_at IS NULL;

\echo 'Projections soft-deleted.'

-- ----------------------------------------------------------------------------
-- Step 5: Delete domain events (source of truth cleanup)
-- ----------------------------------------------------------------------------

\echo ''
\echo 'Step 5: Deleting domain events...'

DELETE FROM domain_events
WHERE event_metadata->'tags' ? 'development'
  AND event_metadata->'tags' ? format('batch:%s', :'batch_id')
  AND processed_at IS NOT NULL;

\echo 'Domain events deleted.'

-- ----------------------------------------------------------------------------
-- Step 6: Cleanup summary
-- ----------------------------------------------------------------------------

\echo ''
\echo 'Step 6: Cleanup Summary'

SELECT 'Remaining tagged events' AS status, COUNT(*) AS count
FROM domain_events
WHERE event_metadata->'tags' ? 'development'
  AND event_metadata->'tags' ? format('batch:%s', :'batch_id');

-- Drop temporary tables
DROP TABLE tagged_orgs;
DROP TABLE tagged_contacts;
DROP TABLE tagged_addresses;
DROP TABLE tagged_phones;

COMMIT;

\echo ''
\echo '============================================'
\echo 'Cleanup complete!'
\echo '============================================'
