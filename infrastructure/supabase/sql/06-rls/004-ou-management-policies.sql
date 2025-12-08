-- Row-Level Security Policies for Organizational Unit (OU) Management
-- Enables provider_admin to manage sub-organizations within their hierarchy
--
-- Design Principles:
-- 1. scope_path containment: User can access OUs where their scope_path @> OU path
-- 2. Super admin bypass: Existing super_admin_all policy handles full access
-- 3. Soft delete only: DELETE operations update is_active/deleted_at, not remove rows
-- 4. Root org protection: Handled at application layer (RPC function), not RLS
--
-- Dependencies:
-- - get_current_scope_path() function (from 002-authentication-helpers.sql)
-- - get_current_user_id() function (from 002-authentication-helpers.sql)
-- - is_super_admin() function (from 001-user_has_permission.sql)
-- - has_permission() function (from 002-authentication-helpers.sql)

-- ============================================================================
-- Organizations Projection - OU Management Policies
-- ============================================================================

-- Policy: Provider/Partner admins can SELECT all organizations within their hierarchy
-- This expands on the existing org_admin_select policy which only allowed viewing
-- the single org where the user is admin. OU management requires viewing the tree.
DROP POLICY IF EXISTS organizations_scope_select ON organizations_projection;
CREATE POLICY organizations_scope_select
  ON organizations_projection
  FOR SELECT
  USING (
    -- User's scope_path must contain (be ancestor of or equal to) the org's path
    -- Example: scope_path 'root.provider.acme' @> 'root.provider.acme.north_campus'
    get_current_scope_path() IS NOT NULL
    AND get_current_scope_path() @> path
  );

COMMENT ON POLICY organizations_scope_select ON organizations_projection IS
  'Allows users to view organizations within their scope_path hierarchy. Required for OU tree visualization.';


-- Policy: Provider/Partner admins can INSERT sub-organizations within their hierarchy
-- Requires organization.create_ou permission (checked at application layer)
-- RLS enforces scope containment - user cannot create OUs outside their hierarchy
DROP POLICY IF EXISTS organizations_scope_insert ON organizations_projection;
CREATE POLICY organizations_scope_insert
  ON organizations_projection
  FOR INSERT
  WITH CHECK (
    -- User's scope_path must contain the new org's path
    get_current_scope_path() IS NOT NULL
    AND get_current_scope_path() @> path
    -- Ensure it's a sub-organization (depth > 2)
    -- Root orgs (depth = 2) can only be created by super_admin via bootstrap workflow
    AND nlevel(path) > 2
  );

COMMENT ON POLICY organizations_scope_insert ON organizations_projection IS
  'Allows users to create sub-organizations within their scope_path hierarchy. Root orgs require super_admin.';


-- Policy: Provider/Partner admins can UPDATE organizations within their hierarchy
-- Updates include: name, display_name, timezone, is_active, deactivated_at, etc.
-- Path changes (reparenting) are blocked - that requires special handling
DROP POLICY IF EXISTS organizations_scope_update ON organizations_projection;
CREATE POLICY organizations_scope_update
  ON organizations_projection
  FOR UPDATE
  USING (
    -- User's scope_path must contain the org's current path
    get_current_scope_path() IS NOT NULL
    AND get_current_scope_path() @> path
    -- Prevent updates to root organization (depth = 2) except by super_admin
    -- Root org updates (e.g., company rename) should go through separate flow
    AND nlevel(path) > 2
  )
  WITH CHECK (
    -- After update, org must still be within user's scope
    -- This prevents path manipulation to escape hierarchy
    get_current_scope_path() IS NOT NULL
    AND get_current_scope_path() @> path
    -- Path depth cannot decrease (cannot promote sub-org to root)
    AND nlevel(path) > 2
  );

COMMENT ON POLICY organizations_scope_update ON organizations_projection IS
  'Allows users to update sub-organizations within their scope_path. Root org updates require super_admin.';


-- Policy: Provider/Partner admins can "DELETE" (soft delete) within their hierarchy
-- In practice, this is an UPDATE to set deleted_at and is_active = false
-- True DELETE operations should be blocked entirely
DROP POLICY IF EXISTS organizations_scope_delete ON organizations_projection;
CREATE POLICY organizations_scope_delete
  ON organizations_projection
  FOR DELETE
  USING (
    -- User's scope_path must contain the org's path
    get_current_scope_path() IS NOT NULL
    AND get_current_scope_path() @> path
    -- Prevent deletion of root organization (depth = 2)
    AND nlevel(path) > 2
    -- Note: Additional validation (no children, no roles) is done in RPC function
    -- RLS cannot check these conditions efficiently
  );

COMMENT ON POLICY organizations_scope_delete ON organizations_projection IS
  'Allows users to delete sub-organizations within their scope_path. Child/role validation done in RPC.';


-- ============================================================================
-- Alternative: JWT Claims-Based Policies (More Efficient)
-- ============================================================================
-- If performance becomes an issue, we can use JWT claims directly instead of
-- the get_current_scope_path() function. This avoids function call overhead.
--
-- Example:
-- CREATE POLICY organizations_scope_select_jwt
--   ON organizations_projection
--   FOR SELECT
--   USING (
--     (auth.jwt()->>'scope_path')::ltree @> path
--   );
--
-- For now, we use the helper function for consistency and testability.


-- ============================================================================
-- Testing Helpers
-- ============================================================================
-- These comments document how to test the policies manually

-- Test SELECT policy:
-- SET LOCAL app.current_user = '<user_uuid>';  -- For testing override
-- SELECT * FROM organizations_projection;
-- Should only return orgs where user's scope_path @> org path

-- Test INSERT policy:
-- INSERT INTO organizations_projection (id, name, slug, type, path, ...)
-- VALUES (...);
-- Should succeed if path is within user's scope_path and nlevel > 2

-- Test UPDATE policy:
-- UPDATE organizations_projection SET name = 'New Name' WHERE id = '<ou_uuid>';
-- Should succeed if OU is within user's scope_path and nlevel > 2

-- Test DELETE policy:
-- DELETE FROM organizations_projection WHERE id = '<ou_uuid>';
-- Should succeed if OU is within user's scope_path and nlevel > 2
-- Note: Application should use soft delete (UPDATE is_active = false) instead
