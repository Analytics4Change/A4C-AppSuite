-- Projection Query RPC Functions for Workflow Activities
-- These functions provide read access to projection tables via the 'api' schema
-- since PostgREST only exposes 'api' schema, not 'public' schema.

-- 1. Get pending invitations by organization
CREATE OR REPLACE FUNCTION api.get_pending_invitations_by_org(p_org_id UUID)
RETURNS TABLE (
  invitation_id UUID,
  email TEXT
)
SECURITY INVOKER  -- Changed from DEFINER per architect review (2024-12-20)
SET search_path = public
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT i.invitation_id, i.email
  FROM invitations_projection i
  WHERE i.organization_id = p_org_id
    AND i.status = 'pending';
END;
$$;

-- 2. Get invitation by organization and email
CREATE OR REPLACE FUNCTION api.get_invitation_by_org_and_email(
  p_org_id UUID,
  p_email TEXT
)
RETURNS TABLE (
  invitation_id UUID,
  email TEXT,
  token TEXT,
  expires_at TIMESTAMPTZ
)
SECURITY INVOKER  -- Changed from DEFINER per architect review (2024-12-20)
SET search_path = public
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT i.invitation_id, i.email, i.token, i.expires_at
  FROM invitations_projection i
  WHERE i.organization_id = p_org_id
    AND i.email = p_email
  LIMIT 1;
END;
$$;

-- 3. Get organization status (for activate/deactivate checks)
-- FIXED: Use is_active (boolean) instead of status (text)
CREATE OR REPLACE FUNCTION api.get_organization_status(p_org_id UUID)
RETURNS TABLE (
  is_active BOOLEAN,
  deleted_at TIMESTAMPTZ
)
SECURITY INVOKER  -- Changed from DEFINER per architect review (2024-12-20)
SET search_path = public
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT o.is_active, o.deleted_at
  FROM organizations_projection o
  WHERE o.id = p_org_id
  LIMIT 1;
END;
$$;

-- 4. Update organization status (for activate/deactivate)
-- FIXED: Use is_active (boolean), deactivated_at instead of status, activated_at
CREATE OR REPLACE FUNCTION api.update_organization_status(
  p_org_id UUID,
  p_is_active BOOLEAN,
  p_deactivated_at TIMESTAMPTZ DEFAULT NULL,
  p_deleted_at TIMESTAMPTZ DEFAULT NULL
)
RETURNS VOID
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
BEGIN
  UPDATE organizations_projection
  SET
    is_active = p_is_active,
    deactivated_at = COALESCE(p_deactivated_at, deactivated_at),
    deleted_at = COALESCE(p_deleted_at, deleted_at)
  WHERE id = p_org_id;
END;
$$;

-- 5. Get organization name
CREATE OR REPLACE FUNCTION api.get_organization_name(p_org_id UUID)
RETURNS TEXT
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
DECLARE
  org_name TEXT;
BEGIN
  SELECT name INTO org_name
  FROM organizations_projection
  WHERE id = p_org_id;

  RETURN org_name;
END;
$$;

-- 6. Get contacts by organization
CREATE OR REPLACE FUNCTION api.get_contacts_by_org(p_org_id UUID)
RETURNS TABLE (
  id UUID
)
SECURITY INVOKER  -- Changed from DEFINER per architect review (2024-12-20)
SET search_path = public
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT c.id
  FROM contacts_projection c
  WHERE c.organization_id = p_org_id;
END;
$$;

-- 7. Get addresses by organization
CREATE OR REPLACE FUNCTION api.get_addresses_by_org(p_org_id UUID)
RETURNS TABLE (
  id UUID
)
SECURITY INVOKER  -- Changed from DEFINER per architect review (2024-12-20)
SET search_path = public
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT a.id
  FROM addresses_projection a
  WHERE a.organization_id = p_org_id;
END;
$$;

-- 8. Get phones by organization
CREATE OR REPLACE FUNCTION api.get_phones_by_org(p_org_id UUID)
RETURNS TABLE (
  id UUID
)
SECURITY INVOKER  -- Changed from DEFINER per architect review (2024-12-20)
SET search_path = public
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT p.id
  FROM phones_projection p
  WHERE p.organization_id = p_org_id;
END;
$$;
