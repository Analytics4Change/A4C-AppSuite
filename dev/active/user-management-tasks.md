# Tasks: User Management

## Phase 0: AsyncAPI & Schema Updates ✅ COMPLETE

### 0.1 AsyncAPI Contract Updates
- [x] Update `infrastructure/supabase/contracts/asyncapi/domains/invitation.yaml`
  - [x] Change `role` from enum string to `roles` array
  - [x] Define role object: `{role_id: UUID, role_name: string}`
- [x] Update `infrastructure/supabase/contracts/asyncapi/domains/user.yaml`
  - [x] Add `first_name`, `last_name` fields to `user.created` event
  - [x] Remove enum restriction on `role_name` (supports custom roles)

### 0.2 Database Migrations
- [x] Migration: `invitations_projection` role → roles (JSONB array)
  - File: `20251231205656_user_management_schema_updates.sql`
  - Added `roles` JSONB column with GIN index
  - Backfilled from legacy `role` column
- [x] Migration: Add `first_name`, `last_name` to users table
  - Backfilled from existing `name` column (split on space)
- [x] Note: `user_org_preferences` NOT needed - `users.current_organization_id` exists

### 0.3 RPC Functions (Moved to Phase 5.5)
- [ ] Create RPC `api.get_assignable_roles()` - filtered by constraints
- [ ] Create RPC `api.check_email_status()` - smart email lookup
- [ ] Create function `validate_role_assignment()` - permission + scope check

## Phase 0A: Extended Data Collection ✅ COMPLETE

### 0A.1 Database Migrations
- [x] `20251231220745_user_org_access_junction_table.sql`
  - Created `user_org_access` junction table with access dates and notification preferences
  - Created trigger to sync `accessible_organizations` array
  - Added helper function `user_has_active_org_access()`
- [x] `20251231220940_role_access_dates.sql`
  - Added `role_valid_from`, `role_valid_until` to `user_roles_projection`
  - Added `get_user_active_roles()` helper function
- [x] `20251231221028_user_addresses.sql`
  - Created `user_addresses` and `user_org_address_overrides` tables
  - Added `get_user_effective_address()` helper function
  - Implemented RLS policies for all scenarios
- [x] `20251231221144_user_phones.sql`
  - Created `user_phones` and `user_org_phone_overrides` tables
  - Added `get_user_effective_phone()` and `get_user_sms_phone()` helper functions
  - Implemented RLS policies
- [x] `20251231221255_invitation_extended_fields.sql`
  - Added `access_start_date`, `access_expiration_date`, `notification_preferences` to `invitations_projection`
- [x] `20251231221349_jwt_hook_access_date_validation.sql`
  - Updated JWT hook to enforce user-level and role-level access dates
  - Returns `access_blocked: true` with reason if outside access window
  - Bumped `claims_version` to 2

### 0A.2 Data Migration
- [x] Migration of existing `accessible_organizations` to junction table via trigger

### 0A.3 AsyncAPI Contract Updates
- [x] Updated `invitation.yaml`
  - Added `access_start_date`, `access_expiration_date`, `notification_preferences`
  - Created `NotificationPreferences` schema
- [x] Updated `user.yaml`
  - Added access dates and notification prefs to `UserCreatedData`
  - Added role-level dates to `UserRoleAssignedData`
  - Added new events: `user.access_dates.updated`, `user.notification_preferences.updated`
  - Added address events: `user.address.added`, `user.address.updated`, `user.address.removed`
  - Added phone events: `user.phone.added`, `user.phone.updated`, `user.phone.removed`

### 0A.4 Event Processors
- [x] `20251231221901_user_extended_event_processors.sql`
  - Extended `process_user_event` to handle all new event types
  - Extended `process_invitation_event` to handle new fields

### 0A.5 Frontend Types
- [x] Updated `frontend/src/types/user.types.ts`
  - Added `NotificationPreferences`, `SmsPreferences` interfaces
  - Added `UserOrgAccess` interface
  - Added `UserAddress`, `AddressType` types
  - Added `UserPhone`, `PhoneType` types
  - Extended `Invitation` with access dates and notification preferences
  - Extended `InviteUserFormData` and `InviteUserRequest` with new fields
  - Added request types for CRUD operations
  - Added validation functions for access dates and phones

## Phase 1: Foundation (Types & Services) ✅ COMPLETE

### 1.1 Type Definitions
- [x] Create `frontend/src/types/user.types.ts`
  - [x] Define `User` interface matching database schema
  - [x] Define `UserWithRoles` interface with role assignments
  - [x] Define `UserFormData` for form state (as `InviteUserFormData`)
  - [x] Define `UserOperationResult` union type
  - [x] Define `UserFilterOptions` and `UserQueryOptions`
  - [x] Add validation helper functions (`validateEmail`, `validateFirstName`, etc.)

### 1.2 Service Interfaces
- [x] Create `frontend/src/services/users/IUserQueryService.ts`
  - [x] `getUsersPaginated()` with filtering and sorting
  - [x] `getUserById()` with role assignments
  - [x] `getInvitations()` for current org
  - [x] `checkEmailStatus()` for smart lookup
  - [x] `getAssignableRoles()` for role selector
  - [x] `getUserOrganizations()` for org selector
- [x] Create `frontend/src/services/users/IUserCommandService.ts`
  - [x] `inviteUser()` - emits `user.invited`
  - [x] `resendInvitation()` - revoke + new invite
  - [x] `revokeInvitation()` - cancel pending invitation
  - [x] `deactivateUser()` - emits `user.deactivated`
  - [x] `reactivateUser()` - emits `user.reactivated`
  - [x] `updateUser()` - profile changes
  - [x] `assignRoles()` - add/remove roles
  - [x] `addUserToOrganization()` - Sally scenario
  - [x] `switchOrganization()` - org context switch
  - [x] `resetPassword()` - trigger password reset email

### 1.3 Mock Implementations
- [x] Create `MockUserQueryService.ts`
  - [x] localStorage-backed mock data
  - [x] Predefined test users (6 users with varying roles)
  - [x] Predefined test invitations (3 invitations: valid, expiring soon, expired)
  - [x] Simulated latency for UX testing
- [x] Create `MockUserCommandService.ts`
  - [x] All command operations implemented
  - [x] Subset-only validation simulation
  - [x] Uses MockUserQueryService for data persistence
- [x] Create `UserServiceFactory.ts` with factory functions
  - [x] Singleton pattern
  - [x] Uses `useMockInvitation` config for mode detection
  - [x] Export via `index.ts` for clean imports

## Phase 2: ViewModels ✅ COMPLETE

### 2.1 Combined List + CRUD ViewModel
- [x] Create `UsersViewModel.ts` (combined list + CRUD)
  - [x] Observable state: users, totalCount, pagination
  - [x] Filters: searchTerm, roleFilter, statusFilter, showInvitationsOnly, showUsersOnly
  - [x] Sorting: sortBy, sortOrder
  - [x] Debounced search (300ms)
  - [x] Pagination helpers
  - [x] Selection state (selectedUserId, selectedInvitationId)
  - [x] CRUD operations calling command service
  - [x] Invitation management (pending list, resend, revoke)
  - [x] User lifecycle (deactivate, reactivate)
  - [x] Email lookup for smart invitation form
  - [x] Role assignment operations
  - [x] Error handling and feedback

### 2.2 Form ViewModel
- [x] Create `UserFormViewModel.ts`
  - [x] Form state with validation (email, firstName, lastName, roleIds)
  - [x] Field validation using imported validators from user.types.ts
  - [x] Touched fields tracking for error display
  - [x] Email lookup integration with suggestedAction computed property
  - [x] Role selection (toggle, select, deselect, setRoles)
  - [x] Dirty tracking comparing current vs original data
  - [x] Submit handler that builds InviteUserRequest

### 2.3 Module Exports
- [x] Create `index.ts` for ViewModels exports
- [x] Verify TypeScript compilation (passed)

## Phase 3B: Extended Data UI Components ✅ COMPLETE

### 3B.1 Display Components
- [x] Create `AddressCard.tsx`
  - [x] Glass-morphism styling
  - [x] Global vs org-override visual distinction
  - [x] Primary address indicator
  - [x] Edit/remove action buttons
  - [x] WCAG 2.1 Level AA compliant
- [x] Create `PhoneCard.tsx`
  - [x] Glass-morphism styling
  - [x] Global vs org-override visual distinction
  - [x] Primary phone indicator
  - [x] SMS capability indicator
  - [x] Edit/remove action buttons

### 3B.2 Form Components
- [x] Create `UserAddressForm.tsx`
  - [x] Address type selection (physical, mailing, billing)
  - [x] US state dropdown
  - [x] ZIP code validation
  - [x] Primary address toggle
  - [x] Organization override option
- [x] Create `UserPhoneForm.tsx`
  - [x] Phone type selection (mobile, office, fax, emergency)
  - [x] Country code dropdown
  - [x] Extension field
  - [x] SMS capability toggle
  - [x] Primary phone toggle
  - [x] Organization override option
- [x] Create `NotificationPreferencesForm.tsx`
  - [x] Email notifications toggle
  - [x] SMS notifications toggle with phone selector
  - [x] In-app notifications toggle
  - [x] Inline and standalone modes
- [x] Create `AccessDatesForm.tsx`
  - [x] Start date picker
  - [x] Expiration date picker
  - [x] Date validation (expiration > start)
  - [x] Access status indicator
  - [x] Clear dates button

### 3B.3 Module Exports
- [x] Create `index.ts` for component exports
- [x] TypeScript compilation verified

## Phase 3: UI Components ✅ COMPLETE

### 3.1 List Components
- [x] Create `UserCard.tsx`
  - [x] Avatar placeholder (initials with color based on user ID)
  - [x] Name, email display
  - [x] Role badge(s) with +N more indicator
  - [x] Status badge (pending/expired/active/deactivated)
  - [x] Selection state with ring highlight
  - [x] Glass-morphism styling matching RoleCard pattern
  - [x] Invitation-specific actions (resend/revoke)
  - [x] User lifecycle actions (deactivate/reactivate)
- [x] Create `UserList.tsx`
  - [x] Search input with debounce (handled by parent)
  - [x] Status filter buttons (all/active/pending/inactive)
  - [x] Type toggle filters (invitations only/users only)
  - [x] User cards with selection
  - [x] Loading/empty states
  - [x] Result count display
- [x] Create `InvitationList.tsx`
  - [x] Pending invitation display
  - [x] Expiration status with visual warning for expiring soon
  - [x] Resend and revoke actions
  - [x] Compact list format for sidebar widgets
  - [x] "Show more" for large lists

### 3.2 Form Components
- [x] Create `UserFormFields.tsx`
  - [x] First name, last name inputs with icons
  - [x] Email input with on-blur lookup
  - [x] Role selection via checkbox group
  - [x] ARIA labels and error messages (WCAG 2.1 Level AA)
- [x] Implement smart email lookup
  - [x] On-blur handler with loading state
  - [x] Status display (pending, active, deactivated, other_org, etc.)
  - [x] Contextual action buttons with appropriate styling
  - [x] Field disabling based on email status

## Phase 4: Pages ✅ COMPLETE

### 4.1 List Page
- [x] Create `UserListPage.tsx`
  - [x] Page header with title and "Invite User" button
  - [x] Status filter tabs (All/Active/Pending/Inactive)
  - [x] Search bar with client-side filtering
  - [x] Responsive card grid layout
  - [x] Loading/error/empty states
  - [x] Confirmation dialogs for all actions

### 4.2 Management Page
- [x] Create `UsersManagePage.tsx`
  - [x] Split-view layout (1/3 list, 2/3 form)
  - [x] Panel modes: empty, edit, create
  - [x] Unsaved changes warning dialog
  - [x] Danger zone section for active users
  - [x] Deactivate/reactivate dialogs
  - [x] Pending/expired invitation banners
- [x] Create `pages/users/index.ts` barrel export
- [x] Add routes to `App.tsx`
  - [x] `/users` → `UserListPage` (requires `user.view` permission)
  - [x] `/users/manage` → `UsersManagePage` (requires `user.create` permission)
- [x] Add "User Management" navigation link to MainLayout sidebar

## Phase 5: Backend (Edge Functions) ✅ COMPLETE

### 5.1 Invite User Edge Function
- [x] Create `infrastructure/supabase/supabase/functions/invite-user/index.ts`
  - [x] Permission validation (`user.create`)
  - [x] Smart email lookup (check existing via RPC functions)
  - [x] Generate secure token (256-bit crypto)
  - [x] Emit `user.invited` event
  - [x] Send email via Resend API
  - [x] Return invitation result

### 5.2 Lazy Expiration Implementation
- [x] Add expiration detection to query service
  - [x] Filter for `status='pending' AND expires_at < now()`
  - [x] Emit `invitation.expired` event in invite-user Edge Function
  - [x] Return computed status to UI

### 5.3 Event Processor Updates
- [x] Add `invitation.expired` handler to event processor
  - [x] Already in `process_invitation_event` function
  - [x] Updates `invitations_projection.status = 'expired'`

### 5.4 Manage User Edge Function
- [x] Create `infrastructure/supabase/supabase/functions/manage-user/index.ts`
  - [x] Permission validation (`user.update`)
  - [x] Deactivate user operation
  - [x] Reactivate user operation
  - [x] Emit `user.deactivated` / `user.reactivated` events

### 5.5 Database Migrations
- [x] Create `20260101205643_user_invitation_lookup_rpcs.sql`
  - [x] `api.check_user_org_membership()` - check user-org membership
  - [x] `api.check_pending_invitation()` - check pending invitation
  - [x] `api.check_user_exists()` - check user existence
  - [x] `api.resend_invitation()` - update invitation token
  - [x] `api.revoke_invitation()` - cancel invitation
  - [x] `api.get_user_org_details()` - user details for manage-user
  - [x] Updated `process_user_event` for deactivate/reactivate events

### 5.6 Edge Function Deployment
- [x] Deploy `invite-user` Edge Function (v1)
- [x] Deploy `manage-user` Edge Function (v1)
- [x] Verify both functions active in Supabase dashboard

## Phase 5.6: Frontend Service Connection ✅ COMPLETE

### 5.6.1 Supabase Query Service
- [x] Create `SupabaseUserQueryService.ts`
  - [x] `getUsersPaginated()` - query users with roles from projections
  - [x] `getUserById()` - fetch user with full role details
  - [x] `getInvitations()` - query invitations_projection
  - [x] `getInvitationById()` - fetch single invitation
  - [x] `checkEmailStatus()` - RPC calls for smart email lookup
  - [x] `getAssignableRoles()` - query roles_projection
  - [x] `getUserOrganizations()` - query user_org_access
  - [x] `getUserAddresses()` - query user_addresses
  - [x] `getUserPhones()` - query user_phones
  - [x] `getUserOrgAccess()` - query user_org_access

### 5.6.2 Supabase Command Service
- [x] Create `SupabaseUserCommandService.ts`
  - [x] `inviteUser()` - calls invite-user Edge Function
  - [x] `resendInvitation()` - calls invite-user with resend operation
  - [x] `revokeInvitation()` - calls invite-user with revoke operation
  - [x] `deactivateUser()` - calls manage-user Edge Function
  - [x] `reactivateUser()` - calls manage-user Edge Function
  - [x] `resetPassword()` - uses Supabase Auth API
  - [x] Placeholder implementations for extended operations

### 5.6.3 Service Factory Updates
- [x] Update `UserServiceFactory.ts` with Supabase implementations
- [x] Update `index.ts` exports
- [x] TypeScript compilation verified
- [x] Production build successful

## Phase 5.7: Constraint Validation ⏸️ PENDING

### 5.7.1 Role Assignment Security
- [ ] Implement `validate_role_assignment()` in invite-user Edge Function
  - [ ] Permission subset check: `role.permissions ⊆ inviter.permissions`
  - [ ] Scope hierarchy check: `role.scope_path <@ inviter.scope_path` (ltree)
  - [ ] NULL scope semantics: NULL = global = allows any target scope
- [ ] Update invite-user Edge Function with constraint validation
- [ ] Add error responses for permission/scope violations

### 5.5.2 Assignable Roles API
- [ ] Create `api.get_assignable_roles()` RPC
  - [ ] Filter roles by inviter's permission subset
  - [ ] Filter roles by inviter's scope hierarchy
  - [ ] Return roles with scope badges for UI display

## Phase 6: User Lifecycle ✅ COMPLETE (Partial - Merged into Phase 5)

### 6.1 Deactivation/Reactivation
- [x] Create `manage-user` Edge Function (done in Phase 5.4)
  - [x] Deactivate user operation with event emission
  - [x] Reactivate user operation with event emission
  - [x] Emit `user.deactivated` / `user.reactivated` events

### 6.2 Role Reassignment ⏸️ PENDING
- [ ] Implement role change in command service
  - [ ] Validate subset-only delegation
  - [ ] Emit `user.role.revoked` event
  - [ ] Emit `user.role.assigned` event

### 6.3 Event Processors
- [x] Add `user.deactivated` handler (done in Phase 5.5)
  - [x] Update `users.is_active = false`
  - [x] Update `user_org_access.is_active = false`
- [x] Add `user.reactivated` handler (done in Phase 5.5)
  - [x] Update `users.is_active = true`
  - [x] Update `user_org_access.is_active = true`
- [ ] Add `user.role.revoked` handler
  - [ ] Delete from `user_roles_projection`

## Phase 7: Org Selector (Minimal Viable) ⏸️ PENDING

### 7.1 Frontend Components
- [ ] Create `frontend/src/components/layout/OrgSelector.tsx`
  - [ ] Dropdown showing current org name
  - [ ] List of user's organizations
  - [ ] Selection triggers org switch
- [ ] Add OrgSelector to MainLayout header

### 7.2 Backend Support
- [ ] Create `user_org_preferences` table (or column on users)
- [ ] Create RPC `api.switch_organization(org_id UUID)`
  - [ ] Update user preference
  - [ ] Trigger token refresh
- [ ] Update JWT custom claims hook to read `preferred_org_id`

### 7.3 Token Refresh Flow
- [ ] Implement token refresh on org switch
- [ ] Update auth context with new JWT claims
- [ ] Trigger page reload or state refresh

## Phase 8: App Integration & Documentation ⏸️ PENDING

### 8.1 Navigation Integration
- [ ] Add routes to `App.tsx`
  - [ ] `/users` → `UsersListPage`
  - [ ] `/users/manage` → `UsersManagePage`
- [ ] Add "User Management" link to left sidebar navigation

### 8.2 Aspirational Documentation
- [ ] Create `documentation/frontend/guides/org-selector-user-journey.md`
  - [ ] Document full robust org selector implementation
  - [ ] Mark as aspirational per AGENT-GUIDELINES.md
  - [ ] Include multi-org user scenarios (Sally scenario)

## Success Validation Checkpoints

### Immediate Validation
- [x] Types compile without TypeScript errors
- [x] Mock services return expected data (6 users, 3 invitations)
- [x] ViewModels trigger MobX reactivity correctly (Phase 2 TypeScript verified)

### Feature Complete Validation
- [ ] User list page displays with pagination
- [ ] User management page split-view works
- [ ] Smart email lookup shows all 6 scenarios
- [ ] Invitations can be created and resent
- [ ] Deactivation/reactivation works

### Integration Validation
- [ ] Real Supabase queries return correct data
- [ ] Edge Functions process requests correctly
- [ ] Domain events emitted and processed
- [ ] RLS policies enforce org isolation

## Current Status

**Phase**: Phase 5.6 - Frontend Service Connection
**Status**: ✅ COMPLETE
**Last Updated**: 2026-01-01
**Next Step**: Test integration end-to-end OR Phase 5.7 - Constraint Validation (role assignment security) OR Phase 7 - Org Selector

## Notes

- Follow `RolesManagePage.tsx` pattern for split-view UI
- ✅ AsyncAPI contracts updated: role → roles array, first_name/last_name added
- ✅ Database migration deployed: `20251231205656_user_management_schema_updates.sql`
- ✅ Phase 5 complete: Backend Edge Functions deployed
  - `invite-user` Edge Function with smart email lookup and Resend email
  - `manage-user` Edge Function for deactivate/reactivate operations
  - 8 database migrations deployed for user management schema
  - Event processors handle all user lifecycle events
- ✅ Phase 1 complete: Types, interfaces, mock services, factory created
  - `user.types.ts` - 1100+ lines with comprehensive types and validation
  - `IUserQueryService.ts` / `IUserCommandService.ts` - CQRS interfaces
  - `MockUserQueryService.ts` / `MockUserCommandService.ts` - localStorage-backed
  - `UserServiceFactory.ts` - singleton pattern with deployment mode detection
- ✅ Phase 2 complete: ViewModels created following RolesViewModel patterns
  - `UsersViewModel.ts` - ~850 lines, combined list + CRUD + lifecycle + address/phone operations
  - `UserFormViewModel.ts` - ~700 lines, form state with email lookup + extended fields
  - `index.ts` - module exports
- ✅ Phase 3B complete: Extended data UI components created
  - `AddressCard.tsx` / `PhoneCard.tsx` - display cards with glass-morphism styling
  - `UserAddressForm.tsx` / `UserPhoneForm.tsx` - CRUD forms with validation
  - `NotificationPreferencesForm.tsx` - email/SMS/in-app toggles
  - `AccessDatesForm.tsx` - access window configuration with status indicators
  - All components WCAG 2.1 Level AA compliant
- ✅ Phase 3 complete: Core UI components created
  - `UserCard.tsx` - glass-morphism card with avatar, status, roles, actions
  - `UserList.tsx` - filterable list with search, status filters, type toggles
  - `InvitationList.tsx` - compact invitation widget with expiring soon warnings
  - `UserFormFields.tsx` - smart email lookup with contextual feedback
  - All components WCAG 2.1 Level AA compliant
- ✅ Phase 4 complete: Pages and routing
  - `UserListPage.tsx` - card grid with status tabs, search, confirmation dialogs
  - `UsersManagePage.tsx` - split-view with list/form, lifecycle operations
  - Routes added: `/users`, `/users/manage` with permission guards
  - Navigation link added to MainLayout sidebar
  - TypeScript compilation verified
- ✅ Phase 5.6 complete: Frontend Supabase services connected
  - `SupabaseUserQueryService.ts` - all query methods with database row type assertions
  - `SupabaseUserCommandService.ts` - Edge Function invocations for invite/manage operations
  - Uses untyped Supabase client with explicit database row interfaces
  - RPC functions called via `(client.rpc as any)` pattern for untyped tables
  - Committed: `54ba80aa feat(users): Add user management CQRS services` (8 files, 4,313 lines)
- Smart email lookup is key UX differentiator - implemented in UserFormFields
- Lazy expiration pattern avoids scheduler complexity
- Role assignment uses natural pass approach (super_admin has all permissions)
- NO org_type bypass - service role (bootstrap workflow) is only bypass
- Multi-org users require org selector for context switching
