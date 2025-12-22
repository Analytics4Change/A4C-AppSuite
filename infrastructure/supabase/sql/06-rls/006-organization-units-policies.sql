-- Row-Level Security Policies for Organization Units Projection
-- Implements scope-based access control for sub-organization hierarchy management
--
-- Organization units (OUs) are sub-organizations within a provider hierarchy (depth > 2).
-- Stored separately from organizations_projection for query optimization:
--   - Platform owners query organizations_projection (root orgs, depth = 2)
--   - Providers query organization_units_projection (their internal hierarchy, depth > 2)
--
-- Design Principles:
-- 1. Scope containment: User can access OUs where their scope_path @> OU path
-- 2. Super admin bypass: Full access to all OUs
-- 3. Soft delete only: DELETE via is_active/deleted_at, not physical removal
-- 4. Depth enforcement: Table constraints ensure nlevel(path) > 2
--
-- Dependencies:
-- - get_current_scope_path() function (from 002-authentication-helpers.sql)
-- - get_current_user_id() function (from 002-authentication-helpers.sql)
-- - is_super_admin() function (from 001-user_has_permission.sql)

-- Enable RLS on the table
ALTER TABLE organization_units_projection ENABLE ROW LEVEL SECURITY;

-- ============================================================================
-- Super Admin Policy - Full Access
-- ============================================================================

DROP POLICY IF EXISTS ou_super_admin_all ON organization_units_projection;
CREATE POLICY ou_super_admin_all
  ON organization_units_projection
  FOR ALL
  USING (is_super_admin(get_current_user_id()));

COMMENT ON POLICY ou_super_admin_all ON organization_units_projection IS
  'Allows super admins full access to all organization units';


-- ============================================================================
-- Scope-Based SELECT Policy
-- ============================================================================
-- Users can view all OUs within their scope_path hierarchy
-- This enables OU tree visualization for provider admins

DROP POLICY IF EXISTS ou_scope_select ON organization_units_projection;
CREATE POLICY ou_scope_select
  ON organization_units_projection
  FOR SELECT
  USING (
    -- User's scope_path must contain (be ancestor of or equal to) the OU's path
    -- Example: scope_path 'root.org_acme.north_campus' @> 'root.org_acme.north_campus.pediatrics'
    get_current_scope_path() IS NOT NULL
    AND get_current_scope_path() @> path
  );

COMMENT ON POLICY ou_scope_select ON organization_units_projection IS
  'Allows users to view organization units within their scope_path hierarchy';


-- ============================================================================
-- Scope-Based INSERT Policy
-- ============================================================================
-- Users can create OUs within their scope_path hierarchy
-- Note: Table constraint already enforces nlevel(path) > 2

DROP POLICY IF EXISTS ou_scope_insert ON organization_units_projection;
CREATE POLICY ou_scope_insert
  ON organization_units_projection
  FOR INSERT
  WITH CHECK (
    -- User's scope_path must contain the new OU's path
    get_current_scope_path() IS NOT NULL
    AND get_current_scope_path() @> path
  );

COMMENT ON POLICY ou_scope_insert ON organization_units_projection IS
  'Allows users to create organization units within their scope_path hierarchy';


-- ============================================================================
-- Scope-Based UPDATE Policy
-- ============================================================================
-- Users can update OUs within their scope_path hierarchy
-- Updates include: name, display_name, timezone, is_active, deactivated_at
-- Path changes (reparenting) require special handling (future: organization_unit.moved event)

DROP POLICY IF EXISTS ou_scope_update ON organization_units_projection;
CREATE POLICY ou_scope_update
  ON organization_units_projection
  FOR UPDATE
  USING (
    -- User's scope_path must contain the OU's current path
    get_current_scope_path() IS NOT NULL
    AND get_current_scope_path() @> path
  )
  WITH CHECK (
    -- After update, OU must still be within user's scope
    -- Prevents path manipulation to escape hierarchy
    get_current_scope_path() IS NOT NULL
    AND get_current_scope_path() @> path
  );

COMMENT ON POLICY ou_scope_update ON organization_units_projection IS
  'Allows users to update organization units within their scope_path hierarchy';


-- ============================================================================
-- Scope-Based DELETE Policy
-- ============================================================================
-- Users can "delete" (soft delete) OUs within their scope_path
-- In practice, deletion sets deleted_at and is_active = false via event
-- True DELETE operations should use soft delete pattern

DROP POLICY IF EXISTS ou_scope_delete ON organization_units_projection;
CREATE POLICY ou_scope_delete
  ON organization_units_projection
  FOR DELETE
  USING (
    -- User's scope_path must contain the OU's path
    get_current_scope_path() IS NOT NULL
    AND get_current_scope_path() @> path
    -- Note: Additional validation (no children, no roles) is done in RPC function
    -- RLS cannot efficiently check these conditions
  );

COMMENT ON POLICY ou_scope_delete ON organization_units_projection IS
  'Allows users to delete organization units within their scope_path. Child/role validation in RPC.';


-- ============================================================================
-- Organization Admin Policy (Alternative Access Path)
-- ============================================================================
-- Organization admins (via organization_id FK) can view OUs in their organization
-- This provides access when user doesn't have a specific OU-level scope_path

DROP POLICY IF EXISTS ou_org_admin_select ON organization_units_projection;
CREATE POLICY ou_org_admin_select
  ON organization_units_projection
  FOR SELECT
  USING (
    organization_id IS NOT NULL
    AND is_org_admin(get_current_user_id(), organization_id)
  );

COMMENT ON POLICY ou_org_admin_select ON organization_units_projection IS
  'Allows organization admins to view all OUs within their organization';


-- ============================================================================
-- Performance Notes
-- ============================================================================
-- For high-volume queries, consider JWT claims-based policies:
--
-- CREATE POLICY ou_scope_select_jwt
--   ON organization_units_projection
--   FOR SELECT
--   USING (
--     (auth.jwt()->>'scope_path')::ltree @> path
--   );
--
-- This avoids function call overhead but reduces testability.
-- Current implementation uses helper functions for consistency.


-- ============================================================================
-- Testing Helpers
-- ============================================================================

-- Test SELECT policy:
-- SET LOCAL request.jwt.claims = '{"scope_path": "root.org_acme", "user_id": "..."}';
-- SELECT * FROM organization_units_projection;
-- Should only return OUs where scope_path @> ou.path

-- Test INSERT policy (via event processor, not direct INSERT):
-- INSERT INTO domain_events (...) with organization_unit.created event
-- Should succeed if new OU path is within user's scope_path

-- Test UPDATE policy:
-- UPDATE organization_units_projection SET name = 'New Name' WHERE id = '<ou_uuid>';
-- Should succeed if OU is within user's scope_path

-- Verify policies are active:
-- SELECT schemaname, tablename, policyname, permissive, roles, cmd, qual
-- FROM pg_policies
-- WHERE tablename = 'organization_units_projection';
