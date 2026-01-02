# Context: User Management

## Decision Record

**Date**: 2024-12-31
**Feature**: User Management (CRUD UI + Workflows)
**Goal**: Enable organization delegates to manage users within their organization through a comprehensive UI with invitation, role management, and lifecycle operations.

### Key Decisions

1. **No Temporal Workflow for Single User Invitation**:
   - Single-user invitations handled by Edge Function synchronously
   - Resend email delivery is fast (<500ms), admin can wait
   - Fire-and-forget pattern acceptable for this use case
   - Temporal reserved for complex multi-step operations (organization bootstrap)

2. **Invitation-Based User Creation**:
   - Admin invites by email, user accepts and chooses auth method
   - User can select password, OAuth (Google/GitHub), or Enterprise SSO
   - Reuses existing `accept-invitation` Edge Function pattern
   - No admin-created passwords (security best practice)

3. **Password Reset via Supabase Built-in**:
   - Use `resetPasswordForEmail()` - simpler, secure, already integrated
   - No custom workflow needed
   - Supabase handles email delivery and token validation

4. **Lazy Expiration Pattern**:
   - No scheduler/background job for invitation expiration
   - Expiration detected when delegate views invitation list
   - Emit `invitation.expired` event on first observation
   - Existing AsyncAPI contract already defines this event

5. **Smart Email Lookup with On-Blur Feedback**:
   - Check email status when admin tabs out of field
   - Show contextual UI based on state (new, pending, active, deactivated, etc.)
   - Prevents duplicate invitations and guides admin to correct action

6. **Routes Following Convention** (2024-12-31):
   - `/users` - Combined list of users + pending invitations
   - `/users/manage` - Split-view management page
   - Follows organization-units and roles routing pattern

7. **Unified User Model** (2024-12-31):
   - Users and invitations displayed together (not separate tabs)
   - Computed `DisplayStatus`: pending | expired | active | deactivated
   - Expiration computed client-side from `expires_at`

8. **Multi-Role Invitations** (2024-12-31):
   - Changed from enum string to `{role_id, role_name}[]` array
   - Supports custom org-defined roles (not just canonical enums)
   - AsyncAPI contracts updated: invitation.yaml, user.yaml

9. **User Name Fields** (2024-12-31):
   - Store `first_name`, `last_name` on user record
   - Copied from invitation on acceptance
   - Enables proper salutations and name display

10. **Role Assignment Security Model** (2024-12-31):
    - Two constraints: permission subset + scope hierarchy (ltree)
    - Natural pass approach: super_admin passes due to having all permissions
    - NO org_type bypass - platform_owner is not a security backdoor
    - Service role (bootstrap workflow) is only bypass for system operations
    - NULL scope = global = allows any target scope

11. **Multi-Organization Users - Sally Scenario** (2024-12-31):
    - Single auth identity can have roles in multiple orgs
    - Each org independently invites/adds users
    - Smart email lookup: "User exists in system, not in this org" → "Add to organization?"
    - Requires org selector for context switching

12. **Minimal Viable Org Selector** (2024-12-31):
    - In scope for user management feature
    - Dropdown in header, lists user's orgs
    - Selection triggers preference update + token refresh
    - Robust implementation documented as aspirational

13. **Extended Data Collection - Hybrid Scope Model** (2024-12-31):
    - Addresses and phones use hybrid scope: global defaults + per-org overrides
    - Two tables: `user_addresses` (global) + `user_org_address_overrides` (org-specific)
    - Same pattern for phones: `user_phones` + `user_org_phone_overrides`
    - Access dates stored in `user_org_access` junction table (per-org window)
    - Notification preferences also in `user_org_access` (per-org settings)
    - Invitations include access dates and notification prefs for immediate setup

14. **Access Date Enforcement** (2024-12-31):
    - Both user-level and role-level access dates supported
    - JWT hook validates access window on token generation
    - Returns `access_blocked: true` if outside window
    - Role-level dates allow temporary role grants

15. **Combined UsersViewModel** (2024-12-31):
    - Merged UserListViewModel into UsersViewModel (similar to RolesViewModel pattern)
    - Single ViewModel handles list display, filtering, pagination, CRUD, and lifecycle
    - Avoids unnecessary indirection - list state and CRUD are tightly coupled
    - UserFormViewModel kept separate for invitation form state

16. **ViewModel Follows Existing Patterns** (2024-12-31):
    - UsersViewModel modeled after RolesViewModel (~850 lines with extended ops)
    - UserFormViewModel modeled after RoleFormViewModel (~700 lines with extended fields)
    - Uses MobX `makeAutoObservable`, `runInAction`, computed properties
    - Dependency injection of query/command services via constructor

17. **UI Component Patterns** (2024-12-31):
    - Glass-morphism card styling from `RoleCard.tsx`
    - Form field wrapper pattern from `RoleFormFields.tsx`
    - Uses Checkbox (not Switch - not installed) for toggles
    - All components export from `index.ts` for clean imports

18. **Supabase Service Implementation Pattern** (2026-01-01):
    - Untyped Supabase client requires explicit database row interfaces (`DbUserRow`, `DbInvitationRow`, etc.)
    - Use `as unknown as DbType` pattern for query result typing
    - RPC calls use `(client.rpc as any)('function_name', params)` to bypass undefined parameter types
    - `eslint-disable-next-line @typescript-eslint/no-explicit-any` comments for type assertions
    - Edge Function invocations via `client.functions.invoke(name, { body: {...} })`

## Technical Context

### Architecture
This feature spans frontend (React + MobX) and backend (Supabase Edge Functions). It follows CQRS patterns established in the codebase: Query services for reads, Command services that emit domain events for writes. The UI follows the split-view management pattern from `RolesManagePage.tsx`.

### Tech Stack
- **Frontend**: React 19, TypeScript, MobX, Tailwind CSS
- **Backend**: Supabase Edge Functions (Deno), PostgreSQL
- **Email**: Resend API for transactional emails
- **Auth**: Supabase Auth with JWT custom claims

### Dependencies
- Existing `invitations_projection` table and event processors
- Existing `user.invited`, `invitation.accepted`, `invitation.expired` events
- Existing `accept-invitation` Edge Function
- Supabase Auth admin API for user ban/unban

## File Structure

### Existing Files Modified
- `frontend/src/App.tsx` - Add routes for user management pages
- `frontend/src/components/layouts/Sidebar.tsx` - Add "User Management" navigation link
- `frontend/src/components/layouts/MainLayout.tsx` - Add OrgSelector to header
- `infrastructure/supabase/sql/03-functions/event-processing/` - Add user event processors
- `infrastructure/supabase/supabase/functions/_shared/jwt-hook.ts` - Read `preferred_org_id`

### New Files Created

**Frontend Types** (Phase 1 - Created 2024-12-31)
- `frontend/src/types/user.types.ts` - ~700 lines with comprehensive types:
  - `User`, `UserWithRoles`, `InviteUserFormData`, `UserOperationResult`
  - `UserListItem` (unified user + invitation display)
  - `UserQueryOptions`, `UserFilterOptions`, `SortableUserFields`
  - `EmailLookupResult` with status enum
  - Validation functions: `validateEmail`, `validateFirstName`, `validateLastName`, `validateRoles`

**Frontend Services** (Phase 1 - Created 2024-12-31)
- `frontend/src/services/users/IUserQueryService.ts` - Query interface (CQRS read side)
- `frontend/src/services/users/IUserCommandService.ts` - Command interface (CQRS write side)
- `frontend/src/services/users/MockUserQueryService.ts` - localStorage-backed mock with:
  - 6 predefined test users (various roles and statuses)
  - 3 predefined invitations (valid, expiring soon, expired)
  - Simulated latency for UX testing
- `frontend/src/services/users/MockUserCommandService.ts` - Mock command operations
- `frontend/src/services/users/UserServiceFactory.ts` - Singleton factory with deployment mode detection
- `frontend/src/services/users/index.ts` - Module exports

**Frontend Supabase Services** (Phase 5.6 - Created 2026-01-01)
- `frontend/src/services/users/SupabaseUserQueryService.ts` - Production query implementation (~940 lines)
  - All query methods with database row type assertions
  - RPC calls for smart email lookup via `(client.rpc as any)` pattern
  - Handles untyped Supabase tables with explicit DbRow interfaces
- `frontend/src/services/users/SupabaseUserCommandService.ts` - Production command implementation (~540 lines)
  - Edge Function invocations for invite/manage operations
  - Reset password via Supabase Auth API
  - Placeholder implementations for extended operations

**Frontend ViewModels** (Phase 2 - Created 2024-12-31)
- `frontend/src/viewModels/users/UsersViewModel.ts` - Combined list + CRUD + lifecycle (~650 lines)
  - Observable state: users, invitations, pagination, filters, sorting
  - Selection with detail loading (user or invitation)
  - Debounced search (300ms), filters by status/role
  - Email lookup for smart invitation form
  - Invitation operations: invite, resend, revoke
  - User lifecycle: deactivate, reactivate
  - Role assignment operations
- `frontend/src/viewModels/users/UserFormViewModel.ts` - Invitation form state (~600 lines)
  - Form data: email, firstName, lastName, roleIds
  - Field validation using validators from user.types.ts
  - Touched fields tracking, dirty detection
  - Email lookup integration with `suggestedAction` computed property
  - Role selection: toggle, select, deselect, setRoles
  - Submit handler builds InviteUserRequest
- `frontend/src/viewModels/users/index.ts` - Module exports

**Frontend Components** (Phase 3B - Created 2024-12-31)
- `frontend/src/components/users/AddressCard.tsx` - Address display card with glass-morphism
- `frontend/src/components/users/PhoneCard.tsx` - Phone display card with SMS indicator
- `frontend/src/components/users/UserAddressForm.tsx` - Address add/edit form with validation
- `frontend/src/components/users/UserPhoneForm.tsx` - Phone add/edit form with validation
- `frontend/src/components/users/NotificationPreferencesForm.tsx` - Email/SMS/in-app toggles
- `frontend/src/components/users/AccessDatesForm.tsx` - Access date window configuration
- `frontend/src/components/users/index.ts` - Module exports

**Frontend Components** (Phase 3 - Created 2026-01-01)
- `frontend/src/components/users/UserCard.tsx` - Glass-morphism user/invitation card with avatar, status badges, role badges, actions
- `frontend/src/components/users/UserList.tsx` - Filterable list with search, status filters, type toggles
- `frontend/src/components/users/UserFormFields.tsx` - Form inputs with smart email lookup and contextual feedback
- `frontend/src/components/users/InvitationList.tsx` - Compact invitation widget with expiring soon warnings
- `frontend/src/components/layout/OrgSelector.tsx` - Minimal viable org selector (Phase 7 - Pending)

**Frontend Pages** (Phase 4 - Created 2026-01-01)
- `frontend/src/pages/users/UserListPage.tsx` - Card grid page with status filter tabs, search, confirmation dialogs
- `frontend/src/pages/users/UsersManagePage.tsx` - Split-view management (1/3 list, 2/3 form) with lifecycle operations
- `frontend/src/pages/users/index.ts` - Module exports
- Routes: `/users` (permission: `user.view`), `/users/manage` (permission: `user.create`)
- Navigation: "User Management" link added to MainLayout sidebar with `UsersRound` icon

**Backend Edge Functions** (Phase 5 - Deployed 2026-01-01)
- `infrastructure/supabase/supabase/functions/invite-user/index.ts` - User invitation
  - Permission validation (`user.create`)
  - Smart email lookup via RPC (checks membership, pending invitation, existing user)
  - Secure 256-bit token generation (crypto.getRandomValues)
  - Lazy expiration detection (emits `invitation.expired` events)
  - Resend API email sending with branded template
  - Emits `user.invited` domain event
- `infrastructure/supabase/supabase/functions/manage-user/index.ts` - Deactivate/reactivate
  - Permission validation (`user.update`)
  - Prevents self-deactivation
  - Emits `user.deactivated` / `user.reactivated` events
  - Validates user exists in org and current state

**Backend Database (Migrations - Deployed 2026-01-01)**
- `20251231205656_user_management_schema_updates.sql` - roles JSONB array
- `20251231220745_user_org_access_junction_table.sql` - Access dates, notification prefs
- `20251231220940_role_access_dates.sql` - Role validity periods
- `20251231221028_user_addresses.sql` - User addresses + org overrides
- `20251231221144_user_phones.sql` - User phones + org overrides
- `20251231221255_invitation_extended_fields.sql` - Extended invitation fields
- `20251231221349_jwt_hook_access_date_validation.sql` - JWT claims v2
- `20251231221901_user_extended_event_processors.sql` - Event handlers
- `20260101205643_user_invitation_lookup_rpcs.sql` - Smart email lookup RPCs

**Backend RPC Functions** (Phase 5 - Deployed 2026-01-01)
- `api.check_user_org_membership(email, org_id)` - Check user-org membership
- `api.check_pending_invitation(email, org_id)` - Check pending invitation
- `api.check_user_exists(email)` - Check user existence
- `api.resend_invitation(id, token, expires_at)` - Update invitation token
- `api.revoke_invitation(id, reason)` - Cancel invitation
- `api.get_user_org_details(user_id, org_id)` - User details for manage-user
- `process_user_event` - Updated with `user.deactivated`, `user.reactivated` handlers

**AsyncAPI Contracts**
- `infrastructure/supabase/contracts/asyncapi/domains/invitation.yaml` - roles array update
- `infrastructure/supabase/contracts/asyncapi/domains/user.yaml` - first/last name fields

**Documentation (Aspirational)**
- `documentation/frontend/guides/org-selector-user-journey.md` - Robust org selector spec

## Related Components

- **Roles Management** (`/roles/manage`) - Pattern reference for split-view UI
- **Organization Bootstrap Workflow** - Existing invitation generation pattern
- **Accept Invitation Edge Function** - User account creation flow
- **JWT Custom Claims Hook** - Permission and role injection

## Key Patterns and Conventions

### MobX ViewModel Pattern
```typescript
export class UsersViewModel {
  users: User[] = [];
  selectedUserId: string | null = null;
  isLoading = false;

  constructor(private queryService: IUserQueryService) {
    makeAutoObservable(this);
  }

  async loadUsers(): Promise<void> {
    runInAction(() => { this.isLoading = true; });
    try {
      const result = await this.queryService.getUsers();
      runInAction(() => { this.users = result; });
    } finally {
      runInAction(() => { this.isLoading = false; });
    }
  }
}
```

### Smart Email Lookup Scenarios
| State | Check | UI Response |
|-------|-------|-------------|
| Not found | No matches anywhere | Show full invitation form |
| Pending invitation | `invitations_projection` pending | "Resend invitation?" prompt |
| Expired invitation | `expires_at < now()` | "Send new invitation?" prompt |
| Active member | Has role in this org | "Already member" with view link |
| Deactivated | `is_active = false` | "Reactivate user?" prompt |
| Other org | User exists, no role here | "Add to organization?" prompt |

### Lazy Expiration Event Emission
```typescript
// When fetching invitations, detect and emit expiration events
for (const inv of invitations) {
  if (inv.status === 'pending' && new Date(inv.expires_at) < new Date()) {
    await emitEvent({
      event_type: 'invitation.expired',
      stream_id: inv.id,
      event_data: {
        invitation_id: inv.id,
        org_id: inv.organization_id,
        email: inv.email,
        expired_at: new Date().toISOString(),
        original_expires_at: inv.expires_at
      }
    });
  }
}
```

## Reference Materials

- **Frontend CLAUDE.md**: `frontend/CLAUDE.md` - React patterns, MobX guidelines
- **Workflows CLAUDE.md**: `workflows/CLAUDE.md` - Event emission patterns
- **RolesManagePage**: `frontend/src/pages/roles/RolesManagePage.tsx` - Split-view reference
- **RolesViewModel**: `frontend/src/viewModels/roles/RolesViewModel.ts` - ViewModel pattern reference (~657 lines)
- **RoleFormViewModel**: `frontend/src/viewModels/roles/RoleFormViewModel.ts` - Form ViewModel reference (~791 lines)
- **Invitation AsyncAPI**: `infrastructure/supabase/contracts/asyncapi/domains/invitation.yaml`
- **User AsyncAPI**: `infrastructure/supabase/contracts/asyncapi/domains/user.yaml`

## Important Constraints

1. **Permission Checks**: All operations require appropriate permissions (`user.view`, `user.create`, `user.update`, `user.delete`, `user.role_assign`)
2. **Subset-Only Delegation**: Users can only assign roles with permissions they possess
3. **Audit Trail**: All state changes must emit domain events for compliance
4. **RLS Enforcement**: All database queries filtered by JWT `org_id` claim
5. **WCAG 2.1 AA**: All UI components must be keyboard accessible with proper ARIA
6. **TypeScript null vs undefined** (2024-12-31): InviteUserFormData uses optional fields (`?`) meaning `undefined`, not `null`. When building form state, use `undefined` for optional dates.
7. **NotificationPreferences spreading** (2024-12-31): When updating partial NotificationPreferences, explicitly construct the full object instead of spreading - TypeScript can't guarantee all required properties exist when spreading partial objects.

## Why This Approach?

**Why Edge Function instead of Temporal for single invitations?**
- Temporal adds complexity (workflow definition, activity registration, worker processing)
- Single invitation is a simple 2-step operation (create record + send email)
- Resend is fast (<500ms), admin can wait for immediate feedback
- No saga compensation needed (if email fails, invitation still valid for manual resend)

**Why Lazy Expiration instead of scheduled job?**
- No scheduler infrastructure needed
- Expiration only matters when someone views the list
- Event trail created when delegate actually needs to know
- Database status updated after first observation

**Why On-Blur email lookup instead of on-submit?**
- Immediate feedback prevents wasted form filling
- User sees appropriate action (resend, reactivate, add) right away
- Better UX than error message after form submission
