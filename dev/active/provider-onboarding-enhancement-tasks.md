# Tasks: Provider Onboarding Enhancement

## 🔥 CRITICAL DATA MODEL CLARIFICATION (UPDATED 2025-01-14)

### General Information (Headquarters)
- **Contact is OPTIONAL** (main office may not have specific contact person)
- **Address and Phone are REQUIRED** (main office address/phone)
- Junction links (if contact provided): `org→contact`, `org→address`, `org→phone` (3 links)
- Junction links (if NO contact): `org→address`, `org→phone` (2 links)
- **NO contact-address or contact-phone links** in General Info section

### Billing & Provider Admin (Fully Connected Contact Groups)
- **Contact is REQUIRED** (must have billing/admin contact person)
- All entities linked together in fully connected graph (6 junction links per section):
  1. `org→contact`
  2. `org→address`
  3. `org→phone`
  4. `contact→address`
  5. `contact→phone`
  6. `phone→address` ← **NEW table required** (enables phone-address queries without contact intermediary)

### "Use General Information" Behavior (CORRECTED)
- **Creates junction links to EXISTING records** (NOT data duplication)
- When checked: Billing/Provider Admin link to same General Info address/phone
- When General Info edited after linking: Auto-unlink, create NEW record, update General Info to point to new record
- When unchecked: Links remain active, sections can edit independently

### Validation: At Least One Contact Required
- **General Info**: Contact optional
- **Billing**: Contact required (but section may be hidden for partners)
- **Provider Admin**: Contact required
- **Validation**: At least ONE contact must exist across ALL sections
- **Enforcement**: ViewModel layer (frontend) + Workflow activity layer (backend)
- **NO database trigger validation**

### NEW Projection Tables (Not Migrations)
**CRITICAL**: Creating brand new tables, dropping old tables without `_projection` suffix

**Tables to CREATE**:
- `contacts_projection` - NEW table with `deleted_at`, `organization_id`, `type` enum, `label`
- `addresses_projection` - NEW table with `deleted_at`, `organization_id`, `type` enum, `label`
- `phones_projection` - NEW table with `deleted_at`, `organization_id`, `type` enum, `label`

**Tables to DROP**:
- Old `contacts` table (empty, no data to migrate)
- Old `addresses` table (empty, no data to migrate)
- Old `phones` table (empty, no data to migrate)

### Junction Table Structure
- **No primary key** - UNIQUE constraint only on (entity1_id, entity2_id)
- **No metadata columns** - No created_at, created_by (domain_events table IS the audit trail)
- **RLS policy**: Both entities' organization_id must match JWT org_id (AND condition)

### Soft Deletes
- All entities use `deleted_at TIMESTAMP`
- When org soft-deleted, cascade soft-delete to all linked contacts/addresses/phones
- Event processors emit deletion events for cascade

---

## 🛠️ INFRASTRUCTURE FIXES (2025-01-14 Evening)

### Platform Owner ltree Hierarchy Path Bug - FIXED ✅

**Issue**: Seed data for platform owner organization (A4C) used incorrect ltree path format.

**Root Cause**:
- **Broken Code**: `path = 'a4c'::LTREE` (nlevel=1)
- **Error**: Violated CHECK constraint requiring `nlevel(path) = 2` for root organizations
- **Constraint**: `(nlevel(path) = 2 AND parent_path IS NULL) OR (nlevel(path) > 2 AND parent_path IS NOT NULL)`

**Why nlevel=2 is Required**:
1. **Documented Architecture**: All root orgs use `root.*` prefix (e.g., `root.org_a4c_internal`)
2. **Code Dependencies**: Validation functions check `nlevel(path) = 2` to identify root orgs
3. **Zitadel Reference**: Bootstrap implementation uses `'root.org_' || slug` pattern
4. **Hierarchy Floor**: The `root` prefix establishes consistent hierarchy depth across the system

**Fix Applied**:
- **File**: `infrastructure/supabase/sql/99-seeds/002-bootstrap-org-roles.sql` (line 43)
- **Change**: `path = 'root.a4c'::LTREE` (nlevel=2) ✅
- **Verification**: Migrations now succeed, platform owner org created with correct path

**Impact**:
- ✅ Seed INSERT now succeeds (no constraint violation)
- ✅ Platform owner org queryable via `nlevel(path) = 2`
- ✅ All validation functions work correctly
- ✅ Permission scoping queries function properly
- ✅ Hierarchy queries using ltree operators work as expected

**Documentation**: See `dev/active/infrastructure-bug-ltree-path-analysis.md` for complete analysis.

**Files Modified**:
1. `infrastructure/supabase/sql/99-seeds/002-bootstrap-org-roles.sql` - Fixed path
2. `dev/active/infrastructure-bug-ltree-path-analysis.md` - Complete bug analysis (NEW)

**Testing Results**: Migrations tested successfully (98 successful, 8 pre-existing failures unrelated to this fix)

---

## Phase 1: Database Schema & Event Contracts ✅ COMPLETE (2025-01-14)

### 1.1 Create Partner Type Infrastructure ✅ COMPLETE
- [x] Create `infrastructure/supabase/sql/02-tables/organizations/008-create-enums.sql` enum (partner_type + 3 entity enums)
- [x] Add `partner_type` column to `organizations_projection` (nullable, CHECK constraint)
- [x] Add `referring_partner_id` column to `organizations_projection` (nullable UUID FK)
- [x] Add CHECK constraint: `(type != 'provider_partner' OR partner_type IS NOT NULL)`
- [x] Test migration locally with `./local-tests/run-migrations.sh`
- [x] Verify idempotency with `./local-tests/verify-idempotency.sh`

### 1.2 Create Many-to-Many Junction Tables ✅ COMPLETE
- [x] Create `infrastructure/supabase/sql/02-tables/organizations/013-junction-tables.sql` (all 6 tables in one file)
- [x] `organization_contacts` junction table
- [x] `organization_addresses` junction table
- [x] `organization_phones` junction table
- [x] `contact_phones` junction table
- [x] `contact_addresses` junction table
- [x] `phone_addresses` junction table ← **NEW: for fully connected contact groups**
- [x] Add foreign key constraints with ON DELETE CASCADE
- [x] Add unique constraints to prevent duplicate links (UNIQUE only, no PK)
- [x] RLS policies (deferred to Phase 2 - not created yet)
- [x] Create indexes on foreign key columns
- [x] Test migrations locally
- [x] Verify idempotency

### 1.3 Update Contact/Address/Phone Projection Schemas ✅ COMPLETE
- [x] Create `infrastructure/supabase/sql/02-tables/organizations/008-create-enums.sql` (all 4 enums in one file)
- [x] `contact_type` enum (a4c_admin, billing, technical, emergency, stakeholder)
- [x] `address_type` enum (physical, mailing, billing)
- [x] `phone_type` enum (mobile, office, fax, emergency)
- [x] `partner_type` enum (var, family, court, other)
- [x] Create NEW `contacts_projection` table (DROP old table, CREATE new with type/label/deleted_at)
- [x] Create NEW `addresses_projection` table (DROP old table, CREATE new with type/label/deleted_at)
- [x] Create NEW `phones_projection` table (DROP old table, CREATE new with type/label/deleted_at)
- [x] All tables have `label` field (user-defined string)
- [x] All tables have `type` enum field (structured classification)
- [x] All tables have `deleted_at` field (soft delete support)
- [x] RLS policies (deferred to Phase 2 - not created yet)
- [x] Test migrations locally
- [x] Verify idempotency

### 1.4 Remove Program Infrastructure
- [ ] Identify program-related columns in `organizations_projection` (if any)
- [ ] Identify program projection tables (if any)
- [ ] Export existing program data to JSON file in `dev/archived/program-data.json`
- [ ] Create migration to drop program columns (idempotent with DROP COLUMN IF EXISTS)
- [ ] Update event processors to skip program events
- [ ] Remove program event types from `event_types` table (if needed)
- [ ] Document removal in migration file comments
- [ ] Test migrations locally
- [ ] Verify idempotency

### 1.5 Update Subdomain Conditional Logic
- [ ] Make `subdomain` column nullable on `organizations_projection` (ALTER TABLE ALTER COLUMN)
- [ ] Create subdomain validation function `is_subdomain_required(org_type, partner_type)`
- [ ] Add database CHECK constraint for subdomain conditional logic
- [ ] Update platform owner org (A4C) to have NULL subdomain if currently has value
- [ ] Add migration comments explaining subdomain rules
- [ ] Test migrations locally
- [ ] Verify idempotency
- [ ] Test constraint validation (insert invalid data, should fail)

### 1.6 Update AsyncAPI Event Contracts
- [ ] Update `infrastructure/supabase/contracts/asyncapi/domains/organization.yaml` - add `referring_partner_id`, `partner_type`, remove program fields
- [ ] Create `infrastructure/supabase/contracts/asyncapi/domains/contact.yaml` - define `contact.created` event
- [ ] Create `infrastructure/supabase/contracts/asyncapi/domains/address.yaml` - define `address.created` event
- [ ] Create `infrastructure/supabase/contracts/asyncapi/domains/phone.yaml` - define `phone.created` event
- [ ] Add `organization.contact.linked` event schema to organization.yaml
- [ ] Add `organization.address.linked` event schema to organization.yaml
- [ ] Add `organization.phone.linked` event schema to organization.yaml
- [ ] Add `contact.phone.linked` event schema to contact.yaml
- [ ] Add `contact.address.linked` event schema to contact.yaml
- [ ] Add `phone.address.linked` event schema to phone.yaml ← **NEW: for fully connected contact groups**
- [ ] Version updated schemas (organization.created v1 → v2)
- [ ] Update AsyncAPI README with new event types
- [ ] Validate AsyncAPI YAML syntax

---

## Phase 2: Event Processing & Triggers ⏸️ PENDING

### 2.1 Update Organization Event Processor
- [ ] Modify `infrastructure/supabase/sql/03-functions/event-processing/002-process-organization-events.sql`
- [ ] Add `referring_partner_id` field handling in `organization.created` event processor
- [ ] Add `partner_type` field handling in `organization.created` event processor
- [ ] Remove program field processing logic
- [ ] Implement idempotent upsert (INSERT ... ON CONFLICT DO UPDATE)
- [ ] Test with sample `organization.created` event (provider org)
- [ ] Test with sample `organization.created` event (partner org)
- [ ] Verify platform owner org (A4C) unaffected

### 2.2 Create Contact/Address/Phone Event Processors
- [ ] Create `infrastructure/supabase/sql/03-functions/event-processing/003-process-contact-events.sql`
- [ ] Implement `process_contact_event()` function to handle `contact.created` events
- [ ] Add idempotent upsert pattern (INSERT ... ON CONFLICT DO NOTHING)
- [ ] Create trigger on `domain_events` table: `WHEN (NEW.event_type = 'contact.created')`
- [ ] Create `infrastructure/supabase/sql/03-functions/event-processing/004-process-address-events.sql`
- [ ] Implement `process_address_event()` function to handle `address.created` events
- [ ] Add idempotent upsert pattern
- [ ] Create trigger on `domain_events` table: `WHEN (NEW.event_type = 'address.created')`
- [ ] Create `infrastructure/supabase/sql/03-functions/event-processing/005-process-phone-events.sql`
- [ ] Implement `process_phone_event()` function to handle `phone.created` events
- [ ] Add idempotent upsert pattern
- [ ] Create trigger on `domain_events` table: `WHEN (NEW.event_type = 'phone.created')`
- [ ] Test all event processors with sample events
- [ ] Verify projections updated correctly

### 2.3 Create Junction Table Event Processors
- [ ] Create `infrastructure/supabase/sql/03-functions/event-processing/006-process-junction-events.sql`
- [ ] Implement `process_organization_contact_link()` for `organization.contact.linked` events
- [ ] Implement `process_organization_address_link()` for `organization.address.linked` events
- [ ] Implement `process_organization_phone_link()` for `organization.phone.linked` events
- [ ] Implement `process_contact_phone_link()` for `contact.phone.linked` events
- [ ] Implement `process_contact_address_link()` for `contact.address.linked` events
- [ ] Implement `process_phone_address_link()` for `phone.address.linked` events ← **NEW: for fully connected contact groups**
- [ ] Add idempotent insert with ON CONFLICT DO NOTHING
- [ ] Create triggers on `domain_events` table for each junction event type
- [ ] Test "Use General Information" scenario (creates NEW records with data duplication)
- [ ] Test Billing/Provider Admin sections (creates fully connected contact groups with 6 junction links)
- [ ] Verify junction tables populated correctly

### 2.4 Test Idempotency & Rollback
- [ ] Run all migrations twice: `./local-tests/run-migrations.sh && ./local-tests/verify-idempotency.sh`
- [ ] Test event replay: emit same event multiple times, verify no duplicate data
- [ ] Test compensation scenario: insert org → insert contacts → delete org → verify contacts deleted (CASCADE)
- [ ] Test event processing idempotency: process same event twice, verify no errors
- [ ] Verify RLS policies working (test with different JWT claims)
- [ ] Document any idempotency issues found and fixed

---

## Phase 3: Workflow Updates (Temporal Activities) ⏸️ PENDING

### 3.1 Update Workflow Parameter Types
- [ ] Modify `workflows/src/workflows/organization-bootstrap/types.ts`
- [ ] Add `referringPartnerId?: string` to `OrganizationBootstrapParams`
- [ ] Add `partnerType?: 'var' | 'family' | 'court' | 'other'` to `OrganizationBootstrapParams`
- [ ] Change `contact` to `contacts: ContactInput[]` array
- [ ] Change `address` to `addresses: AddressInput[]` array
- [ ] Change `phone` to `phones: PhoneInput[]` array
- [ ] Remove program fields from params
- [ ] Create `ContactInput` interface (label, type, first_name, last_name, email, title, department)
- [ ] Create `AddressInput` interface (label, type, street1, street2, city, state, zip_code)
- [ ] Create `PhoneInput` interface (label, type, number, extension)
- [ ] Update `OrganizationBootstrapResult` if needed
- [ ] Run `npm run build` to verify TypeScript compilation

### 3.2 Update `createOrganization` Activity
- [ ] Modify `workflows/src/activities/createOrganization.ts`
- [ ] Update activity to accept new parameter structure (arrays, referring partner, etc.)
- [ ] Emit `organization.created` event with new fields (`referring_partner_id`, `partner_type`)
- [ ] Remove program event emission
- [ ] Loop through `contacts` array and emit `contact.created` event for each
- [ ] Loop through `addresses` array and emit `address.created` event for each
- [ ] Loop through `phones` array and emit `phone.created` event for each
- [ ] Emit `organization.contact.linked` events for all contacts
- [ ] Emit `organization.address.linked` events for all addresses
- [ ] Emit `organization.phone.linked` events for all phones
- [ ] Handle "Use General Information" scenario (detect shared entity IDs, create additional junction links)
- [ ] Implement idempotent check: query if org exists before creating
- [ ] Validate subdomain requirement based on `type` and `partnerType`
- [ ] Return created entity IDs in activity result
- [ ] Add comprehensive error handling and logging
- [ ] Write unit tests for activity

### 3.3 Update DNS Provisioning Activities
- [ ] Modify `workflows/src/activities/configureDNS.ts`
- [ ] Add early return if `subdomain === null` (skip DNS provisioning)
- [ ] Update activity logs: "Subdomain not required, skipping DNS provisioning"
- [ ] Test with provider org (subdomain required)
- [ ] Test with stakeholder partner (subdomain null)
- [ ] Modify `workflows/src/activities/verifyDNS.ts`
- [ ] Add early return if `subdomain === null` (skip DNS verification)
- [ ] Update activity logs appropriately
- [ ] Test with both scenarios (subdomain required and not required)
- [ ] Ensure platform owner org skips DNS provisioning

### 3.4 Update Compensation Logic (Rollback)
- [ ] Update compensation saga in `workflows/src/workflows/organization-bootstrap/workflow.ts`
- [ ] Emit `contact.deleted` events on rollback (for all contacts created)
- [ ] Emit `address.deleted` events on rollback (for all addresses created)
- [ ] Emit `phone.deleted` events on rollback (for all phones created)
- [ ] Emit junction unlink events on rollback
- [ ] Update organization deletion compensation to cascade delete related entities
- [ ] Test compensation scenario: manually fail DNS activity → verify all entities rolled back
- [ ] Verify no orphaned records in database after rollback
- [ ] Document rollback behavior

### 3.5 Update Workflow Tests
- [ ] Update workflow test fixtures in `workflows/src/workflows/organization-bootstrap/__tests__/`
- [ ] Create test case: provider org creation (with billing section data)
- [ ] Create test case: partner org creation (without billing section data)
- [ ] Create test case: VAR partner (with subdomain)
- [ ] Create test case: stakeholder partner (without subdomain)
- [ ] Create test case: "Use General Information" (creates junction links)
- [ ] Create test case: referring partner relationship
- [ ] Update mock DNS provider to handle optional subdomain
- [ ] Run all workflow tests: `npm test`
- [ ] Verify all tests pass
- [ ] Achieve >80% code coverage

---

## Phase 4: Frontend UI Implementation ⏸️ PENDING

### 4.1 Update Form Types & Interfaces
- [ ] Update `frontend/src/types/organization.types.ts`
- [ ] Add `referringPartnerId?: string` to `OrganizationFormData`
- [ ] Add `partnerType?: 'var' | 'family' | 'court' | 'other'` to `OrganizationFormData`
- [ ] Change contact/address/phone from single objects to arrays
- [ ] Remove program fields
- [ ] Create `ContactFormData` interface (label, type, first_name, last_name, email, title, department)
- [ ] Create `AddressFormData` interface (label, type, street1, street2, city, state, zip_code)
- [ ] Create `PhoneFormData` interface (label, type, number, extension)
- [ ] Update `OrganizationBootstrapParams` to match workflow types
- [ ] Add Zod validation schemas for new structure
- [ ] Run `npm run build` to verify TypeScript compilation

### 4.2 Update OrganizationFormViewModel
- [ ] Modify `frontend/src/viewmodels/OrganizationFormViewModel.ts`
- [ ] Add `@observable generalContact: ContactFormData` (single contact for General Info)
- [ ] Add `@observable generalAddress: AddressFormData` (single address for General Info)
- [ ] Add `@observable generalPhone: PhoneFormData` (single phone for General Info)
- [ ] Add `@observable billingContact: ContactFormData` (conditionally shown)
- [ ] Add `@observable billingAddress: AddressFormData` (conditionally shown)
- [ ] Add `@observable billingPhone: PhoneFormData` (conditionally shown)
- [ ] Add `@observable providerAdminContact: ContactFormData`
- [ ] Add `@observable providerAdminAddress: AddressFormData`
- [ ] Add `@observable providerAdminPhone: PhoneFormData`
- [ ] Add `@observable referringPartnerId?: string`
- [ ] Add `@observable partnerType?: 'var' | 'family' | 'court' | 'other'`
- [ ] Add `@observable useBillingGeneralAddress: boolean` (checkbox state)
- [ ] Add `@observable useBillingGeneralPhone: boolean` (checkbox state)
- [ ] Add `@observable useProviderAdminGeneralAddress: boolean` (checkbox state)
- [ ] Add `@observable useProviderAdminGeneralPhone: boolean` (checkbox state)
- [ ] Remove program-related observables
- [ ] Implement validation logic for "all sections required"
- [ ] Implement "Use General Information" checkbox logic (copy values, track sync state)
- [ ] Add `@computed get isSubdomainRequired()` based on type + partnerType
- [ ] Update `transformToWorkflowParams()` to build new parameter structure
- [ ] Update auto-save logic to handle new structure
- [ ] Run `npm run build` to verify compilation

### 4.3 Implement Dynamic Section Visibility
- [ ] Update `frontend/src/pages/organizations/OrganizationCreatePage.tsx`
- [ ] Add conditional rendering: `{organizationType === 'provider' && <BillingSection />}`
- [ ] Update form layout to handle 2-3 sections (responsive grid)
- [ ] Test UI toggle: change org type dropdown → Billing section appears/disappears
- [ ] Ensure smooth transition (no jarring layout shifts)
- [ ] Update glassomorphic styling for dynamic sections
- [ ] Test responsive design (mobile, tablet, desktop)

### 4.4 Implement Referring Partner Dropdown
- [ ] Create API call to fetch partner organizations: `GET /organizations?type=provider_partner`
- [ ] Implement dropdown component (reuse `SelectDropdown` or create new)
- [ ] Filter dropdown to only show partner orgs (exclude providers and platform owner)
- [ ] Add "No Partner" option (value: `null`)
- [ ] Show dropdown only when creating provider org (not when creating partner to avoid circular reference)
- [ ] Add search/autocomplete if partner list is large (optional, nice-to-have)
- [ ] Bind dropdown to `referringPartnerId` observable
- [ ] Test dropdown population and selection

### 4.5 Implement Partner Type Dropdown
- [ ] Add `partnerType` dropdown to General Information section
- [ ] Options: VAR, Family, Court, Other
- [ ] Show dropdown only when `organizationType === 'provider_partner'`
- [ ] Implement conditional subdomain validation based on partner type
- [ ] Show validation error: "Subdomain required for VAR partners" if VAR selected and subdomain empty
- [ ] Hide subdomain validation error for stakeholder partners (family, court)
- [ ] Update form validation to enforce subdomain rules
- [ ] Test all combinations (provider + subdomain, VAR + subdomain, stakeholder + no subdomain)

### 4.6 Add Type Dropdowns to Contact/Address/Phone Inputs
- [ ] Add `type` dropdown to contact input component
- [ ] Contact type options: A4C Admin, Billing, Technical, Emergency, Stakeholder
- [ ] Add `type` dropdown to address input component
- [ ] Address type options: Physical, Mailing, Billing
- [ ] Add `type` dropdown to phone input component
- [ ] Phone type options: Mobile, Office, Fax, Emergency
- [ ] Add `label` text input to all three entity input components
- [ ] Ensure label and type are both required fields (validation)
- [ ] Update `ContactInput`, `AddressInput`, `PhoneInput` components
- [ ] Test dropdowns and label inputs

### 4.7 Implement "Use General Information" Checkboxes
- [ ] Add checkbox to Billing Address section: "Use General Information"
- [ ] Add checkbox to Billing Phone section: "Use General Information"
- [ ] Add checkbox to Provider Admin Address section: "Use General Information"
- [ ] Add checkbox to Provider Admin Phone section: "Use General Information"
- [ ] Implement sync logic: when checked, copy values from General Info to current section
- [ ] Implement MobX reaction: when General Info changes and checkbox is checked, update current section
- [ ] Store sync state in ViewModel (track which sections are synced)
- [ ] Visually indicate synced fields (greyed out input fields or sync icon)
- [ ] When unchecked, unlock fields for independent editing
- [ ] Test checkbox toggle behavior
- [ ] Test dynamic sync (change General Info address → Billing address updates if checkbox checked)

### 4.8 Update Form Validation
- [ ] Enforce "all sections required" validation
- [ ] Each section must have: 1 contact, 1 address, 1 phone (all fields filled)
- [ ] Validate subdomain conditionally: required if provider OR (partner AND VAR)
- [ ] Validate partner type: required if org type is partner
- [ ] Validate referring partner: optional for all org types
- [ ] Display field-level errors (red borders, error text below input)
- [ ] Display section-level errors (e.g., "Billing section is incomplete")
- [ ] Prevent form submission if validation fails
- [ ] Test validation: try submitting incomplete form, verify errors shown
- [ ] Test validation: fill all required fields, verify form submits

### 4.9 Remove Program Section
- [ ] Delete `ProgramSection` component (if exists as separate file)
- [ ] Remove program inputs from `OrganizationCreatePage` JSX
- [ ] Remove program fields from `OrganizationFormData` type
- [ ] Remove program validation logic from ViewModel
- [ ] Remove program from auto-save/draft logic
- [ ] Clean up unused program-related components, types, utils
- [ ] Run `npm run build` to verify no broken imports
- [ ] Test form rendering (ensure no errors from removed program section)

### 4.10 Update OrganizationCreatePage Component
- [ ] Refactor component to render dynamic sections (General + Billing [conditional] + Provider Admin)
- [ ] Update layout: responsive grid with 2-3 tile cards per row
- [ ] Update form submission handler to call `viewModel.transformToWorkflowParams()`
- [ ] Update auto-save logic to handle new form structure (debounced localStorage save)
- [ ] Update accessibility: keyboard navigation (tab indexes), ARIA labels, screen reader announcements
- [ ] Test glassomorphic UI styling with new sections
- [ ] Ensure responsive design works (mobile: stacked sections, desktop: grid layout)
- [ ] Test entire form flow: fill General Info → fill Billing (if provider) → fill Provider Admin → submit
- [ ] Verify workflow invoked with correct parameters

---

## Phase 5: Documentation Updates ⏸️ PENDING

### 5.1 Database Reference Documentation
- [ ] Create `documentation/infrastructure/reference/database/tables/contacts_projection.md`
- [ ] Document schema: all columns, data types, constraints
- [ ] Document RLS policies with examples
- [ ] Add query examples (find all contacts for org, find primary contact)
- [ ] Add performance considerations (indexes, query optimization)
- [ ] Create `documentation/infrastructure/reference/database/tables/addresses_projection.md`
- [ ] Document schema, RLS policies, query examples, performance
- [ ] Create `documentation/infrastructure/reference/database/tables/phones_projection.md`
- [ ] Document schema, RLS policies, query examples, performance
- [ ] Create `documentation/infrastructure/reference/database/tables/organization_contacts.md`
- [ ] Document junction table schema, purpose, RLS policies
- [ ] Create `documentation/infrastructure/reference/database/tables/organization_addresses.md`
- [ ] Document junction table schema, purpose, RLS policies
- [ ] Create `documentation/infrastructure/reference/database/tables/organization_phones.md`
- [ ] Document junction table schema, purpose, RLS policies
- [ ] Update `documentation/infrastructure/reference/database/tables/organizations_projection.md`
- [ ] Add `referring_partner_id`, `partner_type`, updated `subdomain` (nullable) fields
- [ ] Document subdomain conditional logic
- [ ] Document partner type enum values

### 5.2 Update Workflow Architecture Documentation
- [ ] Update `documentation/architecture/workflows/organization-onboarding-workflow.md`
- [ ] Document new workflow parameters (contacts array, addresses array, phones array, referring partner, partner type)
- [ ] Update activity specifications with new event emission logic (contact.created, address.created, etc.)
- [ ] Document subdomain conditional provisioning (when DNS activities are skipped)
- [ ] Update compensation/rollback documentation (cascade delete contacts/addresses/phones)
- [ ] Add sequence diagram showing new event flow (org created → contacts created → junction links created)
- [ ] Document "Use General Information" backend behavior (junction links, not data duplication)
- [ ] Update workflow execution time estimate (may be faster without program, but similar overall)

### 5.3 Update Event Contract Documentation
- [ ] Update `documentation/infrastructure/guides/supabase/docs/EVENT-DRIVEN-ARCHITECTURE.md`
- [ ] Document new event schemas: `contact.created`, `address.created`, `phone.created`
- [ ] Document junction link events: `organization.contact.linked`, etc.
- [ ] Update event ordering documentation (org created → entities created → junction links created)
- [ ] Add examples of event payloads (JSON examples for each event type)
- [ ] Document event versioning strategy (`organization.created` v1 → v2)
- [ ] Update AsyncAPI contract documentation (link to YAML files)
- [ ] Document how to add new event types (process for extending contracts)

### 5.4 Update Frontend Component Documentation
- [ ] Update `OrganizationCreatePage` component documentation
- [ ] Document dynamic section visibility logic (provider vs partner org types)
- [ ] Document "Use General Information" UI/UX behavior (checkboxes, sync, visual indicators)
- [ ] Document referring partner dropdown implementation (filtered to partner orgs)
- [ ] Document partner type conditional subdomain logic (VAR vs stakeholder)
- [ ] Update form validation documentation (all sections required, conditional subdomain)
- [ ] Add accessibility documentation for new features (keyboard nav, ARIA labels)
- [ ] Document auto-save behavior with new structure
- [ ] Add screenshots or wireframes to component docs (if applicable)

### 5.5 Create Migration Guide
- [ ] Create `documentation/infrastructure/guides/provider-onboarding-migration.md`
- [ ] Document backward compatibility approach (nullable fields, defaults)
- [ ] Explain platform owner org preservation (A4C, lars.tice@gmail.com)
- [ ] Document program data removal and archival (where archived, how to recover)
- [ ] Create migration checklist for deploying changes:
  - [ ] Backup production database
  - [ ] Test migrations on staging environment
  - [ ] Verify lars.tice@gmail.com login on staging
  - [ ] Run security advisors
  - [ ] Deploy to production during low-traffic window
  - [ ] Monitor logs for errors
  - [ ] Verify platform owner login on production
- [ ] Document rollback procedure if issues occur (restore database backup, redeploy previous code)
- [ ] Add troubleshooting section for common issues (migration fails, RLS denies access, etc.)

---

## Phase 6: Testing & Validation ⏸️ PENDING

### 6.1 Database Testing
- [ ] Start local Supabase: `./local-tests/start-local.sh`
- [ ] Apply migrations: `./local-tests/run-migrations.sh`
- [ ] Verify idempotency: `./local-tests/verify-idempotency.sh` (2x run, no errors)
- [ ] Manually test RLS policies:
  - [ ] Create test org A with contacts/addresses/phones
  - [ ] Create test org B with contacts/addresses/phones
  - [ ] Login as user from org A, query contacts → should only see org A contacts
  - [ ] Login as user from org B, query contacts → should only see org B contacts
- [ ] Test cascade deletes:
  - [ ] Create test org with contacts/addresses/phones
  - [ ] Delete org
  - [ ] Verify contacts/addresses/phones auto-deleted (CASCADE)
  - [ ] Verify junction links auto-deleted (CASCADE)
- [ ] Test platform owner org preservation:
  - [ ] Query platform owner org (UUID `aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa`)
  - [ ] Verify all fields intact
  - [ ] Verify lars.tice@gmail.com user exists with super_admin role
- [ ] Stop local Supabase: `./local-tests/stop-local.sh`

### 6.2 Workflow Testing
- [ ] Port-forward Temporal server: `kubectl port-forward -n temporal svc/temporal-frontend 7233:7233`
- [ ] Run workflow unit tests: `cd workflows && npm test`
- [ ] Verify all tests pass
- [ ] Manual testing via workflow client:
  - [ ] Test provider org creation (with billing section data)
  - [ ] Verify workflow completes successfully
  - [ ] Check domain_events table for all expected events
  - [ ] Check projections updated correctly
- [ ] Test partner org creation (without billing section data)
  - [ ] Verify workflow completes successfully
  - [ ] Verify no billing contact/address/phone created
- [ ] Test VAR partner with subdomain
  - [ ] Verify DNS activities execute
  - [ ] Verify CNAME record created in Cloudflare (or mock)
- [ ] Test stakeholder partner without subdomain
  - [ ] Verify DNS activities skipped
  - [ ] Verify workflow completes without DNS provisioning
- [ ] Test "Use General Information" scenario
  - [ ] Create org with shared address/phone (same entity IDs)
  - [ ] Verify junction links created in database
  - [ ] Verify only one address/phone record created (not duplicated)
- [ ] Test compensation rollback
  - [ ] Manually fail DNS activity (mock error)
  - [ ] Verify compensation saga deletes org + all entities
  - [ ] Verify no orphaned records in database

### 6.3 Frontend Testing
- [ ] Start frontend dev server: `cd frontend && npm run dev`
- [ ] Test dynamic section visibility:
  - [ ] Select "Provider" org type → verify Billing section shown
  - [ ] Select "Provider Partner" org type → verify Billing section hidden
  - [ ] Toggle back and forth → verify smooth transition
- [ ] Test referring partner dropdown:
  - [ ] Verify dropdown populated with partner orgs only
  - [ ] Verify "No Partner" option available
  - [ ] Select a partner → verify `referringPartnerId` updated
- [ ] Test partner type dropdown and subdomain validation:
  - [ ] Select partner org type → verify partner type dropdown shown
  - [ ] Select "VAR" → verify subdomain field required
  - [ ] Leave subdomain empty → verify validation error shown
  - [ ] Select "Family" → verify subdomain field not required
  - [ ] Leave subdomain empty → verify no validation error
- [ ] Test "Use General Information" checkboxes:
  - [ ] Fill General Info address
  - [ ] Check "Use General Information" in Billing Address → verify values copied
  - [ ] Change General Info address → verify Billing Address syncs
  - [ ] Uncheck "Use General Information" → verify Billing Address unlocked for editing
  - [ ] Repeat for phone fields
- [ ] Test form validation:
  - [ ] Try submitting empty form → verify errors shown
  - [ ] Fill only General Info → verify "Provider Admin section incomplete" error
  - [ ] Fill all required fields → verify form submits successfully
- [ ] Test label and type fields:
  - [ ] Verify label input exists for contacts/addresses/phones
  - [ ] Verify type dropdown exists for contacts/addresses/phones
  - [ ] Try submitting without label/type → verify validation error
- [ ] Test auto-save/draft functionality:
  - [ ] Fill form partially
  - [ ] Wait for auto-save (500ms debounce)
  - [ ] Refresh page
  - [ ] Verify form data restored from localStorage
- [ ] Test keyboard navigation:
  - [ ] Tab through all form fields
  - [ ] Verify tab order logical
  - [ ] Verify dropdowns accessible via keyboard
  - [ ] Verify checkboxes toggle via spacebar
- [ ] Test accessibility:
  - [ ] Run screen reader (NVDA or JAWS)
  - [ ] Verify all form fields announced correctly
  - [ ] Verify error messages announced
  - [ ] Verify dynamic section changes announced
- [ ] Test responsive design:
  - [ ] Test on mobile (375px width) → verify sections stack vertically
  - [ ] Test on tablet (768px width) → verify 2-column grid
  - [ ] Test on desktop (1440px width) → verify 3-column grid

### 6.4 End-to-End Integration Testing
- [ ] Create provider org via UI:
  - [ ] Fill all sections (General + Billing + Provider Admin)
  - [ ] Submit form
  - [ ] Verify workflow invoked (check Temporal UI)
  - [ ] Wait for workflow completion (~10-40 minutes)
  - [ ] Verify organization created in database
  - [ ] Verify contacts/addresses/phones created
  - [ ] Verify junction links created
  - [ ] Verify DNS CNAME record created
  - [ ] Verify invitation emails sent
  - [ ] Verify organization activated
- [ ] Create partner org via UI:
  - [ ] Select partner org type
  - [ ] Verify Billing section hidden
  - [ ] Fill General Info + Provider Admin sections
  - [ ] Submit form
  - [ ] Verify workflow invoked
  - [ ] Verify organization created
  - [ ] Verify no billing contact/address/phone created
- [ ] Create VAR partner:
  - [ ] Select partner org type + VAR partner type
  - [ ] Fill subdomain field
  - [ ] Submit form
  - [ ] Verify DNS CNAME record created
- [ ] Create stakeholder partner:
  - [ ] Select partner org type + Family partner type
  - [ ] Leave subdomain empty
  - [ ] Submit form
  - [ ] Verify workflow completes without DNS provisioning
- [ ] Use "Use General Information" checkboxes:
  - [ ] Create provider org with checkboxes enabled
  - [ ] Verify junction links created in database
  - [ ] Query: should show shared address/phone linked to both General Info and Billing sections
- [ ] Add referring partner:
  - [ ] Select existing partner from dropdown
  - [ ] Submit form
  - [ ] Verify `referring_partner_id` stored in database
- [ ] Test full rollback scenario:
  - [ ] Create org with invalid DNS configuration (force DNS failure)
  - [ ] Verify compensation saga executes
  - [ ] Verify org deleted
  - [ ] Verify contacts/addresses/phones deleted
  - [ ] Verify no orphaned records

### 6.5 Production Validation (Pre-Deployment)
- [ ] Verify lars.tice@gmail.com can login to production site (before deployment)
- [ ] Verify platform owner org (A4C) is intact in production database
- [ ] Review security advisors: `mcp__supabase__get_advisors --type security`
- [ ] Address any critical security issues found
- [ ] Review performance advisors: `mcp__supabase__get_advisors --type performance`
- [ ] Address any critical performance issues found
- [ ] Check for missing RLS policies on new tables
- [ ] Check for performance bottlenecks (slow queries, missing indexes)
- [ ] Smoke test existing features:
  - [ ] User login
  - [ ] Organization list page
  - [ ] User management
  - [ ] Any other critical features
- [ ] Verify no breaking changes to existing features

---

## Success Validation Checkpoints

### Immediate Validation (During Development)
- [ ] All TypeScript compilation succeeds with no errors
- [ ] All database migrations apply cleanly (idempotent, no errors)
- [ ] All workflow tests pass
- [ ] All event processors tested with sample events
- [ ] UI renders correctly for provider and partner org types

### Feature Complete Validation
- [ ] Provider org creation end-to-end test passes
- [ ] Partner org creation end-to-end test passes
- [ ] VAR partner gets subdomain provisioned
- [ ] Stakeholder partner skips subdomain provisioning
- [ ] "Use General Information" creates junction links in database
- [ ] Referring partner relationship captured correctly
- [ ] Platform owner org (lars.tice@gmail.com) login still works
- [ ] All documentation updated and reviewed
- [ ] Security advisors show no critical issues
- [ ] Performance advisors show no regressions

### Production Stability (Post-Deployment)
- [ ] 5+ provider orgs created successfully in production
- [ ] 5+ partner orgs created successfully in production
- [ ] No rollback scenarios in production (100% success rate target)
- [ ] Contact management module integrates cleanly with existing structure
- [ ] No data integrity issues discovered
- [ ] No performance degradation under load
- [ ] Zero security incidents related to new features

---

## Current Status

**Phase**: Phase 1 Schema Implementation COMPLETE ✅
**Status**: ✅ Phase 1.1-1.3 COMPLETE | ⏸️ Phase 1.4-1.6 PENDING
**Last Updated**: 2025-01-14 (Evening Session)
**Next Step**: Phase 1.4 (Remove Program Infrastructure) OR Phase 2 (Event Processing & Triggers)

**Completed in This Session**:
- ✅ Phase 1.1: Partner type infrastructure (enums + columns)
- ✅ Phase 1.2: Junction tables (all 6 tables created)
- ✅ Phase 1.3: NEW projection tables (contacts/addresses/phones v2)
- ✅ Infrastructure bug fix: Platform owner ltree path corrected

**Files Created**:
1. `infrastructure/supabase/sql/02-tables/organizations/008-create-enums.sql` (4 enums)
2. `infrastructure/supabase/sql/02-tables/organizations/009-add-partner-columns.sql` (partner_type, referring_partner_id)
3. `infrastructure/supabase/sql/02-tables/organizations/010-contacts_projection_v2.sql` (NEW table)
4. `infrastructure/supabase/sql/02-tables/organizations/011-addresses_projection_v2.sql` (NEW table)
5. `infrastructure/supabase/sql/02-tables/organizations/012-phones_projection_v2.sql` (NEW table)
6. `infrastructure/supabase/sql/02-tables/organizations/013-junction-tables.sql` (6 junction tables)
7. `dev/active/infrastructure-bug-ltree-path-analysis.md` (bug documentation)

**Files Modified**:
1. `infrastructure/supabase/sql/99-seeds/002-bootstrap-org-roles.sql` (fixed path: 'a4c' → 'root.a4c')

**Testing Results**:
- ✅ Migrations tested successfully (98 successful, 8 pre-existing failures)
- ✅ Idempotency verified (ran migrations twice)
- ✅ Platform owner org created with correct path: `root.a4c` (nlevel=2)
- ✅ All new schema changes applied correctly

## Session Summary (2025-01-14 Afternoon)

**Work Completed**:
- ✅ Created comprehensive dev-docs (plan, context, tasks)
- ✅ Investigated existing codebase (contacts/addresses/phones projections already exist)
- ✅ Reviewed wireframes (provider org, partner org)
- ✅ Resolved 10 critical open questions via interactive user clarification
- ✅ Discovered critical data model requirements (fully connected contact groups)
- ✅ Updated all dev-docs with new requirements (phone_addresses junction table)

**Key Discoveries**:
- Contact/address/phone projection tables already exist with `_projection` suffix
- Platform owner org (A4C, lars.tice@gmail.com) must be preserved
- Referring partner dropdown filtered to ACTIVATED VAR partners only (critical correction)
- General Information section: Contact OPTIONAL, 2-3 junction links (org-level only)
- Billing/Provider Admin sections: 6 junction links each (fully connected contact groups)
- "Use General Information" creates JUNCTION LINKS (NOT data duplication) - critical correction
- phone_addresses junction table required (not in original plan)

## Session Summary (2025-01-14 Evening)

**Work Completed**:
- ✅ Implemented Phase 1.1: Partner type infrastructure (enums + columns)
- ✅ Implemented Phase 1.2: Junction tables (all 6 tables)
- ✅ Implemented Phase 1.3: NEW projection tables (DROP old, CREATE new)
- ✅ Fixed infrastructure bug: Platform owner ltree path ('a4c' → 'root.a4c')
- ✅ Tested migrations locally (98 successful)
- ✅ Verified idempotency (ran migrations twice)
- ✅ Created infrastructure bug analysis document

**Key Implementation Decisions**:
- Used single enum file (008-create-enums.sql) for all 4 enums (cleaner)
- Used single junction file (013-junction-tables.sql) for all 6 tables (cleaner)
- DROP old projection tables (empty, no data to migrate)
- CREATE new projection tables with v2 naming (clearer migration path)
- Junction tables: UNIQUE constraints only, no PK, no metadata (minimal design)
- Soft delete support: `deleted_at TIMESTAMPTZ` on all projection tables
- Deferred RLS policies to Phase 2 (focus on schema first)

---

## Notes

- Keep this file updated as tasks are completed (mark with [x])
- Update "Current Status" section regularly
- Move completed phases from ⏸️ PENDING to ✅ COMPLETE
- Mark current phase with ✅ IN PROGRESS
- Add new tasks as discovered during implementation
- Remove tasks if they become irrelevant
- Use `/dev-docs-update` command before running `/clear` to preserve progress
