# Implementation Plan: Provider Admin Post-Invitation UX

## Executive Summary

This feature implements a complete post-invitation onboarding flow for provider_admin users who accept organization invitations. After clicking an invitation link in email, the provider admin will complete a **blocking setup wizard** (required, cannot skip) that guides them through confirming organization details, accepting data usage agreements, optionally creating organizational units (OUs), and optionally creating custom roles. The wizard uses progressive disclosure and wizard-guided navigation to ensure proper system initialization before granting full application access.

**Key Innovation**: This is the first time provider admins (non-platform owners) will have access to organizational management features. Previously, only super_admins and partner_onboarders could manage organizations. This feature enables provider admins to self-serve their internal organizational hierarchy and role definitions.

## Phase 1: Email & Invitation Acceptance (1-2 days)

### 1.1 Email Template Redesign
- **Remove AI-generated styling**: Eliminate purple gradient header
- **Professional design**: Clean, brand-appropriate email template
- **Update invitation URL**: Change from `/accept-invitation` to `/organizations/invitation`
- **File**: `workflows/src/activities/organization-bootstrap/send-invitation-emails.ts`
- **Time**: 4 hours

### 1.2 Invitation Route Validation
- **Fix route mismatch**: Ensure email URL matches frontend route definition
- **Email URL**: `https://a4c.firstovertheline.com/organizations/invitation?token={token}`
- **Frontend route**: `/organizations/invitation` (already exists)
- **Validate**: Token validation, org details display, auth method selection
- **Time**: 2 hours

### 1.3 Subdomain Routing Decision (Deferred to Phase 2)
- **MVP Decision**: Use path-based routing (current approach)
- **Future enhancement**: Subdomain routing `https://{subdomain}.firstovertheline.com`
- **Reason**: Subdomain routing requires 5-7 days of infrastructure work (wildcard DNS, TLS, nginx config)
- **Impact**: No UX changes needed for Phase 1; subdomain routing is additive

## Phase 2: Blocking Setup Wizard (5-7 days)

### 2.1 Wizard Framework & Navigation
- **Component**: `SetupWizard.tsx` - Multi-step stepper with progress tracking
- **Navigation**: Wizard-guided internal routing (`/onboarding/*` routes)
- **State Management**: `SetupWizardViewModel` (MobX) with localStorage persistence
- **Progress saving**: Auto-save wizard state to localStorage (resume if browser closed)
- **Routes**:
  - `/onboarding/welcome` - Step 1: Confirm org details
  - `/onboarding/agreements` - Step 2: Data usage agreements
  - `/onboarding/structure` - Step 3: Create OUs (optional)
  - `/onboarding/roles` - Step 4: Create custom roles (optional)
- **Time**: 2 days

### 2.2 Step 1: Welcome & Confirm Organization Details
- **Component**: `WelcomeStep.tsx`
- **Content**: Welcome message, org name, contact info, subdomain (all read-only from bootstrap)
- **Action**: Review and confirm details
- **Validation**: None (informational step)
- **Navigation**: Next → Step 2
- **Time**: 4 hours

### 2.3 Step 2: Data Usage Agreements
- **Component**: `AgreementsStep.tsx`
- **Content**: HIPAA compliance, Terms of Service, Privacy Policy
- **UI**: Scrollable agreement text with checkboxes
- **Validation**: All agreements must be checked before proceeding
- **Database**: Store acceptance timestamp and IP address for audit trail
- **Navigation**: Cannot proceed without accepting all agreements
- **Time**: 1 day

### 2.4 Step 3: Create Organizational Units (Optional)
- **Component**: `OUCreationStep.tsx`
- **Feature**: Tree view for creating sub-organization hierarchy
- **Interaction**:
  - Add OU button (opens form modal)
  - Parent selection (dropdown or tree click)
  - OU name, description, type (custom fields)
  - Delete OU (if no children)
- **Validation**: 0+ OUs allowed (fully optional)
- **Backend**: Supabase RPC `create_organization_unit` (NOT Temporal - synchronous DB operation)
- **Database**: Insert into `organizations_projection` with ltree path
- **Navigation**: Skip or Next → Step 4
- **Time**: 2 days
- **Reference**: See `dev/active/organization-units-context.md` Decision #7 for Temporal vs RPC rationale

### 2.5 Step 4: Create Custom Roles (Optional)
- **Component**: `RoleCreationStep.tsx`
- **Feature**: Permission selector for org-specific custom roles
- **UI**:
  - Role name, description input
  - Permission grid (checkboxes organized by applet)
  - Copy from template option (pre-select permissions from existing role)
- **Permissions**: Full list from `permissions_projection` table
- **Validation**: 0+ roles allowed (fully optional)
- **Backend**: Temporal workflow `createCustomRoleActivity`
- **Database**: Insert into `roles_projection` with `organization_id`
- **Navigation**: Skip or Complete → Redirect based on state
- **Time**: 2 days

### 2.6 Wizard Completion & Redirect Logic
- **Logic**: Wizard-guided navigation determines final destination
- **Redirect rules**:
  - If OUs created → `/organization-units` (continue building hierarchy)
  - If roles created → `/organization/users` (invite staff with roles)
  - If both created → `/organization/users` (ready to invite with roles)
  - If neither created → `/dashboard` (clean slate, explore app)
- **Implementation**: `SetupWizardViewModel.getRedirectRoute()`
- **Time**: 4 hours

## Phase 3: Organization Management Routes (3-4 days)

### 3.1 Route Separation: Platform vs Provider
- **Problem**: `/organizations` currently used by super_admin for platform-level org list
- **Solution**: Separate routes
  - `/organizations` (plural) → Platform owners (super_admin, partner_onboarder)
  - `/organization-units/*` → Provider admins (manage their OU hierarchy)
  - `/organization/users` (singular) → Provider admins (user invitations)
  - `/organization/roles` (singular) → Provider admins (custom role management)
- **Navigation**: Update `MainLayout.tsx` to show different nav items based on role
- **Time**: 1 day
- **Note**: Updated 2025-12-08 to align with active organization-units plan

### 3.2 OU Hierarchy Management Page
- **Route**: `/organization-units/*` (list, manage, create, edit)
- **Components**: `OrganizationUnitsListPage.tsx`, `OrganizationUnitsManagePage.tsx`, etc.
- **Features**:
  - Tree view of complete OU hierarchy (read-only visualization)
  - Add OU button (opens create form)
  - Edit OU inline (name, description)
  - Delete OU (validation: no children, no assigned users)
  - Drag-and-drop reordering (future enhancement)
- **ViewModel**: `OrganizationUnitsViewModel` + `OrganizationUnitFormViewModel` (MobX)
- **Backend**: Supabase RPC functions (`create_organization_unit`, `update_organization_unit`, `deactivate_organization_unit`)
- **Time**: 2 days
- **Reference**: See active plan at `dev/active/organization-units-*.md`

### 3.3 User Management & Invitation Page
- **Route**: `/organization/users`
- **Component**: `OrganizationUsersPage.tsx`
- **Features**:
  - User list with role badges
  - Invite user button (opens form)
  - Role assignment dropdown
  - OU scope selector (optional - assign to specific OU)
  - Resend invitation
  - Revoke invitation
- **ViewModel**: `UserInvitationViewModel` (MobX)
- **Backend**: `inviteUserActivity` (Temporal workflow - reuse existing)
- **Time**: 1 day

### 3.4 Custom Role Management Page
- **Route**: `/organization/roles`
- **Component**: `OrganizationRolesPage.tsx`
- **Features**:
  - Role list with permission count
  - Create role button (opens permission selector)
  - Edit role permissions
  - Delete role (validation: no assigned users)
  - Role templates (copy from global roles)
- **ViewModel**: `RoleManagementViewModel` (MobX)
- **Backend**: `createCustomRoleActivity`, `updateRoleActivity`, `deleteRoleActivity`
- **Time**: 1 day

## Phase 4: Backend Implementation (2-3 days)

### 4.1 Supabase RPC Functions for OU CRUD
**Note**: OU operations use Supabase RPC, NOT Temporal (synchronous DB transaction, no external APIs).
See `dev/active/organization-units-context.md` Decision #7 for rationale.

- **Files**: `infrastructure/supabase/sql/03-functions/organizations/`
  - `create_organization_unit.sql` - Create OU with ltree path generation
  - `update_organization_unit.sql` - Update OU fields
  - `deactivate_organization_unit.sql` - Soft delete with validation
  - `get_organization_units.sql` - List OUs within scope
- **Logic**: Same as originally planned, but via RPC not Temporal activity
- **Events**: RPC functions emit domain events directly to `domain_events` table
- **Time**: 1 day
- **Reference**: See `dev/active/organization-units-tasks.md` Phase 5.6

### 4.2 Create Custom Role Activity (Temporal)
- **File**: `workflows/src/activities/rbac/create-custom-role.ts`
- **Params**: `{ orgId, name, description, permissionIds }`
- **Logic**:
  - Insert into `roles_projection` with `organization_id`
  - Insert into `role_permissions_projection` (many-to-many)
  - Emit `RoleCreated` domain event
- **Idempotency**: Check if role with same name + org already exists
- **Time**: 1 day

### 4.3 Update Invitation Workflow
- **File**: `workflows/src/activities/organization-bootstrap/send-invitation-emails.ts`
- **Changes**: Update email template (remove purple, fix URL)
- **Time**: 4 hours

## Phase 5: Database Migrations & RLS Policies (1-2 days)

### 5.1 First-Time Login Tracking
- **Migration**: Add `setup_completed_at` column to `user_roles_projection`
- **Purpose**: Track if user has completed setup wizard
- **Logic**: NULL = wizard required, timestamp = wizard completed
- **Time**: 2 hours

### 5.2 OU Management RLS Policies
- **Table**: `organizations_projection`
- **Policy**: Provider admins can create/update/delete OUs within their org hierarchy
- **Logic**: `(SELECT scope_path FROM user_roles WHERE user_id = auth.uid()) @> NEW.path`
- **Time**: 4 hours

### 5.3 Custom Role RLS Policies
- **Table**: `roles_projection`
- **Policy**: Provider admins can create/update/delete roles scoped to their org
- **Logic**: `organization_id = (SELECT org_id FROM user_roles WHERE user_id = auth.uid())`
- **Time**: 4 hours

### 5.4 Data Usage Agreement Tracking
- **Migration**: Create `user_agreements` table
- **Columns**: `user_id, agreement_type, accepted_at, ip_address, user_agent`
- **Purpose**: HIPAA compliance audit trail
- **Time**: 4 hours

## Success Metrics

### Immediate (Phase 1-2 Complete)
- [ ] Provider admin receives redesigned invitation email (no purple gradient)
- [ ] Email URL matches frontend route (`/organizations/invitation`)
- [ ] Invitation acceptance creates user with `provider_admin` role
- [ ] Blocking setup wizard appears for first-time login
- [ ] Wizard cannot be skipped (blocks access to main app)
- [ ] Wizard state persists if browser closed (localStorage)

### Medium-Term (Phase 3-4 Complete)
- [ ] Provider admin can create 0+ OUs during wizard (optional)
- [ ] Provider admin can create 0+ custom roles during wizard (optional)
- [ ] Wizard completion redirects based on state (dynamic routing)
- [ ] Provider admin can access `/organization-units` (OU management)
- [ ] Provider admin can access `/organization/users` (user invitations)
- [ ] Provider admin can access `/organization/roles` (custom role management)
- [ ] OU creation uses Supabase RPC (event-sourced via domain_events)
- [ ] Custom role creation uses Temporal workflows (event-sourced)

### Long-Term (Production Stability)
- [ ] 95% of provider admins complete wizard without support tickets
- [ ] Average wizard completion time < 5 minutes
- [ ] Zero security incidents from OU/role management features
- [ ] RLS policies enforce org isolation (provider admins cannot access other orgs)
- [ ] Data usage agreement audit trail complete for HIPAA compliance

## Implementation Schedule

**Week 1** (Phase 1-2):
- Days 1-2: Email template redesign, route validation, wizard framework
- Days 3-4: Step 1 (welcome), Step 2 (agreements)
- Day 5: Step 3 (OU creation - UI only)

**Week 2** (Phase 2-3):
- Days 1-2: Step 4 (custom roles - UI only), wizard completion logic
- Days 3-4: Organization management routes (structure, users, roles pages)
- Day 5: Testing & bug fixes

**Week 3** (Phase 4-5):
- Days 1-2: Temporal workflows (OU creation, custom role creation)
- Days 3-4: Database migrations, RLS policies
- Day 5: End-to-end testing, documentation

**Total Estimate**: 15 business days (3 weeks)

## Risk Mitigation

### Risk: Wizard Abandonment
- **Mitigation**: Auto-save progress to localStorage, allow resume
- **Fallback**: Admin support can mark wizard as "completed" manually

### Risk: Subdomain Routing Complexity
- **Mitigation**: Deferred to Phase 2 (future sprint)
- **MVP**: Use path-based routing (proven, stable)

### Risk: RLS Policy Bugs (Data Leakage)
- **Mitigation**: Comprehensive RLS testing in dev environment
- **Testing**: Create multiple test orgs, verify isolation

### Risk: Performance (Large OU Hierarchies)
- **Mitigation**: ltree indexes already exist (efficient hierarchy queries)
- **Monitoring**: Add query performance logging

### Risk: User Confusion (Custom Roles)
- **Mitigation**: Provide role templates (copy permissions from global roles)
- **UX**: Clear permission descriptions, group by applet

## Next Steps After Completion

1. **Subdomain Routing** (Phase 2 - Future Sprint):
   - Infrastructure: Wildcard DNS, TLS certificates
   - Frontend: Subdomain detection, org context provider
   - Estimate: 5-7 days

2. **Bulk OU Import**:
   - CSV upload for large organizations
   - Validate hierarchy before import
   - Estimate: 3 days

3. **Role Templates Library**:
   - Pre-built role templates for common use cases
   - "Residential Nurse", "Clinic Administrator", etc.
   - Estimate: 2 days

4. **Impersonation Feature**:
   - Super admins can impersonate provider admins for support
   - Already partially designed (see `documentation/architecture/authentication/impersonation-*.md`)
   - Estimate: 10 days

5. **Advanced Permissions**:
   - Fine-grained OU-scoped permissions
   - User can only view data within their assigned OU
   - Estimate: 5 days
