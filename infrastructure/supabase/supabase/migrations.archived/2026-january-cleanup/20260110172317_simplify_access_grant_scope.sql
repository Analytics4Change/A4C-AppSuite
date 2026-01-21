-- Migration: Simplify access grant scope enum
--
-- Changes:
-- - Simplify scope from [full_org, facility, program, client_specific] to [organization_unit, client_specific]
-- - full_org/facility/program are all just different levels in organization_units_projection (ltree)
-- - Stub has_cross_tenant_access function (aspirational - not yet implemented)
--
-- No data migration needed - table is empty

-- ============================================================================
-- Step 1: Update CHECK constraint
-- ============================================================================
ALTER TABLE cross_tenant_access_grants_projection
DROP CONSTRAINT IF EXISTS cross_tenant_access_grants_projection_scope_check;

ALTER TABLE cross_tenant_access_grants_projection
ADD CONSTRAINT cross_tenant_access_grants_projection_scope_check
CHECK (scope IN ('organization_unit', 'client_specific'));

-- Update column comment
COMMENT ON COLUMN cross_tenant_access_grants_projection.scope IS
  'Access scope: organization_unit (any OU via scope_id) or client_specific (specific client)';

-- ============================================================================
-- Step 2: Stub has_cross_tenant_access function
-- ============================================================================
CREATE OR REPLACE FUNCTION public.has_cross_tenant_access(
  p_consultant_org_id uuid,
  p_provider_org_id uuid,
  p_user_id uuid DEFAULT NULL,
  p_scope text DEFAULT 'organization_unit'
) RETURNS boolean
LANGUAGE plpgsql STABLE
SET search_path TO 'public', 'extensions', 'pg_temp'
AS $$
BEGIN
  -- Stub: Cross-tenant access not yet implemented
  -- When implemented, will use ltree containment to check if requested resource
  -- is within the granted organization_unit scope
  RETURN FALSE;
END;
$$;

COMMENT ON FUNCTION public.has_cross_tenant_access(uuid, uuid, uuid, text) IS
  'Stub: Cross-tenant access grant checking. Returns FALSE until fully implemented with ltree containment logic.';
