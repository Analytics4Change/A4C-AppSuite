-- Row-Level Security Policies for Contact, Address, Phone Projections
-- Provider Onboarding Enhancement - Phase 2
-- Implements multi-tenant isolation with super_admin bypass

-- ============================================================================
-- Contacts Projection
-- ============================================================================

-- Enable RLS on contacts_projection
ALTER TABLE contacts_projection ENABLE ROW LEVEL SECURITY;

-- Super admins can view all contacts
DROP POLICY IF EXISTS contacts_super_admin_all ON contacts_projection;
CREATE POLICY contacts_super_admin_all
  ON contacts_projection
  FOR ALL
  USING (is_super_admin(get_current_user_id()));

-- Organization admins can view contacts in their organization
DROP POLICY IF EXISTS contacts_org_admin_select ON contacts_projection;
CREATE POLICY contacts_org_admin_select
  ON contacts_projection
  FOR SELECT
  USING (
    is_org_admin(get_current_user_id(), organization_id)
    AND deleted_at IS NULL  -- Hide soft-deleted contacts
  );

COMMENT ON POLICY contacts_super_admin_all ON contacts_projection IS
  'Allows super admins full access to all contacts';
COMMENT ON POLICY contacts_org_admin_select ON contacts_projection IS
  'Allows organization admins to view contacts in their organization (excluding soft-deleted)';


-- ============================================================================
-- Addresses Projection
-- ============================================================================

-- Enable RLS on addresses_projection
ALTER TABLE addresses_projection ENABLE ROW LEVEL SECURITY;

-- Super admins can view all addresses
DROP POLICY IF EXISTS addresses_super_admin_all ON addresses_projection;
CREATE POLICY addresses_super_admin_all
  ON addresses_projection
  FOR ALL
  USING (is_super_admin(get_current_user_id()));

-- Organization admins can view addresses in their organization
DROP POLICY IF EXISTS addresses_org_admin_select ON addresses_projection;
CREATE POLICY addresses_org_admin_select
  ON addresses_projection
  FOR SELECT
  USING (
    is_org_admin(get_current_user_id(), organization_id)
    AND deleted_at IS NULL  -- Hide soft-deleted addresses
  );

COMMENT ON POLICY addresses_super_admin_all ON addresses_projection IS
  'Allows super admins full access to all addresses';
COMMENT ON POLICY addresses_org_admin_select ON addresses_projection IS
  'Allows organization admins to view addresses in their organization (excluding soft-deleted)';


-- ============================================================================
-- Phones Projection
-- ============================================================================

-- Enable RLS on phones_projection
ALTER TABLE phones_projection ENABLE ROW LEVEL SECURITY;

-- Super admins can view all phones
DROP POLICY IF EXISTS phones_super_admin_all ON phones_projection;
CREATE POLICY phones_super_admin_all
  ON phones_projection
  FOR ALL
  USING (is_super_admin(get_current_user_id()));

-- Organization admins can view phones in their organization
DROP POLICY IF EXISTS phones_org_admin_select ON phones_projection;
CREATE POLICY phones_org_admin_select
  ON phones_projection
  FOR SELECT
  USING (
    is_org_admin(get_current_user_id(), organization_id)
    AND deleted_at IS NULL  -- Hide soft-deleted phones
  );

COMMENT ON POLICY phones_super_admin_all ON phones_projection IS
  'Allows super admins full access to all phones';
COMMENT ON POLICY phones_org_admin_select ON phones_projection IS
  'Allows organization admins to view phones in their organization (excluding soft-deleted)';


-- ============================================================================
-- Junction Tables - Organization Contacts
-- ============================================================================

-- Enable RLS on organization_contacts
ALTER TABLE organization_contacts ENABLE ROW LEVEL SECURITY;

-- Super admins can view all organization-contact links
DROP POLICY IF EXISTS org_contacts_super_admin_all ON organization_contacts;
CREATE POLICY org_contacts_super_admin_all
  ON organization_contacts
  FOR ALL
  USING (is_super_admin(get_current_user_id()));

-- Organization admins can view links for their organization
DROP POLICY IF EXISTS org_contacts_org_admin_select ON organization_contacts;
CREATE POLICY org_contacts_org_admin_select
  ON organization_contacts
  FOR SELECT
  USING (
    is_org_admin(get_current_user_id(), organization_id)
    AND EXISTS (
      SELECT 1 FROM contacts_projection c
      WHERE c.id = contact_id
        AND c.organization_id = organization_id
        AND c.deleted_at IS NULL
    )
  );

COMMENT ON POLICY org_contacts_super_admin_all ON organization_contacts IS
  'Allows super admins full access to all organization-contact links';
COMMENT ON POLICY org_contacts_org_admin_select ON organization_contacts IS
  'Allows organization admins to view organization-contact links (both entities must belong to their org)';


-- ============================================================================
-- Junction Tables - Organization Addresses
-- ============================================================================

-- Enable RLS on organization_addresses
ALTER TABLE organization_addresses ENABLE ROW LEVEL SECURITY;

-- Super admins can view all organization-address links
DROP POLICY IF EXISTS org_addresses_super_admin_all ON organization_addresses;
CREATE POLICY org_addresses_super_admin_all
  ON organization_addresses
  FOR ALL
  USING (is_super_admin(get_current_user_id()));

-- Organization admins can view links for their organization
DROP POLICY IF EXISTS org_addresses_org_admin_select ON organization_addresses;
CREATE POLICY org_addresses_org_admin_select
  ON organization_addresses
  FOR SELECT
  USING (
    is_org_admin(get_current_user_id(), organization_id)
    AND EXISTS (
      SELECT 1 FROM addresses_projection a
      WHERE a.id = address_id
        AND a.organization_id = organization_id
        AND a.deleted_at IS NULL
    )
  );

COMMENT ON POLICY org_addresses_super_admin_all ON organization_addresses IS
  'Allows super admins full access to all organization-address links';
COMMENT ON POLICY org_addresses_org_admin_select ON organization_addresses IS
  'Allows organization admins to view organization-address links (both entities must belong to their org)';


-- ============================================================================
-- Junction Tables - Organization Phones
-- ============================================================================

-- Enable RLS on organization_phones
ALTER TABLE organization_phones ENABLE ROW LEVEL SECURITY;

-- Super admins can view all organization-phone links
DROP POLICY IF EXISTS org_phones_super_admin_all ON organization_phones;
CREATE POLICY org_phones_super_admin_all
  ON organization_phones
  FOR ALL
  USING (is_super_admin(get_current_user_id()));

-- Organization admins can view links for their organization
DROP POLICY IF EXISTS org_phones_org_admin_select ON organization_phones;
CREATE POLICY org_phones_org_admin_select
  ON organization_phones
  FOR SELECT
  USING (
    is_org_admin(get_current_user_id(), organization_id)
    AND EXISTS (
      SELECT 1 FROM phones_projection p
      WHERE p.id = phone_id
        AND p.organization_id = organization_id
        AND p.deleted_at IS NULL
    )
  );

COMMENT ON POLICY org_phones_super_admin_all ON organization_phones IS
  'Allows super admins full access to all organization-phone links';
COMMENT ON POLICY org_phones_org_admin_select ON organization_phones IS
  'Allows organization admins to view organization-phone links (both entities must belong to their org)';


-- ============================================================================
-- Junction Tables - Contact Phones
-- ============================================================================

-- Enable RLS on contact_phones
ALTER TABLE contact_phones ENABLE ROW LEVEL SECURITY;

-- Super admins can view all contact-phone links
DROP POLICY IF EXISTS contact_phones_super_admin_all ON contact_phones;
CREATE POLICY contact_phones_super_admin_all
  ON contact_phones
  FOR ALL
  USING (is_super_admin(get_current_user_id()));

-- Organization admins can view links for contacts/phones in their organization
DROP POLICY IF EXISTS contact_phones_org_admin_select ON contact_phones;
CREATE POLICY contact_phones_org_admin_select
  ON contact_phones
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM contacts_projection c
      WHERE c.id = contact_id
        AND is_org_admin(get_current_user_id(), c.organization_id)
        AND c.deleted_at IS NULL
    )
    AND EXISTS (
      SELECT 1 FROM phones_projection p
      WHERE p.id = phone_id
        AND p.deleted_at IS NULL
    )
  );

COMMENT ON POLICY contact_phones_super_admin_all ON contact_phones IS
  'Allows super admins full access to all contact-phone links';
COMMENT ON POLICY contact_phones_org_admin_select ON contact_phones IS
  'Allows organization admins to view contact-phone links (both contact and phone must belong to their org)';


-- ============================================================================
-- Junction Tables - Contact Addresses
-- ============================================================================

-- Enable RLS on contact_addresses
ALTER TABLE contact_addresses ENABLE ROW LEVEL SECURITY;

-- Super admins can view all contact-address links
DROP POLICY IF EXISTS contact_addresses_super_admin_all ON contact_addresses;
CREATE POLICY contact_addresses_super_admin_all
  ON contact_addresses
  FOR ALL
  USING (is_super_admin(get_current_user_id()));

-- Organization admins can view links for contacts/addresses in their organization
DROP POLICY IF EXISTS contact_addresses_org_admin_select ON contact_addresses;
CREATE POLICY contact_addresses_org_admin_select
  ON contact_addresses
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM contacts_projection c
      WHERE c.id = contact_id
        AND is_org_admin(get_current_user_id(), c.organization_id)
        AND c.deleted_at IS NULL
    )
    AND EXISTS (
      SELECT 1 FROM addresses_projection a
      WHERE a.id = address_id
        AND a.deleted_at IS NULL
    )
  );

COMMENT ON POLICY contact_addresses_super_admin_all ON contact_addresses IS
  'Allows super admins full access to all contact-address links';
COMMENT ON POLICY contact_addresses_org_admin_select ON contact_addresses IS
  'Allows organization admins to view contact-address links (both contact and address must belong to their org)';


-- ============================================================================
-- Junction Tables - Phone Addresses
-- ============================================================================

-- Enable RLS on phone_addresses
ALTER TABLE phone_addresses ENABLE ROW LEVEL SECURITY;

-- Super admins can view all phone-address links
DROP POLICY IF EXISTS phone_addresses_super_admin_all ON phone_addresses;
CREATE POLICY phone_addresses_super_admin_all
  ON phone_addresses
  FOR ALL
  USING (is_super_admin(get_current_user_id()));

-- Organization admins can view links for phones/addresses in their organization
DROP POLICY IF EXISTS phone_addresses_org_admin_select ON phone_addresses;
CREATE POLICY phone_addresses_org_admin_select
  ON phone_addresses
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM phones_projection p
      WHERE p.id = phone_id
        AND is_org_admin(get_current_user_id(), p.organization_id)
        AND p.deleted_at IS NULL
    )
    AND EXISTS (
      SELECT 1 FROM addresses_projection a
      WHERE a.id = address_id
        AND a.deleted_at IS NULL
    )
  );

COMMENT ON POLICY phone_addresses_super_admin_all ON phone_addresses IS
  'Allows super admins full access to all phone-address links';
COMMENT ON POLICY phone_addresses_org_admin_select ON phone_addresses IS
  'Allows organization admins to view phone-address links (both phone and address must belong to their org)';
