# Implementation Plan: Organization Selector

## Executive Summary

Implement a minimal viable organization selector that allows multi-organization users to switch between organizations. This is a focused enhancement building on existing infrastructure - the backend already supports multi-org users, so the primary work is frontend UI and a single RPC function.

## Phase 1: Backend Support

### 1.1 Switch Organization RPC
- Create `api.switch_organization(p_org_id UUID)` RPC function
- Validate user has active access to target organization
- Update `users.current_organization_id`
- Return success/error status

### 1.2 JWT Hook Verification
- Verify `custom_access_token_hook` reads `current_organization_id`
- Ensure claims reflect the preferred org (not just first accessible)
- Test token refresh produces correct claims

## Phase 2: Frontend Components

### 2.1 OrgSelector Component
- Create `frontend/src/components/layout/OrgSelector.tsx`
- Dropdown showing current organization name
- List of user's organizations from `api.list_user_org_access()`
- Visual indicator for current selection
- Loading state while fetching orgs

### 2.2 MainLayout Integration
- Add OrgSelector to header (right side, before user menu)
- Only show if user has multiple organizations
- Hide for single-org users (no selector needed)

## Phase 3: Auth Integration

### 3.1 Token Refresh Flow
- Call `api.switch_organization()` on selection
- Call `supabase.auth.refreshSession()` to get new JWT
- Update auth context with new session/claims

### 3.2 App State Reset
- Trigger data reload for active ViewModels
- Clear any org-specific cached data
- Navigate to safe route if current route is invalid

## Phase 4: Testing & Polish

### 4.1 Manual Testing
- Test switching between 2+ orgs
- Verify RLS queries return correct data
- Verify permissions update correctly
- Test edge cases (deactivated org access, etc.)

### 4.2 UX Polish
- Add transition/loading feedback during switch
- Handle errors gracefully (toast notification)
- Keyboard accessibility for dropdown

## Success Metrics

- [ ] Multi-org user can see all their orgs in dropdown
- [ ] Selecting org updates JWT claims correctly
- [ ] All data queries reflect new org context
- [ ] Single-org users don't see selector
- [ ] No page reload required for switch

## Risk Mitigation

| Risk | Mitigation |
|------|------------|
| Stale data after switch | Clear caches, trigger ViewModel reload |
| Invalid route after switch | Navigate to dashboard on mismatch |
| Token refresh fails | Show error, keep current org context |
| Race conditions | Disable selector during switch operation |

## Future Enhancements (Out of Scope)

- Organization search for users with many orgs
- Recently used organizations
- Org-specific theming/branding
- Keyboard shortcuts for quick switch
