# Context: Add org_type to JWT Claims

## Decision Record

**Date**: 2025-12-18
**Feature**: JWT org_type Claims for UI Feature Gating
**Goal**: Enable conditional nav/feature visibility based on organization type without hardcoding organization identifiers.

### Key Decisions

1. **Claims-Based Access Control (CBAC)**: Adding `org_type` to JWT follows the same pattern as existing claims (`org_id`, `user_role`, `permissions`). This is industry standard - Auth0, Okta, Azure AD all support custom claims for this purpose.

2. **Defense in Depth Pattern**: UI controls visibility (UX optimization), backend enforces security. We are NOT replacing backend security with UI logic - we're layering UI decisions on top of backend enforcement.

3. **No AsyncAPI Contract Needed**: JWT claims are authentication/authorization metadata embedded in the token. They are NOT domain events. AsyncAPI contracts are for events like `organization.created`, not session context.

4. **CONSOLIDATED_SCHEMA.sql as Source of Truth**: `DEPLOY_TO_SUPABASE_STUDIO.sql` is legacy (855 lines, Oct 27). `CONSOLIDATED_SCHEMA.sql` is actively maintained (12,371 lines, Dec 18). Only update CONSOLIDATED.

5. **hideForOrgTypes Pattern**: Use exclusion-based filtering (`hideForOrgTypes: ['platform_owner']`) rather than inclusion-based. This makes the common case (show to everyone) the default behavior.

## Technical Context

### Architecture

```
Database (organizations_projection.type)
    ↓
JWT Hook (adds org_type to claims)
    ↓
Frontend (reads claims.org_type for UI decisions)
    ↓
RLS/API (still enforces actual permissions)
```

Platform owners CAN have permission to do anything. The UI simply chooses not to show certain features to them because they're not relevant to the platform owner use case.

### Tech Stack

- **Backend**: PostgreSQL function `custom_access_token_hook` in Supabase
- **Frontend**: React with MobX, TypeScript strict mode
- **Auth**: Supabase Auth with JWT custom claims
- **Types**: Union type `'platform_owner' | 'provider' | 'provider_partner'`

### Dependencies

- `organizations_projection` table (contains `type` column)
- Existing JWT hook infrastructure (already queries user roles, permissions)
- MainLayout nav filtering (already supports role and permission filtering)

## File Structure

### Existing Files Modified - ✅ COMPLETE (2025-12-18)

- `infrastructure/supabase/sql/03-functions/authorization/003-supabase-auth-jwt-hook.sql`
  - ✅ Added `v_org_type text;` variable declaration
  - ✅ Added org_type lookup block with super_admin NULL handling
  - ✅ Added `'org_type', v_org_type` to claims object
  - ✅ Added `'org_type', NULL` to error handler fallback

- `infrastructure/supabase/CONSOLIDATED_SCHEMA.sql`
  - ✅ Same changes as source file (kept in sync)

- `frontend/src/types/auth.types.ts`
  - ✅ Added `OrganizationType` type alias: `'platform_owner' | 'provider' | 'provider_partner'`
  - ✅ Added `org_type: OrganizationType` to JWTClaims interface

- `frontend/src/config/dev-auth.config.ts`
  - ✅ Added `OrganizationType` import
  - ✅ Added `org_type` to DevUserProfile interface
  - ✅ Added `org_type: 'provider'` to DEFAULT_DEV_USER (provider_admin)
  - ✅ Added `org_type: 'platform_owner'` to super_admin profile
  - ✅ Added `org_type: 'platform_owner'` to partner_onboarder profile
  - ✅ Added new `partner_admin` profile with `org_type: 'provider_partner'`
  - ✅ Updated `createMockJWTClaims` to include org_type

- `frontend/src/services/auth/SupabaseAuthProvider.ts`
  - ✅ Added `org_type: decoded.org_type || 'provider'` to JWT decoding

- `frontend/src/components/layouts/MainLayout.tsx`
  - ✅ Added `OrganizationType` import
  - ✅ Created `NavItem` interface with `hideForOrgTypes?: OrganizationType[]`
  - ✅ Added `hideForOrgTypes: ['platform_owner']` to Organization Units nav item
  - ✅ Added org_type filter logic in nav filtering
  - ✅ Added debug logging for org_type filtering

### New Files Created

None - this is a modification to existing infrastructure.

## Related Components

- `AuthContext` - Provides session with claims to components
- `useAuth` hook - Access point for auth state
- `DevAuthProvider` - Mock auth for development
- `SupabaseAuthProvider` - Real auth for production

## Key Patterns and Conventions

### Nav Item Definition Pattern

```typescript
{
  to: '/route',
  icon: IconComponent,
  label: 'Display Name',
  roles: ['role1', 'role2'],           // Required: user must have one of these roles
  permission: 'permission.name',        // Optional: user must have this permission
  hideForOrgTypes: ['platform_owner']   // NEW: hide for these org types
}
```

### Filter Order

1. Check role (must match)
2. Check permission if specified (must be granted)
3. Check hideForOrgTypes if specified (must NOT match)

## Important Constraints

1. **Never hardcode org identifiers** - Use `org_type` enum, not org names/slugs
2. **JWT size** - Keep claims minimal; org_type is just a string enum
3. **Mock/Real parity** - Mock profiles must match real JWT structure
4. **Backward compatibility** - org_type is additive, doesn't break existing claims

## Architectural Review (2025-12-18)

**Reviewer**: software-architect-dbc agent
**Verdict**: APPROVED - Complexity Score 5/25

### Must-Do Recommendations

1. **Add `org_type` to error handler** - JWT hook exception block must include `'org_type', NULL` in fallback claims

2. ~~**Make `org_type` optional in TypeScript**~~ → **SKIPPED** (project in development, no backward compatibility needed):
   ```typescript
   org_type: 'platform_owner' | 'provider' | 'provider_partner';  // Required
   ```

3. **Handle super_admin NULL org_id case** - Super admins have `org_id = NULL` (global scope). Their `org_type` should be `'platform_owner'` for consistency.

### Implementation Optimization

Use LEFT JOIN in main query instead of separate query for efficiency:
```sql
SELECT
  u.current_organization_id,
  o.type AS org_type,
  ...
INTO v_org_id, v_org_type, v_user_role, v_scope_path
FROM public.users u
LEFT JOIN public.organizations_projection o ON o.id = u.current_organization_id
WHERE u.id = v_user_id;
```

### No Concerns About

- **JWT Size**: Adding ~25 bytes is negligible (<5% increase)
- **Query Performance**: Primary key lookup, already indexed
- **Breaking Changes**: This is purely additive

---

## Why This Approach?

### Alternative Considered: Query org type on login

We could fetch org type from DB after login and store in context. Rejected because:
- Extra DB query on every login
- Doesn't follow existing claims-based pattern
- Would require context state management

### Alternative Considered: Permission-based filtering only

We could create org-type-specific permissions. Rejected because:
- Platform owner CAN have all permissions (that's the point)
- Would require permission proliferation
- Doesn't address the UX concern (hiding irrelevant features)

### Chosen Approach: org_type in JWT

- Follows existing pattern (claims-based authorization)
- No runtime queries
- Single source of truth (DB → JWT → UI)
- Extensible for future use cases

---

## Implementation Status - ✅ COMPLETE (2025-12-18)

### Validation Results
- ✅ TypeScript compiles without errors (`npm run typecheck`)
- ✅ Build succeeds (`npm run build`)
- ✅ Pre-existing lint issues only (unrelated to this feature)

### What Was Implemented
1. **Backend SQL**: org_type added to JWT custom claims hook
2. **TypeScript Types**: OrganizationType union type and JWTClaims extension
3. **Mock Auth**: All dev profiles include org_type
4. **Nav Filtering**: hideForOrgTypes pattern implemented for "Org Units"

### Gotchas Discovered
- **SupabaseAuthProvider.ts also needs update**: When adding new JWT claims, remember to update the `decodeJWT` function in `SupabaseAuthProvider.ts` - not just the types and mock profiles
- **Default fallback matters**: Used `'provider'` as default for `org_type` in SupabaseAuthProvider since it's the most common org type

### Manual Testing Required
To verify the feature works:
1. Run `npm run dev` → default profile is `provider_admin` → should see "Org Units"
2. Set `VITE_DEV_PROFILE=super_admin` → should NOT see "Org Units"

### Production Deployment
To apply SQL changes to production:
```bash
# Run the updated JWT hook SQL against production database
psql -h db.${PROJECT_REF}.supabase.co -U postgres -d postgres \
  -f infrastructure/supabase/sql/03-functions/authorization/003-supabase-auth-jwt-hook.sql
```
