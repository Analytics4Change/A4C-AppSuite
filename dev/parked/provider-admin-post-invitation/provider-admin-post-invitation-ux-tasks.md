# Tasks: Provider Admin Post-Invitation UX

## Phase 1: Email & Invitation Acceptance ⏸️ PENDING

### 1.1 Email Template Redesign
- [ ] Remove purple gradient styling from email template
- [ ] Design professional, brand-appropriate header
- [ ] Update email subject line (review for clarity)
- [ ] Test email rendering across clients (Gmail, Outlook, Apple Mail)
- [ ] Update email template in `workflows/src/activities/organization-bootstrap/send-invitation-emails.ts`

### 1.2 Invitation Route Fix
- [ ] Update invitation URL from `/accept-invitation` to `/organizations/invitation`
- [ ] Update URL in email template (line ~65 in send-invitation-emails.ts)
- [ ] Verify route exists in `frontend/src/App.tsx` (already defined at line 62)
- [ ] Test invitation flow end-to-end (email → click → token validation)

### 1.3 Subdomain Routing Investigation Documentation
- [ ] Document subdomain routing requirements (already completed in planning session)
- [ ] Create technical design doc for Phase 2 subdomain routing
- [ ] Estimate infrastructure work (wildcard DNS, TLS, nginx config)
- [ ] Create backlog ticket for subdomain routing (future sprint)

## Phase 2: Blocking Setup Wizard ⏸️ PENDING

### 2.1 Wizard Framework
- [ ] Create `SetupWizard.tsx` component with stepper UI
- [ ] Implement wizard navigation (Next, Back, Skip buttons)
- [ ] Add progress indicator (Step 1 of 4, Step 2 of 4, etc.)
- [ ] Create `SetupWizardViewModel.ts` (MobX store)
- [ ] Implement localStorage auto-save for wizard state
- [ ] Add wizard resume logic (detect incomplete wizard on page reload)
- [ ] Create wizard routes in `frontend/src/App.tsx`:
  - `/onboarding/welcome`
  - `/onboarding/agreements`
  - `/onboarding/structure`
  - `/onboarding/roles`

### 2.2 Step 1: Welcome & Confirm Organization Details
- [ ] Create `WelcomeStep.tsx` component
- [ ] Display organization name (read-only, from invitation)
- [ ] Display contact information (read-only)
- [ ] Display subdomain (read-only)
- [ ] Add welcome message and onboarding overview
- [ ] Add "Next" button navigation to Step 2

### 2.3 Step 2: Data Usage Agreements
- [ ] Create `AgreementsStep.tsx` component
- [ ] Fetch agreement text (HIPAA, ToS, Privacy Policy)
- [ ] Implement scrollable agreement viewer
- [ ] Add checkboxes for each agreement
- [ ] Validate all checkboxes checked before allowing "Next"
- [ ] Create `user_agreements` table migration
- [ ] Implement agreement acceptance tracking (user_id, agreement_type, timestamp, IP)
- [ ] Create Edge Function or API endpoint to save agreement acceptance
- [ ] Add "Back" and "Next" navigation

### 2.4 Step 3: Create Organizational Units (Optional)
- [ ] Create `OUCreationStep.tsx` component
- [ ] Implement tree view for OU hierarchy visualization (reuse `OrganizationTree.tsx`)
- [ ] Add "Add OU" button (opens create form modal)
- [ ] Reuse `OrganizationUnitFormViewModel` for form state
- [ ] Create OU form fields:
  - OU name input (required)
  - Description textarea (optional)
  - Parent selection (auto-populate from tree click)
- [ ] Implement "Delete OU" action (validation: no children)
- [ ] Use Supabase RPC `create_organization_unit` (NOT Temporal - see active plan Decision #7)
- [ ] Implement idempotency check (prevent duplicate OUs)
- [ ] Add temporary in-memory OU storage (save to DB on wizard completion)
- [ ] Add "Skip" and "Next" navigation
- [ ] **Reference**: See `dev/active/organization-units-tasks.md` for shared component details

### 2.5 Step 4: Create Custom Roles (Optional)
- [ ] Create `RoleCreationStep.tsx` component
- [ ] Create `RolePermissionSelector.tsx` component
  - Fetch all permissions from `permissions_projection`
  - Group permissions by applet (organization, user, client, medication, etc.)
  - Implement checkbox grid layout
  - Add "Select All" / "Deselect All" for each applet
- [ ] Add "Create Role" button (opens permission selector modal)
- [ ] Implement role template copy (pre-select permissions from global role)
- [ ] Create `createCustomRoleActivity` Temporal activity
  - Insert into `roles_projection` with `organization_id`
  - Insert into `role_permissions_projection` (many-to-many)
  - Emit `RoleCreated` domain event
- [ ] Implement idempotency check (prevent duplicate roles)
- [ ] Add temporary in-memory role storage (save to DB on wizard completion)
- [ ] Add "Skip" and "Complete" navigation

### 2.6 Wizard Completion & Redirect
- [ ] Implement wizard completion logic in `SetupWizardViewModel`
- [ ] Save all OUs to database (batch via Supabase RPC - NOT Temporal)
- [ ] Save all custom roles to database (batch insert via Temporal workflow)
- [ ] Update `setup_completed_at` timestamp in user_roles_projection
- [ ] Implement dynamic redirect logic:
  - If OUs created → `/organization-units`
  - If roles created → `/organization/users`
  - If both created → `/organization/users`
  - If neither created → `/dashboard`
- [ ] Clear localStorage wizard state on completion
- [ ] Emit `SetupWizardCompleted` domain event

### 2.7 First-Time Login Detection
- [ ] Add `setup_completed_at` column to `user_roles_projection` (migration)
- [ ] Update JWT custom claims hook to include `setup_completed_at`
- [ ] Modify `AuthContext.tsx` to check `setup_completed_at` in session
- [ ] Redirect to wizard if `setup_completed_at IS NULL`
- [ ] Allow app access if `setup_completed_at` has timestamp

## Phase 3: Organization Management Routes ⏸️ PENDING

### 3.1 Route Separation & Navigation
- [ ] Update `MainLayout.tsx` navigation items:
  - Hide `/organizations` from provider_admin
  - Show `/organization-units` to provider_admin
  - Show `/organization/users` to provider_admin
  - Show `/organization/roles` to provider_admin
- [ ] Update `App.tsx` routing:
  - Keep `/organizations` for platform owners only
  - Add `/organization-units/*` for provider admins
  - Add `/organization/users` for provider admins
  - Add `/organization/roles` for provider admins
- [ ] Add permission guards (`RequirePermission` HOC):
  - `/organization-units/*` requires `organization.create_ou`
  - `/organization/users` requires `user.view`
  - `/organization/roles` requires `access_grant.view`

### 3.2 OU Hierarchy Management Page
- [ ] Create `OrganizationStructurePage.tsx`
- [ ] Create `OUManagementViewModel.ts` (MobX store)
- [ ] Implement OU tree view (read-only visualization)
- [ ] Add "Add OU" button (reuse `OUCreateForm.tsx`)
- [ ] Implement inline OU edit (name, description)
- [ ] Implement OU delete (validation: no children, no assigned users)
- [ ] Create `updateOUActivity` Temporal activity
- [ ] Create `deleteOUActivity` Temporal activity (with validation)
- [ ] Add loading states, error handling
- [ ] Add accessibility (keyboard navigation, screen reader support)

### 3.3 User Management & Invitation Page
- [ ] Create `OrganizationUsersPage.tsx`
- [ ] Create `UserInvitationViewModel.ts` (MobX store)
- [ ] Display user list with role badges
- [ ] Create `UserInvitationForm.tsx` component
  - Email input (validation: unique, valid format)
  - First name, last name inputs
  - Role selection dropdown
  - OU scope selector (optional - assign to specific OU)
- [ ] Implement "Invite User" button (triggers existing `inviteUserActivity`)
- [ ] Add "Resend Invitation" action
- [ ] Add "Revoke Invitation" action (update existing workflow)
- [ ] Add loading states, error handling

### 3.4 Custom Role Management Page
- [ ] Create `OrganizationRolesPage.tsx`
- [ ] Create `RoleManagementViewModel.ts` (MobX store)
- [ ] Display role list with permission count
- [ ] Add "Create Role" button (reuse `RolePermissionSelector.tsx`)
- [ ] Implement role edit (update permissions)
- [ ] Implement role delete (validation: no assigned users)
- [ ] Create `updateRoleActivity` Temporal activity
- [ ] Create `deleteRoleActivity` Temporal activity (with validation)
- [ ] Add role template library (copy from global roles)
- [ ] Add loading states, error handling

## Phase 4: Backend Implementation ⏸️ PENDING

### 4.1 Supabase RPC Functions for OU CRUD
**Note**: OU operations use Supabase RPC, NOT Temporal (synchronous DB transaction).
See `dev/active/organization-units-context.md` Decision #7 and `dev/active/organization-units-tasks.md` Phase 5.6.

- [ ] **Defer to active plan** - OU RPC functions defined in `dev/active/organization-units-tasks.md`
- [ ] Shared components: `OrganizationTree.tsx`, `OrganizationUnitFormViewModel.ts`
- [ ] Files: `infrastructure/supabase/sql/03-functions/organizations/`
  - `create_organization_unit.sql`
  - `update_organization_unit.sql`
  - `deactivate_organization_unit.sql`
  - `get_organization_units.sql`

### 4.2 Create Custom Role Activity (Temporal)
- [ ] Create `workflows/src/activities/rbac/create-custom-role.ts`
- [ ] Define `CreateCustomRoleParams` interface
- [ ] Implement activity logic:
  - Validate role name uniqueness (within org)
  - Insert into `roles_projection` with `organization_id`
  - Insert into `role_permissions_projection` (many-to-many)
  - Emit `RoleCreated` domain event
- [ ] Implement idempotency check (check if role exists)
- [ ] Add activity tests
- [ ] Export from `workflows/src/activities/rbac/index.ts`

### 4.3 Update/Delete Role Activities (Temporal)
- [ ] Create `workflows/src/activities/rbac/update-custom-role.ts`
- [ ] Create `workflows/src/activities/rbac/delete-custom-role.ts`
  - Validate no assigned users
  - Soft delete (set `deleted_at` timestamp)
- [ ] Add activity tests for role CRUD operations

### 4.4 Batch Operations Workflow
- [ ] Create `workflows/src/workflows/onboarding/complete-setup-wizard.ts`
- [ ] Implement batch OU creation via Supabase RPC (NOT Temporal)
- [ ] Implement batch role creation (via Temporal activities)
- [ ] Emit `SetupWizardCompleted` event
- [ ] Add workflow tests

## Phase 5: Database Migrations & RLS Policies ⏸️ PENDING

### 5.1 Wizard Completion Tracking
- [ ] Create migration: `add_setup_completed_tracking.sql`
- [ ] Add `setup_completed_at TIMESTAMPTZ` to `user_roles_projection`
- [ ] Update JWT custom claims hook to include `setup_completed_at`
- [ ] Add index for fast lookup: `CREATE INDEX idx_setup_completed ON user_roles_projection(setup_completed_at)`

### 5.2 OU Management RLS Policies
- [ ] Create migration: `add_ou_management_rls.sql`
- [ ] Add RLS policy for provider_admin OU creation:
  ```sql
  CREATE POLICY "Provider admins can create OUs within their org"
  ON organizations_projection FOR INSERT
  USING (
    (SELECT scope_path FROM user_roles_projection WHERE user_id = auth.uid())
    @> NEW.path
  );
  ```
- [ ] Add RLS policy for provider_admin OU update
- [ ] Add RLS policy for provider_admin OU delete (soft delete only)
- [ ] Test RLS policies with multiple test orgs

### 5.3 Custom Role RLS Policies
- [ ] Create migration: `add_custom_role_rls.sql`
- [ ] Add RLS policy for provider_admin role creation:
  ```sql
  CREATE POLICY "Provider admins can create roles in their org"
  ON roles_projection FOR INSERT
  USING (
    organization_id = (SELECT org_id FROM user_roles_projection WHERE user_id = auth.uid())
  );
  ```
- [ ] Add RLS policy for provider_admin role update
- [ ] Add RLS policy for provider_admin role delete
- [ ] Test RLS policies with multiple test orgs

### 5.4 Data Usage Agreement Tracking
- [ ] Create migration: `create_user_agreements_table.sql`
- [ ] Create table:
  ```sql
  CREATE TABLE user_agreements (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES auth.users(id),
    agreement_type TEXT NOT NULL, -- 'hipaa', 'tos', 'privacy_policy'
    accepted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    ip_address INET,
    user_agent TEXT,
    UNIQUE (user_id, agreement_type)
  );
  ```
- [ ] Add RLS policies (users can view own agreements, admins can audit)
- [ ] Create Edge Function or API endpoint to save agreement acceptance

### 5.5 Unique Subdomain Constraint
- [ ] Create migration: `add_unique_subdomain_constraint.sql`
- [ ] Add unique constraint: `ALTER TABLE organizations_projection ADD CONSTRAINT unique_subdomain UNIQUE (subdomain);`
- [ ] Add index for fast lookup: `CREATE INDEX idx_organizations_subdomain ON organizations_projection(subdomain) WHERE subdomain IS NOT NULL;`

## Phase 6: Testing & Documentation ⏸️ PENDING

### 6.1 Unit Tests
- [ ] Test `SetupWizardViewModel` state management
- [ ] Test `OUManagementViewModel` CRUD operations
- [ ] Test `RoleManagementViewModel` CRUD operations
- [ ] Test wizard navigation logic
- [ ] Test redirect logic based on wizard state
- [ ] Test localStorage persistence utilities

### 6.2 Integration Tests
- [ ] Test complete wizard flow (E2E with Playwright)
- [ ] Test OU creation workflow (Temporal activity)
- [ ] Test custom role creation workflow (Temporal activity)
- [ ] Test RLS policies (multiple test orgs, cross-org access blocked)
- [ ] Test first-time login detection and redirect

### 6.3 Accessibility Testing
- [ ] Test wizard keyboard navigation (Tab, Enter, Escape)
- [ ] Test screen reader support (NVDA/JAWS)
- [ ] Test color contrast (WCAG 2.1 Level AA)
- [ ] Test focus management (auto-focus on modals)
- [ ] Test ARIA labels and announcements

### 6.4 Documentation
- [ ] Update `documentation/architecture/authentication/` with wizard flow
- [ ] Update `documentation/frontend/guides/` with wizard patterns
- [ ] Create user guide for provider admin onboarding
- [ ] Document OU hierarchy best practices
- [ ] Document custom role permission recommendations
- [ ] Update API documentation (Edge Functions, Temporal activities)

## Success Validation Checkpoints

### Immediate Validation (Phase 1-2 Complete)
- [ ] Provider admin receives redesigned invitation email (no purple gradient)
- [ ] Email URL matches frontend route (`/organizations/invitation`)
- [ ] Invitation acceptance creates user with `provider_admin` role
- [ ] Blocking setup wizard appears on first login
- [ ] Wizard cannot be skipped (blocks access to main app)
- [ ] Wizard state persists if browser closed (localStorage)
- [ ] All wizard steps render correctly
- [ ] Data usage agreements tracked in database

### Feature Complete Validation (Phase 3-5 Complete)
- [ ] Provider admin can create 0+ OUs during wizard (optional)
- [ ] Provider admin can create 0+ custom roles during wizard (optional)
- [ ] Wizard completion redirects based on state (dynamic routing works)
- [ ] Provider admin can access `/organization-units` (OU management)
- [ ] Provider admin can access `/organization/users` (user invitations)
- [ ] Provider admin can access `/organization/roles` (custom role management)
- [ ] OU creation uses Supabase RPC (event-sourced via domain_events, NOT Temporal)
- [ ] Custom role creation uses Temporal workflows (event-sourced)
- [ ] RLS policies enforce org isolation (provider admins cannot access other orgs)
- [ ] Super admins still have full access (impersonation works)
- [ ] **Reference**: See `dev/active/organization-units-tasks.md` for OU implementation details

### Production Readiness Validation (Phase 6 Complete)
- [ ] All unit tests pass (95%+ coverage)
- [ ] All integration tests pass (E2E wizard flow)
- [ ] Accessibility tests pass (WCAG 2.1 Level AA)
- [ ] RLS security audit complete (no cross-org data leakage)
- [ ] Performance testing (wizard completes in < 5 minutes)
- [ ] Documentation complete (architecture, user guide, API docs)
- [ ] Staging environment deployment successful
- [ ] UAT testing with real provider admins (5+ users)
- [ ] Zero critical bugs in staging

## Current Status

**Phase**: Not yet started
**Status**: ⏸️ PLANNING
**Last Updated**: 2025-11-20
**Next Step**: Review dev-docs with stakeholders, then begin Phase 1 (Email & Invitation Acceptance)

## Notes

- This feature builds on existing invitation workflow - most infrastructure already exists
- Focus on UX polish (wizard flow, progressive disclosure)
- Security is critical - RLS policies must be bulletproof (HIPAA compliance)
- Subdomain routing deferred to Phase 2 (future sprint) - MVP uses path-based routing
- Wizard state persistence uses localStorage - consider IndexedDB for larger datasets
- Tree view component: Reuse `OrganizationTree.tsx` from active plan (custom WAI-ARIA implementation)
- Permission selector UI with 200+ permissions needs optimization (virtualization, search, filtering)

## Alignment with Active Plan

**Updated 2025-12-08**: This parked plan now aligns with the active `organization-units` plan:

- **Route namespace**: `/organization-units/*` (not `/organization/structure`)
- **OU CRUD backend**: Supabase RPC functions (NOT Temporal)
- **Shared components**: `OrganizationTree.tsx`, `OrganizationTreeNode.tsx`, `OrganizationUnitsViewModel.ts`, `OrganizationUnitFormViewModel.ts`
- **Two-ViewModel architecture**: List ViewModel (long-lived) + Form ViewModel (transient)
- **Reference**: See `dev/active/organization-units-*.md` for detailed specifications
