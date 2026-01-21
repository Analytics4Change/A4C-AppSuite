-- Migration: Fix authorization_type column comment
--
-- Changes:
-- - Rename 'parental_consent' to 'family_participation' (more inclusive term)
-- - Update column comment to reflect correct enum values

COMMENT ON COLUMN cross_tenant_access_grants_projection.authorization_type IS
  'Legal/business basis: var_contract, court_order, family_participation, social_services_assignment, emergency_access';
