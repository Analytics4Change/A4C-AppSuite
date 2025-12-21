-- Row-Level Security Policy for VAR Partner Referrals
-- Allows VAR partners to view organizations they referred
-- Created: 2025-11-17
--
-- Authorization Model:
-- - Super admins: See all organizations (existing policy)
-- - VAR partners: See organizations where referring_partner_id = their org_id
-- - Regular users: See only their own organization (existing policy)
--
-- The referring_partner_id relationship IS the permission grant.
-- No additional delegation table needed.

-- ============================================================================
-- Organizations Projection - VAR Partner Referrals Policy
-- ============================================================================

-- VAR partners can view organizations they referred
-- Uses is_var_partner() helper function (SECURITY DEFINER) to avoid infinite recursion
DROP POLICY IF EXISTS organizations_var_partner_referrals ON organizations_projection;
CREATE POLICY organizations_var_partner_referrals
  ON organizations_projection
  FOR SELECT
  USING (
    -- Check if current user's organization is a VAR partner (via helper function)
    is_var_partner()
    -- Allow access to organizations where this VAR partner is the referring partner
    AND referring_partner_id = get_current_org_id()
  );

COMMENT ON POLICY organizations_var_partner_referrals ON organizations_projection IS
  'Allows VAR partners to view organizations they referred (where referring_partner_id = their org_id)';


-- ============================================================================
-- Policy Precedence and Interaction
-- ============================================================================
--
-- RLS policies are combined with OR logic, so a user can match multiple policies:
--
-- 1. organizations_super_admin_all (FOR ALL)
--    - Super admins see ALL organizations
--
-- 2. organizations_org_admin_select (FOR SELECT)
--    - Organization admins see THEIR OWN organization
--
-- 3. organizations_var_partner_referrals (FOR SELECT) [NEW]
--    - VAR partners see organizations they REFERRED
--
-- Example Access Scenarios:
--
-- A. Super Admin in A4C Platform Organization:
--    - Matches policy #1 → Sees ALL organizations
--
-- B. VAR Partner Admin in TechSolutions VAR:
--    - Matches policy #2 → Sees TechSolutions organization
--    - Matches policy #3 → Sees all organizations with referring_partner_id = TechSolutions ID
--    - Net result: TechSolutions + all referred organizations
--
-- C. Provider Admin in ABC Healthcare:
--    - Matches policy #2 → Sees ABC Healthcare organization only
--    - Does NOT match policy #3 (not a VAR partner)
--    - Net result: ABC Healthcare only
--
-- D. Regular User in ABC Healthcare:
--    - Does NOT match policy #2 (not an admin)
--    - Does NOT match policy #3 (not a VAR partner)
--    - Net result: No organizations visible
--    - Note: Users can still see their own org data via other tables (users, user_roles, etc.)
