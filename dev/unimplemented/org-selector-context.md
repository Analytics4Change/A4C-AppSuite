# Context: Organization Selector

## Decision Record

**Date**: 2026-01-20
**Feature**: Organization Selector (Minimal Viable)
**Goal**: Enable multi-organization users to switch between organizations they belong to, with JWT claims updated to reflect the selected organization context.

### Key Decisions

1. **Minimal Viable Implementation**:
   - Simple dropdown in MainLayout header
   - Lists organizations the user has access to
   - Selection triggers preference update + token refresh
   - Full robust implementation documented as aspirational (future)

2. **User Preference Storage**:
   - Use existing `users.current_organization_id` column (already exists)
   - No new table needed - `user_org_preferences` NOT required
   - Preference persisted across sessions

3. **Token Refresh Strategy**:
   - On org switch: call `api.switch_organization()` RPC
   - RPC updates `users.current_organization_id`
   - Frontend calls `supabase.auth.refreshSession()` to get new JWT
   - JWT hook reads `current_organization_id` for claims

4. **JWT Claims Hook Update**:
   - `custom_access_token_hook` already reads org context
   - May need minor update to prefer `current_organization_id` over first accessible org
   - Claims include: `org_id`, `user_role`, `permissions`, `scope_path`

5. **Multi-Org User Scenarios (Sally Scenario)**:
   - Single auth identity can have roles in multiple orgs
   - Each org independently invites/adds users
   - User sees all their orgs in selector dropdown
   - Switching org changes entire app context (data, permissions, roles)

6. **No Page Reload Required**:
   - Token refresh updates JWT claims in memory
   - React context detects new claims and triggers re-render
   - All RLS queries automatically use new `org_id` from JWT

## Technical Context

### Architecture
This feature is a frontend-focused enhancement with minimal backend changes. The backend already supports multi-org users via `user_organizations_projection` (junction table). The main work is:
1. Frontend: OrgSelector component + integration with auth context
2. Backend: Single RPC function to update preference

### Existing Infrastructure
- `users.current_organization_id` - Stores preferred org (already exists)
- `user_organizations_projection` - Junction table with user's org memberships
- `api.list_user_org_access()` - RPC to get user's organizations
- `custom_access_token_hook` - JWT claims generation

### Tech Stack
- **Frontend**: React 19, TypeScript, MobX, Tailwind CSS
- **Backend**: Supabase Edge Functions (if needed), PostgreSQL RPCs
- **Auth**: Supabase Auth with JWT custom claims

## Related Components

- **User Management** - Uses org context for all operations
- **Role Management** - Roles are org-scoped
- **Organization Units** - OU tree is org-specific
- **JWT Custom Claims Hook** - Generates org-scoped permissions

## Reference Materials

- **User Management Context**: `dev/archived/user-management/user-management-context.md` (Decision 12)
- **Frontend Auth Architecture**: `documentation/architecture/authentication/frontend-auth-architecture.md`
- **JWT Claims Setup**: `documentation/infrastructure/guides/supabase/JWT-CLAIMS-SETUP.md`
- **MainLayout**: `frontend/src/components/layouts/MainLayout.tsx`

## Important Constraints

1. **Security**: RPC must validate user has access to target org before switching
2. **Session Continuity**: Token refresh should not log user out
3. **State Reset**: Some ViewModels may need to reload data after org switch
4. **URL Stability**: Current URL should remain valid after switch (if applicable)
