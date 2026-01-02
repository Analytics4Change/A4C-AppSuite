-- Migration: User address tables
-- Purpose: User-global addresses with optional per-org overrides (hybrid scope)
-- Uses existing address_type enum: physical, mailing, billing

-------------------------------------------------------------------------------
-- 1. Create user_addresses table (user-global addresses)
-------------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.user_addresses (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL,

    -- Address details
    label text NOT NULL,
    type public.address_type NOT NULL,
    street1 text NOT NULL,
    street2 text,
    city text NOT NULL,
    state text NOT NULL,
    zip_code text NOT NULL,
    country text DEFAULT 'USA' NOT NULL,

    -- Status
    is_primary boolean DEFAULT false NOT NULL,
    is_active boolean DEFAULT true NOT NULL,

    -- Extensibility
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,

    -- Audit
    created_at timestamptz DEFAULT now() NOT NULL,
    updated_at timestamptz DEFAULT now() NOT NULL,

    -- Foreign key
    CONSTRAINT user_addresses_user_id_fkey FOREIGN KEY (user_id)
        REFERENCES public.users(id) ON DELETE CASCADE
);

COMMENT ON TABLE public.user_addresses IS 'User-global addresses that apply across all organizations unless overridden';
COMMENT ON COLUMN public.user_addresses.label IS 'Human-readable label (e.g., "Home", "Work")';
COMMENT ON COLUMN public.user_addresses.type IS 'Address type: physical, mailing, or billing';
COMMENT ON COLUMN public.user_addresses.is_primary IS 'Exactly one primary address per user (enforced by partial unique index)';
COMMENT ON COLUMN public.user_addresses.metadata IS 'Additional data: verified flag, coordinates, notes';

-------------------------------------------------------------------------------
-- 2. Indexes for user_addresses
-------------------------------------------------------------------------------

-- Index for finding addresses by user
CREATE INDEX IF NOT EXISTS idx_user_addresses_user
    ON public.user_addresses (user_id)
    WHERE is_active = true;

-- Unique constraint: one primary address per user
CREATE UNIQUE INDEX IF NOT EXISTS idx_user_addresses_one_primary
    ON public.user_addresses (user_id)
    WHERE is_primary = true AND is_active = true;

-- Index for address type queries
CREATE INDEX IF NOT EXISTS idx_user_addresses_type
    ON public.user_addresses (user_id, type)
    WHERE is_active = true;

-------------------------------------------------------------------------------
-- 3. RLS Policies for user_addresses
-------------------------------------------------------------------------------

ALTER TABLE public.user_addresses ENABLE ROW LEVEL SECURITY;

-- Super admins can manage all user addresses
DROP POLICY IF EXISTS user_addresses_super_admin_all ON public.user_addresses;
CREATE POLICY user_addresses_super_admin_all
    ON public.user_addresses
    FOR ALL
    USING (public.is_super_admin(public.get_current_user_id()));

COMMENT ON POLICY user_addresses_super_admin_all ON public.user_addresses
    IS 'Allows super admins full access to all user addresses';

-- Users can view and manage their own addresses
DROP POLICY IF EXISTS user_addresses_own_all ON public.user_addresses;
CREATE POLICY user_addresses_own_all
    ON public.user_addresses
    FOR ALL
    USING (user_id = public.get_current_user_id());

COMMENT ON POLICY user_addresses_own_all ON public.user_addresses
    IS 'Allows users to manage their own addresses';

-- Org admins can view addresses of users in their org (via user_org_access)
DROP POLICY IF EXISTS user_addresses_org_admin_select ON public.user_addresses;
CREATE POLICY user_addresses_org_admin_select
    ON public.user_addresses
    FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM public.user_org_access uoa
            WHERE uoa.user_id = user_addresses.user_id
              AND public.is_org_admin(public.get_current_user_id(), uoa.org_id)
        )
    );

COMMENT ON POLICY user_addresses_org_admin_select ON public.user_addresses
    IS 'Allows org admins to view addresses of users in their organization';

-------------------------------------------------------------------------------
-- 4. Create user_org_address_overrides table (per-org address overrides)
-------------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.user_org_address_overrides (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL,
    org_id uuid NOT NULL,

    -- Address details (same structure as user_addresses)
    label text NOT NULL,
    type public.address_type NOT NULL,
    street1 text NOT NULL,
    street2 text,
    city text NOT NULL,
    state text NOT NULL,
    zip_code text NOT NULL,
    country text DEFAULT 'USA' NOT NULL,

    -- Status (no is_primary - org overrides don't have primary concept)
    is_active boolean DEFAULT true NOT NULL,

    -- Extensibility
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,

    -- Audit
    created_at timestamptz DEFAULT now() NOT NULL,
    updated_at timestamptz DEFAULT now() NOT NULL,

    -- Foreign key to user_org_access (ensures user has access to org)
    CONSTRAINT user_org_address_overrides_user_org_fkey
        FOREIGN KEY (user_id, org_id)
        REFERENCES public.user_org_access(user_id, org_id) ON DELETE CASCADE
);

COMMENT ON TABLE public.user_org_address_overrides IS 'Per-organization address overrides when user needs different address for specific org';
COMMENT ON COLUMN public.user_org_address_overrides.org_id IS 'Organization this address override applies to';

-------------------------------------------------------------------------------
-- 5. Indexes for user_org_address_overrides
-------------------------------------------------------------------------------

-- Index for looking up overrides by user and org
CREATE INDEX IF NOT EXISTS idx_user_org_address_overrides_lookup
    ON public.user_org_address_overrides (user_id, org_id)
    WHERE is_active = true;

-- Index for finding all overrides for a user
CREATE INDEX IF NOT EXISTS idx_user_org_address_overrides_user
    ON public.user_org_address_overrides (user_id)
    WHERE is_active = true;

-------------------------------------------------------------------------------
-- 6. RLS Policies for user_org_address_overrides
-------------------------------------------------------------------------------

ALTER TABLE public.user_org_address_overrides ENABLE ROW LEVEL SECURITY;

-- Super admins can manage all address overrides
DROP POLICY IF EXISTS user_org_address_overrides_super_admin_all ON public.user_org_address_overrides;
CREATE POLICY user_org_address_overrides_super_admin_all
    ON public.user_org_address_overrides
    FOR ALL
    USING (public.is_super_admin(public.get_current_user_id()));

COMMENT ON POLICY user_org_address_overrides_super_admin_all ON public.user_org_address_overrides
    IS 'Allows super admins full access to all address overrides';

-- Users can manage their own address overrides
DROP POLICY IF EXISTS user_org_address_overrides_own_all ON public.user_org_address_overrides;
CREATE POLICY user_org_address_overrides_own_all
    ON public.user_org_address_overrides
    FOR ALL
    USING (user_id = public.get_current_user_id());

COMMENT ON POLICY user_org_address_overrides_own_all ON public.user_org_address_overrides
    IS 'Allows users to manage their own address overrides';

-- Org admins can manage address overrides for their org
DROP POLICY IF EXISTS user_org_address_overrides_org_admin_all ON public.user_org_address_overrides;
CREATE POLICY user_org_address_overrides_org_admin_all
    ON public.user_org_address_overrides
    FOR ALL
    USING (public.is_org_admin(public.get_current_user_id(), org_id));

COMMENT ON POLICY user_org_address_overrides_org_admin_all ON public.user_org_address_overrides
    IS 'Allows org admins to manage address overrides in their organization';

-------------------------------------------------------------------------------
-- 7. Helper function: Get effective address for user in org context
-------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.get_user_effective_address(
    p_user_id uuid,
    p_org_id uuid,
    p_address_type public.address_type DEFAULT 'physical'::public.address_type
)
RETURNS TABLE (
    id uuid,
    label text,
    type public.address_type,
    street1 text,
    street2 text,
    city text,
    state text,
    zip_code text,
    country text,
    is_override boolean
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    -- Try org-specific override first
    RETURN QUERY
    SELECT
        ao.id,
        ao.label,
        ao.type,
        ao.street1,
        ao.street2,
        ao.city,
        ao.state,
        ao.zip_code,
        ao.country,
        true AS is_override
    FROM public.user_org_address_overrides ao
    WHERE ao.user_id = p_user_id
      AND ao.org_id = p_org_id
      AND ao.type = p_address_type
      AND ao.is_active = true
    LIMIT 1;

    -- If no override found, return global address
    IF NOT FOUND THEN
        RETURN QUERY
        SELECT
            ua.id,
            ua.label,
            ua.type,
            ua.street1,
            ua.street2,
            ua.city,
            ua.state,
            ua.zip_code,
            ua.country,
            false AS is_override
        FROM public.user_addresses ua
        WHERE ua.user_id = p_user_id
          AND ua.type = p_address_type
          AND ua.is_active = true
        ORDER BY ua.is_primary DESC
        LIMIT 1;
    END IF;
END;
$$;

COMMENT ON FUNCTION public.get_user_effective_address(uuid, uuid, public.address_type)
    IS 'Get effective address for user in org context, checking override first then falling back to global';
