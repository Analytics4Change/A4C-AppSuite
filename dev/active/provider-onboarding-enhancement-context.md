# Context: Provider Onboarding Enhancement

## Decision Record

**Date**: 2025-01-14 (Initial planning + Critical clarification session)
**Feature**: Provider Onboarding Enhancement
**Goal**: Enhance organization creation workflow to support comprehensive contact/address/phone collection, dynamic UI based on org type, partner relationship tracking, and conditional subdomain provisioning while maintaining CQRS event-driven architecture.

### 🔥 CRITICAL UPDATES (2025-01-14 Afternoon Session)

After resolving 37 open questions with user, the following major decisions were finalized:

**1. NEW Projection Tables (Not Migrations)**
   - **Decision**: CREATE brand new `contacts_projection`, `addresses_projection`, `phones_projection` tables. DROP old tables without `_projection` suffix.
   - **Why**: Old tables are empty (no data to migrate). Clean slate approach. All new tables include `deleted_at` (soft deletes) and `organization_id` (RLS enforcement).
   - **Impact**: Simplifies Phase 1 migrations significantly (no ALTER TABLE complexity)

**2. General Information Contact is OPTIONAL**
   - **Decision**: General Info section allows optional contact, requires address/phone
   - **Why**: Main office scenarios have phone/address without specific contact person (unknown receptionist, general mailing address)
   - **Validation**: At least one contact must exist across ALL sections (enforced at ViewModel + Workflow layers, no database triggers)

**3. "Use General Information" Creates Junction Links (NOT Data Duplication)**
   - **Decision**: When checked, create junction links to EXISTING General Info records (shared entities)
   - **Why**: Avoid data duplication. When General Info edited after linking, system auto-unlinks and creates new record.
   - **Impact**: Changes workflow activity logic - must track which sections are linked vs. independent

**4. Soft Deletes with Cascade**
   - **Decision**: All entities use `deleted_at` timestamp. When org soft-deleted, cascade soft-delete to all linked contacts/addresses/phones.
   - **Why**: Preserves audit trail, enables "undo", cleaner than hard deletes
   - **Impact**: Event processors must handle `organization.deleted` → emit `contact.deleted`, `address.deleted`, `phone.deleted` events

**5. Junction Tables: No PK, No Metadata**
   - **Decision**: Junction tables have UNIQUE constraint only (no primary key). No created_at or created_by columns.
   - **Why**: domain_events table IS the audit trail. Minimal design for performance. CQRS alignment.
   - **Impact**: Simplifies junction table creation, reduces storage

**6. RLS Policy for Junction Tables: Both Entities AND Condition**
   - **Decision**: Both organization_id AND linked entity's organization_id must match JWT org_id
   - **Why**: Strictest multi-tenant isolation. Prevents any cross-org junction visibility.
   - **Impact**: RLS policies must join to both sides of junction relationship

**7. Workflow Idempotency: Fail if Org Exists**
   - **Decision**: If org exists during retry, FAIL with non-retryable error (don't attempt repair)
   - **Why**: Simpler error handling. Forces explicit compensation rather than ambiguous state.
   - **Impact**: Workflow compensation saga must be robust

**8. Referring Partner Dropdown: Only Activated VAR Partners**
   - **Decision**: Filter dropdown to `status='activated' AND partner_type='var'`
   - **Why**: Ensures provider can only be referred by operational partners
   - **Impact**: Frontend API call must filter by both status and partner_type

**9. Section Visibility Toggle: Preserve Hidden Data**
   - **Decision**: When org type changes and hides Billing section, preserve Billing data in form state
   - **Why**: Prevents accidental data loss from experimenting with dropdowns
   - **Impact**: Form state management must handle hidden sections

**10. "Use General Information" Unchecking: Keep Links, Allow Independent Editing**
   - **Decision**: When unchecked, links remain active but section can edit independently
   - **Why**: Most flexible approach - user can diverge from General Info without explicit unlinking
   - **Impact**: UI must handle "linked but editable" state

### 🔥 IMPLEMENTATION SESSION (2025-01-14 Evening)

After resolving the 10 critical architectural decisions in the afternoon, implementation of Phase 1 schema changes was completed:

**Phase 1.1-1.3 Implementation Complete ✅**

**Files Created** (6 new migration files):
1. `infrastructure/supabase/sql/02-tables/organizations/008-create-enums.sql` - 4 enum types (partner_type, contact_type, address_type, phone_type)
2. `infrastructure/supabase/sql/02-tables/organizations/009-add-partner-columns.sql` - Added partner_type + referring_partner_id to organizations_projection
3. `infrastructure/supabase/sql/02-tables/organizations/010-contacts_projection_v2.sql` - NEW table (DROP old, CREATE new with type/label/deleted_at)
4. `infrastructure/supabase/sql/02-tables/organizations/011-addresses_projection_v2.sql` - NEW table (DROP old, CREATE new with type/label/deleted_at)
5. `infrastructure/supabase/sql/02-tables/organizations/012-phones_projection_v2.sql` - NEW table (DROP old, CREATE new with type/label/deleted_at)
6. `infrastructure/supabase/sql/02-tables/organizations/013-junction-tables.sql` - 6 junction tables (org-level + contact groups)

**Key Implementation Decisions**:
- **Single enum file**: All 4 enums in one file (008-create-enums.sql) for cleaner migration structure
- **Single junction file**: All 6 junction tables in one file (013-junction-tables.sql) for atomic deployment
- **DROP old tables**: Empty tables without `_projection` suffix dropped, no data migration needed
- **v2 naming**: New tables use v2 suffix in file names to indicate breaking change from old structure
- **Minimal junction design**: UNIQUE constraints only, no PK, no metadata columns (domain_events IS audit trail)
- **Soft delete support**: All projection tables have `deleted_at TIMESTAMPTZ` column
- **Deferred RLS**: RLS policies deferred to Phase 2 to focus on schema correctness first

**Infrastructure Bug Fixed** 🛠️:
- **Issue**: Platform owner seed data used `path='a4c'::LTREE` (nlevel=1), violated CHECK constraint requiring nlevel=2
- **Root Cause**: All root organizations must use `root.*` prefix per documented architecture
- **Fix**: Changed to `path='root.a4c'::LTREE` in `infrastructure/supabase/sql/99-seeds/002-bootstrap-org-roles.sql:43`
- **Impact**: Seed INSERT now succeeds, platform owner org created correctly, all validation functions work
- **Documentation**: Complete bug analysis at `dev/active/infrastructure-bug-ltree-path-analysis.md`

**Testing Results**:
- ✅ Migrations tested successfully (98 successful, 8 pre-existing failures unrelated to Phase 1)
- ✅ Idempotency verified (ran migrations twice with no errors)
- ✅ Platform owner org created with correct path: `root.a4c` (nlevel=2)
- ✅ All new schema changes applied correctly:
  - 4 enums created
  - 2 new columns on organizations_projection
  - 3 new projection tables created (contacts/addresses/phones v2)
  - 6 junction tables created

**Phase 1 Status**:
- ✅ Phase 1.1 COMPLETE: Partner type infrastructure
- ✅ Phase 1.2 COMPLETE: Junction tables
- ✅ Phase 1.3 COMPLETE: Projection table updates
- ✅ Phase 1 Compliance Fix: All ON DELETE violations removed (2025-01-16)
- ⏸️ Phase 1.4 PENDING: Remove program infrastructure
- ⏸️ Phase 1.5 PENDING: Update subdomain conditional logic
- ⏸️ Phase 1.6 PENDING: Update AsyncAPI event contracts

**Infrastructure Guideline Compliance Fix** 🛠️ (2025-01-16):
- **Issue**: Phase 1.1-1.3 migration files contained 16 ON DELETE actions (CASCADE, SET NULL) violating infrastructure guidelines
- **Why Violation**: Event sourcing architecture requires ALL deletions emit domain events. ON DELETE actions bypass event stream:
  - **ON DELETE CASCADE**: Auto-deletes child rows without emitting `*.deleted` events
  - **ON DELETE SET NULL**: Auto-updates FKs to NULL without emitting `*.updated` events
  - **Impact**: Breaks CQRS projections (can't rebuild from events), incomplete audit trail, Temporal compensation fails
- **Fix Applied**: Removed all 16 ON DELETE actions from 5 migration files (009-013)
  - Default behavior now: `ON DELETE RESTRICT` (blocks deletion, forces app/workflow to handle via events)
- **Event-Driven Pattern**: Workflows must emit events before deleting:
  ```
  Workflow: Delete Organization
  1. Emit contact.deleted events (one per contact)
  2. Emit address.deleted events (one per address)
  3. Emit phone.deleted events (one per phone)
  4. Emit organization.contact.unlinked events (junction table cleanup)
  5. Emit organization.deleted event
  6. Event processors update all projections
  7. Complete audit trail in domain_events table
  ```
- **Documentation Added**: Each fixed file now has comment explaining event-driven deletion requirement
- **Deployment Ready**: All files now compliant with infrastructure-guidelines skill, safe to deploy

**Next Steps**:
- Option 1: Deploy Phase 1.1-1.3 to remote (push to main → GitHub Actions auto-deploys)
- Option 2: Continue with Phase 1.4-1.6 (schema completion)
- Option 3: Move to Phase 2 (event processors and triggers for new tables)

### Key Decisions (Original Planning Session)

1. **Data Model: Separate Projection Tables with Many-to-Many Relationships**
   - **Decision**: Use separate projection tables with junction tables for many-to-many relationships
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

5. **Event Creation Timing: Immediate (with Organization Creation)**
   - **Decision**: Emit contact/address/phone events in the first workflow activity (`createOrganization`) before DNS provisioning
   - **Why**: Event sourcing best practice is to record all entity creation atomically. Simplifies rollback (delete entire org including contacts). Provides complete audit trail from moment of creation.
   - **Alternative Rejected**: Create contacts/addresses/phones on organization activation (complicates rollback, loses audit trail if org creation fails midway)

6. **Label + Type Fields: Both Required on All Entities**
   - **Decision**: All contacts/addresses/phones have both `label` (free-form text) and `type` (constrained enum)
   - **Why**: `type` provides structure for business logic (e.g., "billing contact" vs "technical contact"). `label` provides user-friendly identification for future contact management UI. Both serve different purposes.
   - **Alternative Rejected**: Label-only or type-only (loses either structure or flexibility)

7. **Backward Compatibility: Preserve Platform Owner Org**
   - **Decision**: All migrations must preserve platform owner org (A4C, lars.tice@gmail.com). All new fields nullable with defaults. Test login before and after migration.
   - **Why**: Production requirement. Lars must be able to login to manage the system. Breaking platform owner org is unacceptable.
   - **Alternative Rejected**: Require data migration for existing orgs (risky, could break production)

9. **Email Provider: Resend (Not SMTP)** - Added 2025-01-14
   - **Decision**: Use Resend as primary email provider for transactional emails in Temporal workflows. Fully implemented with factory pattern. SMTP (nodemailer) available as fallback.
   - **Why**: Investigation revealed Resend already implemented in `workflows/src/shared/providers/email/resend-provider.ts`. Dev-docs incorrectly assumed SMTP. Resend provides better deliverability, simpler API (native fetch), and superior monitoring dashboard compared to raw SMTP.
   - **Alternative Rejected**: Switching to SMTP (unnecessary, Resend already working, would lose monitoring/analytics)
   - **Configuration**: Requires `RESEND_API_KEY` environment variable in Kubernetes secret `workflow-worker-secrets` (temporal namespace). Workers must restart to pick up key changes.
   - **Documentation**: Comprehensive guides created at `documentation/workflows/guides/resend-email-provider.md` (implementation, monitoring, troubleshooting) and `documentation/infrastructure/operations/resend-key-rotation.md` (security procedures).

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

**Infrastructure Constraints** (Discovered 2025-01-16):
- **NO ON DELETE actions allowed**: ALL foreign keys must omit ON DELETE CASCADE/SET NULL (infrastructure-guidelines skill requirement)
- **Event-driven deletions mandatory**: Workflows must emit `*.deleted` events before deleting entities
- **Dual-track migration system**: Custom SQL directory (local testing) + GitHub Actions (remote deployment) + Supabase CLI (snapshots only)
- **Migration tracking**: Remote uses `_migrations_applied` table (88 entries), local has no tracking (file-based execution order)
- **Deployment via GitHub Actions**: Push to `main` → `.github/workflows/supabase-deploy.yml` auto-deploys to remote
- **Idempotency required**: All migrations must use IF NOT EXISTS, OR REPLACE, DROP IF EXISTS patterns
- **Local Supabase**: Uses Podman (not Docker), may have startup issues unrelated to migration code

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

**Developer Guidance** (Updated 2025-01-14 for Resend documentation):
- `CLAUDE.md` (root) - Added link to Resend email provider guide after workflow environment variables (line 268)
- `workflows/CLAUDE.md` - Updated Technology Stack to reference Resend guide (line 15)
- `infrastructure/CLAUDE.md` - Added cross-references to Resend guides at top of Email Provider section (lines 163-165)
- `documentation/workflows/reference/activities-reference.md` - Updated email provider description to mention Resend (line 467)

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

**Documentation** (Database):
- `documentation/infrastructure/reference/database/tables/contacts_projection.md` - Contact table reference
- `documentation/infrastructure/reference/database/tables/addresses_projection.md` - Address table reference
- `documentation/infrastructure/reference/database/tables/phones_projection.md` - Phone table reference
- `documentation/infrastructure/reference/database/tables/organization_contacts.md` - Junction table reference
- `documentation/infrastructure/reference/database/tables/organization_addresses.md` - Junction table reference
- `documentation/infrastructure/reference/database/tables/organization_phones.md` - Junction table reference

**Documentation** (Contact Management - Aspirational):
- `documentation/architecture/features/contact-management-vision.md` - User stories, use cases, business value (15,000 words) - Added 2025-01-14
- `documentation/infrastructure/architecture/contact-management-architecture.md` - Data model, RLS policies, event-driven architecture (10,000 words) - Added 2025-01-14
- `documentation/infrastructure/guides/contact-management-implementation-guide.md` - 5 implementation phases, 14-19 week estimate (9,000 words) - Added 2025-01-14

**Documentation** (Resend Email Provider):
- `documentation/workflows/guides/resend-email-provider.md` - Complete Resend implementation guide: configuration, domain verification, monitoring, troubleshooting (8,000 words) - Added 2025-01-14
- `documentation/infrastructure/operations/resend-key-rotation.md` - API key rotation procedure with zero downtime, emergency procedures (7,500 words) - Added 2025-01-14

**Documentation** (Architecture Decisions):
- `documentation/infrastructure/architecture/asyncapi-type-generation-decision.md` - Decision to reject AsyncAPI-to-TypeScript auto-generation: anonymous schema problem, type quality loss, build complexity analysis (3,800 words) - Added 2025-01-14

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
- [x] **Contact Management Module Timeline**: RESOLVED - Timeline **indeterminate** (aspirational feature, not on current roadmap). Complete documentation created at `documentation/architecture/features/contact-management-vision.md`, `documentation/infrastructure/architecture/contact-management-architecture.md`, and `documentation/infrastructure/guides/contact-management-implementation-guide.md`. Infrastructure foundation (junction tables, type enums, event processors) being built by provider onboarding enhancement to avoid future data model surgery and enable fast implementation when business need arises. When prioritized: estimated 14-19 weeks for UI/UX implementation (backend foundation already exists).
- [x] **Email Provider**: RESOLVED - Using **Resend** as primary email provider (not SMTP/SendGrid/Mailgun). Fully implemented in `workflows/src/shared/providers/email/resend-provider.ts` with factory pattern. Requires `RESEND_API_KEY` environment variable for Temporal workers (configured in `infrastructure/k8s/temporal/worker-secret.yaml`). SMTP (nodemailer) available as fallback if `RESEND_API_KEY` not set but `SMTP_HOST` configured. Production mode (`WORKFLOW_MODE=production`) uses Resend by default. **See**: [Resend Email Provider Guide](../../documentation/workflows/guides/resend-email-provider.md) and [Resend Key Rotation](../../documentation/infrastructure/operations/resend-key-rotation.md) for complete documentation.
- [x] **TypeScript Type Generation**: RESOLVED - **Continue with manual hand-crafted types** (reject auto-generation). AsyncAPI code generation tools (Modelina) produce anonymous schemas (`AnonymousSchema_1`, `AnonymousSchema_2`) instead of semantic names, lose type quality (no discriminated unions/type guards), add build complexity (monorepo orchestration), and slow developer workflow (15-20 min vs 5-10 min per event). Our current 591-line hand-crafted type file provides superior quality. We already tried and rejected this approach previously (documented in contracts README). **Decision documented**: [AsyncAPI Type Generation Decision](../../documentation/infrastructure/architecture/asyncapi-type-generation-decision.md). Alternative recommendation: Add validation tests to catch drift instead of code generation. Decision made 2025-01-14.

### 🔥 CRITICAL DATA MODEL CLARIFICATION (Updated 2025-01-14)

**General Information Section** (Headquarters):
- **Contact is OPTIONAL** - Main office phone/mailing address may not have specific contact person
- Phone and Address are **REQUIRED** and associated to the **organization only**
- If contact provided, creates 3 separate entities: org→contact, org→address, org→phone (no contact-address or contact-phone links)
- If contact omitted, creates 2 entities: org→address, org→phone
- **Rationale**: Business may have main office with unknown receptionist (phone) and general mailing address with no specific contact

**Billing Information Section** (Contact Group):
- **Contact is REQUIRED** (must have billing contact person)
- Phone, Address, and Contact are **all linked together** in a fully connected graph AND to the organization
- Junction tables needed (6 links total per Billing section):
  - `organization_contacts` (org→contact)
  - `organization_addresses` (org→address)
  - `organization_phones` (org→phone)
  - `contact_addresses` (**contact→address**)
  - `contact_phones` (**contact→phone**)
  - `phone_addresses` (**phone→address**) ← Enables direct phone-address queries without contact intermediary
- Think of this as a "contact group" where all three entities (contact, address, phone) are fully interconnected

**Provider Admin Information Section** (Contact Group):
- **Contact is REQUIRED** (must have provider admin contact person)
- Same as Billing: Phone, Address, and Contact all linked together in a fully connected graph AND to the organization
- Same 6 junction links as Billing section

**"Use General Information" Checkbox Behavior** (CORRECTED):
- **Creates junction links to EXISTING records** (NOT data duplication)
- When checked: Billing/Provider Admin sections link to same address/phone records as General Info
- When General Info edited after linking: System auto-unlinks, creates NEW record with changed data, updates General Info to point to new record
- When unchecked: Links remain active but Billing/Provider Admin can edit independently (links only removed if section cleared)
- **Rationale**: Avoid data duplication while preserving ability to make sections independent when needed

**Validation: At Least One Contact Required**:
- Enforced at ViewModel layer (frontend) AND Workflow activity layer (backend)
- General Info contact optional + Billing section may be hidden (partners) = Need explicit validation
- Validation: "Organization must have at least one contact across all sections"
- **No database trigger validation** - validation at application layer only

### 🔥 NEW PROJECTION TABLES (Not Migrations)

**CRITICAL**: This project creates **brand new** projection tables, does NOT migrate existing tables.

**Tables to CREATE**:
- `contacts_projection` - NEW table with `deleted_at`, `organization_id`, `type` enum
- `addresses_projection` - NEW table with `deleted_at`, `organization_id`, `type` enum
- `phones_projection` - NEW table with `deleted_at`, `organization_id`, `type` enum

**Tables to DROP**:
- Old `contacts` table (without `_projection` suffix) - **NO DATA** to migrate (empty table)
- Old `addresses` table (without `_projection` suffix) - **NO DATA** to migrate (empty table)
- Old `phones` table (without `_projection` suffix) - **NO DATA** to migrate (empty table)

**New Table Structure**:
- All include `deleted_at TIMESTAMP` for soft deletes
- All include `organization_id UUID` foreign key for direct org-scoped queries + RLS enforcement
- All include `type` enum column (contact_type, address_type, phone_type)
- All include `label TEXT` for user-friendly names

**Junction Table Structure**:
- **No primary key** - just UNIQUE constraint on (entity1_id, entity2_id)
- **No metadata columns** - No created_at, created_by, etc. (domain_events table IS the audit trail)
- Minimal design for performance and CQRS alignment

### 🔥 SOFT DELETE & CASCADE BEHAVIOR

**Soft Delete Implementation**:
- All entities use `deleted_at TIMESTAMP` column
- Queries filter `WHERE deleted_at IS NULL` to exclude deleted records
- Soft delete preserves audit trail, enables "undo" functionality

**Cascade Soft Delete**:
- When organization soft-deleted (`deleted_at` set), all linked contacts/addresses/phones also soft-deleted
- Event processors handle cascade: `organization.deleted` event triggers `contact.deleted`, `address.deleted`, `phone.deleted` events
- Junction links automatically filtered out when either entity is soft-deleted (RLS handles this)

**RLS Policy for Junction Tables**:
- Policy: **Both entities must belong to user's org** (AND condition)
- Example: `organization_id = jwt.org_id AND contact.organization_id = jwt.org_id`
- Strictest isolation - prevents any cross-org junction visibility
- Supports future multi-org contacts by removing/modifying constraint later

### 🔥 WORKFLOW & UI DECISIONS

**Workflow Idempotency**:
- If org exists during retry: **FAIL with non-retryable error**
- No attempt to "repair" partial creation
- Forces explicit compensation rather than ambiguous state
- Simpler error handling, clearer failure modes

**Referring Partner Dropdown**:
- Show only **ACTIVATED VAR partners** (status='activated' AND partner_type='var')
- Excludes pending, failed, or deactivated partners
- Excludes stakeholder partners (family, court, other)
- Excludes platform owner org

**Section Visibility Toggle**:
- When user changes org type from Provider to Partner (hides Billing section):
  - **Preserve Billing data** (keep in form state, don't discard)
  - If user switches back to Provider, Billing data reappears
  - Only discard Billing data on final form submission if org type is Partner
- **Rationale**: Prevents accidental data loss from experimenting with org type dropdown

**"Use General Information" Unchecking**:
- When checkbox unchecked: **Keep links, allow independent editing**
- Links remain until user explicitly clears the Billing/Provider Admin section
- Most flexible approach - user can edit independently without breaking links

### 🔄 Still Open (Deferred)

- [ ] **GraphQL API Layer**: Should organization queries be exposed via GraphQL? (Current: direct SQL queries) - Defer to future
- [ ] **Workflow Status Polling**: How does frontend poll for workflow status? (Current: OrganizationBootstrapStatusPage, needs investigation) - Not blocking implementation

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
