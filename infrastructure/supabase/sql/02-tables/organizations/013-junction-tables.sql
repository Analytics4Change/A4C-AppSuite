-- Junction Tables for Many-to-Many Relationships
-- Provider Onboarding Enhancement - Phase 1
-- Minimal design: UNIQUE constraints only, no PK, no metadata
-- Rationale: domain_events table IS the audit trail (CQRS pattern)
-- Note: No ON DELETE CASCADE - event-driven deletion required (emit *.unlinked events via workflow)

-- ==============================================================================
-- Organization Junction Tables (org-level relationships)
-- ==============================================================================

-- Organization ↔ Contact Junction
-- Links organizations to contact persons

CREATE TABLE IF NOT EXISTS organization_contacts (
  organization_id UUID NOT NULL REFERENCES organizations_projection(id),
  contact_id UUID NOT NULL REFERENCES contacts_projection(id),

  UNIQUE (organization_id, contact_id)
);

CREATE INDEX IF NOT EXISTS idx_organization_contacts_org
  ON organization_contacts(organization_id);

CREATE INDEX IF NOT EXISTS idx_organization_contacts_contact
  ON organization_contacts(contact_id);

COMMENT ON TABLE organization_contacts IS 'Many-to-many junction: organizations ↔ contacts (org-level association)';

-- Organization ↔ Address Junction
-- Links organizations to addresses

CREATE TABLE IF NOT EXISTS organization_addresses (
  organization_id UUID NOT NULL REFERENCES organizations_projection(id),
  address_id UUID NOT NULL REFERENCES addresses_projection(id),

  UNIQUE (organization_id, address_id)
);

CREATE INDEX IF NOT EXISTS idx_organization_addresses_org
  ON organization_addresses(organization_id);

CREATE INDEX IF NOT EXISTS idx_organization_addresses_address
  ON organization_addresses(address_id);

COMMENT ON TABLE organization_addresses IS 'Many-to-many junction: organizations ↔ addresses (org-level association)';

-- Organization ↔ Phone Junction
-- Links organizations to phone numbers

CREATE TABLE IF NOT EXISTS organization_phones (
  organization_id UUID NOT NULL REFERENCES organizations_projection(id),
  phone_id UUID NOT NULL REFERENCES phones_projection(id),

  UNIQUE (organization_id, phone_id)
);

CREATE INDEX IF NOT EXISTS idx_organization_phones_org
  ON organization_phones(organization_id);

CREATE INDEX IF NOT EXISTS idx_organization_phones_phone
  ON organization_phones(phone_id);

COMMENT ON TABLE organization_phones IS 'Many-to-many junction: organizations ↔ phones (org-level association)';

-- ==============================================================================
-- Contact Group Junction Tables (fully connected contact groups)
-- ==============================================================================
-- Used for Billing and Provider Admin sections where contact, address, and phone
-- are all linked together in a fully connected graph

-- Contact ↔ Address Junction
-- Links contacts to their addresses (e.g., billing contact to billing address)

CREATE TABLE IF NOT EXISTS contact_addresses (
  contact_id UUID NOT NULL REFERENCES contacts_projection(id),
  address_id UUID NOT NULL REFERENCES addresses_projection(id),

  UNIQUE (contact_id, address_id)
);

CREATE INDEX IF NOT EXISTS idx_contact_addresses_contact
  ON contact_addresses(contact_id);

CREATE INDEX IF NOT EXISTS idx_contact_addresses_address
  ON contact_addresses(address_id);

COMMENT ON TABLE contact_addresses IS 'Many-to-many junction: contacts ↔ addresses (contact group association)';

-- Contact ↔ Phone Junction
-- Links contacts to their phone numbers (e.g., billing contact to billing phone)

CREATE TABLE IF NOT EXISTS contact_phones (
  contact_id UUID NOT NULL REFERENCES contacts_projection(id),
  phone_id UUID NOT NULL REFERENCES phones_projection(id),

  UNIQUE (contact_id, phone_id)
);

CREATE INDEX IF NOT EXISTS idx_contact_phones_contact
  ON contact_phones(contact_id);

CREATE INDEX IF NOT EXISTS idx_contact_phones_phone
  ON contact_phones(phone_id);

COMMENT ON TABLE contact_phones IS 'Many-to-many junction: contacts ↔ phones (contact group association)';

-- Phone ↔ Address Junction
-- Links phone numbers to addresses (e.g., main office phone to main office address)
-- Enables direct phone-address queries without contact intermediary
-- Use case: Main office phone/address without specific contact person

CREATE TABLE IF NOT EXISTS phone_addresses (
  phone_id UUID NOT NULL REFERENCES phones_projection(id),
  address_id UUID NOT NULL REFERENCES addresses_projection(id),

  UNIQUE (phone_id, address_id)
);

CREATE INDEX IF NOT EXISTS idx_phone_addresses_phone
  ON phone_addresses(phone_id);

CREATE INDEX IF NOT EXISTS idx_phone_addresses_address
  ON phone_addresses(address_id);

COMMENT ON TABLE phone_addresses IS 'Many-to-many junction: phones ↔ addresses (direct association, supports contact-less main office scenarios)';
