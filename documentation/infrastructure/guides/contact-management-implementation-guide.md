---
status: aspirational
last_updated: 2025-12-30
---

<!-- TL;DR-START -->
## TL;DR

**Summary**: Comprehensive implementation roadmap for Contact Management module covering 5 phases: directory view, CRUD operations, advanced associations (phones/addresses), deduplication/import, and communication tracking. Foundation infrastructure complete via provider onboarding enhancement.

**When to read**:
- Planning Contact Management feature development
- Understanding contact data model and relationships
- Designing contact directory UI components
- Implementing contact import/export or deduplication

**Prerequisites**: [Provider Onboarding Enhancement](../../../dev/active/provider-onboarding-enhancement-plan.md) complete

**Key topics**: `contact-management`, `junction-tables`, `deduplication`, `csv-import`, `communication-history`

**Estimated read time**: 45 minutes (comprehensive guide)
<!-- TL;DR-END -->

# Contact Management Implementation Guide

**Status**: 🔮 Aspirational
**Timeline**: Indeterminate
**Dependencies**: Provider Onboarding Enhancement (Phases 1-6 complete)
**Last Updated**: 2025-01-14

---

## Overview

This guide provides a comprehensive implementation roadmap for the Contact Management module. It covers dependencies, suggested implementation phases, UI components, API endpoints, testing strategy, and deployment considerations.

When this feature is eventually prioritized, developers will have a clear path from foundation (already built via provider onboarding enhancement) to production-ready Contact Management system.

---

## Prerequisites

### Required Before Starting

**✅ Provider Onboarding Enhancement Complete**:
All 6 phases of the provider onboarding enhancement must be deployed to production:

- **Phase 1**: Database schema (junction tables, type enums) ✅
- **Phase 2**: Event processors (triggers for contact/address/phone events) ✅
- **Phase 3**: Workflow updates (event emission in createOrganization activity) ✅
- **Phase 4**: Frontend UI (organization create form collects contact data) ✅
- **Phase 5**: Documentation (table schemas, event contracts) ✅
- **Phase 6**: Testing & validation (database, workflows, frontend, E2E) ✅

**✅ Foundation Infrastructure Verified**:
- Junction tables exist: `organization_contacts`, `organization_addresses`, `organization_phones`, `contact_phones`, `contact_addresses`, `phone_addresses`
- Type enums exist: `contact_type`, `address_type`, `phone_type`
- Event processors active: `process_contact_event()`, `process_junction_link_event()`
- RLS policies enforced: Multi-tenant isolation working
- Audit trail working: Domain events logged for all operations

**✅ Development Environment Ready**:
- Supabase CLI installed and configured
- Local development database accessible
- Frontend development server running (`npm run dev`)
- TypeScript types generated from database schema

### External Dependencies

**Supabase**:
- PostgreSQL 15+ with RLS support
- Edge Functions (for API endpoints if needed)
- Realtime subscriptions (for live contact updates if needed)

**Frontend**:
- React 19 + TypeScript
- MobX (state management)
- Tailwind CSS (styling)
- Custom component library (SelectDropdown, Modal, etc.)

**Optional Enhancements**:
- Elasticsearch (for full-text contact search)
- Redis (for caching frequently accessed contacts)
- SendGrid/Mailgun (for contact communication tracking)

---

## Implementation Phases

### Phase 1: Basic Contact Directory (3-4 weeks)

**Goal**: Read-only contact directory with search and filter

**Deliverables**:
- Contact list page (table/card view)
- Contact detail view (modal or side panel)
- Search by name, email, phone
- Filter by type (billing, technical, emergency)
- Filter by organization (multi-select)
- Export to CSV

**UI Components**:

1. **ContactListPage** (`frontend/src/pages/contacts/ContactListPage.tsx`)
   - Table view with sortable columns (name, email, type, organization)
   - Search bar (debounced, searches name/email/phone)
   - Filter panel (type, organization, active/inactive)
   - Pagination (20 contacts per page)
   - Export button (downloads CSV)

2. **ContactCard** (`frontend/src/components/contacts/ContactCard.tsx`)
   - Contact name, email, type badge
   - Organization affiliation(s)
   - Phone numbers, addresses (collapsed by default)
   - Click to view details

3. **ContactDetailModal** (`frontend/src/components/contacts/ContactDetailModal.tsx`)
   - Full contact information (name, email, title, department)
   - Associated organizations (list with badges)
   - Phone numbers (with type labels: mobile, office, fax)
   - Addresses (with type labels: physical, mailing, billing)
   - Activity log (when added to orgs, last updated)
   - Close/Edit buttons

**API Endpoints**:

```typescript
// GET /api/contacts?search=john&type=billing&org_id=123&page=1&limit=20
interface GetContactsRequest {
  search?: string;          // Search name, email, phone
  type?: ContactType[];     // Filter by type (multi-select)
  org_id?: string[];        // Filter by organization (multi-select)
  is_active?: boolean;      // Filter by active/inactive
  page: number;             // Pagination
  limit: number;            // Results per page (default: 20)
}

interface GetContactsResponse {
  contacts: Contact[];
  total_count: number;
  page: number;
  limit: number;
}

// GET /api/contacts/:id
interface GetContactByIdResponse {
  contact: Contact;
  organizations: Organization[];  // All orgs this contact is linked to
  phones: Phone[];
  addresses: Address[];
  activity_log: ActivityLogEntry[];
}
```

**SQL Queries**:

```sql
-- Get paginated contact list with search and filters
SELECT
  c.id,
  c.first_name || ' ' || c.last_name as name,
  c.email,
  c.type,
  c.title,
  c.is_primary,
  c.is_active,
  ARRAY_AGG(DISTINCT o.name) as organizations,
  COUNT(*) OVER() as total_count  -- For pagination
FROM contacts_projection c
JOIN organization_contacts oc ON c.id = oc.contact_id
JOIN organizations_projection o ON oc.org_id = o.id
WHERE c.deleted_at IS NULL
  AND o.deleted_at IS NULL
  AND (
    $1::text IS NULL OR  -- Search parameter
    c.first_name ILIKE '%' || $1 || '%' OR
    c.last_name ILIKE '%' || $1 || '%' OR
    c.email ILIKE '%' || $1 || '%'
  )
  AND ($2::contact_type[] IS NULL OR c.type = ANY($2))  -- Type filter
  AND ($3::uuid[] IS NULL OR oc.org_id = ANY($3))       -- Org filter
  AND ($4::boolean IS NULL OR c.is_active = $4)         -- Active filter
GROUP BY c.id, c.first_name, c.last_name, c.email, c.type, c.title, c.is_primary, c.is_active
ORDER BY c.last_name, c.first_name
LIMIT $5 OFFSET $6;  -- Pagination
```

**Testing**:
- Unit tests: ContactListPage component rendering
- Integration tests: API endpoints return correct data
- E2E tests: Search, filter, pagination, export to CSV
- Accessibility: Keyboard navigation, screen reader support

**Time Estimate**: 3-4 weeks

---

### Phase 2: Contact CRUD Operations (2-3 weeks)

**Goal**: Create, edit, delete contacts and link to organizations

**Deliverables**:
- Create new contact form
- Edit contact form
- Delete contact (soft delete with confirmation)
- Link existing contact to organization
- Remove contact from organization (preserve contact record)

**UI Components**:

1. **ContactCreateModal** (`frontend/src/components/contacts/ContactCreateModal.tsx`)
   - Form fields: First name, last name, email (required)
   - Optional fields: Title, department, type, label
   - Phone numbers (dynamic list, add/remove)
   - Addresses (dynamic list, add/remove)
   - Organization association (multi-select dropdown)
   - Save/Cancel buttons
   - Validation: Email uniqueness check, required fields

2. **ContactEditModal** (`frontend/src/components/contacts/ContactEditModal.tsx`)
   - Pre-populated form with existing contact data
   - Allow editing all fields except ID
   - Show audit trail (last updated, updated by)
   - Save/Cancel buttons

3. **ContactDeleteConfirmModal** (`frontend/src/components/contacts/ContactDeleteConfirmModal.tsx`)
   - Warning message: "Are you sure you want to delete this contact?"
   - Show organizations currently linked (warning if >1 org)
   - Checkbox: "I understand this will soft-delete the contact"
   - Delete/Cancel buttons

4. **LinkContactToOrgModal** (`frontend/src/components/contacts/LinkContactToOrgModal.tsx`)
   - Search existing contacts (global directory for super admin, org contacts for provider admin)
   - Duplicate detection: "Contact already linked to this org"
   - Select contact from list
   - Confirm/Cancel buttons

**API Endpoints**:

```typescript
// POST /api/contacts
interface CreateContactRequest {
  first_name: string;
  last_name: string;
  email: string;
  title?: string;
  department?: string;
  type: ContactType;
  label: string;
  phones?: PhoneInput[];
  addresses?: AddressInput[];
  organization_ids: string[];  // Link to these orgs
}

interface CreateContactResponse {
  contact_id: string;
  contact: Contact;
}

// PUT /api/contacts/:id
interface UpdateContactRequest {
  first_name?: string;
  last_name?: string;
  email?: string;
  title?: string;
  department?: string;
  type?: ContactType;
  label?: string;
}

interface UpdateContactResponse {
  contact: Contact;
}

// DELETE /api/contacts/:id
interface DeleteContactRequest {
  confirm: boolean;  // Must be true
}

interface DeleteContactResponse {
  success: boolean;
  deleted_at: string;
}

// POST /api/contacts/:id/link-to-org
interface LinkContactToOrgRequest {
  org_id: string;
}

interface LinkContactToOrgResponse {
  success: boolean;
  linked_at: string;
}

// DELETE /api/contacts/:id/unlink-from-org/:org_id
interface UnlinkContactFromOrgResponse {
  success: boolean;
  unlinked_at: string;
}
```

**Event Emission**:

All CRUD operations emit domain events:

```typescript
// Create contact
await emitEvent({
  event_type: 'contact.created',
  aggregate_type: 'contact',
  aggregate_id: contactId,
  event_data: {
    org_id: orgId,
    first_name: 'John',
    last_name: 'Doe',
    email: 'john@example.com',
    type: 'billing',
    label: 'Billing Manager',
  },
});

// Link contact to org
await emitEvent({
  event_type: 'organization.contact.linked',
  aggregate_type: 'organization_contact',
  aggregate_id: `${orgId}-${contactId}`,
  event_data: {
    org_id: orgId,
    contact_id: contactId,
    linked_at: new Date().toISOString(),
  },
});

// Update contact
await emitEvent({
  event_type: 'contact.updated',
  aggregate_type: 'contact',
  aggregate_id: contactId,
  event_data: {
    changed_fields: {
      email: 'john.doe@example.com',
      title: 'Senior Billing Manager',
    },
  },
});

// Soft delete contact
await emitEvent({
  event_type: 'contact.deleted',
  aggregate_type: 'contact',
  aggregate_id: contactId,
  event_data: {
    deleted_at: new Date().toISOString(),
  },
});
```

**Testing**:
- Unit tests: Form validation, duplicate detection
- Integration tests: CRUD operations emit correct events
- E2E tests: Create contact → link to org → edit → delete
- Accessibility: Form keyboard navigation, error announcements

**Time Estimate**: 2-3 weeks

---

### Phase 3: Advanced Associations (3-4 weeks)

**Goal**: Manage contact phones, addresses, and fully connected contact groups

**Deliverables**:
- Manage contact phones (add/remove personal phones)
- Manage contact addresses (add/remove personal addresses)
- Link phones to addresses (location association)
- Fully connected contact group management (billing department example)

**UI Components**:

1. **ContactPhonesTab** (`frontend/src/components/contacts/ContactPhonesTab.tsx`)
   - List all phones for a contact
   - Add phone button (opens AddPhoneModal)
   - Remove phone button (confirmation)
   - Mark as primary (radio button, one primary per type)

2. **ContactAddressesTab** (`frontend/src/components/contacts/ContactAddressesTab.tsx`)
   - List all addresses for a contact
   - Add address button (opens AddAddressModal)
   - Remove address button (confirmation)
   - Mark as primary (radio button, one primary per type)

3. **PhoneAddressLinkModal** (`frontend/src/components/contacts/PhoneAddressLinkModal.tsx`)
   - Select phone from dropdown (phones associated with contact)
   - Select address from dropdown (addresses associated with contact)
   - Create link button
   - Use case: "This fax line is at the billing office address"

4. **ContactGroupBuilder** (`frontend/src/components/contacts/ContactGroupBuilder.tsx`)
   - Fully connected group UI (drag-and-drop?)
   - Contact card + Address cards + Phone cards
   - Visual links showing connections (contact→address, contact→phone, phone→address)
   - Use case: Billing department (3 people, 1 office, 4 phones all interconnected)

**API Endpoints**:

```typescript
// POST /api/contacts/:id/phones
interface AddPhoneToContactRequest {
  phone_id?: string;  // Existing phone (if linking)
  label?: string;     // New phone (if creating)
  number?: string;
  type?: PhoneType;
}

interface AddPhoneToContactResponse {
  phone_id: string;
  linked_at: string;
}

// DELETE /api/contacts/:contact_id/phones/:phone_id
interface RemovePhoneFromContactResponse {
  success: boolean;
  unlinked_at: string;
}

// POST /api/contacts/:id/addresses
interface AddAddressToContactRequest {
  address_id?: string;  // Existing address (if linking)
  label?: string;       // New address (if creating)
  street1?: string;
  city?: string;
  state?: string;
  zip_code?: string;
  type?: AddressType;
}

interface AddAddressToContactResponse {
  address_id: string;
  linked_at: string;
}

// DELETE /api/contacts/:contact_id/addresses/:address_id
interface RemoveAddressFromContactResponse {
  success: boolean;
  unlinked_at: string;
}

// POST /api/phones/:phone_id/link-to-address/:address_id
interface LinkPhoneToAddressResponse {
  success: boolean;
  linked_at: string;
}
```

**Event Emission**:

```typescript
// Link phone to contact
await emitEvent({
  event_type: 'contact.phone.linked',
  aggregate_type: 'contact_phone',
  aggregate_id: `${contactId}-${phoneId}`,
  event_data: {
    contact_id: contactId,
    phone_id: phoneId,
    linked_at: new Date().toISOString(),
  },
});

// Link address to contact
await emitEvent({
  event_type: 'contact.address.linked',
  aggregate_type: 'contact_address',
  aggregate_id: `${contactId}-${addressId}`,
  event_data: {
    contact_id: contactId,
    address_id: addressId,
    linked_at: new Date().toISOString(),
  },
});

// Link phone to address (location association)
await emitEvent({
  event_type: 'phone.address.linked',
  aggregate_type: 'phone_address',
  aggregate_id: `${phoneId}-${addressId}`,
  event_data: {
    phone_id: phoneId,
    address_id: addressId,
    linked_at: new Date().toISOString(),
  },
});
```

**Testing**:
- Unit tests: Junction link creation/deletion
- Integration tests: Event emission for all link types
- E2E tests: Add phone to contact → link phone to address → verify links in DB
- Accessibility: Tab navigation, ARIA live regions for link confirmations

**Time Estimate**: 3-4 weeks

---

### Phase 4: Deduplication & Import/Export (2-3 weeks)

**Goal**: Detect and merge duplicate contacts, bulk import/export

**Deliverables**:
- Duplicate detection algorithm (fuzzy match on name + email)
- Contact merge tool (side-by-side comparison, select canonical)
- CSV import with duplicate handling
- CSV export (all contacts, filtered contacts)

**UI Components**:

1. **DuplicateDetectionPage** (`frontend/src/pages/contacts/DuplicateDetectionPage.tsx`)
   - List of potential duplicates (grouped by similarity score)
   - Similarity score badge (80-100% likely duplicate)
   - "Review" button opens DuplicateMergeModal

2. **DuplicateMergeModal** (`frontend/src/components/contacts/DuplicateMergeModal.tsx`)
   - Side-by-side comparison of duplicate contacts
   - Select canonical contact (radio button)
   - Show organizations linked to each duplicate
   - "Merge" button: reassign all org links to canonical, archive duplicates
   - Warning: "This will reassign X organizations to the canonical contact"

3. **ContactImportModal** (`frontend/src/components/contacts/ContactImportModal.tsx`)
   - CSV file upload
   - Column mapping UI (map CSV columns to contact fields)
   - Duplicate handling strategy dropdown:
     - "Skip duplicates" (leave existing contacts unchanged)
     - "Update duplicates" (update existing contacts with CSV data)
     - "Create all" (create duplicates, mark for later review)
   - Preview (show first 10 rows)
   - Import button

4. **ContactExportButton** (`frontend/src/components/contacts/ContactExportButton.tsx`)
   - Export button on contact list page
   - Dropdown: "Export current view" vs "Export all contacts"
   - Downloads CSV with columns: first_name, last_name, email, type, organizations, phones, addresses

**API Endpoints**:

```typescript
// GET /api/contacts/duplicates?threshold=0.8
interface GetDuplicatesRequest {
  threshold: number;  // Similarity threshold (0.0-1.0, default 0.8)
}

interface GetDuplicatesResponse {
  duplicate_groups: DuplicateGroup[];
}

interface DuplicateGroup {
  contacts: Contact[];
  similarity_score: number;
}

// POST /api/contacts/merge
interface MergeContactsRequest {
  canonical_id: string;       // Keep this contact
  duplicate_ids: string[];    // Archive these contacts
}

interface MergeContactsResponse {
  canonical_contact: Contact;
  reassigned_org_count: number;
  archived_contact_ids: string[];
}

// POST /api/contacts/import
interface ImportContactsRequest {
  csv_data: string;            // Base64-encoded CSV
  column_mapping: Record<string, string>;  // {"CSV Column": "contact_field"}
  duplicate_strategy: 'skip' | 'update' | 'create_all';
}

interface ImportContactsResponse {
  imported_count: number;
  updated_count: number;
  skipped_count: number;
  errors: ImportError[];
}

// GET /api/contacts/export?format=csv
interface ExportContactsRequest {
  format: 'csv' | 'json';
  filter?: ContactFilter;  // Apply same filters as contact list
}

interface ExportContactsResponse {
  data: string;  // CSV or JSON string
  filename: string;
}
```

**Duplicate Detection Algorithm**:

```sql
-- Find potential duplicates using fuzzy string matching
SELECT
  c1.id as contact1_id,
  c1.first_name || ' ' || c1.last_name as contact1_name,
  c1.email as contact1_email,
  c2.id as contact2_id,
  c2.first_name || ' ' || c2.last_name as contact2_name,
  c2.email as contact2_email,
  GREATEST(
    similarity(c1.email, c2.email),                                   -- Email similarity
    similarity(c1.first_name || c1.last_name, c2.first_name || c2.last_name)  -- Name similarity
  ) as similarity_score
FROM contacts_projection c1
JOIN contacts_projection c2 ON c1.id < c2.id  -- Avoid duplicate pairs
WHERE c1.deleted_at IS NULL AND c2.deleted_at IS NULL
  AND (
    similarity(c1.email, c2.email) > 0.8 OR
    similarity(c1.first_name || c1.last_name, c2.first_name || c2.last_name) > 0.8
  )
ORDER BY similarity_score DESC;

-- PostgreSQL similarity() requires pg_trgm extension
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX idx_contacts_email_trgm ON contacts_projection USING GIN (email gin_trgm_ops);
CREATE INDEX idx_contacts_name_trgm ON contacts_projection USING GIN ((first_name || ' ' || last_name) gin_trgm_ops);
```

**Contact Merge Logic**:

```typescript
async function mergeContacts(canonical_id: string, duplicate_ids: string[]): Promise<void> {
  // 1. Reassign all org associations to canonical contact
  for (const duplicate_id of duplicate_ids) {
    await db.query(`
      UPDATE organization_contacts
      SET contact_id = $1
      WHERE contact_id = $2
      ON CONFLICT (org_id, contact_id) DO NOTHING;  -- Skip if canonical already linked
    `, [canonical_id, duplicate_id]);

    // 2. Reassign phone/address associations
    await db.query(`UPDATE contact_phones SET contact_id = $1 WHERE contact_id = $2 ON CONFLICT DO NOTHING`, [canonical_id, duplicate_id]);
    await db.query(`UPDATE contact_addresses SET contact_id = $1 WHERE contact_id = $2 ON CONFLICT DO NOTHING`, [canonical_id, duplicate_id]);
  }

  // 3. Soft-delete duplicate contacts
  await db.query(`UPDATE contacts_projection SET deleted_at = NOW() WHERE id = ANY($1)`, [duplicate_ids]);

  // 4. Emit merge event for audit trail
  await emitEvent({
    event_type: 'contact.merged',
    aggregate_type: 'contact',
    aggregate_id: canonical_id,
    event_data: {
      canonical_id,
      duplicate_ids,
      merged_at: new Date().toISOString(),
    },
  });
}
```

**Testing**:
- Unit tests: Duplicate detection algorithm accuracy
- Integration tests: Merge logic reassigns all org links correctly
- E2E tests: Import CSV → detect duplicates → merge → verify in DB
- Edge cases: Canonical contact already linked to org (handle gracefully)

**Time Estimate**: 2-3 weeks

---

### Phase 5: Communication Integration (4-5 weeks)

**Goal**: Track communication history, contact preferences, email/SMS from platform

**Deliverables**:
- Email integration (send email to contact from platform)
- SMS integration (send SMS to contact mobile if applicable)
- Communication history tracking (log all emails/SMS sent)
- Contact preferences (preferred method: email, phone, SMS)
- "Do Not Contact" flag (override all communication)

**UI Components**:

1. **ContactCommunicationTab** (`frontend/src/components/contacts/ContactCommunicationTab.tsx`)
   - Communication history timeline (emails, SMS, phone calls)
   - "Send Email" button (opens EmailComposeModal)
   - "Send SMS" button (opens SMSComposeModal)
   - Filter by type (email, SMS, phone)
   - Filter by date range

2. **EmailComposeModal** (`frontend/src/components/contacts/EmailComposeModal.tsx`)
   - To: contact email (pre-filled)
   - Subject: text input
   - Body: rich text editor
   - Attachments: file upload
   - Send/Save Draft/Cancel buttons

3. **SMSComposeModal** (`frontend/src/components/contacts/SMSComposeModal.tsx`)
   - To: contact mobile phone (dropdown if multiple mobiles)
   - Message: text input (160 character limit warning)
   - Send/Cancel buttons

4. **ContactPreferencesSection** (`frontend/src/components/contacts/ContactPreferencesSection.tsx`)
   - Preferred contact method: dropdown (email, phone, SMS)
   - Do Not Contact: checkbox (warning message if checked)
   - Preferred time: time range (e.g., "9am-5pm EST")
   - Save button

**API Endpoints**:

```typescript
// POST /api/contacts/:id/send-email
interface SendEmailToContactRequest {
  subject: string;
  body: string;
  attachments?: File[];
}

interface SendEmailToContactResponse {
  message_id: string;
  sent_at: string;
}

// POST /api/contacts/:id/send-sms
interface SendSMSToContactRequest {
  phone_id: string;  // Which mobile to send to
  message: string;
}

interface SendSMSToContactResponse {
  message_id: string;
  sent_at: string;
}

// GET /api/contacts/:id/communication-history?type=email&start_date=2025-01-01
interface GetCommunicationHistoryRequest {
  type?: 'email' | 'sms' | 'phone';
  start_date?: string;
  end_date?: string;
  limit?: number;
}

interface GetCommunicationHistoryResponse {
  history: CommunicationHistoryEntry[];
  total_count: number;
}

interface CommunicationHistoryEntry {
  id: string;
  type: 'email' | 'sms' | 'phone';
  direction: 'outbound' | 'inbound';
  subject?: string;
  body?: string;
  sent_at: string;
  sent_by: string;  // User who sent it
}

// PUT /api/contacts/:id/preferences
interface UpdateContactPreferencesRequest {
  preferred_contact_method?: 'email' | 'phone' | 'sms';
  do_not_contact?: boolean;
  preferred_time?: string;
}

interface UpdateContactPreferencesResponse {
  preferences: ContactPreferences;
}
```

**Communication History Tracking**:

New table for communication logs:

```sql
CREATE TABLE contact_communications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id UUID NOT NULL REFERENCES contacts_projection(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('email', 'sms', 'phone')),
  direction TEXT NOT NULL CHECK (direction IN ('outbound', 'inbound')),
  subject TEXT,
  body TEXT,
  sent_at TIMESTAMPTZ DEFAULT NOW(),
  sent_by UUID REFERENCES users(id),
  metadata JSONB,  -- Store email headers, SMS delivery status, etc.

  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_contact_comms_contact ON contact_communications(contact_id);
CREATE INDEX idx_contact_comms_type ON contact_communications(type);
CREATE INDEX idx_contact_comms_sent_at ON contact_communications(sent_at DESC);
```

**Event Emission**:

```typescript
// Log email sent
await emitEvent({
  event_type: 'contact.communication.sent',
  aggregate_type: 'contact_communication',
  aggregate_id: messageId,
  event_data: {
    contact_id: contactId,
    type: 'email',
    direction: 'outbound',
    subject: 'Invoice for January 2025',
    sent_at: new Date().toISOString(),
    sent_by: userId,
  },
});

// Trigger: Insert into contact_communications table
```

**Testing**:
- Unit tests: Email/SMS compose modals
- Integration tests: Send email → log in contact_communications → verify in DB
- E2E tests: Send email to contact → check communication history → verify received
- Edge cases: Do Not Contact flag prevents sending (show warning modal)

**Time Estimate**: 4-5 weeks

---

## Technology Stack

### Backend

**Database**:
- PostgreSQL 15+ (with pg_trgm extension for fuzzy search)
- Supabase RLS policies for multi-tenant isolation
- PostgreSQL triggers for event processing

**API Layer** (choose one):
- **Option 1**: Supabase Edge Functions (TypeScript, Deno runtime)
- **Option 2**: Express.js API (Node.js, TypeScript)
- **Option 3**: GraphQL API (Apollo Server, TypeScript)

**Event Store**:
- `domain_events` table (append-only event log)
- PostgreSQL triggers update projections

**Caching** (optional):
- Redis (for frequently accessed contacts)
- Cache invalidation on contact.updated events

**Search** (optional):
- PostgreSQL full-text search (built-in)
- Elasticsearch (for advanced search features)

---

### Frontend

**Framework**:
- React 19 + TypeScript
- Vite (build tool)

**State Management**:
- MobX (observable stores for contact data)
- ViewModels for form state (ContactFormViewModel, ContactSearchViewModel)

**UI Components**:
- Custom component library (SelectDropdown, Modal, Table, etc.)
- Tailwind CSS (glassomorphic styling)
- Headless UI (accessible components)

**Data Fetching**:
- Supabase client (for real-time subscriptions if needed)
- React Query (for caching, refetching, pagination)

**Validation**:
- Zod (schema validation)
- React Hook Form (form state management)

---

## Testing Strategy

### Unit Tests

**Frontend Components**:
```typescript
describe('ContactListPage', () => {
  it('renders contact list', () => {
    const contacts = [/* mock contacts */];
    render(<ContactListPage contacts={contacts} />);
    expect(screen.getByText('John Doe')).toBeInTheDocument();
  });

  it('filters contacts by type', () => {
    const { getByLabelText } = render(<ContactListPage />);
    fireEvent.click(getByLabelText('Billing'));
    expect(mockFetch).toHaveBeenCalledWith('/api/contacts?type=billing');
  });
});
```

**Backend Functions**:
```typescript
describe('mergeContacts', () => {
  it('reassigns all org associations to canonical contact', async () => {
    await mergeContacts('canonical-id', ['duplicate-1', 'duplicate-2']);
    const orgs = await db.query('SELECT * FROM organization_contacts WHERE contact_id = $1', ['canonical-id']);
    expect(orgs.rows.length).toBe(5);  // 2 + 3 orgs reassigned
  });

  it('soft-deletes duplicate contacts', async () => {
    await mergeContacts('canonical-id', ['duplicate-1']);
    const contact = await db.query('SELECT deleted_at FROM contacts_projection WHERE id = $1', ['duplicate-1']);
    expect(contact.rows[0].deleted_at).not.toBeNull();
  });
});
```

---

### Integration Tests

**API Endpoints**:
```typescript
describe('POST /api/contacts', () => {
  it('creates contact and emits contact.created event', async () => {
    const response = await request(app)
      .post('/api/contacts')
      .send({ first_name: 'John', last_name: 'Doe', email: 'john@example.com', type: 'billing' })
      .expect(201);

    expect(response.body.contact_id).toBeDefined();

    // Verify event emitted
    const events = await db.query('SELECT * FROM domain_events WHERE event_type = $1', ['contact.created']);
    expect(events.rows.length).toBe(1);
  });

  it('links contact to organization via junction table', async () => {
    const response = await request(app)
      .post('/api/contacts/contact-id/link-to-org')
      .send({ org_id: 'org-id' })
      .expect(200);

    const links = await db.query('SELECT * FROM organization_contacts WHERE contact_id = $1', ['contact-id']);
    expect(links.rows.length).toBe(1);
  });
});
```

---

### End-to-End Tests (Playwright)

```typescript
test('contact CRUD flow', async ({ page }) => {
  // Navigate to contact list
  await page.goto('/contacts');
  await expect(page.locator('h1')).toHaveText('Contact Directory');

  // Create new contact
  await page.click('text=Create Contact');
  await page.fill('input[name="first_name"]', 'Jane');
  await page.fill('input[name="last_name"]', 'Doe');
  await page.fill('input[name="email"]', 'jane@example.com');
  await page.selectOption('select[name="type"]', 'billing');
  await page.click('text=Save');

  // Verify contact appears in list
  await expect(page.locator('text=Jane Doe')).toBeVisible();

  // Edit contact
  await page.click('text=Jane Doe');
  await page.click('text=Edit');
  await page.fill('input[name="title"]', 'Billing Manager');
  await page.click('text=Save');

  // Verify title updated
  await expect(page.locator('text=Billing Manager')).toBeVisible();

  // Delete contact
  await page.click('text=Delete');
  await page.click('text=Confirm');
  await expect(page.locator('text=Jane Doe')).not.toBeVisible();
});

test('duplicate detection and merge', async ({ page }) => {
  // Create 2 contacts with similar names/emails
  await createContact({ first_name: 'John', last_name: 'Doe', email: 'john.doe@example.com' });
  await createContact({ first_name: 'John', last_name: 'Doe', email: 'johndoe@example.com' });

  // Navigate to duplicate detection page
  await page.goto('/contacts/duplicates');
  await expect(page.locator('text=Potential Duplicates')).toBeVisible();

  // Review duplicate group
  await page.click('text=Review');
  await expect(page.locator('text=john.doe@example.com')).toBeVisible();
  await expect(page.locator('text=johndoe@example.com')).toBeVisible();

  // Select canonical contact
  await page.click('input[value="contact-1"]');  // Radio button
  await page.click('text=Merge');

  // Verify only canonical contact remains
  await page.goto('/contacts');
  await expect(page.locator('text=john.doe@example.com')).toBeVisible();
  await expect(page.locator('text=johndoe@example.com')).not.toBeVisible();
});
```

---

### Accessibility Testing

**Manual Testing**:
- Keyboard navigation (Tab, Shift+Tab, Enter, Escape)
- Screen reader (NVDA, JAWS, VoiceOver)
- Color contrast (WCAG 2.1 AA compliance)

**Automated Testing** (axe-core):
```typescript
import { injectAxe, checkA11y } from 'axe-playwright';

test('contact list page is accessible', async ({ page }) => {
  await page.goto('/contacts');
  await injectAxe(page);
  await checkA11y(page);  // Fails if accessibility violations found
});
```

---

## Deployment Checklist

### Pre-Deployment

- [ ] All unit tests pass (`npm test`)
- [ ] All integration tests pass
- [ ] All E2E tests pass (`npx playwright test`)
- [ ] Accessibility audit complete (no critical issues)
- [ ] Security review complete (RLS policies tested, SQL injection prevented)
- [ ] Performance testing complete (query performance <100ms)
- [ ] Code review approved
- [ ] Documentation updated (API reference, user guide)

### Database Migration

- [ ] Backup production database
- [ ] Run migrations on staging environment
- [ ] Verify migrations idempotent (run twice, no errors)
- [ ] Verify RLS policies working (test with different JWT claims)
- [ ] Verify event processors active (insert test event, check projection)
- [ ] Run security advisors: `mcp__supabase__get_advisors --type security`
- [ ] Run performance advisors: `mcp__supabase__get_advisors --type performance`

### Production Deployment

- [ ] Deploy to production during low-traffic window (e.g., Sunday 2am)
- [ ] Run database migrations (`./infrastructure/supabase/migrations/apply.sh`)
- [ ] Deploy frontend to production (`npm run build && deploy`)
- [ ] Deploy API endpoints (if using Edge Functions)
- [ ] Monitor logs for errors (Supabase dashboard, Sentry)
- [ ] Smoke test: Create contact, edit contact, delete contact
- [ ] Verify platform owner login still works (lars.tice@gmail.com)

### Post-Deployment

- [ ] Monitor error rates (expect <1% error rate in first 24 hours)
- [ ] Monitor query performance (contact list query <100ms p95)
- [ ] Monitor event processing (domain_events processed within 1s)
- [ ] Gather user feedback (survey or user interviews)
- [ ] Track adoption metrics (% of provider admins using Contact Management)
- [ ] Plan next iteration based on feedback

---

## Rollback Plan

If critical issues occur post-deployment:

### Database Rollback

```bash
# Restore database from backup (taken before migration)
pg_restore -d production_db backup_YYYY-MM-DD.sql

# Verify restoration
psql -d production_db -c "SELECT COUNT(*) FROM contacts_projection;"
```

### Application Rollback

```bash
# Revert to previous frontend build
git checkout previous-release-tag
npm run build
deploy

# Revert API endpoints (if applicable)
supabase functions delete contact-api
```

### Communication Plan

- [ ] Notify users of rollback via email/in-app notification
- [ ] Update status page (status.a4c.com)
- [ ] Post-mortem: Root cause analysis, action items
- [ ] Fix issues in development, re-test, re-deploy

---

## Success Metrics

### Functional Metrics
- **Contact Creation Success Rate**: >95% of contact creations succeed
- **Duplicate Detection Accuracy**: >80% of detected duplicates are true duplicates
- **Search Performance**: Contact search results return in <100ms (p95)
- **RLS Policy Effectiveness**: Zero cross-tenant data leaks

### User Adoption Metrics
- **Active Users**: >70% of provider admins use Contact Management within 6 months
- **Contact CRUD Operations**: >100 contact edits per week (platform-wide)
- **Deduplication Usage**: >10 contact merges per month (reducing data duplication)

### Business Impact Metrics
- **Data Quality**: <5% duplicate contacts (down from estimated 20-30% without deduplication)
- **Time Savings**: 50% reduction in time to update contact info (update once vs update per org)
- **User Satisfaction**: >80% of users rate Contact Management "easy to use" or better

---

## Related Documentation

**Vision & Business Case**:
- [Contact Management Vision](../../architecture/features/contact-management-vision.md) - User stories, use cases, business value

**Architecture**:
- [Contact Management Architecture](../architecture/contact-management-architecture.md) - Data model, queries, RLS policies

**Database Reference**:
- [contacts_projection](../reference/database/tables/contacts_projection.md) - Contact table schema (aspirational)
- [organization_contacts](../reference/database/tables/organization_contacts.md) - Junction table (aspirational)

**Infrastructure Foundation**:
- [Provider Onboarding Enhancement Plan](../../../dev/active/provider-onboarding-enhancement-plan.md) - Junction table infrastructure

---

## Total Estimated Timeline

**Phase 1**: Basic Contact Directory - 3-4 weeks
**Phase 2**: Contact CRUD - 2-3 weeks
**Phase 3**: Advanced Associations - 3-4 weeks
**Phase 4**: Deduplication & Import/Export - 2-3 weeks
**Phase 5**: Communication Integration - 4-5 weeks

**Total**: **14-19 weeks** (3.5-5 months)

**Buffer**: Add 20% for testing, bug fixes, documentation (3-4 additional weeks)

**Final Estimate**: **17-23 weeks** (4-6 months) from start to production deployment

---

**Status**: 🔮 Aspirational - Timeline: Indeterminate
**Foundation Ready**: ✅ Junction tables, type enums, event processors (via provider onboarding enhancement)
**When Prioritized**: Backend foundation exists, UI/UX development can start immediately
