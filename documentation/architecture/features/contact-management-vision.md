---
status: aspirational
last_updated: 2025-12-30
---

<!-- TL;DR-START -->
## TL;DR

**Summary**: Vision for future contact management module enabling many-to-many contact-organization relationships, multi-org sharing, and advanced relationship queries.

**When to read**:
- Planning contact management feature
- Understanding future data model for contacts
- Designing multi-org contact sharing
- Evaluating contact deduplication strategies

**Prerequisites**: Provider Onboarding Enhancement (Phase 1-6)

**Key topics**: `contacts`, `many-to-many`, `multi-org`, `junction-tables`, `deduplication`

**Estimated read time**: 15 minutes
<!-- TL;DR-END -->

# Contact Management Module - Vision

**Status**: 🔮 Aspirational
**Timeline**: Indeterminate
**Dependencies**: Provider Onboarding Enhancement (Phase 1-6)
**Last Updated**: 2025-01-14

---

## Overview

The **Contact Management module** is a future feature that will transform how A4C-AppSuite manages contact information across provider organizations, partner relationships, and stakeholder networks. Built on the many-to-many infrastructure created by the provider onboarding enhancement, this module will enable comprehensive contact relationship management, multi-organizational contact sharing, and advanced contact-based operations.

### Business Value

**Current Limitation**: Contacts are tied to a single organization, leading to data duplication when the same person works with multiple providers (e.g., consultants, VAR partner representatives, shared support staff).

**Future Capability**: A contact can be associated with multiple organizations through junction tables, creating a single source of truth that eliminates duplication and enables sophisticated relationship queries.

**ROI Drivers**:
- Reduced data duplication (consultants linked once, not duplicated per org)
- Improved data quality (update contact info once, visible everywhere)
- Enhanced communication (find all billing contacts across orgs in single query)
- Better stakeholder management (track relationships across org boundaries)
- Advanced analytics (identify shared resources, cross-org collaboration patterns)

---

## Key Capabilities

### 1. Multi-Organization Contact Sharing

**Capability**: Associate a single contact with multiple provider organizations without data duplication.

**Use Case**: **IT Consultant Management**
- John Doe is an IT consultant working with 5 different provider organizations
- **Without Contact Management**: 5 duplicate contact records (one per org), phone number updates require 5 edits
- **With Contact Management**: 1 contact record, 5 junction links, phone number updated once

**Enabled Queries**:
```sql
-- Find all organizations John Doe is associated with
SELECT o.name FROM organizations_projection o
JOIN organization_contacts oc ON o.id = oc.org_id
JOIN contacts_projection c ON oc.contact_id = c.id
WHERE c.email = 'john.doe@example.com';
```

### 2. Fully Connected Contact Groups

**Capability**: Create contact groups where contact, address, and phone are all interconnected (not just org-level links).

**Use Case**: **Billing Department Contact Group**
- Billing department has 3 staff members, shared office address, shared fax line, individual mobile phones
- Junction links: org→contacts (3), org→address (1), org→phones (4), contact→address (3), contact→phone (3), phone→address (1)
- Result: "Jane Doe (billing contact) can be reached at (555) 123-4567 (her mobile) and mail sent to 456 Oak St (billing office)"

**Enabled Queries**:
```sql
-- Find all billing contacts with their mobile phones and office address
SELECT c.first_name, c.last_name, p.number as mobile, a.street1
FROM contacts_projection c
JOIN contact_phones cp ON c.id = cp.contact_id
JOIN phones_projection p ON cp.phone_id = p.id AND p.type = 'mobile'
JOIN contact_addresses ca ON c.id = ca.contact_id
JOIN addresses_projection a ON ca.address_id = a.id AND a.type = 'billing'
WHERE c.type = 'billing' AND c.organization_id = ?;
```

### 3. Type-Based Business Operations

**Capability**: Classify contacts by role (billing, technical, emergency, stakeholder, a4c_admin) and execute type-specific operations.

**Use Case**: **Emergency Contact Alerts**
- System detects critical outage at 2 AM
- Query all emergency contacts across affected organizations
- Send SMS alerts to emergency contacts only (not billing or technical)

**Enabled Queries**:
```sql
-- Get all emergency contacts with mobile phones for affected orgs
SELECT c.first_name, c.last_name, p.number
FROM contacts_projection c
JOIN contact_phones cp ON c.id = cp.contact_id
JOIN phones_projection p ON cp.phone_id = p.id AND p.type = 'mobile'
WHERE c.type = 'emergency'
  AND c.organization_id IN (affected_org_ids)
  AND c.is_active = true;
```

### 4. Location-Based Contact Queries

**Capability**: Find contacts based on physical location, link phones to addresses, map staff to office locations.

**Use Case**: **Multi-Office Provider Contact Roster**
- Provider has 3 office locations (downtown, midtown, uptown)
- Each office has reception desk, fax line, and staff roster
- Query: "Who works at the downtown office?" or "What's the fax number for midtown?"

**Enabled Queries**:
```sql
-- Find all staff at downtown office
SELECT c.first_name, c.last_name, c.title
FROM contacts_projection c
JOIN contact_addresses ca ON c.id = ca.contact_id
JOIN addresses_projection a ON ca.address_id = a.id
WHERE a.label = 'Downtown Office';

-- Find reception phone for midtown office
SELECT p.number FROM phones_projection p
JOIN phone_addresses pa ON p.id = pa.phone_id
JOIN addresses_projection a ON pa.address_id = a.id
WHERE a.label = 'Midtown Office' AND p.type = 'office';
```

### 5. Contact Lifecycle Management

**Capability**: Add, remove, transfer, and merge contacts across organizational boundaries.

**Operations**:
- **Add Existing Contact**: Link contact to new organization (no duplication)
- **Remove Contact**: Unlink contact from organization (preserves contact record)
- **Transfer Contact**: Move contact from one org to another (or add to both)
- **Merge Duplicates**: Combine duplicate contacts, reassign all relationships to canonical contact

**Use Case**: **VAR Partner Relationship Change**
- Provider switches from VAR Partner A to VAR Partner B
- VAR Partner A's sales contact needs to be removed from provider's org
- VAR Partner B's sales contact needs to be added
- **Without Contact Management**: Delete old contact, create new contact (loses history)
- **With Contact Management**: Unlink old contact (preserves history), link existing VAR B contact (no duplication)

---

## Primary User Stories

### Super Admins (Platform Owner)

#### US-1: Global Contact Directory
**As a** super admin
**I want to** view all contacts across all provider organizations
**So that** I can manage platform-wide communications and identify shared resources

**Acceptance Criteria**:
- Contact list shows all contacts globally (not scoped to single org)
- Filter by organization (multi-select)
- Filter by contact type (billing, technical, emergency)
- Search by name, email, phone
- Export to CSV for reporting

#### US-2: Multi-Org Contact Associations
**As a** super admin
**I want to** associate a consultant contact with multiple provider organizations
**So that** they can access multiple client systems without duplicate accounts

**Acceptance Criteria**:
- Select existing contact from global directory
- Link contact to multiple organizations via junction table
- Contact appears in each org's contact list
- Update contact info once, visible to all linked orgs

#### US-3: Contact Deduplication
**As a** super admin
**I want to** merge duplicate contacts
**So that** there's a single source of truth for each person

**Acceptance Criteria**:
- Detect potential duplicates (fuzzy match on name + email)
- Side-by-side comparison view
- Select canonical contact
- Reassign all org associations to canonical contact
- Archive duplicate contact (soft delete with audit trail)

---

### Provider Admins

#### US-4: Organization Contact Management
**As a** provider admin
**I want to** add/remove contacts from my organization without creating duplicates
**So that** contact information stays accurate and up-to-date

**Acceptance Criteria**:
- "Add Existing Contact" searches global directory
- If contact exists, create junction link (not duplicate record)
- "Create New Contact" creates new contact and links to org
- Remove contact from org (preserves contact, removes junction link)
- Cannot delete contacts used by other organizations

#### US-5: Contact Role Assignment
**As a** provider admin
**I want to** designate which contact is our billing contact
**So that** invoices are sent to the right person

**Acceptance Criteria**:
- Set contact type to "billing"
- Mark as primary billing contact (is_primary = true)
- Unique constraint: only one primary billing contact per org
- Billing contact appears in organization detail view
- Billing contact automatically included in invoice emails

#### US-6: Contact Information Updates
**As a** provider admin
**I want to** update a contact's phone number and have it reflect everywhere they're associated
**So that** I don't have to update multiple records

**Acceptance Criteria**:
- Edit contact phone number
- Change reflected in all organizations contact is linked to
- Audit log records who made the change
- Domain event emitted: `contact.updated`

#### US-7: Emergency Contact Lists
**As a** provider admin
**I want to** generate a list of all emergency contacts for after-hours incidents
**So that** support staff knows who to call

**Acceptance Criteria**:
- Filter contacts by type = "emergency"
- Show contact name, mobile phone, email
- Export to PDF or CSV
- Include only active contacts (is_active = true)

---

### Clinicians / Support Staff

#### US-8: Quick Contact Lookup
**As a** clinician
**I need to** quickly find the billing contact for a client's organization to resolve a payment issue
**So that** I can address billing questions without delay

**Acceptance Criteria**:
- Search by organization name
- Display primary billing contact
- Show contact phone, email, address
- Click to call (if telephony integrated) or click to email

#### US-9: Contact Communication Preferences
**As a** support staff member
**I need to** know whether to call or email a contact based on their preferred method
**So that** I respect their communication preferences

**Acceptance Criteria**:
- Contact record has "preferred contact method" field (email, phone, SMS)
- Contact detail shows preference badge
- Communication history tracks method used
- "Do Not Contact" flag overrides all communication

---

### VAR Partners

#### US-10: Shared Contact Management
**As a** VAR partner
**I want to** share my technical support contact with multiple provider organizations I resell to
**So that** all my clients can reach our support team

**Acceptance Criteria**:
- VAR partner creates technical support contact
- Link support contact to all reseller provider orgs
- Providers see VAR support contact in their contact list
- Providers cannot edit VAR contact info (read-only for providers)

#### US-11: Referral Contact Tracking
**As a** stakeholder partner (family services)
**I want to** track which provider organization contacts I've worked with for each client referral
**So that** I can maintain referral relationships

**Acceptance Criteria**:
- View contact history (when added to which orgs)
- Filter contacts by organization and date range
- Export referral contact report
- Track communication history with each contact

---

## Real-World Use Cases

### Use Case 1: IT Consultant Onboarding

**Scenario**: John Doe is an IT consultant hired by 5 provider organizations to implement medication tracking integrations.

**Without Contact Management**:
1. Each provider creates a contact record for John Doe (5 duplicates)
2. John Doe changes his phone number
3. Must email all 5 providers to update contact info
4. Providers update at different times (inconsistent data)
5. Provider #3 never updates (outdated phone number)

**With Contact Management**:
1. First provider creates contact record for John Doe
2. Remaining 4 providers search global directory, link existing contact
3. John Doe updates phone number in his profile (or any provider updates it)
4. Change instantly visible to all 5 providers (single source of truth)
5. Audit log shows who made the update and when

**Queries Enabled**:
```sql
-- Find all organizations John Doe is working with
SELECT o.name, oc.created_at as linked_since
FROM organizations_projection o
JOIN organization_contacts oc ON o.id = oc.org_id
JOIN contacts_projection c ON oc.contact_id = c.id
WHERE c.email = 'john.doe@consultant.com'
ORDER BY oc.created_at DESC;

-- Find all shared contacts (working with multiple orgs)
SELECT c.first_name, c.last_name, COUNT(oc.org_id) as org_count
FROM contacts_projection c
JOIN organization_contacts oc ON c.id = oc.contact_id
GROUP BY c.id HAVING COUNT(oc.org_id) > 1;
```

---

### Use Case 2: Multi-Office Provider Organization

**Scenario**: Acme Healthcare has 3 office locations (downtown, midtown, uptown). Each office has its own reception desk, fax line, and staff roster.

**Data Model**:
- 3 addresses: Downtown Office (123 Main St), Midtown Office (456 Oak Ave), Uptown Office (789 Elm Rd)
- 6 phones: 3 reception lines, 3 fax lines
- 15 contacts: 5 staff per location (receptionists, nurses, case managers)
- Junction links:
  - `phone_addresses`: Link each reception/fax to its physical office
  - `contact_addresses`: Link each staff member to their work location
  - `contact_phones`: Link staff to their desk extensions

**Queries Enabled**:
```sql
-- Find all staff at downtown office
SELECT c.first_name, c.last_name, c.title, p.number as extension
FROM contacts_projection c
JOIN contact_addresses ca ON c.id = ca.contact_id
JOIN addresses_projection a ON ca.address_id = a.id
LEFT JOIN contact_phones cp ON c.id = cp.contact_id
LEFT JOIN phones_projection p ON cp.phone_id = p.id AND p.type = 'office'
WHERE a.label = 'Downtown Office' AND c.is_active = true;

-- Find reception and fax numbers for midtown office
SELECT p.type, p.number
FROM phones_projection p
JOIN phone_addresses pa ON p.id = pa.phone_id
JOIN addresses_projection a ON pa.address_id = a.id
WHERE a.label = 'Midtown Office' AND p.type IN ('office', 'fax');
```

**Business Value**:
- Emergency routing: "Call downtown office reception during outage"
- Staff directory: "Who works at each location?"
- Logistics: "Where should I send equipment for uptown office?"

---

### Use Case 3: VAR Partner Reseller Network

**Scenario**: TechPartner VAR resells A4C-AppSuite to 20 provider organizations. Each provider needs to contact TechPartner's sales, technical support, and billing departments.

**Data Model**:
- 1 VAR partner organization (TechPartner)
- 3 VAR contacts: Sales (Jane), Technical Support (Bob), Billing (Alice)
- 20 provider organizations, each with `referring_partner_id = TechPartner.id`
- Junction links: 3 contacts linked to TechPartner org

**Queries Enabled**:
```sql
-- Find technical support contact for my VAR partner
SELECT c.first_name, c.last_name, c.email, p.number
FROM contacts_projection c
JOIN organization_contacts oc ON c.id = oc.contact_id
JOIN organizations_projection o ON oc.org_id = o.id
LEFT JOIN contact_phones cp ON c.id = cp.contact_id
LEFT JOIN phones_projection p ON cp.phone_id = p.id AND p.is_primary = true
WHERE o.id = (SELECT referring_partner_id FROM organizations_projection WHERE id = ?)
  AND c.type = 'technical';

-- Find all providers referred by TechPartner
SELECT o.name, o.subdomain, o.created_at
FROM organizations_projection o
WHERE o.referring_partner_id = ?
ORDER BY o.created_at DESC;

-- Find all VAR partner contacts (sales, support, billing)
SELECT c.first_name, c.last_name, c.type, c.email
FROM contacts_projection c
JOIN organization_contacts oc ON c.id = oc.contact_id
WHERE oc.org_id = ?
ORDER BY c.type;
```

**Business Value**:
- Providers can quickly contact VAR support (no digging through emails)
- TechPartner can update their contact info once, visible to all 20 providers
- Platform owner can analyze VAR partner effectiveness (# of referrals, contact activity)

---

### Use Case 4: Billing Department Contact Group

**Scenario**: Acme Healthcare's billing department has 3 staff members working from a shared office with a shared fax line for insurance claims.

**Data Model** (Fully Connected Contact Group):
- 3 contacts: Jane Doe (Billing Manager), Bob Smith (Billing Specialist), Alice Johnson (Claims Coordinator)
- 1 address: Billing Office, 456 Oak St, Suite 200
- 4 phones: Shared fax (555-111-1111), Jane's mobile (555-222-2222), Bob's mobile (555-333-3333), Alice's mobile (555-444-4444)
- Junction links (21 total):
  - 3 org→contact, 1 org→address, 4 org→phone (org-level links)
  - 3 contact→address (all 3 staff work at billing office)
  - 3 contact→phone (each person has their mobile)
  - 1 phone→address (fax line is at billing office address)

**Queries Enabled**:
```sql
-- Find all billing contacts with their mobile phones and office location
SELECT
  c.first_name || ' ' || c.last_name as name,
  c.title,
  p.number as mobile,
  a.street1 || ', ' || a.city as office
FROM contacts_projection c
JOIN contact_phones cp ON c.id = cp.contact_id
JOIN phones_projection p ON cp.phone_id = p.id AND p.type = 'mobile'
JOIN contact_addresses ca ON c.id = ca.contact_id
JOIN addresses_projection a ON ca.address_id = a.id AND a.type = 'billing'
WHERE c.type = 'billing' AND c.organization_id = ?;

-- Find the fax number for billing office
SELECT p.number
FROM phones_projection p
JOIN phone_addresses pa ON p.id = pa.phone_id
JOIN addresses_projection a ON pa.address_id = a.id
WHERE a.type = 'billing' AND p.type = 'fax';

-- Find all people who work at billing office address
SELECT c.first_name, c.last_name, c.title, c.email
FROM contacts_projection c
JOIN contact_addresses ca ON c.id = ca.contact_id
JOIN addresses_projection a ON ca.address_id = a.id
WHERE a.type = 'billing' AND c.is_active = true;
```

**Business Value**:
- Centralized billing contact directory (who to contact for what)
- Emergency coverage (if Jane is unavailable, call Bob or Alice on their mobiles)
- Fax routing (send insurance claims to billing office fax)
- Office relocation (update billing address once, reflects for all 3 staff)

---

## Infrastructure Foundation

The Contact Management module builds on many-to-many infrastructure created by the **Provider Onboarding Enhancement** project:

### Junction Tables (Relationships)

1. **`organization_contacts`** - Organizations ↔ Contacts (many-to-many)
2. **`organization_addresses`** - Organizations ↔ Addresses (many-to-many)
3. **`organization_phones`** - Organizations ↔ Phones (many-to-many)
4. **`contact_phones`** - Contacts ↔ Phones (many-to-many, personal phones)
5. **`contact_addresses`** - Contacts ↔ Addresses (many-to-many, personal addresses)
6. **`phone_addresses`** - Phones ↔ Addresses (many-to-many, location association)

### Type Enums (Classification)

1. **`contact_type`**: a4c_admin, billing, technical, emergency, stakeholder
2. **`address_type`**: physical, mailing, billing
3. **`phone_type`**: mobile, office, fax, emergency

### Event-Driven Architecture

All contact operations emit domain events for audit trail and projection updates:
- `contact.created`, `contact.updated`, `contact.deleted`
- `organization.contact.linked`, `organization.contact.unlinked`
- `contact.phone.linked`, `contact.address.linked`
- `phone.address.linked`

---

## Why This Infrastructure Investment?

The provider onboarding enhancement only needs simple 1-to-many relationships (each org has multiple contacts). But we're building many-to-many infrastructure because:

### Avoid Future Data Model Surgery
Adding many-to-many relationships later requires:
- Complex migrations (transform 1-to-many to many-to-many)
- Data transformation (split embedded data into junction tables)
- Downtime (cannot be done online)
- Risk (data loss if migration fails)

**Building it now**: Clean data model from day one, no future migration pain.

### Enable Future Contact Management Module
When business needs arise, UI/UX can be built quickly on solid foundation:
- Backend data model: Already exists ✅
- Event processors: Already implemented ✅
- RLS policies: Already enforced ✅
- API queries: Just write SQL ✅
- **Only needs**: Frontend components (contact directory, contact detail, contact edit)

**Estimated time savings**: 4-6 weeks (no data model work, no backend refactoring)

### Prevent Data Duplication
Single source of truth for contact information:
- Consultant exists once, linked to 5 orgs (not 5 duplicate records)
- Update phone number once, visible everywhere
- No data sync issues (inconsistent phone numbers across orgs)

### Support Complex Queries
Junction tables enable queries impossible with embedded data:
- "Find all orgs where John Doe is a contact" (join `organization_contacts`)
- "Find all contacts at 123 Main St" (join `contact_addresses`)
- "Find all billing contacts across all orgs" (filter by `contact_type`)

**Without junction tables**: These queries would require full table scans, JSONB parsing, or be impossible.

---

## Success Criteria (When Implemented)

### Functional Requirements
- ✅ View global contact directory (super admin)
- ✅ Link contact to multiple organizations (no duplication)
- ✅ Manage contact phones and addresses (CRUD operations)
- ✅ Filter contacts by type (billing, technical, emergency)
- ✅ Search contacts by name, email, phone, address
- ✅ Export contact directory to CSV
- ✅ Merge duplicate contacts (deduplication)
- ✅ Track contact lifecycle (audit trail via domain events)

### Non-Functional Requirements
- ✅ RLS policies enforce multi-tenant isolation
- ✅ Query performance: <100ms for contact list (indexed joins)
- ✅ Idempotent operations (contact creation, junction links)
- ✅ Event-driven updates (domain events for all changes)
- ✅ Accessibility: WCAG 2.1 AA compliant UI

### Business Metrics
- **Data Quality**: <5% duplicate contacts (down from estimated 20-30% without deduplication)
- **Operational Efficiency**: 50% reduction in time to update contact info (update once vs update per org)
- **User Satisfaction**: >80% provider admins find contact management "easy to use"
- **Adoption**: >70% of provider orgs use Contact Management module within 6 months of launch

---

## Related Documentation

**Architecture**:
- [Contact Management Architecture](../../infrastructure/architecture/contact-management-architecture.md) - Data model, queries, integration
- [Multi-Tenancy Architecture](../data/multi-tenancy-architecture.md) - RLS policies, JWT claims
- [Event Sourcing Overview](../data/event-sourcing-overview.md) - CQRS pattern, domain events

**Implementation**:
- [Contact Management Implementation Guide](../../infrastructure/guides/contact-management-implementation-guide.md) - Phases, UI, testing
- Provider Onboarding Enhancement Plan - Junction table infrastructure (dev task archived)

**Reference**:
- [Database Tables: contacts_projection](../../infrastructure/reference/database/tables/contacts_projection.md) - Contact schema
- [Database Tables: organization_contacts](../../infrastructure/reference/database/tables/organization_contacts.md) - Junction table

---

## Next Steps (When Prioritized)

1. **Review and Validate**: Review this vision document with stakeholders, validate user stories
2. **UI/UX Design**: Create wireframes and mockups for contact directory, detail view, edit forms
3. **Implementation Planning**: Break down into sprints, assign to development team
4. **Phase 1 Development**: Basic contact directory (read-only, view contacts, search/filter)
5. **Phase 2 Development**: Contact CRUD (create, edit, delete, link to orgs)
6. **Phase 3 Development**: Advanced features (deduplication, import/export, communication history)
7. **Testing & Validation**: E2E testing, accessibility audit, performance testing
8. **Production Rollout**: Deploy to production, monitor adoption, gather feedback

**Estimated Total Time**: 14-19 weeks (3.5-5 months) for complete Contact Management module

---

**Status**: 🔮 Aspirational - Timeline: Indeterminate
**Foundation Ready**: ✅ Junction tables, type enums, event processors (via provider onboarding enhancement)
**When Prioritized**: Backend foundation already exists, UI/UX development can start immediately
