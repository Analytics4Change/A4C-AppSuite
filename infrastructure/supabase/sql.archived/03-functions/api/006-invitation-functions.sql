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
-- DEPRECATED (2025-12-22): This function is no longer called.
--
-- The invitation.accepted event now handles all projection updates via
-- process_invitation_event() trigger. This removes the dual-write pattern
-- where both an RPC and event processor were updating the same row.
--
-- The Edge Function now only emits the invitation.accepted event, which:
-- 1. Updates invitations_projection.status and accepted_at
-- 2. Creates role assignment in user_roles_projection
-- 3. Updates users shadow table
--
-- This function is kept for schema consistency but will be removed in
-- a future cleanup.
-- ==============================================================================
CREATE OR REPLACE FUNCTION api.accept_invitation(p_invitation_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
BEGIN
  -- DEPRECATED: No longer called. Event processor handles updates.
  -- Kept for schema consistency, will be removed in future cleanup.
  RAISE WARNING 'api.accept_invitation is deprecated. Use invitation.accepted event instead.';

  UPDATE public.invitations_projection
  SET accepted_at = NOW()
  WHERE id = p_invitation_id;
END;
$$;

GRANT EXECUTE ON FUNCTION api.accept_invitation TO service_role;
COMMENT ON FUNCTION api.accept_invitation IS
  'DEPRECATED (2025-12-22): No longer called. The invitation.accepted event now handles all projection updates via process_invitation_event().';

-- ==============================================================================
-- Notes
-- ==============================================================================
-- - SECURITY DEFINER: Required for service role access (Edge Functions use service role)
-- - get_invitation_by_token: Still used, returns org name for display in acceptance UI
-- - accept_invitation: DEPRECATED (2025-12-22) - event processor handles updates now
