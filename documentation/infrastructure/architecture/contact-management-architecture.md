# Contact Management Architecture

**Status**: 🔮 Aspirational
**Timeline**: Indeterminate
**Dependencies**: Provider Onboarding Enhancement (Phases 1-6)
**Last Updated**: 2025-01-14

---

## Overview

This document provides comprehensive architectural guidance for the future Contact Management module. It details the data model, many-to-many relationships, query patterns, RLS policies, performance considerations, and integration points with existing A4C-AppSuite features.

The architecture builds on the many-to-many infrastructure created by the provider onboarding enhancement, which established junction tables, type enums, and event processors specifically designed to enable sophisticated contact relationship management.

---

## Data Model

### Core Projection Tables

The foundation consists of three projection tables created during the provider onboarding enhancement:

#### `contacts_projection`
```sql
CREATE TABLE contacts_projection (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations_projection(id),
  label TEXT NOT NULL,                    -- User-defined label (e.g., "John - Main Contact")
  type contact_type NOT NULL,             -- Enum: a4c_admin, billing, technical, emergency, stakeholder
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  email TEXT NOT NULL,
  title TEXT,                             -- Job title (e.g., "Billing Manager")
  department TEXT,                        -- Department (e.g., "Finance")
  is_primary BOOLEAN DEFAULT false,       -- One primary contact per type per org
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  deleted_at TIMESTAMPTZ,                 -- Soft delete

  -- Constraints
  UNIQUE(organization_id, type, is_primary) WHERE is_primary = true AND deleted_at IS NULL
);

CREATE INDEX idx_contacts_org ON contacts_projection(organization_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_contacts_type ON contacts_projection(type) WHERE deleted_at IS NULL;
CREATE INDEX idx_contacts_email ON contacts_projection(email) WHERE deleted_at IS NULL;
CREATE INDEX idx_contacts_type_org ON contacts_projection(type, organization_id) WHERE deleted_at IS NULL;
```

#### `addresses_projection`
```sql
CREATE TABLE addresses_projection (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations_projection(id),
  label TEXT NOT NULL,                    -- User-defined label (e.g., "Headquarters")
  type address_type NOT NULL,             -- Enum: physical, mailing, billing
  street1 TEXT NOT NULL,
  street2 TEXT,
  city TEXT NOT NULL,
  state TEXT NOT NULL,
  zip_code TEXT NOT NULL,
  is_primary BOOLEAN DEFAULT false,       -- One primary address per type per org
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  deleted_at TIMESTAMPTZ,                 -- Soft delete

  -- Constraints
  UNIQUE(organization_id, type, is_primary) WHERE is_primary = true AND deleted_at IS NULL
);

CREATE INDEX idx_addresses_org ON addresses_projection(organization_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_addresses_type ON addresses_projection(type) WHERE deleted_at IS NULL;
CREATE INDEX idx_addresses_location ON addresses_projection(city, state, zip_code) WHERE deleted_at IS NULL;
```

#### `phones_projection`
```sql
CREATE TABLE phones_projection (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations_projection(id),
  label TEXT NOT NULL,                    -- User-defined label (e.g., "Main Reception")
  type phone_type NOT NULL,               -- Enum: mobile, office, fax, emergency
  number TEXT NOT NULL,                   -- Phone number (formatted)
  extension TEXT,                         -- Extension (if applicable)
  is_primary BOOLEAN DEFAULT false,       -- One primary phone per type per org
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  deleted_at TIMESTAMPTZ,                 -- Soft delete

  -- Constraints
  UNIQUE(organization_id, type, is_primary) WHERE is_primary = true AND deleted_at IS NULL
);

CREATE INDEX idx_phones_org ON phones_projection(organization_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_phones_type ON phones_projection(type) WHERE deleted_at IS NULL;
CREATE INDEX idx_phones_number ON phones_projection(number) WHERE deleted_at IS NULL;
```

---

### Junction Tables (Many-to-Many Relationships)

Six junction tables enable many-to-many relationships:

#### Organization-Level Associations

```sql
-- Organizations ↔ Contacts
CREATE TABLE organization_contacts (
  org_id UUID NOT NULL REFERENCES organizations_projection(id) ON DELETE CASCADE,
  contact_id UUID NOT NULL REFERENCES contacts_projection(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),

  PRIMARY KEY (org_id, contact_id)
);

CREATE INDEX idx_org_contacts_org ON organization_contacts(org_id);
CREATE INDEX idx_org_contacts_contact ON organization_contacts(contact_id);

-- Organizations ↔ Addresses
CREATE TABLE organization_addresses (
  org_id UUID NOT NULL REFERENCES organizations_projection(id) ON DELETE CASCADE,
  address_id UUID NOT NULL REFERENCES addresses_projection(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),

  PRIMARY KEY (org_id, address_id)
);

CREATE INDEX idx_org_addresses_org ON organization_addresses(org_id);
CREATE INDEX idx_org_addresses_address ON organization_addresses(address_id);

-- Organizations ↔ Phones
CREATE TABLE organization_phones (
  org_id UUID NOT NULL REFERENCES organizations_projection(id) ON DELETE CASCADE,
  phone_id UUID NOT NULL REFERENCES phones_projection(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),

  PRIMARY KEY (org_id, phone_id)
);

CREATE INDEX idx_org_phones_org ON organization_phones(org_id);
CREATE INDEX idx_org_phones_phone ON organization_phones(phone_id);
```

#### Contact-Level Associations (Fully Connected Groups)

```sql
-- Contacts ↔ Phones (personal phones)
CREATE TABLE contact_phones (
  contact_id UUID NOT NULL REFERENCES contacts_projection(id) ON DELETE CASCADE,
  phone_id UUID NOT NULL REFERENCES phones_projection(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),

  PRIMARY KEY (contact_id, phone_id)
);

CREATE INDEX idx_contact_phones_contact ON contact_phones(contact_id);
CREATE INDEX idx_contact_phones_phone ON contact_phones(phone_id);

-- Contacts ↔ Addresses (personal addresses)
CREATE TABLE contact_addresses (
  contact_id UUID NOT NULL REFERENCES contacts_projection(id) ON DELETE CASCADE,
  address_id UUID NOT NULL REFERENCES addresses_projection(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),

  PRIMARY KEY (contact_id, address_id)
);

CREATE INDEX idx_contact_addresses_contact ON contact_addresses(contact_id);
CREATE INDEX idx_contact_addresses_address ON contact_addresses(address_id);

-- Phones ↔ Addresses (location association for fully connected groups)
CREATE TABLE phone_addresses (
  phone_id UUID NOT NULL REFERENCES phones_projection(id) ON DELETE CASCADE,
  address_id UUID NOT NULL REFERENCES addresses_projection(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),

  PRIMARY KEY (phone_id, address_id)
);

CREATE INDEX idx_phone_addresses_phone ON phone_addresses(phone_id);
CREATE INDEX idx_phone_addresses_address ON phone_addresses(address_id);
```

---

### Type Enums

```sql
-- Contact role classification
CREATE TYPE contact_type AS ENUM (
  'a4c_admin',      -- A4C platform administrator contact
  'billing',        -- Billing/finance contact
  'technical',      -- Technical support contact
  'emergency',      -- Emergency/after-hours contact
  'stakeholder'     -- Stakeholder/partner contact
);

-- Address purpose classification
CREATE TYPE address_type AS ENUM (
  'physical',       -- Physical location (headquarters, office)
  'mailing',        -- Mailing address (PO Box, etc.)
  'billing'         -- Billing address (invoices, statements)
);

-- Phone device classification
CREATE TYPE phone_type AS ENUM (
  'mobile',         -- Mobile/cell phone
  'office',         -- Office/desk phone
  'fax',            -- Fax machine
  'emergency'       -- Emergency hotline
);
```

---

## Relationship Patterns

### Pattern 1: Org-Level Only (General Information)

**Use Case**: Company headquarters information

**Junction Links** (3 total):
- `org→contact` (company contact person)
- `org→address` (headquarters address)
- `org→phone` (main reception line)

**NO** contact-level links (contact is NOT linked to address or phone)

**Example**:
```
Organization: Acme Healthcare
  ├─ Contact: Jane Doe (General Contact)         [org→contact]
  ├─ Address: 123 Main St (Headquarters)         [org→address]
  └─ Phone: (555) 100-0000 (Main Reception)      [org→phone]

Jane is the contact person, but NOT personally associated with the address or phone.
```

**SQL Representation**:
```sql
-- Insert general info entities
INSERT INTO contacts_projection (id, org_id, label, type, first_name, last_name, email)
VALUES ('contact-1', 'org-1', 'General Contact', 'a4c_admin', 'Jane', 'Doe', 'jane@acme.com');

INSERT INTO addresses_projection (id, org_id, label, type, street1, city, state, zip_code)
VALUES ('address-1', 'org-1', 'Headquarters', 'physical', '123 Main St', 'Springfield', 'IL', '62701');

INSERT INTO phones_projection (id, org_id, label, type, number)
VALUES ('phone-1', 'org-1', 'Main Reception', 'office', '555-100-0000');

-- Create org-level junction links ONLY
INSERT INTO organization_contacts (org_id, contact_id) VALUES ('org-1', 'contact-1');
INSERT INTO organization_addresses (org_id, address_id) VALUES ('org-1', 'address-1');
INSERT INTO organization_phones (org_id, phone_id) VALUES ('org-1', 'phone-1');

-- NO contact→address or contact→phone links
```

---

### Pattern 2: Fully Connected Contact Group (Billing / Provider Admin)

**Use Case**: Billing department contact group

**Junction Links** (6 total per contact group):
- `org→contact`, `org→address`, `org→phone` (org associations)
- `contact→address` (personal work location)
- `contact→phone` (personal phone)
- `phone→address` (phone location)

**Example**:
```
Organization: Acme Healthcare
  ├─ Contact: Bob Smith (Billing Manager)        [org→contact]
  │   ├─ Address: 456 Oak St (Billing Office)    [contact→address]
  │   └─ Phone: (555) 200-0000 (Bob's Mobile)    [contact→phone]
  ├─ Address: 456 Oak St (Billing Office)        [org→address]
  │   └─ Phone: (555) 201-0000 (Fax)             [phone→address]
  └─ Phone: (555) 200-0000 (Bob's Mobile)        [org→phone]
       └─ Phone: (555) 201-0000 (Fax)            [org→phone]

Bob is the billing contact, works at the billing office, can be reached on his mobile.
The fax line is at the billing office address.
```

**SQL Representation**:
```sql
-- Insert billing contact group entities
INSERT INTO contacts_projection (id, org_id, label, type, first_name, last_name, email)
VALUES ('contact-2', 'org-1', 'Billing Manager', 'billing', 'Bob', 'Smith', 'bob@acme.com');

INSERT INTO addresses_projection (id, org_id, label, type, street1, city, state, zip_code)
VALUES ('address-2', 'org-1', 'Billing Office', 'billing', '456 Oak St', 'Springfield', 'IL', '62702');

INSERT INTO phones_projection (id, org_id, label, type, number)
VALUES
  ('phone-2', 'org-1', 'Bob Mobile', 'mobile', '555-200-0000'),
  ('phone-3', 'org-1', 'Billing Fax', 'fax', '555-201-0000');

-- Create org-level junction links
INSERT INTO organization_contacts (org_id, contact_id) VALUES ('org-1', 'contact-2');
INSERT INTO organization_addresses (org_id, address_id) VALUES ('org-1', 'address-2');
INSERT INTO organization_phones (org_id, phone_id) VALUES ('org-1', 'phone-2'), ('org-1', 'phone-3');

-- Create contact-level junction links (fully connected group)
INSERT INTO contact_addresses (contact_id, address_id) VALUES ('contact-2', 'address-2');
INSERT INTO contact_phones (contact_id, phone_id) VALUES ('contact-2', 'phone-2');
INSERT INTO phone_addresses (phone_id, address_id) VALUES ('phone-3', 'address-2');
```

---

## Complex Query Patterns

### Query 1: Find Contacts Shared Across Multiple Organizations

**Use Case**: Identify consultants, VAR reps, or shared support staff

```sql
SELECT
  c.first_name || ' ' || c.last_name as contact_name,
  c.email,
  c.type as contact_type,
  COUNT(DISTINCT oc.org_id) as org_count,
  ARRAY_AGG(DISTINCT o.name ORDER BY o.name) as organizations
FROM contacts_projection c
JOIN organization_contacts oc ON c.id = oc.contact_id
JOIN organizations_projection o ON oc.org_id = o.id
WHERE c.deleted_at IS NULL AND o.deleted_at IS NULL
GROUP BY c.id, c.first_name, c.last_name, c.email, c.type
HAVING COUNT(DISTINCT oc.org_id) > 1
ORDER BY org_count DESC, contact_name;
```

**Expected Output**:
| contact_name | email | contact_type | org_count | organizations |
|---|---|---|---|---|
| John Doe | john@consultant.com | technical | 5 | {Acme Healthcare, Best Medical, Care Plus, ...} |
| Jane Smith | jane@varpartner.com | a4c_admin | 3 | {Provider A, Provider B, Provider C} |

**Performance**: O(n) with index on `organization_contacts(contact_id)`

---

### Query 2: Find All Contacts at a Specific Physical Location

**Use Case**: Office roster, emergency evacuation list

```sql
SELECT
  c.first_name || ' ' || c.last_name as name,
  c.email,
  c.title,
  c.type as contact_type,
  p.number as phone,
  p.type as phone_type
FROM contacts_projection c
JOIN contact_addresses ca ON c.id = ca.contact_id
JOIN addresses_projection a ON ca.address_id = a.id
LEFT JOIN contact_phones cp ON c.id = cp.contact_id
LEFT JOIN phones_projection p ON cp.phone_id = p.id AND p.type = 'mobile'
WHERE a.street1 = '123 Main St'
  AND a.city = 'Springfield'
  AND a.state = 'IL'
  AND c.deleted_at IS NULL
  AND c.is_active = true
ORDER BY c.last_name, c.first_name;
```

**Expected Output**:
| name | email | title | contact_type | phone | phone_type |
|---|---|---|---|---|---|
| Alice Johnson | alice@acme.com | Claims Coordinator | billing | 555-444-4444 | mobile |
| Bob Smith | bob@acme.com | Billing Manager | billing | 555-200-0000 | mobile |
| Jane Doe | jane@acme.com | General Manager | a4c_admin | 555-222-2222 | mobile |

**Performance**: O(n) with composite index on `addresses_projection(street1, city, state)`

---

### Query 3: Find Primary Contact by Type for Each Organization

**Use Case**: Generate billing contact list for invoicing, technical contact list for support

```sql
SELECT
  o.name as organization,
  o.subdomain,
  c.first_name || ' ' || c.last_name as contact_name,
  c.email,
  c.type as contact_type,
  p.number as phone
FROM organizations_projection o
JOIN organization_contacts oc ON o.id = oc.org_id
JOIN contacts_projection c ON oc.contact_id = c.id
LEFT JOIN contact_phones cp ON c.id = cp.contact_id
LEFT JOIN phones_projection p ON cp.phone_id = p.id AND p.is_primary = true
WHERE c.type = 'billing'             -- Filter by type
  AND c.is_primary = true            -- Only primary billing contact
  AND c.deleted_at IS NULL
  AND o.deleted_at IS NULL
ORDER BY o.name;
```

**Expected Output**:
| organization | subdomain | contact_name | email | contact_type | phone |
|---|---|---|---|---|---|
| Acme Healthcare | acme | Bob Smith | bob@acme.com | billing | 555-200-0000 |
| Best Medical | best | Jane Doe | jane@best.com | billing | 555-300-0000 |
| Care Plus | careplus | Alice Johnson | alice@careplus.com | billing | 555-400-0000 |

**Performance**: O(n) with composite index on `contacts_projection(type, is_primary)`

---

### Query 4: Find Fully Connected Contact Groups (Contact + Address + Phone)

**Use Case**: Billing department roster, provider admin info

```sql
SELECT
  c.first_name || ' ' || c.last_name as contact_name,
  c.email,
  c.type as contact_type,
  a.street1 || ', ' || a.city || ' ' || a.state || ' ' || a.zip_code as address,
  a.type as address_type,
  p.number as phone,
  p.type as phone_type
FROM contacts_projection c
JOIN contact_addresses ca ON c.id = ca.contact_id
JOIN addresses_projection a ON ca.address_id = a.id
JOIN contact_phones cp ON c.id = cp.contact_id
JOIN phones_projection p ON cp.phone_id = p.id
JOIN phone_addresses pa ON p.id = pa.phone_id AND a.id = pa.address_id  -- Phone at address
WHERE c.organization_id = ?
  AND c.type = 'billing'
  AND c.deleted_at IS NULL
ORDER BY c.last_name, c.first_name;
```

**Expected Output**:
| contact_name | email | contact_type | address | address_type | phone | phone_type |
|---|---|---|---|---|---|---|
| Bob Smith | bob@acme.com | billing | 456 Oak St, Springfield IL 62702 | billing | 555-201-0000 | fax |

**Performance**: O(n) with composite index on `contacts_projection(organization_id, type)`

---

### Query 5: Find All Phone Numbers for a Contact Across All Organizations

**Use Case**: Contact profile, communication routing

```sql
-- Personal phones (linked directly to contact)
SELECT
  'Personal' as source,
  o.name as organization,
  p.label,
  p.number,
  p.type,
  p.is_primary
FROM contacts_projection c
JOIN organization_contacts oc ON c.id = oc.contact_id
JOIN organizations_projection o ON oc.org_id = o.id
JOIN contact_phones cp ON c.id = cp.contact_id
JOIN phones_projection p ON cp.phone_id = p.id
WHERE c.email = 'john.doe@consultant.com'
  AND c.deleted_at IS NULL
  AND p.deleted_at IS NULL

UNION

-- Organization phones (shared phones at orgs where contact is a member)
SELECT
  'Organization' as source,
  o.name as organization,
  p.label,
  p.number,
  p.type,
  p.is_primary
FROM contacts_projection c
JOIN organization_contacts oc ON c.id = oc.contact_id
JOIN organizations_projection o ON oc.org_id = o.id
JOIN organization_phones op ON o.id = op.org_id
JOIN phones_projection p ON op.phone_id = p.id
WHERE c.email = 'john.doe@consultant.com'
  AND c.deleted_at IS NULL
  AND p.deleted_at IS NULL
ORDER BY source, organization, is_primary DESC;
```

**Expected Output**:
| source | organization | label | number | type | is_primary |
|---|---|---|---|---|---|
| Personal | Acme Healthcare | John Mobile | 555-100-0000 | mobile | true |
| Personal | Best Medical | John Mobile | 555-100-0000 | mobile | true |
| Organization | Acme Healthcare | Main Reception | 555-111-1111 | office | true |
| Organization | Best Medical | Main Reception | 555-222-2222 | office | true |

**Performance**: O(n) with index on `contacts_projection(email)`

---

### Query 6: Organization Hierarchy with Contact Counts

**Use Case**: Analytics, reporting, org structure visualization

```sql
WITH RECURSIVE org_tree AS (
  -- Root organizations (no parent)
  SELECT
    id,
    name,
    path,
    0 as level
  FROM organizations_projection
  WHERE parent_path IS NULL AND deleted_at IS NULL

  UNION ALL

  -- Child organizations
  SELECT
    o.id,
    o.name,
    o.path,
    ot.level + 1
  FROM organizations_projection o
  JOIN org_tree ot ON o.parent_path = ot.path
  WHERE o.deleted_at IS NULL
)
SELECT
  ot.name,
  ot.level,
  ot.path,
  COUNT(DISTINCT oc.contact_id) as contact_count,
  COUNT(DISTINCT CASE WHEN c.type = 'billing' THEN c.id END) as billing_contacts,
  COUNT(DISTINCT CASE WHEN c.type = 'technical' THEN c.id END) as technical_contacts,
  COUNT(DISTINCT CASE WHEN c.type = 'emergency' THEN c.id END) as emergency_contacts
FROM org_tree ot
LEFT JOIN organization_contacts oc ON ot.id = oc.org_id
LEFT JOIN contacts_projection c ON oc.contact_id = c.id AND c.deleted_at IS NULL
GROUP BY ot.id, ot.name, ot.level, ot.path
ORDER BY ot.path;
```

**Expected Output**:
| name | level | path | contact_count | billing_contacts | technical_contacts | emergency_contacts |
|---|---|---|---|---|---|---|
| Platform Owner (A4C) | 0 | root | 1 | 0 | 0 | 0 |
| Acme Healthcare | 1 | root.acme | 5 | 1 | 1 | 1 |
| Acme North Campus | 2 | root.acme.north | 3 | 1 | 1 | 1 |

**Performance**: O(n log n) with ltree index on `organizations_projection(path)`

---

## Row-Level Security (RLS) Policies

### Multi-Tenant Isolation

All projection tables enforce RLS using JWT custom claims:

```sql
-- contacts_projection: Users see only contacts for their org(s)
CREATE POLICY contacts_tenant_isolation ON contacts_projection
  FOR ALL
  TO authenticated
  USING (
    id IN (
      SELECT contact_id
      FROM organization_contacts
      WHERE org_id = (current_setting('request.jwt.claims', true)::json->>'org_id')::uuid
    )
  );

-- Super admin override: See all contacts globally
CREATE POLICY contacts_super_admin ON contacts_projection
  FOR ALL
  TO authenticated
  USING (
    (current_setting('request.jwt.claims', true)::json->>'user_role') = 'super_admin'
  );

ALTER TABLE contacts_projection ENABLE ROW LEVEL SECURITY;
```

```sql
-- addresses_projection: Users see only addresses for their org(s)
CREATE POLICY addresses_tenant_isolation ON addresses_projection
  FOR ALL
  TO authenticated
  USING (
    id IN (
      SELECT address_id
      FROM organization_addresses
      WHERE org_id = (current_setting('request.jwt.claims', true)::json->>'org_id')::uuid
    )
  );

CREATE POLICY addresses_super_admin ON addresses_projection
  FOR ALL
  TO authenticated
  USING (
    (current_setting('request.jwt.claims', true)::json->>'user_role') = 'super_admin'
  );

ALTER TABLE addresses_projection ENABLE ROW LEVEL SECURITY;
```

```sql
-- phones_projection: Users see only phones for their org(s)
CREATE POLICY phones_tenant_isolation ON phones_projection
  FOR ALL
  TO authenticated
  USING (
    id IN (
      SELECT phone_id
      FROM organization_phones
      WHERE org_id = (current_setting('request.jwt.claims', true)::json->>'org_id')::uuid
    )
  );

CREATE POLICY phones_super_admin ON phones_projection
  FOR ALL
  TO authenticated
  USING (
    (current_setting('request.jwt.claims', true)::json->>'user_role') = 'super_admin'
  );

ALTER TABLE phones_projection ENABLE ROW LEVEL SECURITY;
```

### Junction Table Policies

```sql
-- organization_contacts: Users see only links for their org
CREATE POLICY org_contacts_tenant_isolation ON organization_contacts
  FOR ALL
  TO authenticated
  USING (
    org_id = (current_setting('request.jwt.claims', true)::json->>'org_id')::uuid
  );

CREATE POLICY org_contacts_super_admin ON organization_contacts
  FOR ALL
  TO authenticated
  USING (
    (current_setting('request.jwt.claims', true)::json->>'user_role') = 'super_admin'
  );

ALTER TABLE organization_contacts ENABLE ROW LEVEL SECURITY;

-- Repeat for organization_addresses, organization_phones
-- contact_phones, contact_addresses, phone_addresses
```

### Testing RLS Policies

```sql
-- Test as provider admin (should see only own org's contacts)
SET request.jwt.claims = '{"org_id": "org-acme-uuid", "user_role": "provider_admin"}';
SELECT COUNT(*) FROM contacts_projection;  -- Should return only Acme contacts

-- Test as super admin (should see all contacts)
SET request.jwt.claims = '{"user_role": "super_admin"}';
SELECT COUNT(*) FROM contacts_projection;  -- Should return all contacts globally
```

---

## Event-Driven Architecture

### Domain Events

All contact operations emit domain events for audit trail and projection updates:

#### Contact Events
```yaml
contact.created:
  aggregate_type: contact
  aggregate_id: <contact_id>
  event_data:
    org_id: <org_id>
    label: "Billing Manager"
    type: billing
    first_name: "Bob"
    last_name: "Smith"
    email: "bob@acme.com"
    title: "Billing Manager"
    department: "Finance"

contact.updated:
  aggregate_type: contact
  aggregate_id: <contact_id>
  event_data:
    changed_fields:
      email: "bob.smith@acme.com"  # Updated email
      title: "Senior Billing Manager"  # Promoted

contact.deleted:
  aggregate_type: contact
  aggregate_id: <contact_id>
  event_data:
    deleted_at: "2025-01-14T10:30:00Z"
```

#### Junction Link Events
```yaml
organization.contact.linked:
  aggregate_type: organization_contact
  aggregate_id: <org_id>-<contact_id>
  event_data:
    org_id: <org_id>
    contact_id: <contact_id>
    linked_at: "2025-01-14T10:00:00Z"

organization.contact.unlinked:
  aggregate_type: organization_contact
  aggregate_id: <org_id>-<contact_id>
  event_data:
    org_id: <org_id>
    contact_id: <contact_id>
    unlinked_at: "2025-01-14T11:00:00Z"
    reason: "Contact transferred to different org"

contact.phone.linked:
  aggregate_type: contact_phone
  aggregate_id: <contact_id>-<phone_id>
  event_data:
    contact_id: <contact_id>
    phone_id: <phone_id>
    linked_at: "2025-01-14T10:00:00Z"

# Similar events for:
# - contact.address.linked / unlinked
# - phone.address.linked / unlinked
```

### Event Processors (PostgreSQL Triggers)

Event processors update projections when events are emitted:

```sql
CREATE OR REPLACE FUNCTION process_contact_event() RETURNS TRIGGER AS $$
BEGIN
  IF NEW.event_type = 'contact.created' THEN
    INSERT INTO contacts_projection (
      id, organization_id, label, type, first_name, last_name, email, title, department
    )
    VALUES (
      NEW.aggregate_id,
      (NEW.event_data->>'org_id')::uuid,
      NEW.event_data->>'label',
      (NEW.event_data->>'type')::contact_type,
      NEW.event_data->>'first_name',
      NEW.event_data->>'last_name',
      NEW.event_data->>'email',
      NEW.event_data->>'title',
      NEW.event_data->>'department'
    )
    ON CONFLICT (id) DO NOTHING;  -- Idempotent

  ELSIF NEW.event_type = 'contact.updated' THEN
    UPDATE contacts_projection
    SET
      email = COALESCE((NEW.event_data->'changed_fields'->>'email'), email),
      title = COALESCE((NEW.event_data->'changed_fields'->>'title'), title),
      updated_at = NOW()
    WHERE id = NEW.aggregate_id;

  ELSIF NEW.event_type = 'contact.deleted' THEN
    UPDATE contacts_projection
    SET deleted_at = (NEW.event_data->>'deleted_at')::timestamptz
    WHERE id = NEW.aggregate_id;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER contact_event_processor
  AFTER INSERT ON domain_events
  FOR EACH ROW
  WHEN (NEW.event_type LIKE 'contact.%')
  EXECUTE FUNCTION process_contact_event();
```

```sql
CREATE OR REPLACE FUNCTION process_junction_link_event() RETURNS TRIGGER AS $$
BEGIN
  IF NEW.event_type = 'organization.contact.linked' THEN
    INSERT INTO organization_contacts (org_id, contact_id)
    VALUES (
      (NEW.event_data->>'org_id')::uuid,
      (NEW.event_data->>'contact_id')::uuid
    )
    ON CONFLICT (org_id, contact_id) DO NOTHING;  -- Idempotent

  ELSIF NEW.event_type = 'organization.contact.unlinked' THEN
    DELETE FROM organization_contacts
    WHERE org_id = (NEW.event_data->>'org_id')::uuid
      AND contact_id = (NEW.event_data->>'contact_id')::uuid;
  END IF;

  -- Repeat for other junction link events

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER junction_link_event_processor
  AFTER INSERT ON domain_events
  FOR EACH ROW
  WHEN (NEW.event_type LIKE '%.linked' OR NEW.event_type LIKE '%.unlinked')
  EXECUTE FUNCTION process_junction_link_event();
```

---

## Performance Considerations

### Indexing Strategy

**Projection Tables**:
```sql
-- Frequently filtered columns
CREATE INDEX idx_contacts_type ON contacts_projection(type) WHERE deleted_at IS NULL;
CREATE INDEX idx_contacts_email ON contacts_projection(email) WHERE deleted_at IS NULL;
CREATE INDEX idx_contacts_active ON contacts_projection(is_active) WHERE deleted_at IS NULL;

-- Composite indexes for common queries
CREATE INDEX idx_contacts_type_org ON contacts_projection(type, organization_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_contacts_primary ON contacts_projection(organization_id, type, is_primary) WHERE is_primary = true AND deleted_at IS NULL;

-- Full-text search (if needed)
CREATE INDEX idx_contacts_name_fts ON contacts_projection USING GIN (
  to_tsvector('english', first_name || ' ' || last_name || ' ' || email)
) WHERE deleted_at IS NULL;
```

**Junction Tables**:
```sql
-- Foreign key indexes (created automatically with PRIMARY KEY)
-- Additional covering indexes for reverse lookups
CREATE INDEX idx_org_contacts_contact_org ON organization_contacts(contact_id, org_id);
CREATE INDEX idx_contact_phones_phone_contact ON contact_phones(phone_id, contact_id);
CREATE INDEX idx_contact_addresses_address_contact ON contact_addresses(address_id, contact_id);
```

### Query Optimization

**Use EXPLAIN ANALYZE**:
```sql
EXPLAIN ANALYZE
SELECT c.*, p.number
FROM contacts_projection c
JOIN contact_phones cp ON c.id = cp.contact_id
JOIN phones_projection p ON cp.phone_id = p.id
WHERE c.type = 'billing' AND c.organization_id = ?;

-- Expected plan: Index Scan on idx_contacts_type_org → Nested Loop Join
-- Target: <50ms for typical contact list query
```

**Materialized Views** (for expensive aggregations):
```sql
CREATE MATERIALIZED VIEW org_contact_stats AS
SELECT
  o.id as org_id,
  o.name as org_name,
  COUNT(DISTINCT oc.contact_id) as total_contacts,
  COUNT(DISTINCT CASE WHEN c.type = 'billing' THEN c.id END) as billing_contacts,
  COUNT(DISTINCT CASE WHEN c.type = 'technical' THEN c.id END) as technical_contacts,
  COUNT(DISTINCT CASE WHEN c.type = 'emergency' THEN c.id END) as emergency_contacts
FROM organizations_projection o
LEFT JOIN organization_contacts oc ON o.id = oc.org_id
LEFT JOIN contacts_projection c ON oc.contact_id = c.id AND c.deleted_at IS NULL
WHERE o.deleted_at IS NULL
GROUP BY o.id, o.name;

CREATE UNIQUE INDEX idx_org_contact_stats_org ON org_contact_stats(org_id);

-- Refresh periodically (daily or on-demand)
REFRESH MATERIALIZED VIEW CONCURRENTLY org_contact_stats;
```

### Caching Strategy

**Application-Level Caching** (Redis):
```typescript
// Cache frequently accessed contacts
const cacheKey = `contact:${contactId}`;
const cachedContact = await redis.get(cacheKey);

if (cachedContact) {
  return JSON.parse(cachedContact);
}

const contact = await db.query('SELECT * FROM contacts_projection WHERE id = $1', [contactId]);
await redis.setex(cacheKey, 3600, JSON.stringify(contact));  // Cache for 1 hour
return contact;
```

**Cache Invalidation** (on contact update):
```typescript
// When contact.updated event is processed
await redis.del(`contact:${contactId}`);
await redis.del(`org:${orgId}:contacts`);  // Invalidate org contact list
```

---

## Integration Points

### 1. Organization Management

**Current**: Organizations have basic org-level associations
**Enhanced**: Organizations have comprehensive contact directory

**Integration**:
- Organization detail page shows "Contacts" tab with list of all associated contacts
- Organization edit allows adding/removing contact associations (junction links)
- Organization deletion cascades to junction tables (preserves contact records)

**Query**:
```sql
-- Get all contacts for an organization (with phones and addresses)
SELECT
  c.id,
  c.first_name || ' ' || c.last_name as name,
  c.email,
  c.type,
  c.is_primary,
  ARRAY_AGG(DISTINCT p.number) FILTER (WHERE p.id IS NOT NULL) as phones,
  ARRAY_AGG(DISTINCT a.street1 || ', ' || a.city) FILTER (WHERE a.id IS NOT NULL) as addresses
FROM contacts_projection c
JOIN organization_contacts oc ON c.id = oc.contact_id
LEFT JOIN contact_phones cp ON c.id = cp.contact_id
LEFT JOIN phones_projection p ON cp.phone_id = p.id AND p.deleted_at IS NULL
LEFT JOIN contact_addresses ca ON c.id = ca.contact_id
LEFT JOIN addresses_projection a ON ca.address_id = a.id AND a.deleted_at IS NULL
WHERE oc.org_id = ?
  AND c.deleted_at IS NULL
GROUP BY c.id, c.first_name, c.last_name, c.email, c.type, c.is_primary
ORDER BY c.is_primary DESC, c.last_name;
```

---

### 2. User Management

**Current**: Users created from invitations, associated with single org
**Enhanced**: Users have contact records linked to their profile

**Integration**:
- User profile page shows associated contact record (if exists)
- Contact record links to user account (via email match)
- User invitation creates contact record automatically

**Sync Logic**:
```sql
-- Find contact record for a user
SELECT c.*
FROM contacts_projection c
WHERE c.email = (SELECT email FROM users WHERE id = ?)
  AND c.deleted_at IS NULL
LIMIT 1;

-- When user updates email, update linked contact
UPDATE contacts_projection
SET email = ?, updated_at = NOW()
WHERE email = (SELECT email FROM users WHERE id = ?)
  AND deleted_at IS NULL;
```

---

### 3. Workflow Orchestration (Temporal)

**Current**: Organization bootstrap workflow creates org + contacts atomically
**Enhanced**: Workflows emit contact/address/phone events, triggers populate junction tables

**Event Flow**:
```
Organization Bootstrap Workflow
  ├─ createOrganization activity
  │   ├─ Emit organization.created
  │   ├─ Emit contact.created (x3: general, billing, provider admin)
  │   ├─ Emit address.created (x3)
  │   ├─ Emit phone.created (x3)
  │   ├─ Emit organization.contact.linked (x3)
  │   ├─ Emit organization.address.linked (x3)
  │   ├─ Emit organization.phone.linked (x3)
  │   ├─ Emit contact.phone.linked (x6 for billing + provider admin fully connected groups)
  │   ├─ Emit contact.address.linked (x6)
  │   └─ Emit phone.address.linked (x6)
  ├─ configureDNS activity
  └─ emitBootstrapCompleted activity  // Trigger handler sets is_active=true
```

**Compensation (Rollback)**:
```typescript
// If workflow fails, compensation saga emits failure event + safety net deactivation
try {
  const orgId = await createOrganization(params);
  await configureDNS(params.subdomain);
  await emitBootstrapCompleted(orgId);  // Handler sets is_active=true
} catch (error) {
  await emitBootstrapFailed(orgId);        // Handler sets is_active=false
  await deactivateOrganization(orgId);     // Safety net fallback
  throw error;
}
```

---

### 4. RBAC (Role-Based Access Control)

**Permissions for Contact Management**:

```typescript
enum ContactPermission {
  // Read permissions
  CONTACTS_READ_ALL = 'contacts.read.all',           // Super admin: view all contacts globally
  CONTACTS_READ_ORG = 'contacts.read.org',           // Provider admin, clinician: view org contacts

  // Write permissions
  CONTACTS_WRITE_ALL = 'contacts.write.all',         // Super admin: create/update/delete any contact
  CONTACTS_WRITE_ORG = 'contacts.write.org',         // Provider admin: manage org contacts

  // Association permissions
  CONTACTS_ASSOCIATE = 'contacts.associate',         // Link existing contacts to org
  CONTACTS_REMOVE_ORG = 'contacts.remove.org',       // Remove contact from org (not delete)

  // Advanced permissions
  CONTACTS_MERGE = 'contacts.merge',                 // Super admin: merge duplicate contacts
  CONTACTS_BULK_IMPORT = 'contacts.bulk_import',     // Super admin: import from CSV
}

// Role assignments
const rolePermissions = {
  super_admin: [
    ContactPermission.CONTACTS_READ_ALL,
    ContactPermission.CONTACTS_WRITE_ALL,
    ContactPermission.CONTACTS_MERGE,
    ContactPermission.CONTACTS_BULK_IMPORT,
  ],
  provider_admin: [
    ContactPermission.CONTACTS_READ_ORG,
    ContactPermission.CONTACTS_WRITE_ORG,
    ContactPermission.CONTACTS_ASSOCIATE,
    ContactPermission.CONTACTS_REMOVE_ORG,
  ],
  clinician: [
    ContactPermission.CONTACTS_READ_ORG,
  ],
};
```

**Permission Checks**:
```sql
-- Check if user has permission to manage contacts for an organization
CREATE FUNCTION user_can_manage_contacts(user_id UUID, target_org_id UUID) RETURNS BOOLEAN AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1
    FROM user_permissions up
    WHERE up.user_id = user_id
      AND up.permission IN ('contacts.write.all', 'contacts.write.org')
      AND (
        up.permission = 'contacts.write.all'  -- Super admin (no org restriction)
        OR up.scope_org_id = target_org_id    -- Provider admin (own org only)
      )
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
```

---

### 5. Audit Logging

**All Contact Operations Logged**:

```sql
-- View audit trail for a specific contact
SELECT
  de.event_type,
  de.event_data,
  de.created_at,
  u.email as performed_by
FROM domain_events de
LEFT JOIN users u ON de.user_id = u.id
WHERE de.aggregate_type = 'contact'
  AND de.aggregate_id = ?
ORDER BY de.created_at DESC;
```

**Audit Trail Queries**:
```sql
-- Find who added a contact to an organization
SELECT
  u.email as performed_by,
  de.created_at as linked_at,
  de.event_data->>'org_id' as org_id,
  de.event_data->>'contact_id' as contact_id
FROM domain_events de
JOIN users u ON de.user_id = u.id
WHERE de.event_type = 'organization.contact.linked'
  AND de.event_data->>'org_id' = ?
ORDER BY de.created_at DESC;

-- Find all changes to a contact's email
SELECT
  de.event_data->'changed_fields'->>'email' as new_email,
  de.created_at as changed_at,
  u.email as changed_by
FROM domain_events de
JOIN users u ON de.user_id = u.id
WHERE de.event_type = 'contact.updated'
  AND de.aggregate_id = ?
  AND de.event_data->'changed_fields' ? 'email'
ORDER BY de.created_at DESC;
```

---

## Related Documentation

**Vision & Business Case**:
- [Contact Management Vision](../../architecture/features/contact-management-vision.md) - User stories, use cases, business value

**Implementation Guide**:
- [Contact Management Implementation Guide](../guides/contact-management-implementation-guide.md) - Phases, UI, testing, deployment

**Database Reference**:
- [contacts_projection](../reference/database/tables/contacts_projection.md) - Contact table schema (aspirational)
- [organization_contacts](../reference/database/tables/organization_contacts.md) - Junction table (aspirational)

**Related Architecture**:
- [Multi-Tenancy Architecture](../../architecture/data/multi-tenancy-architecture.md) - RLS policies, JWT claims
- [Event Sourcing Overview](../../architecture/data/event-sourcing-overview.md) - CQRS pattern, domain events
- [Organization Management Architecture](../../architecture/data/organization-management-architecture.md) - Org structure

**Infrastructure Foundation**:
- [Provider Onboarding Enhancement Plan](../../../dev/active/provider-onboarding-enhancement-plan.md) - Junction table infrastructure

---

**Status**: 🔮 Aspirational - Timeline: Indeterminate
**Foundation Ready**: ✅ Junction tables, type enums, event processors (via provider onboarding enhancement)
**When Prioritized**: Backend foundation exists, focus on UI/UX development and business logic
