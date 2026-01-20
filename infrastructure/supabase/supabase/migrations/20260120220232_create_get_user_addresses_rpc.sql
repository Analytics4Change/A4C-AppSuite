-- ============================================================================
-- Create api.get_user_addresses RPC for CQRS compliance
--
-- This replaces direct queries to user_addresses table.
-- Returns addresses for a user that the current user is authorized to see.
-- ============================================================================

CREATE OR REPLACE FUNCTION api.get_user_addresses(p_user_id uuid)
RETURNS TABLE(
  id uuid,
  user_id uuid,
  label text,
  type text,
  street1 text,
  street2 text,
  city text,
  state text,
  zip_code text,
  country text,
  is_primary boolean,
  is_active boolean,
  metadata jsonb,
  created_at timestamp with time zone,
  updated_at timestamp with time zone
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $$
DECLARE
  v_current_user_id uuid;
  v_current_org_id uuid;
BEGIN
  -- Get current user context
  v_current_user_id := public.get_current_user_id();
  v_current_org_id := public.get_current_org_id();

  -- Authorization check
  IF NOT (
    -- Platform admin (cross-tenant access)
    public.has_platform_privilege()
    -- Org admin viewing users in their org
    OR (public.has_org_admin_permission() AND EXISTS (
      SELECT 1 FROM user_organizations_projection uop
      WHERE uop.user_id = p_user_id AND uop.org_id = v_current_org_id
    ))
    -- User viewing their own addresses
    OR p_user_id = v_current_user_id
  ) THEN
    RAISE EXCEPTION 'Access denied: insufficient permissions' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT
    ua.id,
    ua.user_id,
    ua.label,
    ua.type::text,
    ua.street1,
    ua.street2,
    ua.city,
    ua.state,
    ua.zip_code,
    ua.country,
    ua.is_primary,
    ua.is_active,
    ua.metadata,
    ua.created_at,
    ua.updated_at
  FROM user_addresses ua
  WHERE ua.user_id = p_user_id
    AND ua.is_active = true
  ORDER BY ua.is_primary DESC, ua.created_at DESC;
END;
$$;

COMMENT ON FUNCTION api.get_user_addresses(uuid) IS
'Get addresses for a user (CQRS-compliant).
Authorization:
- Platform admins can view any user''s addresses
- Org admins can view addresses for users in their org
- Users can view their own addresses';
