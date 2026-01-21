-- Fix: get_invitation_by_token returns NULL role when data is in roles JSONB array
--
-- Root cause: Schema evolution mismatch
-- - Old schema: `role` column (TEXT) - single role name
-- - New schema: `roles` column (JSONB array) - multiple roles with IDs
--
-- The RPC returns `i.role` which is NULL for newer invitations,
-- while actual role data is in `i.roles`.
--
-- Error chain:
-- 1. validate-invitation calls get_invitation_by_token RPC
-- 2. RPC returns role: NULL
-- 3. Frontend checks if (!data?.orgName || !data?.role) → fails
-- 4. Throws "Invalid invitation response"
--
-- Solution: Use COALESCE to extract role from roles array when role is NULL

DROP FUNCTION IF EXISTS api.get_invitation_by_token(TEXT);

CREATE OR REPLACE FUNCTION api.get_invitation_by_token(p_token TEXT)
RETURNS TABLE (
  id UUID,
  token TEXT,
  email TEXT,
  organization_id UUID,
  organization_name TEXT,
  role TEXT,
  status TEXT,
  expires_at TIMESTAMPTZ,
  accepted_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
BEGIN
  RETURN QUERY
  SELECT
    i.id,
    i.token,
    i.email,
    i.organization_id,
    o.name as organization_name,
    -- Fix: Extract role from roles JSONB array when role column is NULL
    COALESCE(i.role, i.roles->0->>'roleName', i.roles->0->>'role_name') as role,
    i.status,
    i.expires_at,
    i.accepted_at
  FROM public.invitations_projection i
  LEFT JOIN public.organizations_projection o ON o.id = i.organization_id
  WHERE i.token = p_token;
END;
$$;

ALTER FUNCTION api.get_invitation_by_token(TEXT) OWNER TO postgres;

COMMENT ON FUNCTION api.get_invitation_by_token(TEXT) IS
  'Get invitation details by token for validation. Handles both legacy role column and new roles JSONB array. Called by validate-invitation Edge Function.';

GRANT EXECUTE ON FUNCTION api.get_invitation_by_token(TEXT) TO anon;
GRANT EXECUTE ON FUNCTION api.get_invitation_by_token(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION api.get_invitation_by_token(TEXT) TO service_role;
