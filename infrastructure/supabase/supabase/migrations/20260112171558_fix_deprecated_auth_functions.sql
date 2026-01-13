-- Migration: Fix deprecated is_super_admin() and is_org_admin() calls in API functions
-- Description: Updates 6 API functions that still reference dropped functions
--              to use has_platform_privilege() and has_org_admin_permission()
--
-- Affected functions:
--   1. api.get_roles - is_super_admin → has_platform_privilege
--   2. api.get_bootstrap_status - inline super_admin check → has_platform_privilege
--   3. api.get_user_org_access - is_super_admin + is_org_admin → JWT-based
--   4. api.list_user_org_access - is_super_admin → has_platform_privilege
--   5. api.update_user_access_dates - is_super_admin + is_org_admin → JWT-based
--   6. api.update_user_notification_preferences - is_super_admin + is_org_admin → JWT-based
--
-- Authorization Pattern (Three-Tier):
--   Tier 1: has_platform_privilege() - platform-wide access (cross-tenant)
--   Tier 2: has_org_admin_permission() - org-level admin access
--   Tier 3: resource.organization_id = get_current_org_id() - baseline tenant access

-- ============================================================================
-- 1. api.get_roles - Fix platform privilege check
-- ============================================================================

CREATE OR REPLACE FUNCTION api.get_roles(
  p_status text DEFAULT 'all'::text,
  p_search_term text DEFAULT NULL::text
)
RETURNS TABLE(
  id uuid,
  name text,
  description text,
  organization_id uuid,
  org_hierarchy_scope text,
  is_active boolean,
  deleted_at timestamp with time zone,
  created_at timestamp with time zone,
  updated_at timestamp with time zone,
  permission_count bigint,
  user_count bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions', 'pg_temp'
AS $$
DECLARE
  v_user_id UUID;
  v_org_id UUID;
  v_org_type TEXT;
  v_has_platform_privilege BOOLEAN;
BEGIN
  -- Get current user context (called ONCE, not per row)
  v_user_id := public.get_current_user_id();
  v_org_id := public.get_current_org_id();
  v_org_type := (auth.jwt()->>'org_type')::text;
  v_has_platform_privilege := public.has_platform_privilege();

  RETURN QUERY
  SELECT
    r.id,
    r.name,
    r.description,
    r.organization_id,
    r.org_hierarchy_scope::TEXT,
    r.is_active,
    r.deleted_at,
    r.created_at,
    r.updated_at,
    COALESCE(pc.cnt, 0)::BIGINT AS permission_count,
    COALESCE(uc.cnt, 0)::BIGINT AS user_count
  FROM roles_projection r
  LEFT JOIN (
    SELECT rp.role_id, COUNT(*) as cnt
    FROM role_permissions_projection rp
    GROUP BY rp.role_id
  ) pc ON pc.role_id = r.id
  LEFT JOIN (
    SELECT ur.role_id, COUNT(*) as cnt
    FROM user_roles_projection ur
    GROUP BY ur.role_id
  ) uc ON uc.role_id = r.id
  WHERE
    r.deleted_at IS NULL
    -- Authorization: Three-tier check
    AND (
      -- Tier 3: User's organization roles (baseline tenant access)
      r.organization_id = v_org_id
      -- Tier 1: Global roles ONLY visible to platform_owner org type
      OR (r.organization_id IS NULL AND v_org_type = 'platform_owner')
      -- Tier 1: Platform admin override - sees all roles across all orgs
      OR v_has_platform_privilege
    )
    -- Status filter
    AND (p_status = 'all'
         OR (p_status = 'active' AND r.is_active = true)
         OR (p_status = 'inactive' AND r.is_active = false))
    -- Search filter
    AND (p_search_term IS NULL
         OR r.name ILIKE '%' || p_search_term || '%'
         OR r.description ILIKE '%' || p_search_term || '%')
  ORDER BY
    r.is_active DESC,
    r.name ASC;
END;
$$;

COMMENT ON FUNCTION api.get_roles(text, text) IS
'List roles visible to current user.
- Tier 3: Users see their organization''s roles
- Tier 1: Global roles only visible to platform_owner org type
- Tier 1: Platform admins (has_platform_privilege) see all roles
Uses JWT-based authorization (no database queries for auth check).';

-- ============================================================================
-- 2. api.get_bootstrap_status - Fix inline super_admin check
-- ============================================================================

CREATE OR REPLACE FUNCTION api.get_bootstrap_status(p_bootstrap_id uuid)
RETURNS TABLE(
  bootstrap_id uuid,
  organization_id uuid,
  status text,
  current_stage text,
  error_message text,
  created_at timestamp with time zone,
  completed_at timestamp with time zone,
  domain text,
  dns_configured boolean,
  invitations_sent integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_user_id UUID;
BEGIN
  -- Get current user from JWT
  v_user_id := auth.uid();

  -- Allow access if:
  -- 1. User has platform.admin permission (platform-wide access)
  -- 2. User has a role in the organization being queried
  -- 3. User initiated the bootstrap (found in event metadata)
  IF v_user_id IS NOT NULL THEN
    IF NOT (
      -- Tier 1: Platform admin can view any organization
      public.has_platform_privilege()
      OR
      -- Tier 3: User has role in the organization being queried
      EXISTS (
        SELECT 1 FROM user_roles_projection
        WHERE user_id = v_user_id
          AND org_id = p_bootstrap_id
      )
      OR
      -- User initiated the bootstrap (check event metadata)
      EXISTS (
        SELECT 1 FROM domain_events
        WHERE stream_id = p_bootstrap_id
          AND event_type = 'organization.bootstrap.initiated'
          AND event_metadata->>'user_id' = v_user_id::TEXT
      )
    ) THEN
      -- Not authorized - return empty result (consistent with "not found" behavior)
      RETURN;
    END IF;
  END IF;

  -- The p_bootstrap_id is now the organization_id (unified ID system)
  RETURN QUERY
  SELECT * FROM get_bootstrap_status(p_bootstrap_id);
END;
$$;

COMMENT ON FUNCTION api.get_bootstrap_status(uuid) IS
'Get bootstrap workflow status for an organization.
Authorization:
- Platform admins (has_platform_privilege) can view any org
- Users with roles in the org can view
- Users who initiated the bootstrap can view';

-- ============================================================================
-- 3. api.get_user_org_access - Fix both is_super_admin and is_org_admin
-- ============================================================================

CREATE OR REPLACE FUNCTION api.get_user_org_access(p_user_id uuid, p_org_id uuid)
RETURNS TABLE(
  user_id uuid,
  org_id uuid,
  access_start_date date,
  access_expiration_date date,
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
  -- Authorization: Three-tier check
  IF NOT (
    -- Tier 1: Platform admin (cross-tenant access)
    public.has_platform_privilege()
    -- Tier 2: Org admin for this org
    OR public.has_org_admin_permission()
    -- User viewing their own record
    OR p_user_id = public.get_current_user_id()
  ) THEN
    RAISE EXCEPTION 'Access denied' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT
    uop.user_id,
    uop.org_id,
    uop.access_start_date,
    uop.access_expiration_date,
    uop.notification_preferences,
    uop.created_at,
    uop.updated_at
  FROM public.user_organizations_projection uop
  WHERE uop.user_id = p_user_id
    AND uop.org_id = p_org_id;
END;
$$;

COMMENT ON FUNCTION api.get_user_org_access(uuid, uuid) IS
'Get user organization access details.
Authorization:
- Platform admins can view any user/org
- Org admins can view users in their org
- Users can view their own records';

-- ============================================================================
-- 4. api.list_user_org_access - Fix is_super_admin check
-- ============================================================================

CREATE OR REPLACE FUNCTION api.list_user_org_access(p_user_id uuid)
RETURNS TABLE(
  user_id uuid,
  org_id uuid,
  org_name text,
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
'List all organization memberships for a user.
Authorization:
- Platform admins can view any user''s orgs
- Users can view their own org list';

-- ============================================================================
-- 5. api.update_user_access_dates - Fix both is_super_admin and is_org_admin
-- ============================================================================

CREATE OR REPLACE FUNCTION api.update_user_access_dates(
  p_user_id uuid,
  p_org_id uuid,
  p_access_start_date date,
  p_access_expiration_date date
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $$
DECLARE
  v_old_record record;
BEGIN
  -- Authorization: Three-tier check
  IF NOT (
    -- Tier 1: Platform admin (cross-tenant access)
    public.has_platform_privilege()
    -- Tier 2: Org admin for this org
    OR public.has_org_admin_permission()
  ) THEN
    RAISE EXCEPTION 'Access denied' USING ERRCODE = '42501';
  END IF;

  -- Validate dates
  IF p_access_start_date IS NOT NULL
     AND p_access_expiration_date IS NOT NULL
     AND p_access_start_date > p_access_expiration_date THEN
    RAISE EXCEPTION 'Start date must be before expiration date' USING ERRCODE = '22023';
  END IF;

  -- Get old values for event
  SELECT access_start_date, access_expiration_date
  INTO v_old_record
  FROM public.user_organizations_projection
  WHERE user_id = p_user_id AND org_id = p_org_id;

  -- Emit domain event
  PERFORM api.emit_domain_event(
    p_event_type := 'user.access_dates_updated',
    p_aggregate_type := 'user',
    p_aggregate_id := p_user_id,
    p_event_data := jsonb_build_object(
      'user_id', p_user_id,
      'org_id', p_org_id,
      'access_start_date', p_access_start_date,
      'access_expiration_date', p_access_expiration_date,
      'previous_start_date', v_old_record.access_start_date,
      'previous_expiration_date', v_old_record.access_expiration_date
    ),
    p_event_metadata := jsonb_build_object(
      'user_id', public.get_current_user_id()
    )
  );

  -- Update the projection directly (event processor will also handle this)
  UPDATE public.user_organizations_projection
  SET
    access_start_date = p_access_start_date,
    access_expiration_date = p_access_expiration_date,
    updated_at = now()
  WHERE user_id = p_user_id
    AND org_id = p_org_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'User organization access record not found' USING ERRCODE = 'P0002';
  END IF;
END;
$$;

COMMENT ON FUNCTION api.update_user_access_dates(uuid, uuid, date, date) IS
'Update user access dates in an organization.
Authorization:
- Platform admins can update any user/org
- Org admins can update users in their org';

-- ============================================================================
-- 6. api.update_user_notification_preferences - Fix both checks
-- ============================================================================

CREATE OR REPLACE FUNCTION api.update_user_notification_preferences(
  p_user_id uuid,
  p_org_id uuid,
  p_notification_preferences jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $$
BEGIN
  -- Authorization: Three-tier check - users can update their own
  IF NOT (
    -- Tier 1: Platform admin (cross-tenant access)
    public.has_platform_privilege()
    -- Tier 2: Org admin for this org
    OR public.has_org_admin_permission()
    -- User updating their own preferences
    OR p_user_id = public.get_current_user_id()
  ) THEN
    RAISE EXCEPTION 'Access denied' USING ERRCODE = '42501';
  END IF;

  -- Update the projection
  UPDATE public.user_organizations_projection
  SET
    notification_preferences = p_notification_preferences,
    updated_at = now()
  WHERE user_id = p_user_id
    AND org_id = p_org_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'User organization access record not found' USING ERRCODE = 'P0002';
  END IF;
END;
$$;

COMMENT ON FUNCTION api.update_user_notification_preferences(uuid, uuid, jsonb) IS
'Update user notification preferences for an organization.
Authorization:
- Platform admins can update any user/org
- Org admins can update users in their org
- Users can update their own preferences';

-- ============================================================================
-- Verification
-- ============================================================================

DO $$
BEGIN
  RAISE NOTICE '=== Migration Complete: fix_deprecated_auth_functions ===';
  RAISE NOTICE '';
  RAISE NOTICE 'Updated functions:';
  RAISE NOTICE '  1. api.get_roles - is_super_admin → has_platform_privilege';
  RAISE NOTICE '  2. api.get_bootstrap_status - inline check → has_platform_privilege';
  RAISE NOTICE '  3. api.get_user_org_access - both → JWT-based';
  RAISE NOTICE '  4. api.list_user_org_access - is_super_admin → has_platform_privilege';
  RAISE NOTICE '  5. api.update_user_access_dates - both → JWT-based';
  RAISE NOTICE '  6. api.update_user_notification_preferences - both → JWT-based';
  RAISE NOTICE '';
  RAISE NOTICE 'Authorization pattern:';
  RAISE NOTICE '  Tier 1: has_platform_privilege() - platform-wide access';
  RAISE NOTICE '  Tier 2: has_org_admin_permission() - org admin access';
  RAISE NOTICE '  Tier 3: org_id = get_current_org_id() - tenant access';
END;
$$;
