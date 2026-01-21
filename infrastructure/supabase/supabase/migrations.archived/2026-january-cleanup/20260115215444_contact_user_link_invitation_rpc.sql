-- ============================================================================
-- Migration: Contact-User Linking Support for Invitations
-- Purpose: Update get_invitation_by_token to return contact_id, first_name,
--          last_name, and roles for contact-user linking during invitation
--          acceptance
-- ============================================================================

-- Drop existing function to replace with updated signature
DROP FUNCTION IF EXISTS api.get_invitation_by_token(TEXT);

-- Create updated function with contact_id and additional fields
CREATE OR REPLACE FUNCTION api.get_invitation_by_token(p_token TEXT)
RETURNS TABLE (
  id UUID,
  token TEXT,
  email TEXT,
  organization_id UUID,
  organization_name TEXT,
  role TEXT,
  roles JSONB,
  first_name TEXT,
  last_name TEXT,
  status TEXT,
  expires_at TIMESTAMPTZ,
  accepted_at TIMESTAMPTZ,
  correlation_id UUID,
  contact_id UUID
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
    i.roles,
    i.first_name,
    i.last_name,
    i.status,
    i.expires_at,
    i.accepted_at,
    i.correlation_id,
    i.contact_id
  FROM public.invitations_projection i
  LEFT JOIN public.organizations_projection o ON o.id = i.organization_id
  WHERE i.token = p_token;
END;
$$;

ALTER FUNCTION api.get_invitation_by_token(TEXT) OWNER TO postgres;

COMMENT ON FUNCTION api.get_invitation_by_token(TEXT) IS
  'Get invitation details by token for validation. Returns correlation_id for lifecycle tracing, '
  'contact_id for contact-user linking, and first_name/last_name/roles for user creation.';

GRANT EXECUTE ON FUNCTION api.get_invitation_by_token(TEXT) TO anon;
GRANT EXECUTE ON FUNCTION api.get_invitation_by_token(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION api.get_invitation_by_token(TEXT) TO service_role;
