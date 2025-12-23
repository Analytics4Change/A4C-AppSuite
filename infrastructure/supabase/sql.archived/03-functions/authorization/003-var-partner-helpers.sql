-- VAR Partner Helper Functions
-- Provides VAR partner detection for RLS policies

-- ============================================================================
-- VAR Partner Detection
-- ============================================================================

-- Check if current user's organization is a VAR partner
-- Uses SECURITY DEFINER to bypass RLS and avoid infinite recursion
-- when used in RLS policies on organizations_projection
CREATE OR REPLACE FUNCTION is_var_partner()
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM organizations_projection
    WHERE id = get_current_org_id()
      AND type = 'provider_partner'
      AND partner_type = 'var'
      AND is_active = true
  );
$$
SET search_path = public, extensions, pg_temp;

COMMENT ON FUNCTION is_var_partner IS
  'Checks if current user''s organization is an active VAR partner. Uses SECURITY DEFINER to bypass RLS and prevent infinite recursion.';
