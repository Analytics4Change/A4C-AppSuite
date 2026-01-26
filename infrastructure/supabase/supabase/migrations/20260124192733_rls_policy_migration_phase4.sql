-- =============================================================================
-- Migration: RLS Policy Migration to Effective Permissions
-- Purpose: Update RLS policies to use has_effective_permission() helper
-- Part of: Multi-Role Authorization Phase 4
-- =============================================================================

-- This migration updates RLS policies from the deprecated get_current_scope_path()
-- pattern to the new has_effective_permission(permission, path) pattern.
--
-- The new pattern:
-- - Checks user's JWT effective_permissions array
-- - Verifies permission name matches AND scope contains target path
-- - Supports multi-role users with different permissions at different scopes

-- =============================================================================
-- ORGANIZATIONS_PROJECTION POLICIES
-- =============================================================================

-- SELECT: View organizations within permission scope
DROP POLICY IF EXISTS "organizations_scope_select" ON organizations_projection;
CREATE POLICY "organizations_scope_select" ON organizations_projection
FOR SELECT USING (
  has_effective_permission('organization.view', path)
);

COMMENT ON POLICY "organizations_scope_select" ON organizations_projection IS
'Allows users to view organizations within their effective permission scope.
Uses has_effective_permission() which checks JWT effective_permissions array.';

-- INSERT: Create sub-organizations (nlevel > 2 prevents root org creation)
DROP POLICY IF EXISTS "organizations_scope_insert" ON organizations_projection;
CREATE POLICY "organizations_scope_insert" ON organizations_projection
FOR INSERT WITH CHECK (
  has_effective_permission('organization.create', path)
  AND extensions.nlevel(path) > 2
);

COMMENT ON POLICY "organizations_scope_insert" ON organizations_projection IS
'Allows users to create sub-organizations within their permission scope.
Root org creation (nlevel <= 2) requires platform admin via separate policy.';

-- UPDATE: Update sub-organizations
DROP POLICY IF EXISTS "organizations_scope_update" ON organizations_projection;
CREATE POLICY "organizations_scope_update" ON organizations_projection
FOR UPDATE USING (
  has_effective_permission('organization.update', path)
  AND extensions.nlevel(path) > 2
) WITH CHECK (
  has_effective_permission('organization.update', path)
  AND extensions.nlevel(path) > 2
);

COMMENT ON POLICY "organizations_scope_update" ON organizations_projection IS
'Allows users to update sub-organizations within their permission scope.
Root org updates require platform admin via separate policy.';

-- DELETE: Delete sub-organizations
DROP POLICY IF EXISTS "organizations_scope_delete" ON organizations_projection;
CREATE POLICY "organizations_scope_delete" ON organizations_projection
FOR DELETE USING (
  has_effective_permission('organization.delete', path)
  AND extensions.nlevel(path) > 2
);

COMMENT ON POLICY "organizations_scope_delete" ON organizations_projection IS
'Allows users to delete sub-organizations within their permission scope.
Root org deletion requires platform admin.';

-- =============================================================================
-- ORGANIZATION_UNITS_PROJECTION POLICIES
-- =============================================================================

-- SELECT: View OUs within permission scope
DROP POLICY IF EXISTS "ou_scope_select" ON organization_units_projection;
CREATE POLICY "ou_scope_select" ON organization_units_projection
FOR SELECT USING (
  has_effective_permission('organization.view_ou', path)
);

COMMENT ON POLICY "ou_scope_select" ON organization_units_projection IS
'Allows users to view organization units within their effective permission scope.';

-- INSERT: Create OUs within permission scope
DROP POLICY IF EXISTS "ou_scope_insert" ON organization_units_projection;
CREATE POLICY "ou_scope_insert" ON organization_units_projection
FOR INSERT WITH CHECK (
  has_effective_permission('organization.create_ou', path)
);

COMMENT ON POLICY "ou_scope_insert" ON organization_units_projection IS
'Allows users to create organization units within their permission scope.';

-- UPDATE: Update OUs within permission scope
DROP POLICY IF EXISTS "ou_scope_update" ON organization_units_projection;
CREATE POLICY "ou_scope_update" ON organization_units_projection
FOR UPDATE USING (
  has_effective_permission('organization.update_ou', path)
) WITH CHECK (
  has_effective_permission('organization.update_ou', path)
);

COMMENT ON POLICY "ou_scope_update" ON organization_units_projection IS
'Allows users to update organization units within their permission scope.';

-- DELETE: Delete OUs within permission scope
DROP POLICY IF EXISTS "ou_scope_delete" ON organization_units_projection;
CREATE POLICY "ou_scope_delete" ON organization_units_projection
FOR DELETE USING (
  has_effective_permission('organization.delete_ou', path)
);

COMMENT ON POLICY "ou_scope_delete" ON organization_units_projection IS
'Allows users to delete organization units within their permission scope.';
