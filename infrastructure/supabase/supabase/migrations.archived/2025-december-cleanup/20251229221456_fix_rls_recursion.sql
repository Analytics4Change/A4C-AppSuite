-- Migration: fix_rls_recursion
-- PURPOSE: Fix infinite RLS recursion in permission check functions
-- ROOT CAUSE: is_super_admin and is_org_admin query user_roles_projection,
--             which has RLS policies that call is_super_admin/is_org_admin,
--             creating infinite recursion → "stack depth limit exceeded"
-- FIX: Make these functions SECURITY DEFINER to bypass RLS when checking permissions

-- ============================================================================
-- FIX: is_super_admin - must bypass RLS to avoid recursion
-- ============================================================================
CREATE OR REPLACE FUNCTION public.is_super_admin(p_user_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER  -- KEY FIX: Run as function owner to bypass RLS
SET search_path = public, pg_temp
STABLE
AS $$
BEGIN
  -- Direct table access bypasses RLS policies that would call this function
  RETURN EXISTS (
    SELECT 1
    FROM user_roles_projection ur
    JOIN roles_projection r ON r.id = ur.role_id
    WHERE ur.user_id = p_user_id
      AND r.name = 'super_admin'
      AND ur.organization_id IS NULL
  );
END;
$$;

-- ============================================================================
-- FIX: is_org_admin - must bypass RLS to avoid recursion
-- ============================================================================
CREATE OR REPLACE FUNCTION public.is_org_admin(p_user_id UUID, p_org_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER  -- KEY FIX: Run as function owner to bypass RLS
SET search_path = public, pg_temp
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM user_roles_projection ur
    JOIN roles_projection r ON r.id = ur.role_id
    WHERE ur.user_id = p_user_id
      AND r.name IN ('provider_admin', 'partner_admin')
      AND ur.organization_id = p_org_id
      AND r.deleted_at IS NULL
  );
$$;

-- ============================================================================
-- VERIFICATION
-- ============================================================================
DO $$
BEGIN
  RAISE NOTICE 'RLS recursion fix applied:';
  RAISE NOTICE '  - is_super_admin: SECURITY DEFINER (bypasses RLS)';
  RAISE NOTICE '  - is_org_admin: SECURITY DEFINER (bypasses RLS)';
  RAISE NOTICE 'This prevents infinite recursion when RLS policies call these functions.';
END;
$$;
