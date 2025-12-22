-- Migration Script: Sub-Organizations to Organization Units Projection
-- CRITICAL: Run this ONCE after organization_units_projection table is created
--
-- Purpose:
-- Migrates existing sub-organizations (nlevel(path) > 2) from organizations_projection
-- to the new dedicated organization_units_projection table.
--
-- Migration Steps:
-- 1. Copy sub-orgs to organization_units_projection
-- 2. Verify counts match
-- 3. (Optional) Delete from organizations_projection - ONLY after verification
--
-- Safety:
-- - Uses ON CONFLICT DO NOTHING for idempotency (safe to re-run)
-- - Does NOT delete from old table automatically
-- - Provides verification queries
-- - Transaction ensures atomicity
--
-- Prerequisites:
-- - organization_units_projection table created (001-organization_units_projection.sql)
-- - Event processor created (014-process-organization-unit-events.sql)
-- - Event router updated (001-main-event-router.sql)
-- - RLS policies created (006-organization-units-policies.sql)

BEGIN;

-- ============================================================================
-- Step 1: Copy Sub-Organizations to organization_units_projection
-- ============================================================================

RAISE NOTICE 'Starting sub-organization migration...';

-- Get count before migration
DO $$
DECLARE
  v_source_count INTEGER;
  v_target_before INTEGER;
BEGIN
  SELECT COUNT(*) INTO v_source_count
  FROM organizations_projection
  WHERE nlevel(path) > 2;

  SELECT COUNT(*) INTO v_target_before
  FROM organization_units_projection;

  RAISE NOTICE 'Source sub-orgs in organizations_projection: %', v_source_count;
  RAISE NOTICE 'Existing records in organization_units_projection: %', v_target_before;
END $$;

-- Insert sub-organizations into organization_units_projection
-- ON CONFLICT ensures idempotency - safe to re-run
INSERT INTO organization_units_projection (
  id,
  organization_id,
  name,
  display_name,
  slug,
  path,
  parent_path,
  timezone,
  is_active,
  deactivated_at,
  deleted_at,
  created_at,
  updated_at
)
SELECT
  op.id,
  -- Find root organization (nlevel = 2) for this sub-org
  (
    SELECT root.id
    FROM organizations_projection root
    WHERE nlevel(root.path) = 2
      AND op.path <@ root.path
    LIMIT 1
  ) as organization_id,
  op.name,
  op.display_name,
  op.slug,
  op.path,
  op.parent_path,
  COALESCE(op.timezone, 'America/New_York'),
  op.is_active,
  op.deactivated_at,
  op.deleted_at,
  op.created_at,
  op.updated_at
FROM organizations_projection op
WHERE nlevel(op.path) > 2
ON CONFLICT (id) DO UPDATE SET
  -- Update to latest values if already exists
  name = EXCLUDED.name,
  display_name = EXCLUDED.display_name,
  timezone = EXCLUDED.timezone,
  is_active = EXCLUDED.is_active,
  deactivated_at = EXCLUDED.deactivated_at,
  deleted_at = EXCLUDED.deleted_at,
  updated_at = EXCLUDED.updated_at;

-- ============================================================================
-- Step 2: Verify Migration
-- ============================================================================

DO $$
DECLARE
  v_source_count INTEGER;
  v_target_count INTEGER;
  v_missing_count INTEGER;
BEGIN
  -- Count sub-orgs in source
  SELECT COUNT(*) INTO v_source_count
  FROM organizations_projection
  WHERE nlevel(path) > 2;

  -- Count records in target
  SELECT COUNT(*) INTO v_target_count
  FROM organization_units_projection;

  RAISE NOTICE '--- Migration Verification ---';
  RAISE NOTICE 'Sub-orgs in organizations_projection (nlevel > 2): %', v_source_count;
  RAISE NOTICE 'Records in organization_units_projection: %', v_target_count;

  -- Check for any missing records
  SELECT COUNT(*) INTO v_missing_count
  FROM organizations_projection op
  WHERE nlevel(op.path) > 2
    AND NOT EXISTS (
      SELECT 1 FROM organization_units_projection oup
      WHERE oup.id = op.id
    );

  IF v_missing_count > 0 THEN
    RAISE WARNING 'MIGRATION INCOMPLETE: % sub-orgs not migrated!', v_missing_count;
  ELSE
    RAISE NOTICE 'MIGRATION COMPLETE: All sub-orgs successfully migrated.';
  END IF;

  -- Verify all paths match
  IF EXISTS (
    SELECT 1
    FROM organizations_projection op
    JOIN organization_units_projection oup ON op.id = oup.id
    WHERE op.path != oup.path
  ) THEN
    RAISE WARNING 'PATH MISMATCH: Some paths differ between tables!';
  ELSE
    RAISE NOTICE 'PATH VERIFICATION: All paths match correctly.';
  END IF;
END $$;

-- ============================================================================
-- Verification Queries (for manual inspection)
-- ============================================================================

-- Show migrated records summary
SELECT
  'Migration Summary' as report,
  (SELECT COUNT(*) FROM organizations_projection WHERE nlevel(path) > 2) as source_sub_orgs,
  (SELECT COUNT(*) FROM organization_units_projection) as target_records,
  (SELECT COUNT(*) FROM organization_units_projection WHERE organization_id IS NULL) as missing_root_org;

-- Show sample of migrated records
SELECT
  oup.id,
  oup.name,
  oup.path::text,
  oup.organization_id,
  op.name as root_org_name
FROM organization_units_projection oup
LEFT JOIN organizations_projection op ON op.id = oup.organization_id
ORDER BY oup.path
LIMIT 10;

COMMIT;

-- ============================================================================
-- Step 3: Cleanup (MANUAL - Run separately after verification)
-- ============================================================================
-- IMPORTANT: Only run this AFTER confirming migration success!
-- This removes sub-orgs from organizations_projection.
-- UNCOMMENT and run separately in a new transaction:

-- BEGIN;
--
-- -- Double-check before delete
-- SELECT COUNT(*) as "Sub-orgs to delete from organizations_projection"
-- FROM organizations_projection
-- WHERE nlevel(path) > 2
--   AND EXISTS (SELECT 1 FROM organization_units_projection WHERE id = organizations_projection.id);
--
-- -- Delete migrated sub-orgs from old table
-- DELETE FROM organizations_projection
-- WHERE nlevel(path) > 2
--   AND EXISTS (SELECT 1 FROM organization_units_projection WHERE id = organizations_projection.id);
--
-- -- Verify cleanup
-- SELECT COUNT(*) as "Remaining sub-orgs (should be 0)"
-- FROM organizations_projection
-- WHERE nlevel(path) > 2;
--
-- COMMIT;

-- ============================================================================
-- Rollback (if needed)
-- ============================================================================
-- To rollback the cleanup (if accidentally deleted from old table):
--
-- INSERT INTO organizations_projection (
--   id, name, display_name, slug, type, path, parent_path,
--   timezone, is_active, deactivated_at, deleted_at, created_at, updated_at
-- )
-- SELECT
--   id, name, display_name, slug, 'provider', path, parent_path,
--   timezone, is_active, deactivated_at, deleted_at, created_at, updated_at
-- FROM organization_units_projection
-- ON CONFLICT (id) DO NOTHING;
