-- Migration: user_org_access junction table
-- Purpose: Per-organization access control, replacing accessible_organizations array as source of truth
-- Includes: access dates (start/expiration), notification preferences
-- Maintains backward compatibility via trigger that syncs accessible_organizations array

-------------------------------------------------------------------------------
-- 1. Create user_org_access junction table
-------------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.user_org_access (
    user_id uuid NOT NULL,
    org_id uuid NOT NULL,

    -- Access window (both nullable = no restriction)
    access_start_date date DEFAULT NULL,
    access_expiration_date date DEFAULT NULL,

    -- Per-org notification preferences (JSONB for flexibility)
    notification_preferences jsonb DEFAULT '{
        "email": true,
        "sms": { "enabled": false, "phone_id": null },
        "in_app": false
    }'::jsonb NOT NULL,

    -- Audit timestamps
    created_at timestamptz DEFAULT now() NOT NULL,
    updated_at timestamptz DEFAULT now() NOT NULL,

    -- Composite primary key
    CONSTRAINT user_org_access_pkey PRIMARY KEY (user_id, org_id),

    -- Foreign keys
    CONSTRAINT user_org_access_user_id_fkey FOREIGN KEY (user_id)
        REFERENCES public.users(id) ON DELETE CASCADE,
    CONSTRAINT user_org_access_org_id_fkey FOREIGN KEY (org_id)
        REFERENCES public.organizations_projection(id) ON DELETE CASCADE,

    -- Constraint: access_start_date must be before access_expiration_date (if both set)
    CONSTRAINT user_org_access_date_order_check CHECK (
        access_start_date IS NULL
        OR access_expiration_date IS NULL
        OR access_start_date <= access_expiration_date
    )
);

COMMENT ON TABLE public.user_org_access IS 'Junction table for user-organization access with per-org access windows and notification preferences. Source of truth for accessible_organizations array.';
COMMENT ON COLUMN public.user_org_access.access_start_date IS 'First date user can access this org (NULL = immediate)';
COMMENT ON COLUMN public.user_org_access.access_expiration_date IS 'Last date user can access this org (NULL = no expiration)';
COMMENT ON COLUMN public.user_org_access.notification_preferences IS 'Per-org notification preferences: email, sms, in_app';

-------------------------------------------------------------------------------
-- 2. Indexes for common access patterns
-------------------------------------------------------------------------------

-- Index for finding all orgs a user can access
CREATE INDEX IF NOT EXISTS idx_user_org_access_user
    ON public.user_org_access (user_id);

-- Index for finding all users with access to an org
CREATE INDEX IF NOT EXISTS idx_user_org_access_org
    ON public.user_org_access (org_id);

-- Index for Temporal workflow: find expiring access (within next 30 days)
CREATE INDEX IF NOT EXISTS idx_user_org_access_expiring
    ON public.user_org_access (access_expiration_date)
    WHERE access_expiration_date IS NOT NULL;

-- Index for Temporal workflow: find users with SMS notifications enabled
CREATE INDEX IF NOT EXISTS idx_user_org_access_sms_enabled
    ON public.user_org_access (user_id)
    WHERE notification_preferences->'sms'->>'enabled' = 'true';

-- Note: Partial index with CURRENT_DATE not possible (not IMMUTABLE)
-- Access validation uses user_has_active_org_access() function instead
-- which performs the date comparison at query time

-------------------------------------------------------------------------------
-- 3. RLS Policies (following user_roles_projection pattern)
-------------------------------------------------------------------------------

ALTER TABLE public.user_org_access ENABLE ROW LEVEL SECURITY;

-- Policy: Super admins can see and manage all user-org access
DROP POLICY IF EXISTS user_org_access_super_admin_all ON public.user_org_access;
CREATE POLICY user_org_access_super_admin_all
    ON public.user_org_access
    FOR ALL
    USING (public.is_super_admin(public.get_current_user_id()));

COMMENT ON POLICY user_org_access_super_admin_all ON public.user_org_access
    IS 'Allows super admins full access to all user-org access records';

-- Policy: Org admins can view/manage access for users in their organization
DROP POLICY IF EXISTS user_org_access_org_admin_all ON public.user_org_access;
CREATE POLICY user_org_access_org_admin_all
    ON public.user_org_access
    FOR ALL
    USING (public.is_org_admin(public.get_current_user_id(), org_id));

COMMENT ON POLICY user_org_access_org_admin_all ON public.user_org_access
    IS 'Allows organization admins to manage user access in their organization';

-- Policy: Users can view their own org access records
DROP POLICY IF EXISTS user_org_access_own_select ON public.user_org_access;
CREATE POLICY user_org_access_own_select
    ON public.user_org_access
    FOR SELECT
    USING (user_id = public.get_current_user_id());

COMMENT ON POLICY user_org_access_own_select ON public.user_org_access
    IS 'Allows users to view their own org access records';

-------------------------------------------------------------------------------
-- 4. Trigger function: Sync accessible_organizations array on users table
-------------------------------------------------------------------------------

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

    -- Update the accessible_organizations array from user_org_access
    UPDATE public.users
    SET
        accessible_organizations = (
            SELECT COALESCE(array_agg(uoa.org_id ORDER BY uoa.created_at), ARRAY[]::uuid[])
            FROM public.user_org_access uoa
            WHERE uoa.user_id = target_user_id
        ),
        updated_at = now()
    WHERE id = target_user_id;

    RETURN COALESCE(NEW, OLD);
END;
$$;

COMMENT ON FUNCTION public.sync_accessible_organizations()
    IS 'Trigger function to keep users.accessible_organizations array in sync with user_org_access junction table';

-- Create trigger (drop first for idempotency)
DROP TRIGGER IF EXISTS trg_sync_accessible_orgs ON public.user_org_access;
CREATE TRIGGER trg_sync_accessible_orgs
    AFTER INSERT OR UPDATE OR DELETE ON public.user_org_access
    FOR EACH ROW
    EXECUTE FUNCTION public.sync_accessible_organizations();

-------------------------------------------------------------------------------
-- 5. Helper function: Check if user has active access to organization
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
        FROM public.user_org_access
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
-- 6. Data migration: Populate from existing accessible_organizations array
-------------------------------------------------------------------------------

-- Insert existing accessible_organizations into junction table
-- This is idempotent due to ON CONFLICT DO NOTHING
INSERT INTO public.user_org_access (user_id, org_id, created_at, updated_at)
SELECT
    u.id AS user_id,
    unnest(u.accessible_organizations) AS org_id,
    u.created_at,
    now()
FROM public.users u
WHERE u.accessible_organizations IS NOT NULL
  AND array_length(u.accessible_organizations, 1) > 0
ON CONFLICT (user_id, org_id) DO NOTHING;
