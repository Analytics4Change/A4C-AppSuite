-- Remove Deprecated Zitadel Authentication References
-- Migration completed October 2025: Zitadel → Supabase Auth
--
-- This migration removes all references to the deprecated Zitadel authentication system.
-- The platform now uses Supabase Auth exclusively for authentication (OAuth2 + SAML 2.0).
--
-- Changes:
-- - Drop zitadel_org_id column from organizations_projection
-- - Drop Zitadel ID resolution functions (6 functions)
-- - Drop Zitadel mapping tables (zitadel_organization_mapping, zitadel_user_mapping)
-- - Drop Zitadel indexes
--
-- Safety: All changes use IF EXISTS for idempotency
-- Impact: No data loss (Zitadel migration completed 4+ months ago)
-- Rollback: Revert this migration and redeploy previous schema if needed

-- ============================================================================
-- Drop Zitadel ID Resolution Functions
-- ============================================================================

-- Organization ID resolution functions
DROP FUNCTION IF EXISTS get_internal_org_id(TEXT);
DROP FUNCTION IF EXISTS get_zitadel_org_id(UUID);
DROP FUNCTION IF EXISTS upsert_org_mapping(UUID, TEXT, TEXT);

-- User ID resolution functions
DROP FUNCTION IF EXISTS get_internal_user_id(TEXT);
DROP FUNCTION IF EXISTS get_zitadel_user_id(UUID);
DROP FUNCTION IF EXISTS upsert_user_mapping(UUID, TEXT, TEXT);

-- ============================================================================
-- Drop Zitadel Mapping Tables
-- ============================================================================

DROP TABLE IF EXISTS zitadel_user_mapping CASCADE;
DROP TABLE IF EXISTS zitadel_organization_mapping CASCADE;

-- ============================================================================
-- Drop Zitadel Indexes
-- ============================================================================

DROP INDEX IF EXISTS idx_organizations_zitadel_org;
DROP INDEX IF EXISTS idx_users_external_id;

-- ============================================================================
-- Drop Zitadel Columns from organizations_projection
-- ============================================================================

-- Remove zitadel_org_id column (deprecated - now using Supabase Auth)
ALTER TABLE organizations_projection
  DROP COLUMN IF EXISTS zitadel_org_id CASCADE;

-- ============================================================================
-- Update Comments to Reflect Migration
-- ============================================================================

COMMENT ON TABLE organizations_projection IS
  'Organization hierarchy projection (CQRS read model). Uses Supabase Auth for authentication (migration from Zitadel completed October 2025).';

-- ============================================================================
-- Verification Queries (for manual testing)
-- ============================================================================

-- Verify no Zitadel references remain:
-- SELECT column_name FROM information_schema.columns
-- WHERE table_name = 'organizations_projection' AND column_name LIKE '%zitadel%';
-- Expected: 0 rows

-- Verify functions dropped:
-- SELECT routine_name FROM information_schema.routines
-- WHERE routine_name LIKE '%zitadel%';
-- Expected: 0 rows

-- Verify tables dropped:
-- SELECT table_name FROM information_schema.tables
-- WHERE table_name LIKE '%zitadel%';
-- Expected: 0 rows (except zitadel-bootstrap-reference.sql in 00-reference/)
