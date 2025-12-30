-- Migration: Filter permissions by org_type in api.get_permissions()
-- Purpose: Non-platform_owner users should NOT see global-scope permissions
-- Issue: #4 - Organization vs OU permission visibility
--
-- Key Insight:
-- - scope_type='global' = Organization Management (platform_owner ONLY)
-- - scope_type IN ('org','facility','program','client') = OU Management (all org_types)
--
-- org_type values (from JWT claims):
-- - platform_owner: Can see ALL permissions
-- - provider: Can ONLY see non-global permissions
-- - provider_partner: Can ONLY see non-global permissions

-- ============================================================================
-- Update api.get_permissions() to filter by org_type
-- ============================================================================
CREATE OR REPLACE FUNCTION api.get_permissions()
RETURNS TABLE (
  id UUID,
  name TEXT,
  applet TEXT,
  action TEXT,
  display_name TEXT,
  description TEXT,
  scope_type TEXT,
  requires_mfa BOOLEAN
)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_org_type TEXT;
BEGIN
  -- Get org_type from JWT custom claims
  v_org_type := COALESCE(
    auth.jwt()->'app_metadata'->>'org_type',
    auth.jwt()->>'org_type',
    'provider'  -- Default to provider (most restrictive) if not set
  );

  RETURN QUERY
  SELECT
    p.id,
    p.name,
    p.applet,
    p.action,
    p.display_name,
    p.description,
    p.scope_type,
    p.requires_mfa
  FROM permissions_projection p
  WHERE
    -- Platform owners see everything
    -- Non-platform owners only see non-global permissions
    CASE
      WHEN v_org_type = 'platform_owner' THEN TRUE
      ELSE p.scope_type != 'global'
    END
  ORDER BY p.applet, p.action;
END;
$$;

COMMENT ON FUNCTION api.get_permissions IS 'List available permissions filtered by org_type. Non-platform_owner users only see org/facility/program/client scoped permissions. Platform owners see all permissions including global scope.';

-- ============================================================================
-- Verification query (run manually to test)
-- ============================================================================
-- Test for platform_owner (should see all):
-- SELECT * FROM api.get_permissions() WHERE scope_type = 'global';
--
-- Test for provider (should see none with global scope):
-- Set org_type='provider' in JWT claims and verify global permissions are hidden
