-- ==============================================================================
-- Invitation RPC Functions
-- Called by accept-invitation Edge Function via PostgREST
-- ==============================================================================
--
-- These functions support the invitation acceptance flow:
-- 1. Frontend calls Edge Function with invitation token
-- 2. Edge Function calls api.get_invitation_by_token() to validate
-- 3. Edge Function calls api.accept_invitation() to mark as accepted
--
-- NOTE: These functions already exist in production database.
-- This file adds them to version control for schema consistency.

-- ==============================================================================
-- Function: api.get_invitation_by_token
-- ==============================================================================
-- Get invitation details by token for validation during acceptance
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
    i.role,
    i.status,
    i.expires_at,
    i.accepted_at
  FROM public.invitations_projection i
  LEFT JOIN public.organizations_projection o ON o.id = i.organization_id
  WHERE i.token = p_token;
END;
$$;

GRANT EXECUTE ON FUNCTION api.get_invitation_by_token TO service_role;
COMMENT ON FUNCTION api.get_invitation_by_token IS
  'Get invitation details by token for validation. Called by accept-invitation Edge Function.';

-- ==============================================================================
-- Function: api.accept_invitation
-- ==============================================================================
-- Mark invitation as accepted
CREATE OR REPLACE FUNCTION api.accept_invitation(p_invitation_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
BEGIN
  UPDATE public.invitations_projection
  SET accepted_at = NOW()
  WHERE id = p_invitation_id;
END;
$$;

GRANT EXECUTE ON FUNCTION api.accept_invitation TO service_role;
COMMENT ON FUNCTION api.accept_invitation IS
  'Mark invitation as accepted. Called by accept-invitation Edge Function.';

-- ==============================================================================
-- Notes
-- ==============================================================================
-- - SECURITY DEFINER: Required for service role access (Edge Functions use service role)
-- - These functions are called by the accept-invitation Edge Function
-- - get_invitation_by_token: Returns org name for display in acceptance UI
-- - accept_invitation: Simple update, event emission handled separately
