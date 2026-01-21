# Tasks: Organization Selector

## Phase 1: Backend Support

### 1.1 Switch Organization RPC
- [ ] Create migration for `api.switch_organization()` RPC
  - [ ] Function signature: `api.switch_organization(p_org_id UUID) RETURNS JSONB`
  - [ ] Validate caller has active access via `user_organizations_projection`
  - [ ] Update `users.current_organization_id = p_org_id`
  - [ ] Return `{ success: true, org_id, org_name }` or error
- [ ] Deploy migration to Supabase

### 1.2 JWT Hook Verification
- [ ] Review `custom_access_token_hook` in baseline migration
- [ ] Verify it reads `users.current_organization_id` for org context
- [ ] If needed, update hook to prefer `current_organization_id` over first accessible org
- [ ] Test: Change `current_organization_id` manually, refresh token, verify claims

## Phase 2: Frontend Components

### 2.1 OrgSelector Component
- [ ] Create `frontend/src/components/layout/OrgSelector.tsx`
  - [ ] Props: none (fetches own data)
  - [ ] State: organizations list, current org, loading, error
  - [ ] Fetch orgs on mount via `userQueryService.getUserOrganizations()`
  - [ ] Dropdown UI with Tailwind styling (match header theme)
  - [ ] Current org name as trigger button
  - [ ] List items with org name, role badge
  - [ ] Click handler calls switch function
  - [ ] WCAG 2.1 Level AA: keyboard nav, aria-labels
- [ ] Create `frontend/src/components/layout/index.ts` barrel export (if not exists)

### 2.2 MainLayout Integration
- [ ] Import OrgSelector in `MainLayout.tsx`
- [ ] Add to header, positioned right side before user menu
- [ ] Conditional render: only show if `organizations.length > 1`
- [ ] Pass any needed props (none expected)

## Phase 3: Auth Integration

### 3.1 Switch Organization Handler
- [ ] Add `switchOrganization()` to auth context or create utility
  - [ ] Call `api.switch_organization()` RPC
  - [ ] On success: call `supabase.auth.refreshSession()`
  - [ ] Update local session state with new JWT
  - [ ] Return success/error to caller
- [ ] Handle errors: show toast, don't change context

### 3.2 App State Reset
- [ ] Identify ViewModels that cache org-specific data
- [ ] Add `onOrgSwitch` callback or event listener pattern
- [ ] Clear caches and trigger reload on switch
- [ ] Consider: navigate to `/dashboard` after switch for safety

## Phase 4: Testing & Polish

### 4.1 Manual Testing
- [ ] Test with user in 2+ organizations
- [ ] Verify dropdown shows all accessible orgs
- [ ] Switch org, verify:
  - [ ] JWT `org_id` claim updated
  - [ ] User list shows users from new org
  - [ ] Role list shows roles from new org
  - [ ] OU tree shows OUs from new org
- [ ] Test single-org user: selector hidden
- [ ] Test edge case: org access revoked while viewing

### 4.2 UX Polish
- [ ] Add loading spinner during switch
- [ ] Add success toast: "Switched to {org_name}"
- [ ] Add error toast if switch fails
- [ ] Keyboard navigation: arrow keys, enter, escape
- [ ] Focus management: return focus to trigger after close

## Current Status

**Phase**: Not Started
**Status**: Ready to implement
**Last Updated**: 2026-01-20
**Estimated Effort**: 1-2 days

## Notes

- Backend already supports multi-org users via `user_organizations_projection`
- `users.current_organization_id` column already exists
- `api.list_user_org_access()` RPC already exists for fetching user's orgs
- Main work is frontend component + token refresh integration
- Keep it minimal - robust features (search, recent, theming) are future scope
