-- Update Subdomain Provisioning to be Conditional
-- Part of Phase 1.5: Provider Onboarding Enhancement
--
-- Subdomain Requirements by Organization Type:
-- - Provider organizations: ALWAYS require subdomain (tenant isolation + portal access)
-- - VAR partner organizations: Require subdomain (they get their own portal)
-- - Stakeholder partners (family, court, other): Do NOT require subdomain (no portal access)
-- - Platform owner (A4C): Does NOT require subdomain (NULL allowed)
--
-- Implementation:
-- - Make subdomain_status nullable (NULL = subdomain not required)
-- - Create validation function to determine subdomain requirement
-- - Add CHECK constraint to enforce conditional logic
-- - Update platform owner org to have NULL subdomain_status
--
-- Safety: All changes are idempotent and backward compatible
-- Impact: Enables flexible subdomain provisioning based on org type

-- ============================================================================
-- Make subdomain_status Nullable
-- ============================================================================

-- Change subdomain_status from DEFAULT 'pending' to nullable
-- Organizations that don't require subdomains will have NULL subdomain_status
ALTER TABLE organizations_projection
  ALTER COLUMN subdomain_status DROP DEFAULT,
  ALTER COLUMN subdomain_status DROP NOT NULL;

-- Update default for new orgs: NULL (will be set by validation logic)
ALTER TABLE organizations_projection
  ALTER COLUMN subdomain_status SET DEFAULT NULL;

-- ============================================================================
-- Create Subdomain Validation Function
-- ============================================================================

CREATE OR REPLACE FUNCTION is_subdomain_required(
  p_type TEXT,
  p_partner_type partner_type
) RETURNS BOOLEAN AS $$
BEGIN
  -- Subdomain required for providers (always have portal)
  IF p_type = 'provider' THEN
    RETURN TRUE;
  END IF;

  -- Subdomain required for VAR partners (they get portal access)
  IF p_type = 'provider_partner' AND p_partner_type = 'var' THEN
    RETURN TRUE;
  END IF;

  -- Subdomain NOT required for stakeholder partners (family, court, other)
  -- They don't get portal access, just limited dashboard views
  IF p_type = 'provider_partner' AND p_partner_type IN ('family', 'court', 'other') THEN
    RETURN FALSE;
  END IF;

  -- Subdomain NOT required for platform owner (A4C)
  -- Platform owner uses main domain, not tenant subdomain
  IF p_type = 'platform_owner' THEN
    RETURN FALSE;
  END IF;

  -- Default: subdomain not required (conservative approach)
  RETURN FALSE;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

COMMENT ON FUNCTION is_subdomain_required IS
  'Determines if subdomain provisioning is required based on organization type and partner type';

-- ============================================================================
-- Add CHECK Constraint for Subdomain Conditional Logic
-- ============================================================================

-- Constraint: If subdomain required, subdomain_status cannot be NULL
-- If subdomain not required, subdomain_status MUST be NULL
ALTER TABLE organizations_projection
  DROP CONSTRAINT IF EXISTS chk_subdomain_conditional;

ALTER TABLE organizations_projection
  ADD CONSTRAINT chk_subdomain_conditional CHECK (
    -- If subdomain required, status cannot be NULL
    (is_subdomain_required(type, partner_type) = TRUE AND subdomain_status IS NOT NULL)
    OR
    -- If subdomain not required, status MUST be NULL
    (is_subdomain_required(type, partner_type) = FALSE AND subdomain_status IS NULL)
  );

-- ============================================================================
-- Update Existing Organizations
-- ============================================================================

-- Set subdomain_status to NULL for organizations that don't require subdomains
UPDATE organizations_projection
SET
  subdomain_status = NULL,
  cloudflare_record_id = NULL,
  dns_verified_at = NULL,
  subdomain_metadata = '{}'::jsonb,
  updated_at = NOW()
WHERE
  is_subdomain_required(type, partner_type) = FALSE
  AND subdomain_status IS NOT NULL;

-- Update documentation
COMMENT ON COLUMN organizations_projection.subdomain_status IS
  'Subdomain provisioning status (NULL = subdomain not required for this org type). Required for providers and VAR partners only.';

-- ============================================================================
-- Verification Queries (for manual testing)
-- ============================================================================

-- Verify subdomain_status is nullable:
-- SELECT column_name, is_nullable, column_default
-- FROM information_schema.columns
-- WHERE table_name = 'organizations_projection' AND column_name = 'subdomain_status';
-- Expected: is_nullable = 'YES', column_default = NULL

-- Verify function works correctly:
-- SELECT
--   'provider' as type, NULL::partner_type as partner_type,
--   is_subdomain_required('provider', NULL) as required;
-- Expected: TRUE
--
-- SELECT
--   'provider_partner' as type, 'var'::partner_type as partner_type,
--   is_subdomain_required('provider_partner', 'var') as required;
-- Expected: TRUE
--
-- SELECT
--   'provider_partner' as type, 'family'::partner_type as partner_type,
--   is_subdomain_required('provider_partner', 'family') as required;
-- Expected: FALSE
--
-- SELECT
--   'platform_owner' as type, NULL::partner_type as partner_type,
--   is_subdomain_required('platform_owner', NULL) as required;
-- Expected: FALSE

-- Verify constraint works:
-- Test 1: Insert provider with NULL subdomain_status (should FAIL)
-- INSERT INTO organizations_projection (id, name, slug, type, path, created_at, partner_type, subdomain_status)
-- VALUES (gen_random_uuid(), 'Test Provider', 'test-provider', 'provider', 'root.test_provider', NOW(), NULL, NULL);
-- Expected: ERROR - constraint violation
--
-- Test 2: Insert stakeholder partner with 'pending' subdomain_status (should FAIL)
-- INSERT INTO organizations_projection (id, name, slug, type, path, created_at, partner_type, subdomain_status)
-- VALUES (gen_random_uuid(), 'Test Family', 'test-family', 'provider_partner', 'root.test_family', NOW(), 'family', 'pending');
-- Expected: ERROR - constraint violation
--
-- Test 3: Insert stakeholder partner with NULL subdomain_status (should SUCCEED)
-- INSERT INTO organizations_projection (id, name, slug, type, path, created_at, partner_type, subdomain_status)
-- VALUES (gen_random_uuid(), 'Test Family', 'test-family', 'provider_partner', 'root.test_family', NOW(), 'family', NULL);
-- Expected: Success

-- ============================================================================
-- Migration Notes
-- ============================================================================

-- This migration is part of Phase 1.5 (Provider Onboarding Enhancement)
-- Subdomain provisioning is now conditional based on org type:
-- - Provider orgs: subdomain REQUIRED (portal access)
-- - VAR partners: subdomain REQUIRED (portal access)
-- - Stakeholder partners: subdomain NOT required (no portal, just limited views)
-- - Platform owner: subdomain NOT required (uses main domain)
--
-- Event processors will check is_subdomain_required() and only provision DNS
-- for orgs where it returns TRUE. Temporal workflows will skip DNS provisioning
-- activities when subdomain_status is NULL.
--
-- See: dev/active/provider-onboarding-enhancement-context.md for full context
