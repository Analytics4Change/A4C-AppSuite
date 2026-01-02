-- Migration: User phone tables
-- Purpose: User-global phones with optional per-org overrides (hybrid scope)
-- Uses existing phone_type enum: mobile, office, fax, emergency

-------------------------------------------------------------------------------
-- 1. Create user_phones table (user-global phones)
-------------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.user_phones (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL,

    -- Phone details
    label text NOT NULL,
    type public.phone_type NOT NULL,
    number text NOT NULL,
    extension text,
    country_code text DEFAULT '+1' NOT NULL,

    -- Status and capabilities
    is_primary boolean DEFAULT false NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    sms_capable boolean DEFAULT false NOT NULL,  -- Important for SMS notifications

    -- Extensibility
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,

    -- Audit
    created_at timestamptz DEFAULT now() NOT NULL,
    updated_at timestamptz DEFAULT now() NOT NULL,

    -- Foreign key
    CONSTRAINT user_phones_user_id_fkey FOREIGN KEY (user_id)
        REFERENCES public.users(id) ON DELETE CASCADE
);

COMMENT ON TABLE public.user_phones IS 'User-global phone numbers that apply across all organizations unless overridden';
COMMENT ON COLUMN public.user_phones.label IS 'Human-readable label (e.g., "Personal Cell", "Work")';
COMMENT ON COLUMN public.user_phones.type IS 'Phone type: mobile, office, fax, or emergency';
COMMENT ON COLUMN public.user_phones.sms_capable IS 'Whether this phone can receive SMS notifications';
COMMENT ON COLUMN public.user_phones.is_primary IS 'Exactly one primary phone per user (enforced by partial unique index)';

-------------------------------------------------------------------------------
-- 2. Indexes for user_phones
-------------------------------------------------------------------------------

-- Index for finding phones by user
CREATE INDEX IF NOT EXISTS idx_user_phones_user
    ON public.user_phones (user_id)
    WHERE is_active = true;

-- Unique constraint: one primary phone per user
CREATE UNIQUE INDEX IF NOT EXISTS idx_user_phones_one_primary
    ON public.user_phones (user_id)
    WHERE is_primary = true AND is_active = true;

-- Index for phone type queries
CREATE INDEX IF NOT EXISTS idx_user_phones_type
    ON public.user_phones (user_id, type)
    WHERE is_active = true;

-- Index for SMS-capable phones (for notification workflow)
CREATE INDEX IF NOT EXISTS idx_user_phones_sms_capable
    ON public.user_phones (user_id)
    WHERE sms_capable = true AND is_active = true;

-------------------------------------------------------------------------------
-- 3. RLS Policies for user_phones
-------------------------------------------------------------------------------

ALTER TABLE public.user_phones ENABLE ROW LEVEL SECURITY;

-- Super admins can manage all user phones
DROP POLICY IF EXISTS user_phones_super_admin_all ON public.user_phones;
CREATE POLICY user_phones_super_admin_all
    ON public.user_phones
    FOR ALL
    USING (public.is_super_admin(public.get_current_user_id()));

COMMENT ON POLICY user_phones_super_admin_all ON public.user_phones
    IS 'Allows super admins full access to all user phones';

-- Users can view and manage their own phones
DROP POLICY IF EXISTS user_phones_own_all ON public.user_phones;
CREATE POLICY user_phones_own_all
    ON public.user_phones
    FOR ALL
    USING (user_id = public.get_current_user_id());

COMMENT ON POLICY user_phones_own_all ON public.user_phones
    IS 'Allows users to manage their own phones';

-- Org admins can view phones of users in their org (via user_org_access)
DROP POLICY IF EXISTS user_phones_org_admin_select ON public.user_phones;
CREATE POLICY user_phones_org_admin_select
    ON public.user_phones
    FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM public.user_org_access uoa
            WHERE uoa.user_id = user_phones.user_id
              AND public.is_org_admin(public.get_current_user_id(), uoa.org_id)
        )
    );

COMMENT ON POLICY user_phones_org_admin_select ON public.user_phones
    IS 'Allows org admins to view phones of users in their organization';

-------------------------------------------------------------------------------
-- 4. Create user_org_phone_overrides table (per-org phone overrides)
-------------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.user_org_phone_overrides (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL,
    org_id uuid NOT NULL,

    -- Phone details (same structure as user_phones)
    label text NOT NULL,
    type public.phone_type NOT NULL,
    number text NOT NULL,
    extension text,
    country_code text DEFAULT '+1' NOT NULL,

    -- Status (no is_primary - org overrides don't have primary concept)
    is_active boolean DEFAULT true NOT NULL,
    sms_capable boolean DEFAULT false NOT NULL,

    -- Extensibility
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,

    -- Audit
    created_at timestamptz DEFAULT now() NOT NULL,
    updated_at timestamptz DEFAULT now() NOT NULL,

    -- Foreign key to user_org_access (ensures user has access to org)
    CONSTRAINT user_org_phone_overrides_user_org_fkey
        FOREIGN KEY (user_id, org_id)
        REFERENCES public.user_org_access(user_id, org_id) ON DELETE CASCADE
);

COMMENT ON TABLE public.user_org_phone_overrides IS 'Per-organization phone overrides when user needs different phone for specific org';
COMMENT ON COLUMN public.user_org_phone_overrides.org_id IS 'Organization this phone override applies to';

-------------------------------------------------------------------------------
-- 5. Indexes for user_org_phone_overrides
-------------------------------------------------------------------------------

-- Index for looking up overrides by user and org
CREATE INDEX IF NOT EXISTS idx_user_org_phone_overrides_lookup
    ON public.user_org_phone_overrides (user_id, org_id)
    WHERE is_active = true;

-- Index for finding all overrides for a user
CREATE INDEX IF NOT EXISTS idx_user_org_phone_overrides_user
    ON public.user_org_phone_overrides (user_id)
    WHERE is_active = true;

-- Index for SMS-capable override phones
CREATE INDEX IF NOT EXISTS idx_user_org_phone_overrides_sms
    ON public.user_org_phone_overrides (user_id, org_id)
    WHERE sms_capable = true AND is_active = true;

-------------------------------------------------------------------------------
-- 6. RLS Policies for user_org_phone_overrides
-------------------------------------------------------------------------------

ALTER TABLE public.user_org_phone_overrides ENABLE ROW LEVEL SECURITY;

-- Super admins can manage all phone overrides
DROP POLICY IF EXISTS user_org_phone_overrides_super_admin_all ON public.user_org_phone_overrides;
CREATE POLICY user_org_phone_overrides_super_admin_all
    ON public.user_org_phone_overrides
    FOR ALL
    USING (public.is_super_admin(public.get_current_user_id()));

COMMENT ON POLICY user_org_phone_overrides_super_admin_all ON public.user_org_phone_overrides
    IS 'Allows super admins full access to all phone overrides';

-- Users can manage their own phone overrides
DROP POLICY IF EXISTS user_org_phone_overrides_own_all ON public.user_org_phone_overrides;
CREATE POLICY user_org_phone_overrides_own_all
    ON public.user_org_phone_overrides
    FOR ALL
    USING (user_id = public.get_current_user_id());

COMMENT ON POLICY user_org_phone_overrides_own_all ON public.user_org_phone_overrides
    IS 'Allows users to manage their own phone overrides';

-- Org admins can manage phone overrides for their org
DROP POLICY IF EXISTS user_org_phone_overrides_org_admin_all ON public.user_org_phone_overrides;
CREATE POLICY user_org_phone_overrides_org_admin_all
    ON public.user_org_phone_overrides
    FOR ALL
    USING (public.is_org_admin(public.get_current_user_id(), org_id));

COMMENT ON POLICY user_org_phone_overrides_org_admin_all ON public.user_org_phone_overrides
    IS 'Allows org admins to manage phone overrides in their organization';

-------------------------------------------------------------------------------
-- 7. Helper function: Get effective phone for user in org context
-------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.get_user_effective_phone(
    p_user_id uuid,
    p_org_id uuid,
    p_phone_type public.phone_type DEFAULT 'mobile'::public.phone_type
)
RETURNS TABLE (
    id uuid,
    label text,
    type public.phone_type,
    number text,
    extension text,
    country_code text,
    sms_capable boolean,
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
        po.id,
        po.label,
        po.type,
        po.number,
        po.extension,
        po.country_code,
        po.sms_capable,
        true AS is_override
    FROM public.user_org_phone_overrides po
    WHERE po.user_id = p_user_id
      AND po.org_id = p_org_id
      AND po.type = p_phone_type
      AND po.is_active = true
    LIMIT 1;

    -- If no override found, return global phone
    IF NOT FOUND THEN
        RETURN QUERY
        SELECT
            up.id,
            up.label,
            up.type,
            up.number,
            up.extension,
            up.country_code,
            up.sms_capable,
            false AS is_override
        FROM public.user_phones up
        WHERE up.user_id = p_user_id
          AND up.type = p_phone_type
          AND up.is_active = true
        ORDER BY up.is_primary DESC
        LIMIT 1;
    END IF;
END;
$$;

COMMENT ON FUNCTION public.get_user_effective_phone(uuid, uuid, public.phone_type)
    IS 'Get effective phone for user in org context, checking override first then falling back to global';

-------------------------------------------------------------------------------
-- 8. Helper function: Get SMS-capable phone for notifications
-------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.get_user_sms_phone(
    p_user_id uuid,
    p_org_id uuid
)
RETURNS TABLE (
    id uuid,
    number text,
    country_code text,
    is_override boolean
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    -- Try org-specific SMS-capable override first
    RETURN QUERY
    SELECT
        po.id,
        po.number,
        po.country_code,
        true AS is_override
    FROM public.user_org_phone_overrides po
    WHERE po.user_id = p_user_id
      AND po.org_id = p_org_id
      AND po.sms_capable = true
      AND po.is_active = true
    LIMIT 1;

    -- If no override found, return global SMS-capable phone
    IF NOT FOUND THEN
        RETURN QUERY
        SELECT
            up.id,
            up.number,
            up.country_code,
            false AS is_override
        FROM public.user_phones up
        WHERE up.user_id = p_user_id
          AND up.sms_capable = true
          AND up.is_active = true
        ORDER BY up.is_primary DESC, up.type = 'mobile' DESC
        LIMIT 1;
    END IF;
END;
$$;

COMMENT ON FUNCTION public.get_user_sms_phone(uuid, uuid)
    IS 'Get SMS-capable phone for user in org context, for notification delivery';
