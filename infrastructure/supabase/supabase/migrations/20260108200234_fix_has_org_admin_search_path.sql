-- Fix security advisory: add search_path to has_org_admin_permission()

CREATE OR REPLACE FUNCTION public.has_org_admin_permission()
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $$
  -- Check if user has org admin permission via JWT claims
  -- This replaces is_org_admin() which queried the database
  SELECT
    -- Check user_role claim for admin roles
    (current_setting('request.jwt.claims', true)::jsonb->>'user_role')
      IN ('provider_admin', 'partner_admin', 'super_admin')
    -- OR check permissions array for admin-level permissions
    OR EXISTS (
      SELECT 1
      FROM jsonb_array_elements_text(
        COALESCE((current_setting('request.jwt.claims', true)::jsonb)->'permissions', '[]'::jsonb)
      ) AS perm
      WHERE perm IN ('user.manage', 'user.role_assign', 'organization.manage')
    );
$$;

COMMENT ON FUNCTION public.has_org_admin_permission() IS
'JWT-claims-based check for org admin privileges. Replaces is_org_admin() which queried the database.
Returns true if user has provider_admin, partner_admin, or super_admin role, or has admin-level permissions.';
