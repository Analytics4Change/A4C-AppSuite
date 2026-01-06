-- Migration: Create api.get_role_by_name RPC function
-- Purpose: Look up role by name for Edge Function role assignment
-- Pattern: Same as get_invitation_by_token, get_organization_by_id

-- Create RPC function to look up role by name
-- Prefers org-specific role over system role (NULL organization_id)
CREATE OR REPLACE FUNCTION api.get_role_by_name(
  p_org_id UUID,
  p_role_name TEXT
)
RETURNS TABLE (
  id UUID,
  name TEXT,
  organization_id UUID
)
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  SELECT r.id, r.name, r.organization_id
  FROM public.roles_projection r
  WHERE r.name = p_role_name
    AND (r.organization_id = p_org_id OR r.organization_id IS NULL)
  ORDER BY r.organization_id DESC NULLS LAST  -- Prefer org-specific over system role
  LIMIT 1;
$$;

-- Grant execute to service role (Edge Functions use service role)
GRANT EXECUTE ON FUNCTION api.get_role_by_name(UUID, TEXT) TO service_role;

COMMENT ON FUNCTION api.get_role_by_name IS
  'Look up role by name, preferring org-specific role over system role. Used by accept-invitation Edge Function.';
