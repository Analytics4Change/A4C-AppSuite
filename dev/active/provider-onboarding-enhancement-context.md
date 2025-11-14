# Context: Provider Onboarding Enhancement

## Decision Record

**Date**: 2025-01-14
**Feature**: Provider Onboarding Enhancement
**Goal**: Enhance organization creation workflow to support comprehensive contact/address/phone collection, dynamic UI based on org type, partner relationship tracking, and conditional subdomain provisioning while maintaining CQRS event-driven architecture.

### Key Decisions

1. **Data Model: Separate Projection Tables with Many-to-Many Relationships**
   - **Decision**: Use existing `contacts_projection`, `addresses_projection`, `phones_projection` tables (already created) with junction tables for many-to-many relationships
   - **Why**: CQRS pattern requires projections derived from events. Many-to-many supports future contact management module where contacts can be associated with multiple orgs/phones/addresses
   - **Alternative Rejected**: Storing contacts/addresses/phones as JSONB fields on organizations_projection (not queryable, doesn't support many-to-many)

2. **UI Behavior: Dynamic Section Visibility Based on Org Type**
   - **Decision**: Show Billing section only for provider orgs, hide for partner orgs. Dynamically toggle based on org type dropdown selection.
   - **Why**: Partners don't have billing relationships with A4C (they refer business, don't bill). Reduces UI clutter and prevents confusion.
   - **Alternative Rejected**: Always show all sections and validate conditionally (confusing UX, why show fields that can't be filled?)

3. **Subdomain Logic: Conditional Based on Org Type + Partner Type**
   - **Decision**: Subdomain required if `(type='provider') OR (type='provider_partner' AND partner_type='var')`. Platform owner and stakeholder partners get NULL subdomain.
   - **Why**: Only orgs that need their own customer-facing domain require DNS provisioning. VAR partners resell the platform and need subdomains. Stakeholder partners (family, court) don't need subdomains.
   - **Alternative Rejected**: Subdomain required for all orgs (wasteful DNS records, unnecessary Cloudflare API calls)

4. **Program Management: Complete Removal**
   - **Decision**: Remove program fields from entire stack (UI, workflow, schema, events, docs)
   - **Why**: User confirmed program management is out of scope for organization creation. Will be handled separately if needed. MVP had program inline but it's not actually needed.
   - **Alternative Rejected**: Keep program fields but make them optional (tech debt, confusing to maintain dead code)

5. **"Use General Information" Behavior: Dynamic Sync with Junction Links**
   - **Decision**: UI shows dynamic sync (copy values when checked, update when general info changes). Backend creates junction table links via CQRS events.
   - **Why**: UI provides convenient autofill. Backend uses junction links (not data duplication) to support future many-to-many queries. Clean separation of concerns.
   - **Alternative Rejected**: Backend data duplication (duplicate address records, violates normalization, causes sync issues)

6. **Event Creation Timing: Immediate (with Organization Creation)**
   - **Decision**: Emit contact/address/phone events in the first workflow activity (`createOrganization`) before DNS provisioning
   - **Why**: Event sourcing best practice is to record all entity creation atomically. Simplifies rollback (delete entire org including contacts). Provides complete audit trail from moment of creation.
   - **Alternative Rejected**: Create contacts/addresses/phones on organization activation (complicates rollback, loses audit trail if org creation fails midway)

7. **Label + Type Fields: Both Required on All Entities**
   - **Decision**: All contacts/addresses/phones have both `label` (free-form text) and `type` (constrained enum)
   - **Why**: `type` provides structure for business logic (e.g., "billing contact" vs "technical contact"). `label` provides user-friendly identification for future contact management UI. Both serve different purposes.
   - **Alternative Rejected**: Label-only or type-only (loses either structure or flexibility)

8. **Backward Compatibility: Preserve Platform Owner Org**
   - **Decision**: All migrations must preserve platform owner org (A4C, lars.tice@gmail.com). All new fields nullable with defaults. Test login before and after migration.
   - **Why**: Production requirement. Lars must be able to login to manage the system. Breaking platform owner org is unacceptable.
   - **Alternative Rejected**: Require data migration for existing orgs (risky, could break production)

---

## Technical Context

### Architecture

This feature enhances the **organization bootstrap workflow**, which is a Temporal.io durable workflow that provisions new provider and partner organizations. The system follows an **event-driven CQRS architecture**:

- **Write Model**: Domain events stored in `domain_events` table (append-only event store)
- **Read Model**: Projections (`organizations_projection`, `contacts_projection`, etc.) derived from events via PostgreSQL triggers
- **Orchestration**: Temporal workflows coordinate long-running operations (DNS provisioning, email delivery)
- **Multi-Tenancy**: Row-level security (RLS) enforces org isolation using JWT custom claims

The enhancement maintains this architecture while adding:
- Many-to-many relationships (junction tables)
- Conditional workflow logic (subdomain provisioning)
- Dynamic UI (org-type-specific sections)

### Tech Stack

**Frontend**:
- React 19 + TypeScript
- MobX (state management) - `OrganizationFormViewModel`
- Vite (build tool)
- Tailwind CSS (glassomorphic UI styling)
- Custom components: `SubdomainInput`, `PhoneInput`, `SelectDropdown`

**Workflows**:
- Temporal.io (workflow orchestration)
- Node.js 20 + TypeScript
- Cloudflare API (DNS provisioning via CloudflareDNSProvider)
- Activities: `createOrganization`, `configureDNS`, `verifyDNS`, `generateInvitations`, `sendInvitationEmails`, `activateOrganization`

**Infrastructure**:
- Supabase PostgreSQL (database with RLS)
- Supabase Edge Functions (workflow invocation endpoint)
- PostgreSQL triggers (event processors update projections)
- AsyncAPI contracts (event schema definitions)
- Kubernetes (Temporal server + workers deployed on k3s)

**Tools**:
- Supabase CLI (local testing: `./local-tests/start-local.sh`)
- Temporal CLI (workflow execution, status)
- kubectl (Kubernetes management)

### Dependencies

**Internal**:
- `organizations_projection` table (parent table for all entities)
- `contacts_projection`, `addresses_projection`, `phones_projection` (already exist)
- `domain_events` table (event store)
- `event_types` table (event schema registry)
- JWT custom claims (org_id, user_role, permissions from Supabase Auth)

**External**:
- Cloudflare API (DNS CNAME record creation)
- SMTP server (invitation email delivery)
- Temporal cluster (workflow execution)

**Existing Constraints**:
- Subdomain must be unique across all orgs
- One primary contact/address/phone per org (enforced by unique constraint on `is_primary`)
- RLS policies require JWT custom claims (can't query without valid session)
- Platform owner org (UUID: `aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa`) must remain intact

---

## File Structure

### Existing Files Modified

**Frontend**:
- `frontend/src/pages/organizations/OrganizationCreatePage.tsx` - Main UI component, add dynamic sections, remove program section, add referring partner dropdown
- `frontend/src/viewmodels/OrganizationFormViewModel.ts` - State management, change to arrays, add "Use General Information" logic
- `frontend/src/types/organization.types.ts` - Type definitions, add new interfaces (ContactFormData, AddressFormData, PhoneFormData)
- `frontend/src/services/workflow/IWorkflowClient.ts` - Workflow client interface, update parameter types

**Workflows**:
- `workflows/src/workflows/organization-bootstrap/workflow.ts` - Main workflow, update to handle optional subdomain
- `workflows/src/workflows/organization-bootstrap/types.ts` - Parameter types, add arrays, add referring partner, remove program
- `workflows/src/activities/createOrganization.ts` - Organization creation activity, emit contact/address/phone events
- `workflows/src/activities/configureDNS.ts` - DNS provisioning, handle optional subdomain
- `workflows/src/activities/verifyDNS.ts` - DNS verification, skip if no subdomain

**Infrastructure** (Database):
- `infrastructure/supabase/sql/02-tables/organizations/001-organizations_projection.sql` - Add `referring_partner_id`, `partner_type` columns, make `subdomain` nullable
- `infrastructure/supabase/sql/02-tables/organizations/005-contacts_projection.sql` - Add `type` enum column
- `infrastructure/supabase/sql/02-tables/organizations/006-addresses_projection.sql` - Add `type` enum column
- `infrastructure/supabase/sql/02-tables/organizations/007-phones_projection.sql` - Add `type` enum column
- `infrastructure/supabase/sql/03-functions/event-processing/002-process-organization-events.sql` - Update to handle new fields, remove program logic

**Infrastructure** (AsyncAPI Contracts):
- `infrastructure/supabase/contracts/asyncapi/domains/organization.yaml` - Update `organization.created` event schema, remove program fields, add new fields

### New Files Created

**Database** (Junction Tables):
- `infrastructure/supabase/sql/02-tables/organizations/008-organization_contacts_junction.sql` - Many-to-many: org ↔ contact
- `infrastructure/supabase/sql/02-tables/organizations/009-organization_addresses_junction.sql` - Many-to-many: org ↔ address
- `infrastructure/supabase/sql/02-tables/organizations/010-organization_phones_junction.sql` - Many-to-many: org ↔ phone
- `infrastructure/supabase/sql/02-tables/organizations/011-contact_phones_junction.sql` - Many-to-many: contact ↔ phone (future)
- `infrastructure/supabase/sql/02-tables/organizations/012-contact_addresses_junction.sql` - Many-to-many: contact ↔ address (future)

**Database** (Enums):
- `infrastructure/supabase/sql/01-enums/partner_type.sql` - Partner type enum (var, family, court, other)
- `infrastructure/supabase/sql/01-enums/contact_type.sql` - Contact type enum (a4c_admin, billing, technical, emergency, stakeholder)
- `infrastructure/supabase/sql/01-enums/address_type.sql` - Address type enum (physical, mailing, billing)
- `infrastructure/supabase/sql/01-enums/phone_type.sql` - Phone type enum (mobile, office, fax, emergency)

**Event Processors** (Triggers):
- `infrastructure/supabase/sql/03-functions/event-processing/003-process-contact-events.sql` - Handle `contact.created` events
- `infrastructure/supabase/sql/03-functions/event-processing/004-process-address-events.sql` - Handle `address.created` events
- `infrastructure/supabase/sql/03-functions/event-processing/005-process-phone-events.sql` - Handle `phone.created` events
- `infrastructure/supabase/sql/03-functions/event-processing/006-process-junction-events.sql` - Handle junction link events

**AsyncAPI Contracts**:
- `infrastructure/supabase/contracts/asyncapi/domains/contact.yaml` - Contact event schemas
- `infrastructure/supabase/contracts/asyncapi/domains/address.yaml` - Address event schemas
- `infrastructure/supabase/contracts/asyncapi/domains/phone.yaml` - Phone event schemas

**Documentation**:
- `documentation/infrastructure/reference/database/tables/contacts_projection.md` - Contact table reference
- `documentation/infrastructure/reference/database/tables/addresses_projection.md` - Address table reference
- `documentation/infrastructure/reference/database/tables/phones_projection.md` - Phone table reference
- `documentation/infrastructure/reference/database/tables/organization_contacts.md` - Junction table reference
- `documentation/infrastructure/reference/database/tables/organization_addresses.md` - Junction table reference
- `documentation/infrastructure/reference/database/tables/organization_phones.md` - Junction table reference

---

## Related Components

**Organization Management** (Parent Feature):
- Organization list page (will query projections)
- Organization detail page (will display contacts/addresses/phones)
- Organization edit page (future, will reuse form components)

**User Management**:
- User invitation workflow (receives contact emails from org creation)
- User role assignment (org_id required for RBAC)

**Authentication**:
- JWT custom claims (org_id used in RLS policies)
- Supabase Auth (session management)

**Contact Management** (Future Module):
- Will leverage many-to-many infrastructure built here
- Contact CRUD operations
- Contact-phone and contact-address associations

**DNS Management**:
- Cloudflare DNS provider (CNAME creation)
- DNS verification polling
- Subdomain status tracking

---

## Key Patterns and Conventions

### 1. CQRS Event Sourcing

**Pattern**: All state changes emit domain events → PostgreSQL triggers update projections

**Example**:
```typescript
// Workflow activity emits event
await emitEvent({
  event_type: 'contact.created',
  aggregate_type: 'contact',
  aggregate_id: contactId,
  event_data: { first_name: 'John', last_name: 'Doe', ... }
});

// Trigger processes event (SQL)
CREATE OR REPLACE FUNCTION process_contact_event() RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO contacts_projection (id, org_id, first_name, last_name, ...)
  VALUES (NEW.aggregate_id, NEW.event_data->>'org_id', ...)
  ON CONFLICT (id) DO NOTHING; -- Idempotent
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
```

**Why**: Separates writes from reads, provides audit trail, enables time-travel debugging

### 2. Idempotency Everywhere

**Pattern**: All migrations, triggers, and activities must be idempotent

**SQL Migrations**:
```sql
CREATE TABLE IF NOT EXISTS table_name (...);
CREATE INDEX IF NOT EXISTS idx_name ON table_name(column);
DROP POLICY IF EXISTS policy_name ON table_name;
CREATE POLICY policy_name ON table_name USING (...);
```

**Projection Updates**:
```sql
INSERT INTO projection_table (id, ...)
VALUES (...)
ON CONFLICT (id) DO UPDATE SET ...;
```

**Why**: Migrations run multiple times during testing. Events may be replayed. Activities may retry.

### 3. RLS Policy Pattern

**Pattern**: All projection tables have RLS policies using JWT custom claims

**Example**:
```sql
CREATE POLICY contacts_tenant_isolation ON contacts_projection
  FOR ALL
  USING (organization_id = (current_setting('request.jwt.claims', true)::json->>'org_id')::uuid);

ALTER TABLE contacts_projection ENABLE ROW LEVEL SECURITY;
```

**Why**: Enforces multi-tenant data isolation at database layer, prevents cross-org data leaks

### 4. Temporal Activity Idempotency

**Pattern**: Activities check if work already done before executing

**Example**:
```typescript
async function createOrganization(params: OrganizationBootstrapParams): Promise<string> {
  // Check if org already exists (idempotency)
  const existing = await db.query('SELECT id FROM organizations WHERE subdomain = $1', [params.subdomain]);
  if (existing.rows.length > 0) {
    return existing.rows[0].id; // Already created, return existing ID
  }

  // Create org and emit events...
}
```

**Why**: Activities may be retried by Temporal. Idempotency prevents duplicate data.

### 5. Dynamic UI with Conditional Rendering

**Pattern**: React components render different sections based on state

**Example**:
```tsx
{organizationType === 'provider' && (
  <BillingInformationSection
    contact={billingContact}
    address={billingAddress}
    phone={billingPhone}
  />
)}
```

**Why**: Cleaner UX, shows only relevant fields, reduces cognitive load

### 6. MobX Observable State Management

**Pattern**: ViewModels use MobX observables and computed values

**Example**:
```typescript
class OrganizationFormViewModel {
  @observable organizationType: 'provider' | 'provider_partner' = 'provider';
  @observable contacts: ContactFormData[] = [];

  @computed get isSubdomainRequired(): boolean {
    return this.organizationType === 'provider' ||
           (this.organizationType === 'provider_partner' && this.partnerType === 'var');
  }
}
```

**Why**: Reactive state updates, automatic re-renders, computed properties for derived state

### 7. Workflow Saga Pattern (Compensation)

**Pattern**: Workflow maintains compensation logic for rollback on failure

**Example**:
```typescript
try {
  const orgId = await createOrganization(params);
  const recordId = await configureDNS(params.subdomain);
  await activateOrganization(orgId);
} catch (error) {
  // Compensation: rollback in reverse order
  await deactivateOrganization(orgId);
  await removeDNS(recordId);
  await deleteOrganization(orgId);
  throw error;
}
```

**Why**: Durable workflows may fail midway. Compensation ensures system returns to consistent state.

---

## Reference Materials

**Internal Documentation**:
- `/home/lars/dev/A4C-AppSuite/documentation/architecture/workflows/organization-onboarding-workflow.md` - Current workflow architecture
- `/home/lars/dev/A4C-AppSuite/documentation/architecture/workflows/organization-bootstrap-workflow-design.md` - Detailed design spec (200 lines)
- `/home/lars/dev/A4C-AppSuite/documentation/infrastructure/reference/database/tables/organizations_projection.md` - Organization table reference (765 lines)
- `/home/lars/dev/A4C-AppSuite/infrastructure/CLAUDE.md` - Infrastructure component guidance
- `/home/lars/dev/A4C-AppSuite/workflows/CLAUDE.md` - Workflow component guidance
- `/home/lars/dev/A4C-AppSuite/frontend/CLAUDE.md` - Frontend component guidance

**Skills**:
- `infrastructure-guidelines` skill - Supabase SQL idempotency, RLS patterns, CQRS projections, K8s deployments
- `temporal-workflow-guidelines` skill - Workflow patterns, activity design, error handling

**External Documentation**:
- Temporal.io Docs: https://docs.temporal.io/
- Supabase Docs: https://supabase.com/docs
- AsyncAPI Spec: https://www.asyncapi.com/docs/reference/specification/v2.6.0
- PostgreSQL ltree: https://www.postgresql.org/docs/current/ltree.html
- Cloudflare API: https://developers.cloudflare.com/api/

**Wireframes**:
- `/home/lars/tmp/Organization-Management-Partner.png` - Provider org wireframe (3 sections)
- `/home/lars/tmp/Organization-Management-Partner-general-info.png` - General Info section highlighted
- Second wireframe shows partner org (2 sections, no Billing)

---

## Important Constraints

### Business Constraints

1. **Platform Owner Preservation**: Platform owner org (A4C, UUID `aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa`) must remain functional. Lars Tice (lars.tice@gmail.com) must be able to login.

2. **Subdomain Uniqueness**: Subdomains must be globally unique across all organizations. Database unique constraint enforces this.

3. **Billing Section Visibility**: Only provider orgs have billing relationships with A4C. Partner orgs don't need Billing section.

4. **VAR Partner Subdomains**: Value-added resellers need subdomains because they white-label the platform. Stakeholder partners (family, court) don't need subdomains.

5. **All Sections Required**: General Info always required. Billing required for providers. Provider Admin always required. Each section must have at least 1 contact, 1 address, 1 phone.

### Technical Constraints

6. **Event Ordering**: Contact/address/phone events must be emitted AFTER organization.created event (org must exist before linking entities).

7. **RLS Enforcement**: All queries require valid JWT session with org_id custom claim. Can't query projections without authentication.

8. **Temporal Workflow Duration**: Organization bootstrap workflow runs 10-40 minutes (DNS verification polling). Workflows must be durable and survive worker restarts.

9. **DNS Propagation Delay**: Cloudflare DNS changes take 1-5 minutes to propagate globally. Workflow polls with exponential backoff.

10. **Idempotency Required**: Migrations run multiple times during testing. Events may be replayed. Activities may retry. All operations must be idempotent.

### Schema Constraints

11. **ltree Hierarchy**: Organizations use ltree path for hierarchy (e.g., `root.org_acme_healthcare.north_campus`). Path must be valid ltree format.

12. **Soft Deletes**: Organizations use `deleted_at` for soft deletes. Cascade logic must preserve audit trail.

13. **One Primary Per Org**: Only one contact/address/phone can be marked `is_primary = true` per organization. Unique constraint enforces this.

14. **Foreign Key Cascades**: Junction tables use `ON DELETE CASCADE` to auto-delete links when parent entity deleted.

---

## Why This Approach?

### Why Many-to-Many Junction Tables Instead of JSONB?

**Chosen**: Separate junction tables (`organization_contacts`, `organization_addresses`, `organization_phones`)

**Rejected**: JSONB array fields on `organizations_projection`

**Rationale**:
- **Queryability**: Can't efficiently query "all orgs where contact email = X" with JSONB
- **Future Contact Management**: Contact module will need to query "all orgs where contact Y is a member"
- **Referential Integrity**: Foreign keys enforce valid relationships, JSONB allows orphaned references
- **CQRS Alignment**: Projections are derived from events. Junction link events create junction records. Clean separation.
- **Performance**: Indexed foreign keys fast for queries. JSONB GIN indexes slower and less flexible.

### Why Create Contacts/Addresses/Phones Immediately Instead of On Activation?

**Chosen**: Emit all entity creation events in first workflow activity (`createOrganization`)

**Rejected**: Create entities when organization activated (end of workflow)

**Rationale**:
- **Event Sourcing Best Practice**: All initial state recorded atomically at moment of creation
- **Simpler Rollback**: If DNS fails, rollback deletes entire org including all entities. No orphaned contacts.
- **Complete Audit Trail**: Events show exactly when org created with all related entities
- **Data Consistency**: Organization and its entities created together, not in separate transactions
- **Activity Idempotency**: Single activity creates everything, simpler to make idempotent

### Why Dynamic UI Sections Instead of Always Showing All Sections?

**Chosen**: Show/hide Billing section based on org type

**Rejected**: Always show all sections, disable/validate conditionally

**Rationale**:
- **User Confusion**: Why show Billing fields if they can't be filled? Confusing UX.
- **Cognitive Load**: Fewer sections = easier to understand what's required
- **Visual Clarity**: Dynamic sections make org type differences obvious
- **Form Validation**: Simpler validation logic (sections either required or not shown)
- **Mobile Responsiveness**: Fewer sections = less scrolling on mobile

### Why Label + Type Fields Instead of Label Only?

**Chosen**: Both `label` (free-form text) and `type` (constrained enum) on all entities

**Rejected**: Label-only (free-form text for everything)

**Rationale**:
- **Business Logic**: Code can filter "billing contacts" vs "technical contacts" using `type` enum
- **Data Integrity**: Type enum prevents typos ("biling" vs "billing")
- **User Flexibility**: Label allows custom descriptions ("John - Main Contact") for clarity
- **Future Contact Management**: Contact management UI will use `type` for filtering/sorting
- **Reporting**: Can generate reports like "all orgs missing billing contact" using `type`

### Why Remove Program Instead of Making It Optional?

**Chosen**: Completely remove program fields from entire stack

**Rejected**: Keep program fields but make them optional

**Rationale**:
- **User Confirmation**: User explicitly said programs are out of scope for org creation
- **Tech Debt**: Optional fields that are never used create confusion and maintenance burden
- **Code Simplicity**: Removing program simplifies UI, workflow params, validation, events, triggers
- **Future Flexibility**: If programs needed later, can add as separate feature with different UX
- **Migration Safety**: Archive program data (don't delete) allows recovery if needed

### Why Platform Owner Gets NULL Subdomain?

**Chosen**: Platform owner org has `subdomain = NULL`, skips DNS provisioning

**Rejected**: Platform owner gets subdomain like all other orgs

**Rationale**:
- **Different Purpose**: Platform owner is internal admin org, not a customer-facing org
- **No DNS Needed**: Platform owner doesn't need custom subdomain (uses base domain)
- **Workflow Simplification**: Skip unnecessary Cloudflare API calls for internal org
- **Historical**: Platform owner created before subdomain feature existed, no subdomain assigned
- **Conditional Logic**: Same conditional logic applies to stakeholder partners (no subdomain needed)

---

## Investigation Findings (Key Discoveries)

During the planning phase, we investigated the codebase and discovered:

1. **Contact/Address/Phone Projections Already Exist**: Tables `contacts_projection`, `addresses_projection`, `phones_projection` already created with correct naming convention (`_projection` suffix). This saves significant implementation time.

2. **Platform Owner Fixed UUID**: Platform owner org uses hardcoded UUID `aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa` in seed data. Must preserve this UUID during migration.

3. **Lars Tice User ID**: User `lars.tice@gmail.com` has UUID `5a975b95-a14d-4ddd-bdb6-949033dab0b8` and `super_admin` role assigned. Must preserve this user and role assignment.

4. **provider_partner Type Already Exists**: Organization type enum already includes `'provider_partner'`. Don't need to add it, just add `partner_type` classification.

5. **Subdomain Status Enum Exists**: Enum `subdomain_status` with values `'pending'`, `'dns_created'`, `'verifying'`, `'verified'`, `'failed'` already exists. Can use for conditional provisioning.

6. **Business Profiles Table Deprecated**: `organization_business_profiles_projection` table has deprecated `mailing_address` and `physical_address` JSONB fields. These should eventually be migrated to `addresses_projection`.

7. **No Program Tables Found**: No program projection tables exist. Program data (if any) is stored in JSONB or doesn't exist yet. Safe to remove program feature.

8. **AsyncAPI Contracts Defined**: Event schemas already defined in `infrastructure/supabase/contracts/asyncapi/domains/organization.yaml`. Can extend with new event types.

9. **Event Processing Pattern Established**: Existing `process_organization_event()` function shows pattern to follow for new event processors. Use same trigger pattern.

10. **RLS Policies Enforced**: All existing projection tables have RLS policies using JWT custom claims. Must add RLS to new junction tables.

---

## Open Questions / TODO

### ✅ Resolved Questions

- [x] **Referring Partner Mandatory?**: RESOLVED - Optional. Dropdown defaults to "Not Applicable". Only VAR partners (value-added resellers) are eligible for display in the dropdown. This determines if provider is coming through a partner channel.
- [x] **Partner Type "Other"**: RESOLVED - Catch-all category for partners that don't fit VAR/family/court classifications.
- [x] **Migration of Deprecated Business Profile Addresses**: RESOLVED - Defer to later. `organization_business_profiles_projection` has no data. Safe to ignore for this project.
- [x] **Sub-Organization Creation**: RESOLVED - Out of scope for this project. This project creates top-level orgs only. Sub-org creation is a provider_admin function (impersonation required). "Provider Admin Info" section establishes first user assigned provider_admin role for the new org. Sub-org functionality not yet implemented (may be documented as aspirational in @documentation/).
- [x] **Contact Phone/Address Links**: RESOLVED - **INCLUDE IN THIS PROJECT**. Contacts have personal phones and addresses linked to them. Event processors for `contact.phone.linked` and `contact.address.linked` will be created now.

### 🔥 CRITICAL DATA MODEL CLARIFICATION

**General Information Section** (Headquarters):
- Phone and Address are associated to the **organization only** (not to a contact)
- Contact is a person associated to the organization
- These are **3 separate entities**: org→address, org→phone, org→contact (no contact-address or contact-phone links)

**Billing Information Section** (Contact Group):
- Phone, Address, and Contact are **all linked together** in a fully connected graph AND to the organization
- Junction tables needed:
  - `organization_contacts` (org→contact)
  - `organization_addresses` (org→address)
  - `organization_phones` (org→phone)
  - `contact_addresses` (**contact→address**)
  - `contact_phones` (**contact→phone**)
  - `phone_addresses` (**phone→address**) ← **NEW TABLE REQUIRED**
- Think of this as a "contact group" where all three entities (contact, address, phone) are fully interconnected

**Provider Admin Information Section** (Contact Group):
- Same as Billing: Phone, Address, and Contact all linked together in a fully connected graph AND to the organization
- Same junction tables as Billing section

**"Use General Information" Checkbox Behavior**:
- **Copy address data**: Create a NEW address record with same data as General Info, then link contact to the new address
- **Copy phone data**: Create a NEW phone record with same data as General Info, then link contact to the new phone
- **NOT a reference**: This is data duplication, not a junction link to the existing General Info records

### 🔄 Still Open

- [ ] **Contact Management Module Timeline**: When will contact management module be implemented? Many-to-many infrastructure built here is for that future module.
- [ ] **TypeScript Type Generation**: Should we auto-generate TypeScript types from AsyncAPI schemas? (Current: manual typing)
- [ ] **Contact Phone/Address Links**: When will contact-phone and contact-address junction tables be used? (Future contact management module)
- [ ] **GraphQL API Layer**: Should organization queries be exposed via GraphQL? (Current: direct SQL queries)
- [ ] **Workflow Status Polling**: How does frontend poll for workflow status? (Current: OrganizationBootstrapStatusPage, needs investigation)
- [ ] **Email Provider**: Is SMTP the only email delivery method, or support SendGrid/Mailgun? (Current: SMTP via Nodemailer)

---

## Critical Success Factors

1. **Platform Owner Login Works**: Lars Tice can login to production site before and after migration
2. **Idempotency Verified**: All migrations and triggers tested with 2x run (no errors, no duplicates)
3. **RLS Policies Tested**: Multi-tenant isolation enforced (org A can't see org B's contacts)
4. **End-to-End Flow Passes**: Provider org creation from UI → workflow → events → projections → success
5. **Dynamic UI Works**: Org type dropdown changes → Billing section appears/disappears smoothly
6. **"Use General Information" Functional**: Checkboxes sync values correctly, junction links created
7. **Subdomain Conditional Logic Correct**: VAR partners get DNS, stakeholder partners skip DNS
8. **Rollback Tested**: DNS failure → compensation saga deletes org + all entities
9. **Documentation Complete**: All new tables, events, workflows fully documented
10. **No Performance Regression**: Query performance same or better after migration

---

## Next Immediate Steps

1. Review this context document for accuracy
2. Create `provider-onboarding-enhancement-tasks.md` with checklist
3. Start Phase 1: Database schema updates (create partner_type enum, junction tables)
4. Test migrations locally with `./local-tests/verify-idempotency.sh`
5. Commit schema changes to git
6. Proceed with Phase 2: Event processors and triggers
