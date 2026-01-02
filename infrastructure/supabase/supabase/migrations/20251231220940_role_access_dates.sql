-- Migration: Add role-level access dates to user_roles_projection
-- Purpose: Allow per-role validity periods (e.g., temporary admin access)
-- Works with user_org_access: Effective access = user-level window ∩ role-level windows

-------------------------------------------------------------------------------
-- 1. Add columns to user_roles_projection
-------------------------------------------------------------------------------

-- Add role_valid_from column (NULL = role active immediately)
ALTER TABLE public.user_roles_projection
    ADD COLUMN IF NOT EXISTS role_valid_from date DEFAULT NULL;

COMMENT ON COLUMN public.user_roles_projection.role_valid_from
    IS 'First date this role assignment is active (NULL = immediate)';

-- Add role_valid_until column (NULL = role never expires)
ALTER TABLE public.user_roles_projection
    ADD COLUMN IF NOT EXISTS role_valid_until date DEFAULT NULL;

COMMENT ON COLUMN public.user_roles_projection.role_valid_until
    IS 'Last date this role assignment is active (NULL = no expiration)';

-------------------------------------------------------------------------------
-- 2. Add constraint: valid_from must be before valid_until
-------------------------------------------------------------------------------

-- Drop constraint if exists for idempotency, then recreate
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'user_roles_date_order_check'
        AND conrelid = 'public.user_roles_projection'::regclass
    ) THEN
        ALTER TABLE public.user_roles_projection
            DROP CONSTRAINT user_roles_date_order_check;
    END IF;
END $$;

ALTER TABLE public.user_roles_projection
    ADD CONSTRAINT user_roles_date_order_check CHECK (
        role_valid_from IS NULL
        OR role_valid_until IS NULL
        OR role_valid_from <= role_valid_until
    );

-------------------------------------------------------------------------------
-- 3. Indexes for Temporal workflow queries
-------------------------------------------------------------------------------

-- Index for finding roles expiring within next N days
CREATE INDEX IF NOT EXISTS idx_user_roles_expiring
    ON public.user_roles_projection (role_valid_until)
    WHERE role_valid_until IS NOT NULL;

-- Note: Partial indexes with CURRENT_DATE not possible (not IMMUTABLE)
-- Date filtering is done at query time via get_user_active_roles() function

-- Index for roles with future start dates (for notification queries)
CREATE INDEX IF NOT EXISTS idx_user_roles_pending_start
    ON public.user_roles_projection (role_valid_from)
    WHERE role_valid_from IS NOT NULL;

-------------------------------------------------------------------------------
-- 4. Helper function: Check if role assignment is currently active
-------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.is_role_active(
    p_role_valid_from date,
    p_role_valid_until date
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
AS $$
BEGIN
    RETURN (p_role_valid_from IS NULL OR p_role_valid_from <= CURRENT_DATE)
       AND (p_role_valid_until IS NULL OR p_role_valid_until >= CURRENT_DATE);
END;
$$;

COMMENT ON FUNCTION public.is_role_active(date, date)
    IS 'Check if a role assignment is currently active based on valid_from and valid_until dates';

-------------------------------------------------------------------------------
-- 5. Helper function: Get user''s active roles (respecting both org and role dates)
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
    LEFT JOIN public.user_org_access uoa
        ON uoa.user_id = ur.user_id
        AND uoa.org_id = ur.organization_id
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
              (uoa.access_start_date IS NULL OR uoa.access_start_date <= CURRENT_DATE)
              AND (uoa.access_expiration_date IS NULL OR uoa.access_expiration_date >= CURRENT_DATE)
          )
      );
END;
$$;

COMMENT ON FUNCTION public.get_user_active_roles(uuid, uuid)
    IS 'Get user''s active roles, respecting both org-level and role-level access dates';
