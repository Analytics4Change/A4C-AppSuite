-- Migration: Migrate RLS Policies from is_super_admin() to has_platform_privilege()
-- Description: Replaces all is_super_admin() calls with has_platform_privilege()
--              and drops the deprecated is_super_admin() function
--
-- This is a breaking change but acceptable since there's no production deployment.
-- After this migration, platform owner access is controlled by the platform.admin
-- permission in JWT claims, not by querying user_roles_projection.

-- ============================================================================
-- addresses_projection policies
-- ============================================================================

DROP POLICY IF EXISTS "addresses_super_admin_all" ON public.addresses_projection;
DROP POLICY IF EXISTS "platform_admin_all" ON public.addresses_projection;
CREATE POLICY "platform_admin_all" ON public.addresses_projection
  USING (has_platform_privilege());
COMMENT ON POLICY "platform_admin_all" ON public.addresses_projection IS
  'Allows platform admins full access to all addresses';

-- ============================================================================
-- organization_business_profiles_projection policies
-- ============================================================================

DROP POLICY IF EXISTS "business_profiles_super_admin_all" ON public.organization_business_profiles_projection;
DROP POLICY IF EXISTS "platform_admin_all" ON public.organization_business_profiles_projection;
CREATE POLICY "platform_admin_all" ON public.organization_business_profiles_projection
  USING (has_platform_privilege());
COMMENT ON POLICY "platform_admin_all" ON public.organization_business_profiles_projection IS
  'Allows platform admins full access to all business profiles';

-- ============================================================================
-- clients policies
-- ============================================================================

DROP POLICY IF EXISTS "clients_delete" ON public.clients;
DROP POLICY IF EXISTS "clients_delete" ON public.clients;
CREATE POLICY "clients_delete" ON public.clients FOR DELETE
  USING (
    has_platform_privilege()
    OR (
      organization_id = ((auth.jwt() ->> 'org_id')::uuid)
      AND user_has_permission(get_current_user_id(), 'clients.delete', organization_id)
    )
  );
COMMENT ON POLICY "clients_delete" ON public.clients IS
  'Allows authorized users to delete client records (prefer archiving)';

DROP POLICY IF EXISTS "clients_insert" ON public.clients;
DROP POLICY IF EXISTS "clients_insert" ON public.clients;
CREATE POLICY "clients_insert" ON public.clients FOR INSERT
  WITH CHECK (
    has_platform_privilege()
    OR is_org_admin(get_current_user_id(), organization_id)
    OR user_has_permission(get_current_user_id(), 'clients.create', organization_id)
  );
COMMENT ON POLICY "clients_insert" ON public.clients IS
  'Allows organization admins and authorized users to create client records';

DROP POLICY IF EXISTS "clients_select" ON public.clients;
DROP POLICY IF EXISTS "clients_select" ON public.clients;
CREATE POLICY "clients_select" ON public.clients FOR SELECT
  USING (
    has_platform_privilege()
    OR organization_id = get_current_org_id()
  );

DROP POLICY IF EXISTS "clients_super_admin_select" ON public.clients;
-- Removed: redundant with clients_select having has_platform_privilege()

DROP POLICY IF EXISTS "clients_update" ON public.clients;
DROP POLICY IF EXISTS "clients_update" ON public.clients;
CREATE POLICY "clients_update" ON public.clients FOR UPDATE
  USING (
    has_platform_privilege()
    OR (
      organization_id = ((auth.jwt() ->> 'org_id')::uuid)
      AND user_has_permission(get_current_user_id(), 'clients.update', organization_id)
    )
  );
COMMENT ON POLICY "clients_update" ON public.clients IS
  'Allows authorized users to update client records in their organization';

-- ============================================================================
-- contact_addresses policies
-- ============================================================================

DROP POLICY IF EXISTS "contact_addresses_super_admin_all" ON public.contact_addresses;
DROP POLICY IF EXISTS "platform_admin_all" ON public.contact_addresses;
CREATE POLICY "platform_admin_all" ON public.contact_addresses
  USING (has_platform_privilege());
COMMENT ON POLICY "platform_admin_all" ON public.contact_addresses IS
  'Allows platform admins full access to all contact-address links';

-- ============================================================================
-- contact_phones policies
-- ============================================================================

DROP POLICY IF EXISTS "contact_phones_super_admin_all" ON public.contact_phones;
DROP POLICY IF EXISTS "platform_admin_all" ON public.contact_phones;
CREATE POLICY "platform_admin_all" ON public.contact_phones
  USING (has_platform_privilege());
COMMENT ON POLICY "platform_admin_all" ON public.contact_phones IS
  'Allows platform admins full access to all contact-phone links';

-- ============================================================================
-- contacts_projection policies
-- ============================================================================

DROP POLICY IF EXISTS "contacts_super_admin_all" ON public.contacts_projection;
DROP POLICY IF EXISTS "platform_admin_all" ON public.contacts_projection;
CREATE POLICY "platform_admin_all" ON public.contacts_projection
  USING (has_platform_privilege());
COMMENT ON POLICY "platform_admin_all" ON public.contacts_projection IS
  'Allows platform admins full access to all contacts';

-- ============================================================================
-- cross_tenant_access_grants_projection policies
-- ============================================================================

DROP POLICY IF EXISTS "cross_tenant_grants_super_admin_all" ON public.cross_tenant_access_grants_projection;
DROP POLICY IF EXISTS "platform_admin_all" ON public.cross_tenant_access_grants_projection;
CREATE POLICY "platform_admin_all" ON public.cross_tenant_access_grants_projection
  USING (has_platform_privilege());
COMMENT ON POLICY "platform_admin_all" ON public.cross_tenant_access_grants_projection IS
  'Allows platform admins full access to all cross-tenant access grants';

-- ============================================================================
-- domain_events policies
-- ============================================================================

DROP POLICY IF EXISTS "domain_events_authenticated_insert" ON public.domain_events;
DROP POLICY IF EXISTS "domain_events_authenticated_insert" ON public.domain_events;
CREATE POLICY "domain_events_authenticated_insert" ON public.domain_events FOR INSERT
  WITH CHECK (
    auth.uid() IS NOT NULL
    AND (
      has_platform_privilege()
      OR (event_metadata ->> 'organization_id')::uuid = ((current_setting('request.jwt.claims', true)::jsonb ->> 'org_id'))::uuid
    )
    AND length(event_metadata ->> 'reason') >= 10
  );
COMMENT ON POLICY "domain_events_authenticated_insert" ON public.domain_events IS
  'Allows authenticated users to INSERT events. Validates org_id matches JWT claim and reason >= 10 chars.';

DROP POLICY IF EXISTS "domain_events_org_select" ON public.domain_events;
DROP POLICY IF EXISTS "domain_events_org_select" ON public.domain_events;
CREATE POLICY "domain_events_org_select" ON public.domain_events FOR SELECT
  USING (
    auth.uid() IS NOT NULL
    AND (
      has_platform_privilege()
      OR (event_metadata ->> 'organization_id')::uuid = ((current_setting('request.jwt.claims', true)::jsonb ->> 'org_id'))::uuid
    )
  );
COMMENT ON POLICY "domain_events_org_select" ON public.domain_events IS
  'Allows users to SELECT events belonging to their organization.';

DROP POLICY IF EXISTS "domain_events_super_admin_all" ON public.domain_events;
-- Removed: redundant with domain_events_org_select having has_platform_privilege()

-- ============================================================================
-- dosage_info policies
-- ============================================================================

DROP POLICY IF EXISTS "dosage_info_delete" ON public.dosage_info;
DROP POLICY IF EXISTS "dosage_info_delete" ON public.dosage_info;
CREATE POLICY "dosage_info_delete" ON public.dosage_info FOR DELETE
  USING (
    has_platform_privilege()
    OR (
      organization_id = ((auth.jwt() ->> 'org_id')::uuid)
      AND user_has_permission(get_current_user_id(), 'medications.administer', organization_id)
    )
  );
COMMENT ON POLICY "dosage_info_delete" ON public.dosage_info IS
  'Allows medication administrators to delete dosage records';

DROP POLICY IF EXISTS "dosage_info_insert" ON public.dosage_info;
DROP POLICY IF EXISTS "dosage_info_insert" ON public.dosage_info;
CREATE POLICY "dosage_info_insert" ON public.dosage_info FOR INSERT
  WITH CHECK (
    has_platform_privilege()
    OR (
      organization_id = ((auth.jwt() ->> 'org_id')::uuid)
      AND user_has_permission(get_current_user_id(), 'medications.administer', organization_id)
    )
  );
COMMENT ON POLICY "dosage_info_insert" ON public.dosage_info IS
  'Allows medication administrators to schedule doses in their organization';

DROP POLICY IF EXISTS "dosage_info_super_admin_select" ON public.dosage_info;
DROP POLICY IF EXISTS "platform_admin_select" ON public.dosage_info;
CREATE POLICY "platform_admin_select" ON public.dosage_info FOR SELECT
  USING (has_platform_privilege());
COMMENT ON POLICY "platform_admin_select" ON public.dosage_info IS
  'Allows platform admins to view all dosage records across all organizations';

DROP POLICY IF EXISTS "dosage_info_update" ON public.dosage_info;
DROP POLICY IF EXISTS "dosage_info_update" ON public.dosage_info;
CREATE POLICY "dosage_info_update" ON public.dosage_info FOR UPDATE
  USING (
    has_platform_privilege()
    OR (
      organization_id = ((auth.jwt() ->> 'org_id')::uuid)
      AND (
        user_has_permission(get_current_user_id(), 'medications.administer', organization_id)
        OR administered_by = get_current_user_id()
      )
    )
  );
COMMENT ON POLICY "dosage_info_update" ON public.dosage_info IS
  'Allows medication administrators and administering staff to update dose records';

-- ============================================================================
-- event_types policies
-- ============================================================================

DROP POLICY IF EXISTS "event_types_super_admin_all" ON public.event_types;
DROP POLICY IF EXISTS "platform_admin_all" ON public.event_types;
CREATE POLICY "platform_admin_all" ON public.event_types
  USING (has_platform_privilege());
COMMENT ON POLICY "platform_admin_all" ON public.event_types IS
  'Allows platform admins full access to event type definitions';

-- ============================================================================
-- invitations_projection policies
-- ============================================================================

DROP POLICY IF EXISTS "invitations_super_admin_all" ON public.invitations_projection;
DROP POLICY IF EXISTS "platform_admin_all" ON public.invitations_projection;
CREATE POLICY "platform_admin_all" ON public.invitations_projection
  USING (has_platform_privilege());
COMMENT ON POLICY "platform_admin_all" ON public.invitations_projection IS
  'Allows platform admins full access to all invitations';

-- ============================================================================
-- medication_history policies
-- ============================================================================

DROP POLICY IF EXISTS "medication_history_delete" ON public.medication_history;
DROP POLICY IF EXISTS "medication_history_delete" ON public.medication_history;
CREATE POLICY "medication_history_delete" ON public.medication_history FOR DELETE
  USING (
    has_platform_privilege()
    OR (
      organization_id = ((auth.jwt() ->> 'org_id')::uuid)
      AND user_has_permission(get_current_user_id(), 'medications.prescribe', organization_id)
    )
  );
COMMENT ON POLICY "medication_history_delete" ON public.medication_history IS
  'Allows authorized prescribers to discontinue prescriptions';

DROP POLICY IF EXISTS "medication_history_insert" ON public.medication_history;
DROP POLICY IF EXISTS "medication_history_insert" ON public.medication_history;
CREATE POLICY "medication_history_insert" ON public.medication_history FOR INSERT
  WITH CHECK (
    has_platform_privilege()
    OR (
      organization_id = ((auth.jwt() ->> 'org_id')::uuid)
      AND user_has_permission(get_current_user_id(), 'medications.prescribe', organization_id)
    )
  );
COMMENT ON POLICY "medication_history_insert" ON public.medication_history IS
  'Allows authorized prescribers to create prescriptions in their organization';

DROP POLICY IF EXISTS "medication_history_super_admin_select" ON public.medication_history;
DROP POLICY IF EXISTS "platform_admin_select" ON public.medication_history;
CREATE POLICY "platform_admin_select" ON public.medication_history FOR SELECT
  USING (has_platform_privilege());
COMMENT ON POLICY "platform_admin_select" ON public.medication_history IS
  'Allows platform admins to view all prescription records across all organizations';

DROP POLICY IF EXISTS "medication_history_update" ON public.medication_history;
DROP POLICY IF EXISTS "medication_history_update" ON public.medication_history;
CREATE POLICY "medication_history_update" ON public.medication_history FOR UPDATE
  USING (
    has_platform_privilege()
    OR (
      organization_id = ((auth.jwt() ->> 'org_id')::uuid)
      AND (
        user_has_permission(get_current_user_id(), 'medications.prescribe', organization_id)
        OR prescribed_by = get_current_user_id()
      )
    )
  );
COMMENT ON POLICY "medication_history_update" ON public.medication_history IS
  'Allows prescribers to update their prescriptions in their organization';

-- ============================================================================
-- medications policies
-- ============================================================================

DROP POLICY IF EXISTS "medications_delete" ON public.medications;
DROP POLICY IF EXISTS "medications_delete" ON public.medications;
CREATE POLICY "medications_delete" ON public.medications FOR DELETE
  USING (
    has_platform_privilege()
    OR (
      organization_id = ((auth.jwt() ->> 'org_id')::uuid)
      AND user_has_permission(get_current_user_id(), 'medications.manage', organization_id)
    )
  );
COMMENT ON POLICY "medications_delete" ON public.medications IS
  'Allows authorized pharmacy staff to remove medications from formulary';

DROP POLICY IF EXISTS "medications_insert" ON public.medications;
DROP POLICY IF EXISTS "medications_insert" ON public.medications;
CREATE POLICY "medications_insert" ON public.medications FOR INSERT
  WITH CHECK (
    has_platform_privilege()
    OR (
      organization_id = ((auth.jwt() ->> 'org_id')::uuid)
      AND (
        is_org_admin(get_current_user_id(), organization_id)
        OR user_has_permission(get_current_user_id(), 'medications.manage', organization_id)
      )
    )
  );
COMMENT ON POLICY "medications_insert" ON public.medications IS
  'Allows organization admins and pharmacy staff to add medications to formulary';

DROP POLICY IF EXISTS "medications_super_admin_select" ON public.medications;
DROP POLICY IF EXISTS "platform_admin_select" ON public.medications;
CREATE POLICY "platform_admin_select" ON public.medications FOR SELECT
  USING (has_platform_privilege());
COMMENT ON POLICY "platform_admin_select" ON public.medications IS
  'Allows platform admins to view all medication formularies across all organizations';

DROP POLICY IF EXISTS "medications_update" ON public.medications;
DROP POLICY IF EXISTS "medications_update" ON public.medications;
CREATE POLICY "medications_update" ON public.medications FOR UPDATE
  USING (
    has_platform_privilege()
    OR (
      organization_id = ((auth.jwt() ->> 'org_id')::uuid)
      AND user_has_permission(get_current_user_id(), 'medications.manage', organization_id)
    )
  );
COMMENT ON POLICY "medications_update" ON public.medications IS
  'Allows pharmacy staff to update medication information';

-- ============================================================================
-- organization_addresses policies
-- ============================================================================

DROP POLICY IF EXISTS "org_addresses_super_admin_all" ON public.organization_addresses;
DROP POLICY IF EXISTS "platform_admin_all" ON public.organization_addresses;
CREATE POLICY "platform_admin_all" ON public.organization_addresses
  USING (has_platform_privilege());
COMMENT ON POLICY "platform_admin_all" ON public.organization_addresses IS
  'Allows platform admins full access to all organization-address links';

-- ============================================================================
-- organization_contacts policies
-- ============================================================================

DROP POLICY IF EXISTS "org_contacts_super_admin_all" ON public.organization_contacts;
DROP POLICY IF EXISTS "platform_admin_all" ON public.organization_contacts;
CREATE POLICY "platform_admin_all" ON public.organization_contacts
  USING (has_platform_privilege());
COMMENT ON POLICY "platform_admin_all" ON public.organization_contacts IS
  'Allows platform admins full access to all organization-contact links';

-- ============================================================================
-- organization_phones policies
-- ============================================================================

DROP POLICY IF EXISTS "org_phones_super_admin_all" ON public.organization_phones;
DROP POLICY IF EXISTS "platform_admin_all" ON public.organization_phones;
CREATE POLICY "platform_admin_all" ON public.organization_phones
  USING (has_platform_privilege());
COMMENT ON POLICY "platform_admin_all" ON public.organization_phones IS
  'Allows platform admins full access to all organization-phone links';

-- ============================================================================
-- organizations_projection policies
-- ============================================================================

DROP POLICY IF EXISTS "organizations_select" ON public.organizations_projection;
DROP POLICY IF EXISTS "organizations_select" ON public.organizations_projection;
CREATE POLICY "organizations_select" ON public.organizations_projection FOR SELECT
  USING (
    has_platform_privilege()
    OR id = get_current_org_id()
  );

DROP POLICY IF EXISTS "organizations_super_admin_all" ON public.organizations_projection;
DROP POLICY IF EXISTS "platform_admin_all" ON public.organizations_projection;
CREATE POLICY "platform_admin_all" ON public.organizations_projection
  USING (has_platform_privilege());
COMMENT ON POLICY "platform_admin_all" ON public.organizations_projection IS
  'Allows platform admins full access to all organizations';

-- ============================================================================
-- organization_units_projection policies
-- ============================================================================

DROP POLICY IF EXISTS "ou_super_admin_all" ON public.organization_units_projection;
DROP POLICY IF EXISTS "platform_admin_all" ON public.organization_units_projection;
CREATE POLICY "platform_admin_all" ON public.organization_units_projection
  USING (has_platform_privilege());
COMMENT ON POLICY "platform_admin_all" ON public.organization_units_projection IS
  'Allows platform admins full access to all organization units';

-- ============================================================================
-- permissions_projection policies
-- ============================================================================

DROP POLICY IF EXISTS "permissions_super_admin_all" ON public.permissions_projection;
DROP POLICY IF EXISTS "permissions_superadmin" ON public.permissions_projection;
DROP POLICY IF EXISTS "platform_admin_all" ON public.permissions_projection;
CREATE POLICY "platform_admin_all" ON public.permissions_projection
  USING (has_platform_privilege());
COMMENT ON POLICY "platform_admin_all" ON public.permissions_projection IS
  'Allows platform admins full access to permission definitions';

-- ============================================================================
-- phone_addresses policies
-- ============================================================================

DROP POLICY IF EXISTS "phone_addresses_super_admin_all" ON public.phone_addresses;
DROP POLICY IF EXISTS "platform_admin_all" ON public.phone_addresses;
CREATE POLICY "platform_admin_all" ON public.phone_addresses
  USING (has_platform_privilege());
COMMENT ON POLICY "platform_admin_all" ON public.phone_addresses IS
  'Allows platform admins full access to all phone-address links';

-- ============================================================================
-- phones_projection policies
-- ============================================================================

DROP POLICY IF EXISTS "phones_super_admin_all" ON public.phones_projection;
DROP POLICY IF EXISTS "platform_admin_all" ON public.phones_projection;
CREATE POLICY "platform_admin_all" ON public.phones_projection
  USING (has_platform_privilege());
COMMENT ON POLICY "platform_admin_all" ON public.phones_projection IS
  'Allows platform admins full access to all phones';

-- ============================================================================
-- role_permissions_projection policies
-- ============================================================================

DROP POLICY IF EXISTS "role_permissions_super_admin_all" ON public.role_permissions_projection;
DROP POLICY IF EXISTS "role_permissions_superadmin" ON public.role_permissions_projection;
DROP POLICY IF EXISTS "platform_admin_all" ON public.role_permissions_projection;
CREATE POLICY "platform_admin_all" ON public.role_permissions_projection
  USING (has_platform_privilege());
COMMENT ON POLICY "platform_admin_all" ON public.role_permissions_projection IS
  'Allows platform admins full access to all role-permission grants';

-- ============================================================================
-- roles_projection policies
-- ============================================================================

DROP POLICY IF EXISTS "roles_super_admin_all" ON public.roles_projection;
DROP POLICY IF EXISTS "roles_superadmin" ON public.roles_projection;
DROP POLICY IF EXISTS "platform_admin_all" ON public.roles_projection;
CREATE POLICY "platform_admin_all" ON public.roles_projection
  USING (has_platform_privilege());
COMMENT ON POLICY "platform_admin_all" ON public.roles_projection IS
  'Allows platform admins full access to all roles';

-- ============================================================================
-- user_roles_projection policies
-- ============================================================================

DROP POLICY IF EXISTS "user_roles_super_admin_all" ON public.user_roles_projection;
DROP POLICY IF EXISTS "user_roles_superadmin" ON public.user_roles_projection;
DROP POLICY IF EXISTS "platform_admin_all" ON public.user_roles_projection;
CREATE POLICY "platform_admin_all" ON public.user_roles_projection
  USING (has_platform_privilege());
COMMENT ON POLICY "platform_admin_all" ON public.user_roles_projection IS
  'Allows platform admins full access to all user-role assignments';

-- ============================================================================
-- users policies
-- ============================================================================

DROP POLICY IF EXISTS "users_select" ON public.users;
DROP POLICY IF EXISTS "users_select" ON public.users;
CREATE POLICY "users_select" ON public.users FOR SELECT
  USING (
    has_platform_privilege()
    OR id = auth.uid()
    OR current_organization_id = get_current_org_id()
  );

DROP POLICY IF EXISTS "users_super_admin_all" ON public.users;
DROP POLICY IF EXISTS "platform_admin_all" ON public.users;
CREATE POLICY "platform_admin_all" ON public.users
  USING (has_platform_privilege());
COMMENT ON POLICY "platform_admin_all" ON public.users IS
  'Allows platform admins full access to all users';

-- ============================================================================
-- Update api.list_roles_for_user to use has_platform_privilege()
-- ============================================================================

CREATE OR REPLACE FUNCTION api.list_roles_for_user(
  p_user_id UUID DEFAULT NULL,
  p_status TEXT DEFAULT 'active'
)
RETURNS TABLE (
  id UUID,
  name TEXT,
  description TEXT,
  is_global BOOLEAN,
  organization_id UUID,
  is_active BOOLEAN,
  can_be_deleted BOOLEAN,
  user_count BIGINT
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
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
    (r.organization_id IS NULL) AS is_global,
    r.organization_id,
    r.is_active,
    r.can_be_deleted,
    (SELECT COUNT(*) FROM user_roles_projection ur WHERE ur.role_id = r.id) AS user_count
  FROM roles_projection r
  WHERE
    -- If user_id specified, filter to their roles
    (p_user_id IS NULL OR EXISTS (
      SELECT 1 FROM user_roles_projection ur
      WHERE ur.user_id = p_user_id AND ur.role_id = r.id
    ))
    -- Visibility rules
    AND (
      -- Global roles ONLY visible to platform_owner org type
      (r.organization_id IS NULL AND v_org_type = 'platform_owner')
      -- User's organization roles
      OR r.organization_id = v_org_id
      -- Platform admin override: sees all roles
      OR v_has_platform_privilege
    )
    -- Status filter
    AND (p_status = 'all'
         OR (p_status = 'active' AND r.is_active = true)
         OR (p_status = 'inactive' AND r.is_active = false))
  ORDER BY
    r.organization_id NULLS FIRST,
    r.name;
END;
$$;

COMMENT ON FUNCTION api.list_roles_for_user(UUID, TEXT) IS
'Lists roles, optionally filtered by user assignment.
Platform admins can see all roles across all organizations.
Regular users see global roles (if in platform_owner org) and their org roles.';

-- ============================================================================
-- user_addresses policies
-- ============================================================================

DROP POLICY IF EXISTS "user_addresses_super_admin_all" ON public.user_addresses;
DROP POLICY IF EXISTS "platform_admin_all" ON public.user_addresses;
CREATE POLICY "platform_admin_all" ON public.user_addresses
  USING (has_platform_privilege());
COMMENT ON POLICY "platform_admin_all" ON public.user_addresses IS
  'Allows platform admins full access to all user-address links';

-- ============================================================================
-- user_org_address_overrides policies
-- ============================================================================

DROP POLICY IF EXISTS "user_org_address_overrides_super_admin_all" ON public.user_org_address_overrides;
DROP POLICY IF EXISTS "platform_admin_all" ON public.user_org_address_overrides;
CREATE POLICY "platform_admin_all" ON public.user_org_address_overrides
  USING (has_platform_privilege());
COMMENT ON POLICY "platform_admin_all" ON public.user_org_address_overrides IS
  'Allows platform admins full access to all user org address overrides';

-- ============================================================================
-- user_phones policies
-- ============================================================================

DROP POLICY IF EXISTS "user_phones_super_admin_all" ON public.user_phones;
DROP POLICY IF EXISTS "platform_admin_all" ON public.user_phones;
CREATE POLICY "platform_admin_all" ON public.user_phones
  USING (has_platform_privilege());
COMMENT ON POLICY "platform_admin_all" ON public.user_phones IS
  'Allows platform admins full access to all user-phone links';

-- ============================================================================
-- user_org_phone_overrides policies
-- ============================================================================

DROP POLICY IF EXISTS "user_org_phone_overrides_super_admin_all" ON public.user_org_phone_overrides;
DROP POLICY IF EXISTS "platform_admin_all" ON public.user_org_phone_overrides;
CREATE POLICY "platform_admin_all" ON public.user_org_phone_overrides
  USING (has_platform_privilege());
COMMENT ON POLICY "platform_admin_all" ON public.user_org_phone_overrides IS
  'Allows platform admins full access to all user org phone overrides';

-- ============================================================================
-- user_organizations_projection policies
-- ============================================================================

DROP POLICY IF EXISTS "user_organizations_super_admin_all" ON public.user_organizations_projection;
DROP POLICY IF EXISTS "platform_admin_all" ON public.user_organizations_projection;
CREATE POLICY "platform_admin_all" ON public.user_organizations_projection
  USING (has_platform_privilege());
COMMENT ON POLICY "platform_admin_all" ON public.user_organizations_projection IS
  'Allows platform admins full access to all user-organization memberships';

-- ============================================================================
-- Drop deprecated is_super_admin() function
-- ============================================================================

DROP FUNCTION IF EXISTS public.is_super_admin(uuid);
