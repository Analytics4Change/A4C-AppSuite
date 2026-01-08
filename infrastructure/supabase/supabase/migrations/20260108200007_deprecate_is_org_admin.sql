-- Migration: Deprecate is_org_admin() and migrate RLS to JWT-claims pattern
--
-- This migration:
-- 1. Adds missing FK from user_roles_projection.user_id to users(id) (fixes PostgREST 406)
-- 2. Creates has_org_admin_permission() JWT-claims helper function
-- 3. Migrates all RLS policies from is_org_admin() to JWT-claims pattern
-- 4. Updates RPC functions that used is_org_admin()
-- 5. Drops deprecated is_org_admin() function
--
-- Per RBAC architecture (Section F), JWT-claims-based checks are preferred over
-- database-querying functions for RLS policies.

-- ============================================================================
-- PHASE 1: Add missing FK constraint (fixes PostgREST 406 error)
-- ============================================================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'user_roles_projection_user_id_fkey'
  ) THEN
    ALTER TABLE user_roles_projection
    ADD CONSTRAINT user_roles_projection_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;
    RAISE NOTICE 'Added FK constraint user_roles_projection_user_id_fkey';
  ELSE
    RAISE NOTICE 'FK constraint user_roles_projection_user_id_fkey already exists';
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_user_roles_projection_user_id ON user_roles_projection(user_id);

-- ============================================================================
-- PHASE 2: Create JWT-claims helper function
-- ============================================================================

CREATE OR REPLACE FUNCTION public.has_org_admin_permission()
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  -- Check if user has org admin permission via JWT claims
  -- This replaces is_org_admin() which queried the database
  SELECT
    -- Check user_role claim for admin roles
    (current_setting('request.jwt.claims', true)::jsonb->>'user_role')
      IN ('provider_admin', 'partner_admin', 'super_admin')
    -- OR check permissions array for admin-level permissions
    OR EXISTS (
      SELECT 1
      FROM jsonb_array_elements_text(
        COALESCE((current_setting('request.jwt.claims', true)::jsonb)->'permissions', '[]'::jsonb)
      ) AS perm
      WHERE perm IN ('user.manage', 'user.role_assign', 'organization.manage')
    );
$$;

COMMENT ON FUNCTION public.has_org_admin_permission() IS
'JWT-claims-based check for org admin privileges. Replaces is_org_admin() which queried the database.
Returns true if user has provider_admin, partner_admin, or super_admin role, or has admin-level permissions.';

-- ============================================================================
-- PHASE 3: Migrate RLS policies from is_org_admin() to JWT-claims pattern
-- ============================================================================

-- addresses_projection
DROP POLICY IF EXISTS "addresses_org_admin_select" ON public.addresses_projection;
CREATE POLICY "addresses_org_admin_select" ON public.addresses_projection
  FOR SELECT
  USING (
    has_org_admin_permission() AND organization_id = get_current_org_id() AND deleted_at IS NULL
  );
COMMENT ON POLICY "addresses_org_admin_select" ON public.addresses_projection IS
  'Allows org admins to view addresses in their organization';

-- organization_business_profiles_projection
DROP POLICY IF EXISTS "business_profiles_org_admin_select" ON public.organization_business_profiles_projection;
CREATE POLICY "business_profiles_org_admin_select" ON public.organization_business_profiles_projection
  FOR SELECT
  USING (
    has_org_admin_permission() AND organization_id = get_current_org_id()
  );
COMMENT ON POLICY "business_profiles_org_admin_select" ON public.organization_business_profiles_projection IS
  'Allows org admins to view business profiles in their organization';

-- clients (INSERT policy)
DROP POLICY IF EXISTS "clients_insert" ON public.clients;
CREATE POLICY "clients_insert" ON public.clients FOR INSERT
  WITH CHECK (
    has_platform_privilege()
    OR (has_org_admin_permission() AND organization_id = get_current_org_id())
    OR user_has_permission(get_current_user_id(), 'clients.create', organization_id)
  );
COMMENT ON POLICY "clients_insert" ON public.clients IS
  'Allows organization admins and authorized users to create client records';

-- contact_addresses (org admin select - through contact)
DROP POLICY IF EXISTS "contact_addresses_org_admin_select" ON public.contact_addresses;
CREATE POLICY "contact_addresses_org_admin_select" ON public.contact_addresses
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM contacts_projection c
      WHERE c.id = contact_addresses.contact_id
        AND has_org_admin_permission()
        AND c.organization_id = get_current_org_id()
        AND c.deleted_at IS NULL
    )
    AND EXISTS (
      SELECT 1 FROM addresses_projection a
      WHERE a.id = contact_addresses.address_id
        AND a.deleted_at IS NULL
    )
  );
COMMENT ON POLICY "contact_addresses_org_admin_select" ON public.contact_addresses IS
  'Allows org admins to view contact-address links in their organization';

-- contact_phones (org admin select - through contact)
DROP POLICY IF EXISTS "contact_phones_org_admin_select" ON public.contact_phones;
CREATE POLICY "contact_phones_org_admin_select" ON public.contact_phones
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM contacts_projection c
      WHERE c.id = contact_phones.contact_id
        AND has_org_admin_permission()
        AND c.organization_id = get_current_org_id()
        AND c.deleted_at IS NULL
    )
    AND EXISTS (
      SELECT 1 FROM phones_projection p
      WHERE p.id = contact_phones.phone_id
        AND p.deleted_at IS NULL
    )
  );
COMMENT ON POLICY "contact_phones_org_admin_select" ON public.contact_phones IS
  'Allows org admins to view contact-phone links in their organization';

-- contacts_projection
DROP POLICY IF EXISTS "contacts_org_admin_select" ON public.contacts_projection;
CREATE POLICY "contacts_org_admin_select" ON public.contacts_projection
  FOR SELECT
  USING (
    has_org_admin_permission() AND organization_id = get_current_org_id() AND deleted_at IS NULL
  );
COMMENT ON POLICY "contacts_org_admin_select" ON public.contacts_projection IS
  'Allows org admins to view contacts in their organization';

-- cross_tenant_access_grants_projection (special: check either org)
DROP POLICY IF EXISTS "cross_tenant_grants_org_admin_select" ON public.cross_tenant_access_grants_projection;
CREATE POLICY "cross_tenant_grants_org_admin_select" ON public.cross_tenant_access_grants_projection
  FOR SELECT
  USING (
    has_org_admin_permission() AND (
      consultant_org_id = get_current_org_id()
      OR provider_org_id = get_current_org_id()
    )
  );
COMMENT ON POLICY "cross_tenant_grants_org_admin_select" ON public.cross_tenant_access_grants_projection IS
  'Allows org admins to view cross-tenant grants where their org is involved';

-- invitations_projection
DROP POLICY IF EXISTS "invitations_org_admin_select" ON public.invitations_projection;
CREATE POLICY "invitations_org_admin_select" ON public.invitations_projection
  FOR SELECT
  USING (
    has_org_admin_permission() AND organization_id = get_current_org_id()
  );
COMMENT ON POLICY "invitations_org_admin_select" ON public.invitations_projection IS
  'Allows org admins to view invitations in their organization';

-- medications (INSERT policy)
DROP POLICY IF EXISTS "medications_insert" ON public.medications;
CREATE POLICY "medications_insert" ON public.medications FOR INSERT
  WITH CHECK (
    has_platform_privilege()
    OR (
      organization_id = get_current_org_id()
      AND (
        has_org_admin_permission()
        OR user_has_permission(get_current_user_id(), 'medications.manage', organization_id)
      )
    )
  );
COMMENT ON POLICY "medications_insert" ON public.medications IS
  'Allows organization admins and pharmacy staff to add medications to formulary';

-- organization_addresses
DROP POLICY IF EXISTS "org_addresses_org_admin_select" ON public.organization_addresses;
CREATE POLICY "org_addresses_org_admin_select" ON public.organization_addresses
  FOR SELECT
  USING (
    has_org_admin_permission() AND organization_id = get_current_org_id()
    AND EXISTS (
      SELECT 1 FROM organizations_projection o
      WHERE o.id = organization_addresses.organization_id
        AND o.deleted_at IS NULL
    )
  );
COMMENT ON POLICY "org_addresses_org_admin_select" ON public.organization_addresses IS
  'Allows org admins to view organization addresses';

-- organization_contacts
DROP POLICY IF EXISTS "org_contacts_org_admin_select" ON public.organization_contacts;
CREATE POLICY "org_contacts_org_admin_select" ON public.organization_contacts
  FOR SELECT
  USING (
    has_org_admin_permission() AND organization_id = get_current_org_id()
    AND EXISTS (
      SELECT 1 FROM organizations_projection o
      WHERE o.id = organization_contacts.organization_id
        AND o.deleted_at IS NULL
    )
  );
COMMENT ON POLICY "org_contacts_org_admin_select" ON public.organization_contacts IS
  'Allows org admins to view organization contacts';

-- organization_phones
DROP POLICY IF EXISTS "org_phones_org_admin_select" ON public.organization_phones;
CREATE POLICY "org_phones_org_admin_select" ON public.organization_phones
  FOR SELECT
  USING (
    has_org_admin_permission() AND organization_id = get_current_org_id()
    AND EXISTS (
      SELECT 1 FROM organizations_projection o
      WHERE o.id = organization_phones.organization_id
        AND o.deleted_at IS NULL
    )
  );
COMMENT ON POLICY "org_phones_org_admin_select" ON public.organization_phones IS
  'Allows org admins to view organization phones';

-- organizations_projection
DROP POLICY IF EXISTS "organizations_org_admin_select" ON public.organizations_projection;
CREATE POLICY "organizations_org_admin_select" ON public.organizations_projection
  FOR SELECT
  USING (
    has_org_admin_permission() AND id = get_current_org_id()
  );
COMMENT ON POLICY "organizations_org_admin_select" ON public.organizations_projection IS
  'Allows org admins to view their own organization';

-- organization_units_projection
DROP POLICY IF EXISTS "ou_org_admin_select" ON public.organization_units_projection;
CREATE POLICY "ou_org_admin_select" ON public.organization_units_projection
  FOR SELECT
  USING (
    organization_id IS NOT NULL
    AND has_org_admin_permission()
    AND organization_id = get_current_org_id()
  );
COMMENT ON POLICY "ou_org_admin_select" ON public.organization_units_projection IS
  'Allows org admins to view organization units in their organization';

-- phone_addresses (org admin select - through phone)
DROP POLICY IF EXISTS "phone_addresses_org_admin_select" ON public.phone_addresses;
CREATE POLICY "phone_addresses_org_admin_select" ON public.phone_addresses
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM phones_projection p
      WHERE p.id = phone_addresses.phone_id
        AND has_org_admin_permission()
        AND p.organization_id = get_current_org_id()
        AND p.deleted_at IS NULL
    )
    AND EXISTS (
      SELECT 1 FROM addresses_projection a
      WHERE a.id = phone_addresses.address_id
        AND a.deleted_at IS NULL
    )
  );
COMMENT ON POLICY "phone_addresses_org_admin_select" ON public.phone_addresses IS
  'Allows org admins to view phone-address links in their organization';

-- phones_projection
DROP POLICY IF EXISTS "phones_org_admin_select" ON public.phones_projection;
CREATE POLICY "phones_org_admin_select" ON public.phones_projection
  FOR SELECT
  USING (
    has_org_admin_permission() AND organization_id = get_current_org_id() AND deleted_at IS NULL
  );
COMMENT ON POLICY "phones_org_admin_select" ON public.phones_projection IS
  'Allows org admins to view phones in their organization';

-- role_permissions_projection (through roles)
DROP POLICY IF EXISTS "role_permissions_org_admin_select" ON public.role_permissions_projection;
CREATE POLICY "role_permissions_org_admin_select" ON public.role_permissions_projection
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM roles_projection r
      WHERE r.id = role_permissions_projection.role_id
        AND r.organization_id IS NOT NULL
        AND has_org_admin_permission()
        AND r.organization_id = get_current_org_id()
    )
  );
COMMENT ON POLICY "role_permissions_org_admin_select" ON public.role_permissions_projection IS
  'Allows org admins to view role-permission grants for roles in their organization';

-- roles_projection
DROP POLICY IF EXISTS "roles_org_admin_select" ON public.roles_projection;
CREATE POLICY "roles_org_admin_select" ON public.roles_projection
  FOR SELECT
  USING (
    organization_id IS NOT NULL
    AND has_org_admin_permission()
    AND organization_id = get_current_org_id()
  );
COMMENT ON POLICY "roles_org_admin_select" ON public.roles_projection IS
  'Allows org admins to view roles in their organization';

-- user_roles_projection
DROP POLICY IF EXISTS "user_roles_org_admin_select" ON public.user_roles_projection;
CREATE POLICY "user_roles_org_admin_select" ON public.user_roles_projection
  FOR SELECT
  USING (
    organization_id IS NOT NULL
    AND has_org_admin_permission()
    AND organization_id = get_current_org_id()
  );
COMMENT ON POLICY "user_roles_org_admin_select" ON public.user_roles_projection IS
  'Allows org admins to view user-role assignments in their organization';

-- users (org admin select through user_roles)
DROP POLICY IF EXISTS "users_org_admin_select" ON public.users;
CREATE POLICY "users_org_admin_select" ON public.users
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM user_roles_projection ur
      WHERE ur.user_id = users.id
        AND has_org_admin_permission()
        AND ur.organization_id = get_current_org_id()
    )
  );
COMMENT ON POLICY "users_org_admin_select" ON public.users IS
  'Allows org admins to view users with roles in their organization';

-- user_organizations_projection (from 20251231220745 and 20260105162527)
DROP POLICY IF EXISTS "user_org_access_org_admin_select" ON public.user_organizations_projection;
CREATE POLICY "user_org_access_org_admin_select" ON public.user_organizations_projection
  FOR SELECT
  USING (
    has_org_admin_permission() AND org_id = get_current_org_id()
  );
COMMENT ON POLICY "user_org_access_org_admin_select" ON public.user_organizations_projection IS
  'Allows org admins to view user-organization memberships in their organization';

-- user_addresses (from 20251231221028)
DROP POLICY IF EXISTS "user_addresses_org_admin_select" ON public.user_addresses;
CREATE POLICY "user_addresses_org_admin_select" ON public.user_addresses
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM user_organizations_projection uoa
      WHERE uoa.user_id = user_addresses.user_id
        AND has_org_admin_permission()
        AND uoa.org_id = get_current_org_id()
    )
  );
COMMENT ON POLICY "user_addresses_org_admin_select" ON public.user_addresses IS
  'Allows org admins to view user addresses for users in their organization';

-- user_phones (from 20251231221144)
DROP POLICY IF EXISTS "user_phones_org_admin_select" ON public.user_phones;
CREATE POLICY "user_phones_org_admin_select" ON public.user_phones
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM user_organizations_projection uoa
      WHERE uoa.user_id = user_phones.user_id
        AND has_org_admin_permission()
        AND uoa.org_id = get_current_org_id()
    )
  );
COMMENT ON POLICY "user_phones_org_admin_select" ON public.user_phones IS
  'Allows org admins to view user phones for users in their organization';

-- ============================================================================
-- PHASE 4: Update RPC functions that used is_org_admin()
-- ============================================================================

-- api.list_user_organizations - update to use JWT claims
CREATE OR REPLACE FUNCTION api.list_user_organizations(
  p_user_id UUID DEFAULT NULL,
  p_org_id UUID DEFAULT NULL
)
RETURNS TABLE (
  user_id UUID,
  org_id UUID,
  organization_name TEXT,
  is_primary BOOLEAN,
  joined_at TIMESTAMPTZ
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_current_user_id UUID;
  v_current_org_id UUID;
  v_has_platform_privilege BOOLEAN;
  v_has_org_admin_permission BOOLEAN;
BEGIN
  -- Get current user context (called ONCE, not per row)
  v_current_user_id := public.get_current_user_id();
  v_current_org_id := public.get_current_org_id();
  v_has_platform_privilege := public.has_platform_privilege();
  v_has_org_admin_permission := public.has_org_admin_permission();

  RETURN QUERY
  SELECT
    uop.user_id,
    uop.org_id,
    op.name AS organization_name,
    uop.is_primary,
    uop.joined_at
  FROM user_organizations_projection uop
  JOIN organizations_projection op ON op.id = uop.org_id
  WHERE
    -- Filter by user_id if specified
    (p_user_id IS NULL OR uop.user_id = p_user_id)
    -- Filter by org_id if specified
    AND (p_org_id IS NULL OR uop.org_id = p_org_id)
    -- Authorization: platform admin sees all, org admin sees their org, users see their own
    AND (
      v_has_platform_privilege
      OR (v_has_org_admin_permission AND uop.org_id = v_current_org_id)
      OR uop.user_id = v_current_user_id
    )
  ORDER BY uop.is_primary DESC, op.name;
END;
$$;

COMMENT ON FUNCTION api.list_user_organizations(UUID, UUID) IS
'Lists user-organization memberships. Platform admins see all, org admins see their org, users see their own.';

-- api.get_user_addresses_for_org - update to use JWT claims
CREATE OR REPLACE FUNCTION api.get_user_addresses_for_org(
  p_user_id UUID,
  p_org_id UUID
)
RETURNS TABLE (
  address_id UUID,
  address_type VARCHAR,
  street_line1 VARCHAR,
  street_line2 VARCHAR,
  city VARCHAR,
  state_province VARCHAR,
  postal_code VARCHAR,
  country VARCHAR,
  is_primary BOOLEAN,
  is_verified BOOLEAN,
  created_at TIMESTAMPTZ
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_current_user_id UUID;
  v_current_org_id UUID;
  v_has_platform_privilege BOOLEAN;
  v_has_org_admin_permission BOOLEAN;
BEGIN
  -- Get current user context
  v_current_user_id := public.get_current_user_id();
  v_current_org_id := public.get_current_org_id();
  v_has_platform_privilege := public.has_platform_privilege();
  v_has_org_admin_permission := public.has_org_admin_permission();

  -- Authorization check
  IF NOT (
    v_has_platform_privilege
    OR (v_has_org_admin_permission AND p_org_id = v_current_org_id)
    OR p_user_id = v_current_user_id
  ) THEN
    RAISE EXCEPTION 'Access denied: insufficient permissions';
  END IF;

  RETURN QUERY
  SELECT
    ua.address_id,
    ua.address_type,
    ua.street_line1,
    ua.street_line2,
    ua.city,
    ua.state_province,
    ua.postal_code,
    ua.country,
    ua.is_primary,
    ua.is_verified,
    ua.created_at
  FROM user_addresses ua
  WHERE ua.user_id = p_user_id
    AND EXISTS (
      SELECT 1 FROM user_organizations_projection uop
      WHERE uop.user_id = p_user_id AND uop.org_id = p_org_id
    )
  ORDER BY ua.is_primary DESC, ua.created_at DESC;
END;
$$;

COMMENT ON FUNCTION api.get_user_addresses_for_org(UUID, UUID) IS
'Gets addresses for a user within an organization context. Platform admins see all, org admins see their org users, users see their own.';

-- api.get_user_phones_for_org - update to use JWT claims
CREATE OR REPLACE FUNCTION api.get_user_phones_for_org(
  p_user_id UUID,
  p_org_id UUID
)
RETURNS TABLE (
  phone_id UUID,
  phone_type VARCHAR,
  phone_number VARCHAR,
  extension VARCHAR,
  is_primary BOOLEAN,
  is_verified BOOLEAN,
  created_at TIMESTAMPTZ
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_current_user_id UUID;
  v_current_org_id UUID;
  v_has_platform_privilege BOOLEAN;
  v_has_org_admin_permission BOOLEAN;
BEGIN
  -- Get current user context
  v_current_user_id := public.get_current_user_id();
  v_current_org_id := public.get_current_org_id();
  v_has_platform_privilege := public.has_platform_privilege();
  v_has_org_admin_permission := public.has_org_admin_permission();

  -- Authorization check
  IF NOT (
    v_has_platform_privilege
    OR (v_has_org_admin_permission AND p_org_id = v_current_org_id)
    OR p_user_id = v_current_user_id
  ) THEN
    RAISE EXCEPTION 'Access denied: insufficient permissions';
  END IF;

  RETURN QUERY
  SELECT
    up.phone_id,
    up.phone_type,
    up.phone_number,
    up.extension,
    up.is_primary,
    up.is_verified,
    up.created_at
  FROM user_phones up
  WHERE up.user_id = p_user_id
    AND EXISTS (
      SELECT 1 FROM user_organizations_projection uop
      WHERE uop.user_id = p_user_id AND uop.org_id = p_org_id
    )
  ORDER BY up.is_primary DESC, up.created_at DESC;
END;
$$;

COMMENT ON FUNCTION api.get_user_phones_for_org(UUID, UUID) IS
'Gets phones for a user within an organization context. Platform admins see all, org admins see their org users, users see their own.';

-- ============================================================================
-- PHASE 4b: Update remaining RLS policies using is_org_admin()
-- ============================================================================

-- user_org_address_overrides (full access for org admins)
DROP POLICY IF EXISTS "user_org_address_overrides_org_admin_all" ON public.user_org_address_overrides;
CREATE POLICY "user_org_address_overrides_org_admin_all" ON public.user_org_address_overrides
  USING (
    has_org_admin_permission() AND org_id = get_current_org_id()
  );
COMMENT ON POLICY "user_org_address_overrides_org_admin_all" ON public.user_org_address_overrides IS
  'Allows org admins full access to user address overrides in their organization';

-- user_org_phone_overrides (full access for org admins)
DROP POLICY IF EXISTS "user_org_phone_overrides_org_admin_all" ON public.user_org_phone_overrides;
CREATE POLICY "user_org_phone_overrides_org_admin_all" ON public.user_org_phone_overrides
  USING (
    has_org_admin_permission() AND org_id = get_current_org_id()
  );
COMMENT ON POLICY "user_org_phone_overrides_org_admin_all" ON public.user_org_phone_overrides IS
  'Allows org admins full access to user phone overrides in their organization';

-- user_organizations_projection (full access for org admins)
DROP POLICY IF EXISTS "user_organizations_org_admin_all" ON public.user_organizations_projection;
CREATE POLICY "user_organizations_org_admin_all" ON public.user_organizations_projection
  USING (
    has_org_admin_permission() AND org_id = get_current_org_id()
  );
COMMENT ON POLICY "user_organizations_org_admin_all" ON public.user_organizations_projection IS
  'Allows org admins full access to user-organization memberships in their organization';

-- ============================================================================
-- PHASE 5: Drop deprecated is_org_admin() function
-- ============================================================================

DROP FUNCTION IF EXISTS public.is_org_admin(uuid, uuid);

-- ============================================================================
-- VERIFICATION: Log what was done
-- ============================================================================

DO $$
BEGIN
  RAISE NOTICE 'Migration complete:';
  RAISE NOTICE '  - Added FK: user_roles_projection.user_id -> users.id';
  RAISE NOTICE '  - Created: has_org_admin_permission() (JWT-claims based)';
  RAISE NOTICE '  - Migrated: 20+ RLS policies from is_org_admin() to JWT pattern';
  RAISE NOTICE '  - Updated: api.list_user_organizations, api.get_user_addresses_for_org, api.get_user_phones_for_org';
  RAISE NOTICE '  - Dropped: is_org_admin(uuid, uuid) function';
END $$;
