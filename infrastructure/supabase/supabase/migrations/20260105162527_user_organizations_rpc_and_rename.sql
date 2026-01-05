-- Migration: Rename user_org_access → user_organizations_projection + Add RPC API layer
-- Purpose: Follow projection naming convention AND eliminate direct table access anti-pattern
--
-- Changes:
-- 1. Rename table user_org_access → user_organizations_projection
-- 2. Update all functions referencing the old table name
-- 3. Create RPC functions in api schema for frontend access
-- 4. Recreate RLS policies with new table name

-------------------------------------------------------------------------------
-- 1. Rename table (constraints and indexes auto-follow)
-------------------------------------------------------------------------------

ALTER TABLE IF EXISTS public.user_org_access
    RENAME TO user_organizations_projection;

-- Update table comment
COMMENT ON TABLE public.user_organizations_projection IS
    'Projection table for user-organization access with per-org access windows and notification preferences. Source of truth for accessible_organizations array.';

-------------------------------------------------------------------------------
-- 2. Drop and recreate trigger with updated function
-------------------------------------------------------------------------------

-- Drop the old trigger (it references the old function)
DROP TRIGGER IF EXISTS trg_sync_accessible_orgs ON public.user_organizations_projection;

-- Update sync_accessible_organizations function to use new table name
CREATE OR REPLACE FUNCTION public.sync_accessible_organizations()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    target_user_id uuid;
BEGIN
    -- Determine which user_id to update
    target_user_id := COALESCE(NEW.user_id, OLD.user_id);

    -- Update the accessible_organizations array from user_organizations_projection
    UPDATE public.users
    SET
        accessible_organizations = (
            SELECT COALESCE(array_agg(uop.org_id ORDER BY uop.created_at), ARRAY[]::uuid[])
            FROM public.user_organizations_projection uop
            WHERE uop.user_id = target_user_id
        ),
        updated_at = now()
    WHERE id = target_user_id;

    RETURN COALESCE(NEW, OLD);
END;
$$;

COMMENT ON FUNCTION public.sync_accessible_organizations()
    IS 'Trigger function to keep users.accessible_organizations array in sync with user_organizations_projection table';

-- Recreate trigger on new table name
CREATE TRIGGER trg_sync_accessible_orgs
    AFTER INSERT OR UPDATE OR DELETE ON public.user_organizations_projection
    FOR EACH ROW
    EXECUTE FUNCTION public.sync_accessible_organizations();

-------------------------------------------------------------------------------
-- 3. Update user_has_active_org_access function
-------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.user_has_active_org_access(
    p_user_id uuid,
    p_org_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    RETURN EXISTS (
        SELECT 1
        FROM public.user_organizations_projection
        WHERE user_id = p_user_id
          AND org_id = p_org_id
          AND (access_start_date IS NULL OR access_start_date <= CURRENT_DATE)
          AND (access_expiration_date IS NULL OR access_expiration_date >= CURRENT_DATE)
    );
END;
$$;

COMMENT ON FUNCTION public.user_has_active_org_access(uuid, uuid)
    IS 'Check if user has active (non-expired, started) access to an organization';

-------------------------------------------------------------------------------
-- 4. Update get_user_active_roles function
-------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.get_user_active_roles(
    p_user_id uuid,
    p_org_id uuid DEFAULT NULL
)
RETURNS TABLE (
    role_id uuid,
    role_name text,
    organization_id uuid,
    scope_path extensions.ltree
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    RETURN QUERY
    SELECT
        ur.role_id,
        r.name AS role_name,
        ur.organization_id,
        ur.scope_path
    FROM public.user_roles_projection ur
    JOIN public.roles_projection r ON r.id = ur.role_id
    LEFT JOIN public.user_organizations_projection uop
        ON uop.user_id = ur.user_id
        AND uop.org_id = ur.organization_id
    WHERE ur.user_id = p_user_id
      -- Filter by org if specified
      AND (p_org_id IS NULL OR ur.organization_id = p_org_id OR ur.organization_id IS NULL)
      -- Role-level date check
      AND (ur.role_valid_from IS NULL OR ur.role_valid_from <= CURRENT_DATE)
      AND (ur.role_valid_until IS NULL OR ur.role_valid_until >= CURRENT_DATE)
      -- User-org level date check (for org-scoped roles)
      AND (
          ur.organization_id IS NULL  -- Global roles (super_admin) skip org access check
          OR (
              (uop.access_start_date IS NULL OR uop.access_start_date <= CURRENT_DATE)
              AND (uop.access_expiration_date IS NULL OR uop.access_expiration_date >= CURRENT_DATE)
          )
      );
END;
$$;

COMMENT ON FUNCTION public.get_user_active_roles(uuid, uuid)
    IS 'Get user''s active roles, respecting both org-level and role-level access dates';

-------------------------------------------------------------------------------
-- 5. Update custom_access_token_hook function (JWT hook)
-------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION "public"."custom_access_token_hook"("event" "jsonb") RETURNS "jsonb"
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'extensions', 'pg_temp'
    AS $$
DECLARE
  v_user_id uuid;
  v_user_record record;
  v_claims jsonb;
  v_org_id uuid;
  v_org_type text;
  v_user_role text;
  v_permissions text[];
  v_scope_path text;
  v_org_access_record record;
  v_access_blocked boolean := false;
  v_access_block_reason text;
BEGIN
  -- Extract user ID from event (Supabase Auth user UUID)
  v_user_id := (event->>'user_id')::uuid;

  -- Get user's current organization
  SELECT u.current_organization_id
  INTO v_org_id
  FROM public.users u
  WHERE u.id = v_user_id;

  -- =========================================================================
  -- ACCESS DATE VALIDATION
  -- =========================================================================

  -- Check user-level access dates from user_organizations_projection
  IF v_org_id IS NOT NULL THEN
    SELECT
      uop.access_start_date,
      uop.access_expiration_date
    INTO v_org_access_record
    FROM public.user_organizations_projection uop
    WHERE uop.user_id = v_user_id
      AND uop.org_id = v_org_id;

    -- Check if access hasn't started yet
    IF v_org_access_record.access_start_date IS NOT NULL
       AND v_org_access_record.access_start_date > CURRENT_DATE THEN
      v_access_blocked := true;
      v_access_block_reason := 'access_not_started';
    END IF;

    -- Check if access has expired
    IF v_org_access_record.access_expiration_date IS NOT NULL
       AND v_org_access_record.access_expiration_date < CURRENT_DATE THEN
      v_access_blocked := true;
      v_access_block_reason := 'access_expired';
    END IF;
  END IF;

  -- If access is blocked, return minimal claims with blocked flag
  IF v_access_blocked THEN
    RETURN jsonb_build_object(
      'claims',
      COALESCE(event->'claims', '{}'::jsonb) || jsonb_build_object(
        'org_id', v_org_id,
        'org_type', NULL,
        'user_role', 'blocked',
        'permissions', '[]'::jsonb,
        'scope_path', NULL,
        'access_blocked', true,
        'access_block_reason', v_access_block_reason,
        'claims_version', 2
      )
    );
  END IF;

  -- =========================================================================
  -- EXISTING LOGIC (with role-level date filtering)
  -- =========================================================================

  -- Get user's role and scope, filtering by role-level access dates
  SELECT
    COALESCE(
      (SELECT r.name
       FROM public.user_roles_projection ur
       JOIN public.roles_projection r ON r.id = ur.role_id
       WHERE ur.user_id = v_user_id
         -- Filter by role-level access dates
         AND (ur.role_valid_from IS NULL OR ur.role_valid_from <= CURRENT_DATE)
         AND (ur.role_valid_until IS NULL OR ur.role_valid_until >= CURRENT_DATE)
       ORDER BY
         CASE
           WHEN r.name = 'super_admin' THEN 1
           WHEN r.name = 'provider_admin' THEN 2
           WHEN r.name = 'partner_admin' THEN 3
           ELSE 4
         END
       LIMIT 1
      ),
      'viewer'
    ) as role,
    COALESCE(
      (SELECT ur.scope_path::text
       FROM public.user_roles_projection ur
       JOIN public.roles_projection r ON r.id = ur.role_id
       WHERE ur.user_id = v_user_id
         -- Filter by role-level access dates
         AND (ur.role_valid_from IS NULL OR ur.role_valid_from <= CURRENT_DATE)
         AND (ur.role_valid_until IS NULL OR ur.role_valid_until >= CURRENT_DATE)
       ORDER BY
         CASE
           WHEN r.name = 'super_admin' THEN 1
           WHEN r.name = 'provider_admin' THEN 2
           WHEN r.name = 'partner_admin' THEN 3
           ELSE 4
         END
       LIMIT 1
      ),
      NULL
    ) as scope
  INTO v_user_role, v_scope_path;

  -- If no organization context, check for super_admin role
  IF v_org_id IS NULL THEN
    SELECT
      CASE
        WHEN EXISTS (
          SELECT 1
          FROM public.user_roles_projection ur
          JOIN public.roles_projection r ON r.id = ur.role_id
          WHERE ur.user_id = v_user_id
            AND r.name = 'super_admin'
            AND ur.organization_id IS NULL
            -- Filter by role-level access dates
            AND (ur.role_valid_from IS NULL OR ur.role_valid_from <= CURRENT_DATE)
            AND (ur.role_valid_until IS NULL OR ur.role_valid_until >= CURRENT_DATE)
        ) THEN NULL  -- Super admin has NULL org_id (global scope)
        ELSE (
          SELECT o.id
          FROM public.organizations_projection o
          WHERE o.type = 'platform_owner'
          LIMIT 1
        )
      END
    INTO v_org_id;
  END IF;

  -- Get organization type for UI feature gating
  -- Super admins (NULL org_id) default to 'platform_owner' for consistency
  IF v_org_id IS NULL THEN
    v_org_type := 'platform_owner';
  ELSE
    SELECT o.type::text INTO v_org_type
    FROM public.organizations_projection o
    WHERE o.id = v_org_id;
  END IF;

  -- Get user's permissions for the organization
  -- Super admins get all permissions
  IF v_user_role = 'super_admin' THEN
    SELECT array_agg(p.name)
    INTO v_permissions
    FROM public.permissions_projection p;
  ELSE
    -- Get permissions via role grants, filtering by role-level access dates
    SELECT array_agg(DISTINCT p.name)
    INTO v_permissions
    FROM public.user_roles_projection ur
    JOIN public.role_permissions_projection rp ON rp.role_id = ur.role_id
    JOIN public.permissions_projection p ON p.id = rp.permission_id
    WHERE ur.user_id = v_user_id
      AND (ur.organization_id = v_org_id OR ur.organization_id IS NULL)
      -- Filter by role-level access dates
      AND (ur.role_valid_from IS NULL OR ur.role_valid_from <= CURRENT_DATE)
      AND (ur.role_valid_until IS NULL OR ur.role_valid_until >= CURRENT_DATE);
  END IF;

  -- Default to empty array if no permissions
  v_permissions := COALESCE(v_permissions, ARRAY[]::text[]);

  -- Build custom claims by merging with existing claims
  v_claims := COALESCE(event->'claims', '{}'::jsonb) || jsonb_build_object(
    'org_id', v_org_id,
    'org_type', v_org_type,
    'user_role', v_user_role,
    'permissions', to_jsonb(v_permissions),
    'scope_path', v_scope_path,
    'access_blocked', false,
    'claims_version', 2
  );

  -- Return the updated claims object
  RETURN jsonb_build_object('claims', v_claims);

EXCEPTION
  WHEN OTHERS THEN
    -- Log error but don't fail authentication
    RAISE WARNING 'JWT hook error for user %: % %',
      v_user_id,
      SQLERRM,
      SQLSTATE;

    -- Return minimal claims on error, preserving standard JWT fields
    RETURN jsonb_build_object(
      'claims',
      COALESCE(event->'claims', '{}'::jsonb) || jsonb_build_object(
        'org_id', NULL,
        'org_type', NULL,
        'user_role', 'viewer',
        'permissions', '[]'::jsonb,
        'scope_path', NULL,
        'access_blocked', false,
        'claims_error', SQLERRM,
        'claims_version', 2
      )
    );
END;
$$;

COMMENT ON FUNCTION "public"."custom_access_token_hook"("event" "jsonb")
    IS 'JWT custom claims hook with user-level and role-level access date validation (v2)';

-------------------------------------------------------------------------------
-- 6. Recreate RLS policies with new table name
-------------------------------------------------------------------------------

-- Drop old policies (they may reference old table name in policy name)
DROP POLICY IF EXISTS user_org_access_super_admin_all ON public.user_organizations_projection;
DROP POLICY IF EXISTS user_org_access_org_admin_all ON public.user_organizations_projection;
DROP POLICY IF EXISTS user_org_access_own_select ON public.user_organizations_projection;

-- Create new policies with updated names
CREATE POLICY user_organizations_super_admin_all
    ON public.user_organizations_projection
    FOR ALL
    USING (public.is_super_admin(public.get_current_user_id()));

COMMENT ON POLICY user_organizations_super_admin_all ON public.user_organizations_projection
    IS 'Allows super admins full access to all user-org access records';

CREATE POLICY user_organizations_org_admin_all
    ON public.user_organizations_projection
    FOR ALL
    USING (public.is_org_admin(public.get_current_user_id(), org_id));

COMMENT ON POLICY user_organizations_org_admin_all ON public.user_organizations_projection
    IS 'Allows organization admins to manage user access in their organization';

CREATE POLICY user_organizations_own_select
    ON public.user_organizations_projection
    FOR SELECT
    USING (user_id = public.get_current_user_id());

COMMENT ON POLICY user_organizations_own_select ON public.user_organizations_projection
    IS 'Allows users to view their own org access records';

-------------------------------------------------------------------------------
-- 7. Create RPC functions in api schema
-------------------------------------------------------------------------------

-- RPC: Get user's organization access (single org)
CREATE OR REPLACE FUNCTION api.get_user_org_access(
    p_user_id uuid,
    p_org_id uuid
)
RETURNS TABLE (
    user_id uuid,
    org_id uuid,
    access_start_date date,
    access_expiration_date date,
    notification_preferences jsonb,
    created_at timestamptz,
    updated_at timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
    -- RLS is already enforced on user_organizations_projection
    -- But we add explicit check for extra safety
    IF NOT (
        public.is_super_admin(public.get_current_user_id())
        OR public.is_org_admin(public.get_current_user_id(), p_org_id)
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

COMMENT ON FUNCTION api.get_user_org_access(uuid, uuid)
    IS 'Get a user''s access configuration for a specific organization';

-- RPC: List all organization access for a user
CREATE OR REPLACE FUNCTION api.list_user_org_access(
    p_user_id uuid
)
RETURNS TABLE (
    user_id uuid,
    org_id uuid,
    org_name text,
    access_start_date date,
    access_expiration_date date,
    is_currently_active boolean,
    notification_preferences jsonb,
    created_at timestamptz,
    updated_at timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
    -- Check authorization
    IF NOT (
        public.is_super_admin(public.get_current_user_id())
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

COMMENT ON FUNCTION api.list_user_org_access(uuid)
    IS 'List all organization access records for a user with active status';

-- RPC: Update user's access dates (emits domain event)
CREATE OR REPLACE FUNCTION api.update_user_access_dates(
    p_user_id uuid,
    p_org_id uuid,
    p_access_start_date date,
    p_access_expiration_date date
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
    v_old_record record;
BEGIN
    -- Check authorization
    IF NOT (
        public.is_super_admin(public.get_current_user_id())
        OR public.is_org_admin(public.get_current_user_id(), p_org_id)
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

COMMENT ON FUNCTION api.update_user_access_dates(uuid, uuid, date, date)
    IS 'Update a user''s access date window for an organization';

-- RPC: Update notification preferences
CREATE OR REPLACE FUNCTION api.update_user_notification_preferences(
    p_user_id uuid,
    p_org_id uuid,
    p_notification_preferences jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
    -- Check authorization - users can update their own, admins can update any
    IF NOT (
        public.is_super_admin(public.get_current_user_id())
        OR public.is_org_admin(public.get_current_user_id(), p_org_id)
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

COMMENT ON FUNCTION api.update_user_notification_preferences(uuid, uuid, jsonb)
    IS 'Update a user''s notification preferences for an organization';

-------------------------------------------------------------------------------
-- 8. Grant permissions on RPC functions
-------------------------------------------------------------------------------

GRANT EXECUTE ON FUNCTION api.get_user_org_access(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION api.list_user_org_access(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION api.update_user_access_dates(uuid, uuid, date, date) TO authenticated;
GRANT EXECUTE ON FUNCTION api.update_user_notification_preferences(uuid, uuid, jsonb) TO authenticated;
