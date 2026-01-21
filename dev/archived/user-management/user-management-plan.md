# Implementation Plan: User Management

## Executive Summary

Implement User CRUD UI and User Workflows for A4C-AppSuite, enabling organization delegates (provider_admin and their role-based delegates) to manage users within their organization. This feature provides a complete user lifecycle management system including invitation, onboarding, role management, and deactivation.

The implementation prioritizes simplicity over over-engineering: single-user invitations use Edge Functions (not Temporal workflows), invitation expiration uses lazy evaluation (not schedulers), and password reset leverages Supabase's built-in functionality.

## Phase 0: AsyncAPI & Schema Updates

### 0.1 Contract Updates
- Update `invitation.yaml`: role → roles array with `{role_id, role_name}`
- Update `user.yaml`: Add first_name, last_name fields

### 0.2 Database Migrations
- Migration: `invitations_projection` role → roles (JSONB array)
- Migration: Add `first_name`, `last_name` to users projection
- Migration: Add `user_org_preferences` table for org selector

### 0.3 RPC Functions
- Create `api.get_assignable_roles()` - filtered by permission/scope constraints
- Create `api.check_email_status()` - smart email lookup
- Create `validate_role_assignment()` - permission subset + scope hierarchy check

## Phase 1: Foundation (Types & Services)

### 1.1 Type Definitions
- Create `frontend/src/types/user.types.ts` with User, UserFormData, UserOperationResult types
- Define invitation-related types extending existing patterns
- Add validation helper functions

### 1.2 Service Interfaces
- Create `IUserQueryService.ts` for read operations (paginated, filtered)
- Create `IUserCommandService.ts` for write operations (CQRS pattern)
- Define factory functions for dependency injection

### 1.3 Mock Implementations
- Create `MockUserQueryService.ts` with localStorage-backed data
- Create `MockUserCommandService.ts` for development testing
- Include predefined test users matching auth profiles

## Phase 2: ViewModels

### 2.1 List ViewModel
- Create `UserListViewModel.ts` with pagination, filters, search
- Implement debounced search (300ms)
- Add sort by name, email, created date, last login

### 2.2 CRUD ViewModel
- Create `UsersViewModel.ts` for list + operations
- Implement selection state and CRUD methods
- Add invitation management (pending, expired, resend)

### 2.3 Form ViewModel
- Create `UserFormViewModel.ts` for create/edit forms
- Implement validation (email format, required fields)
- Track dirty state and submission

## Phase 3: UI Components

### 3.1 List Components
- Create `UserCard.tsx` with avatar, name, email, role badge, status
- Create `UserList.tsx` with search, filters, selection state
- Create `InvitationList.tsx` for pending invitations with actions

### 3.2 Form Components
- Create `UserFormFields.tsx` with name, email, role dropdown
- Integrate TreeSelectDropdown for organization unit scope
- Implement on-blur email lookup with smart feedback

## Phase 4: Pages

### 4.1 List Page
- Create `UserListPage.tsx` with grid layout
- Add search/filter bar and pagination controls
- Implement navigation to management page

### 4.2 Management Page
- Create `UsersManagePage.tsx` with split-view layout
- Left panel (1/3): User list with selection
- Right panel (2/3): Form for create/edit
- Add danger zone for deactivate/delete
- Implement smart email lookup scenarios

## Phase 5: Backend (Edge Functions)

### 5.1 Invite User Edge Function
- Create `invite-user/index.ts` with permission validation
- Implement smart email lookup (check existing user/invitation)
- Generate invitation token and emit `user.invited` event
- Send email via Resend

### 5.2 Lazy Expiration
- Implement expiration detection in query service
- Emit `invitation.expired` event on first observation
- Update projection status after emission

## Phase 5.5: Constraint Validation

### 5.5.1 Role Assignment Security
- Implement `validate_role_assignment()` in invite-user Edge Function
- Permission subset check: `role.permissions ⊆ inviter.permissions`
- Scope hierarchy check: `role.scope_path <@ inviter.scope_path` (ltree)
- NULL scope = global = allows any target scope

### 5.5.2 Assignable Roles API
- Create `api.get_assignable_roles()` RPC
- Filter by inviter's permission subset and scope hierarchy
- Return roles with scope badges for UI display

## Phase 6: User Lifecycle

### 6.1 Deactivation/Reactivation
- Create Edge Function for user deactivation
- Use Supabase Auth ban mechanism
- Emit `user.deactivated` / `user.reactivated` events

### 6.2 Role Reassignment
- Implement role change with proper event emission
- Enforce subset-only delegation
- Emit `user.role.revoked` then `user.role.assigned`

## Phase 7: Org Selector (Minimal Viable)

### 7.1 Frontend Components
- Create `OrgSelector.tsx` dropdown in MainLayout header
- Show current org, list user's organizations
- Selection triggers org switch and token refresh

### 7.2 Backend Support
- Create `user_org_preferences` table
- Update JWT custom claims hook to read `preferred_org_id`
- Implement token refresh on org switch

## Phase 8: App Integration & Documentation

### 8.1 Navigation Integration
- Add routes to `App.tsx`: `/users`, `/users/manage`
- Add "User Management" link to left sidebar navigation

### 8.2 Aspirational Documentation
- Create `org-selector-user-journey.md` (marked aspirational)
- Document full robust org selector implementation
- Include multi-org user scenarios (Sally scenario)

## Success Metrics

### Immediate
- [ ] Types compile without errors
- [ ] Mock services return expected data
- [ ] ViewModels maintain proper MobX reactivity

### Medium-Term
- [ ] Pages render with all states (loading, error, empty, data)
- [ ] Smart email lookup shows correct scenarios
- [ ] Invitations can be sent and resent

### Long-Term
- [ ] Users can be invited, activated, deactivated
- [ ] Role assignments work with subset-only enforcement
- [ ] Full audit trail via domain events

## Risk Mitigation

| Risk | Mitigation |
|------|------------|
| MobX reactivity issues | Follow established RolesViewModel patterns exactly |
| Email delivery failures | Immediate feedback in UI, retry capability |
| Permission escalation | Subset-only delegation enforced server-side |
| Race conditions on expiration | Idempotent event emission pattern |

## Next Steps After Completion
- Add bulk import capability (CSV upload)
- Implement user activity logging dashboard
- Add email templates customization
- Consider adding user groups/teams feature
