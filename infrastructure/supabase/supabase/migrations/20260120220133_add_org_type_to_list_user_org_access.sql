-- ============================================================================
-- Add org_type to api.list_user_org_access RPC
--
-- This fixes a CQRS violation where the frontend was doing a secondary query
-- to organizations_projection to get the org type.
-- ============================================================================

-- Drop existing function (return type is changing)
DROP FUNCTION IF EXISTS api.list_user_org_access(uuid);

-- Recreate with org_type column
CREATE FUNCTION api.list_user_org_access(p_user_id uuid)
RETURNS TABLE(
  user_id uuid,
  org_id uuid,
  org_name text,
  org_type text,  -- NEW: Added org type
  access_start_date date,
  access_expiration_date date,
  is_currently_active boolean,
  notification_preferences jsonb,
  created_at timestamp with time zone,
  updated_at timestamp with time zone
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $$
BEGIN
  -- Authorization check
  IF NOT (
    -- Tier 1: Platform admin (cross-tenant access)
    public.has_platform_privilege()
    -- User viewing their own org list
    OR p_user_id = public.get_current_user_id()
  ) THEN
    RAISE EXCEPTION 'Access denied' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT
    uop.user_id,
    uop.org_id,
    op.name AS org_name,
    op.type AS org_type,  -- NEW: Include org type from organizations_projection
    uop.access_start_date,
    uop.access_expiration_date,
    (
      (uop.access_start_date IS NULL OR uop.access_start_date <= CURRENT_DATE)
      AND (uop.access_expiration_date IS NULL OR uop.access_expiration_date >= CURRENT_DATE)
    ) AS is_currently_active,
    uop.notification_preferences,
    uop.created_at,
    uop.updated_at
  FROM public.user_organizations_projection uop
  JOIN public.organizations_projection op ON op.id = uop.org_id
  WHERE uop.user_id = p_user_id
  ORDER BY uop.created_at DESC;
END;
$$;

COMMENT ON FUNCTION api.list_user_org_access(uuid) IS
'List all organization memberships for a user, including org type.
Authorization:
- Platform admins can view any user''s orgs
- Users can view their own org list';
