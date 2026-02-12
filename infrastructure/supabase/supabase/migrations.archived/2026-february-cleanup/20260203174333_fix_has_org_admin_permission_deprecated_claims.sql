-- =============================================================================
-- Migration: Fix has_org_admin_permission() to use effective_permissions (v4 claims)
-- Purpose: Update RLS helper function that was using deprecated user_role and permissions claims
-- =============================================================================

-- The old function checked:
--   1. user_role IN ('provider_admin', 'partner_admin', 'super_admin')
--   2. permissions array contains 'user.manage', 'user.role_assign', 'organization.manage'
--
-- In claims v4:
--   - user_role was removed
--   - permissions array was replaced by effective_permissions: [{p, s}]
--
-- New function checks effective_permissions for admin-level permissions

CREATE OR REPLACE FUNCTION "public"."has_org_admin_permission"()
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path TO 'public', 'extensions', 'pg_temp'
AS $$
  -- Check if user has org admin permission via JWT effective_permissions (claims v4)
  SELECT EXISTS (
    SELECT 1
    FROM jsonb_array_elements(
      COALESCE(
        (current_setting('request.jwt.claims', true)::jsonb)->'effective_permissions',
        '[]'::jsonb
      )
    ) AS ep
    WHERE ep->>'p' IN (
      'user.manage',
      'user.role_assign',
      'organization.manage',
      'role.create',
      'role.update',
      'role.delete'
    )
  );
$$;

COMMENT ON FUNCTION "public"."has_org_admin_permission"() IS
'Check if user has organization admin permissions via effective_permissions JWT claim (claims v4).
Used by RLS policies to grant admin access to organization resources.
Returns true if user has any of: user.manage, user.role_assign, organization.manage, role.create, role.update, role.delete.';
