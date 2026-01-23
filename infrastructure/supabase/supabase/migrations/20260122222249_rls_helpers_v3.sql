-- =============================================================================
-- Migration: RLS Helpers v3 (Effective Permissions)
-- Purpose: Create new scoped permission helpers, deprecate old single-value helpers
-- Part of: Multi-Role Authorization Phase 2D
--
-- Note: Old helpers are DEPRECATED (not dropped) because existing RLS policies
-- depend on them. Phase 4 will update RLS policies then drop the old helpers.
-- =============================================================================

-- =============================================================================
-- NEW HELPER: has_effective_permission(permission, target_path)
-- =============================================================================

-- Primary RLS helper: Check if user has permission at a specific scope
-- This replaces the combination of:
--   get_current_permissions() @> ARRAY[permission]
--   AND get_current_scope_path() @> target_path
CREATE OR REPLACE FUNCTION has_effective_permission(
  p_permission text,
  p_target_path ltree
) RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM jsonb_array_elements(
      COALESCE(
        (current_setting('request.jwt.claims', true)::jsonb)->'effective_permissions',
        '[]'::jsonb
      )
    ) ep
    WHERE ep->>'p' = p_permission
      AND (ep->>'s')::ltree @> p_target_path
  );
$$;

COMMENT ON FUNCTION has_effective_permission(text, ltree) IS
'Check if the current user has a permission at or above the target scope path.

Usage in RLS policies:
  has_effective_permission(''clients.view'', path)

Returns true if:
1. User has the permission (including implied permissions)
2. User''s scope for that permission contains the target path

Example:
  User has clients.view at ''acme'' scope
  Target path is ''acme.pediatrics.unit1''
  Returns TRUE because ''acme'' @> ''acme.pediatrics.unit1''';

-- =============================================================================
-- NEW HELPER: has_permission(permission)
-- =============================================================================

-- Convenience function: Check if user has permission (ignoring scope)
-- Use when resource doesn't have a scope path or for global permissions
CREATE OR REPLACE FUNCTION has_permission(p_permission text)
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM jsonb_array_elements(
      COALESCE(
        (current_setting('request.jwt.claims', true)::jsonb)->'effective_permissions',
        '[]'::jsonb
      )
    ) ep
    WHERE ep->>'p' = p_permission
  );
$$;

COMMENT ON FUNCTION has_permission(text) IS
'Check if the current user has a permission (without scope check).

Usage in RLS policies:
  has_permission(''settings.global_view'')

Use has_effective_permission() for scoped checks.
This function is for global/unscoped permissions only.';

-- =============================================================================
-- NEW HELPER: get_permission_scope(permission)
-- =============================================================================

-- Get the user's effective scope for a specific permission
-- Returns NULL if user doesn't have the permission
CREATE OR REPLACE FUNCTION get_permission_scope(p_permission text)
RETURNS ltree
LANGUAGE sql
STABLE
AS $$
  SELECT (ep->>'s')::ltree
  FROM jsonb_array_elements(
    COALESCE(
      (current_setting('request.jwt.claims', true)::jsonb)->'effective_permissions',
      '[]'::jsonb
    )
  ) ep
  WHERE ep->>'p' = p_permission
  LIMIT 1;
$$;

COMMENT ON FUNCTION get_permission_scope(text) IS
'Get the scope at which the user has a specific permission.

Returns:
- The ltree scope path if user has the permission
- NULL if user does not have the permission

Usage:
  SELECT get_permission_scope(''clients.view'');
  -- Returns: ''acme.pediatrics'' (user''s scope for this permission)';

-- =============================================================================
-- DEPRECATED HELPERS (to be dropped in Phase 4)
-- =============================================================================

-- These functions return single values which doesn't work for multi-role users.
-- They are NOT dropped yet because existing RLS policies depend on them.
-- Phase 4 (RLS Policy Migration) will:
--   1. Update all RLS policies to use has_effective_permission()
--   2. Then DROP these deprecated functions

-- Mark as deprecated via comments
COMMENT ON FUNCTION get_current_scope_path() IS
'DEPRECATED: Use has_effective_permission(permission, path) instead.
This function returns a single scope from the primary role, which does not
support multi-role users. Will be DROPPED in Phase 4 after RLS policy migration.';

COMMENT ON FUNCTION get_current_permissions() IS
'DEPRECATED: Use has_effective_permission(permission, path) or has_permission(permission) instead.
This function returns a flat array without scope information, which does not
support multi-role users. Will be DROPPED in Phase 4 after RLS policy migration.';

COMMENT ON FUNCTION get_current_user_role() IS
'DEPRECATED: Use has_permission(permission) or has_effective_permission(permission, path) instead.
This function returns a single role name, which does not support multi-role users.
Will be DROPPED in Phase 4 after RLS policy migration.';

-- KEEP: get_current_org_id() - still useful as org context is single-valued
-- The user is in one organization at a time, even with multiple roles

-- =============================================================================
-- GRANT PERMISSIONS
-- =============================================================================

GRANT EXECUTE ON FUNCTION has_effective_permission(text, ltree) TO authenticated;
GRANT EXECUTE ON FUNCTION has_permission(text) TO authenticated;
GRANT EXECUTE ON FUNCTION get_permission_scope(text) TO authenticated;

-- =============================================================================
-- Documentation
-- =============================================================================

COMMENT ON SCHEMA public IS
'Multi-Role Authorization v3 RLS Helpers:

NEW functions (use these):
- has_effective_permission(permission, target_path) - Scoped permission check
- has_permission(permission) - Unscoped permission check
- get_permission_scope(permission) - Get scope for a permission

DEPRECATED functions (will be dropped in Phase 4):
- get_current_scope_path() - Use has_effective_permission() instead
- get_current_permissions() - Use has_effective_permission() instead
- get_current_user_role() - Use has_permission() instead

KEPT functions:
- get_current_org_id() - Still valid (user has one current org)';
