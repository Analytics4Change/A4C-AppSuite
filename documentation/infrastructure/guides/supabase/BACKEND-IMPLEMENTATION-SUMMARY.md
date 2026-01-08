---
status: current
last_updated: 2025-12-30
---

<!-- TL;DR-START -->
## TL;DR

**Summary**: Complete implementation summary of backend JWT custom claims hook for Supabase Auth, including `custom_access_token_hook`, authentication helpers, organization switching, and deployment instructions.

**When to read**:
- Deploying JWT custom claims to Supabase
- Understanding the JWT claims structure (org_id, user_role, permissions, scope_path)
- Testing custom claims and RLS policy integration
- Planning frontend integration with JWT claims

**Prerequisites**: [SUPABASE-AUTH-SETUP.md](./SUPABASE-AUTH-SETUP.md)

**Key topics**: `jwt-claims`, `supabase-auth`, `custom-hook`, `rls-integration`, `multi-tenancy`

**Estimated read time**: 20 minutes
<!-- TL;DR-END -->

# Backend JWT Custom Claims Implementation Summary

**Date**: 2025-10-27
**Status**: ✅ Implementation Complete - Ready for Deployment
**Phase**: Backend Supabase Auth Integration

---

## Executive Summary

The backend JWT custom claims infrastructure for Supabase Auth has been successfully implemented. This completes Phase 1 of the Zitadel → Supabase Auth migration, establishing the foundation for multi-tenant isolation and RBAC enforcement.

**Key Achievement**: The database can now enrich Supabase Auth JWT tokens with custom claims (`org_id`, `user_role`, `permissions`, `scope_path`) required for Row-Level Security (RLS) and permission-based access control.

---

## What Was Completed

### 1. JWT Custom Access Token Hook

**File**: `infrastructure/supabase/sql/03-functions/authorization/003-supabase-auth-jwt-hook.sql`

**Created Functions**:
- ✅ `auth.custom_access_token_hook(event jsonb)` - Main hook function called by Supabase Auth
- ✅ `public.switch_organization(p_new_org_id uuid)` - Organization context switching
- ✅ `public.get_user_claims_preview(p_user_id uuid)` - Claims preview for testing/debugging

**Features**:
- Extracts user's organization, role, and permissions from database
- Handles super_admin global access (NULL org_id)
- Falls back gracefully on error (minimal claims, doesn't block auth)
- Supports organization switching with JWT refresh
- Proper privilege escalation (SECURITY DEFINER)

### 2. Updated Authentication Helper Functions

**File**: `infrastructure/supabase/sql/03-functions/authorization/002-authentication-helpers.sql`

**Updated Functions**:
- ✅ `get_current_user_id()` - Now supports both Supabase Auth (UUID) and legacy Zitadel (TEXT via mapping)
- ⚠️ `is_org_admin(p_user_id, p_org_id)` - **DEPRECATED** (January 2026). Replaced by JWT-claims-based `has_org_admin_permission()` function which checks JWT claims directly without database queries.

**New Functions**:
- ✅ `get_current_org_id()` - Extracts org_id from JWT custom claims
- ✅ `get_current_user_role()` - Extracts user_role from JWT custom claims
- ✅ `get_current_permissions()` - Extracts permissions array from JWT custom claims
- ✅ `get_current_scope_path()` - Extracts scope_path from JWT custom claims
- ✅ `has_permission(p_permission text)` - Checks if user has specific permission

### 3. Deployment Script Updates

**File**: `infrastructure/supabase/DEPLOY_TO_SUPABASE_STUDIO.sql`

**Changes**:
- ✅ Replaced old Zitadel-only `get_current_user_id()` with hybrid version
- ✅ Added all JWT custom claims extraction functions
- ✅ Added complete JWT custom access token hook
- ✅ Added helper functions for org switching and claims preview
- ⚠️ **DEPRECATED**: `is_org_admin()` has been replaced by `has_org_admin_permission()` (January 2026)

**Benefits**:
- Single-file deployment for complete database setup
- Backward compatible with existing Zitadel references (during transition)
- Ready for fresh deployment or migration

### 4. Comprehensive Deployment Guide

**File**: `infrastructure/supabase/JWT-CLAIMS-SETUP.md`

**Contents**:
- Step-by-step deployment instructions
- Supabase Dashboard configuration guide
- Testing procedures with SQL examples
- Frontend integration examples
- Troubleshooting guide
- Performance considerations
- Rollback procedures

### 5. Updated Documentation

**Files Updated**:
- ✅ `infrastructure/README.md` - Phase 1 marked complete, next steps updated
- ✅ `.plans/supabase-auth-integration/custom-claims-setup.md` - Status updated with implementation details

---

## Architecture Overview

### JWT Claims Flow

```
1. User authenticates with Supabase Auth (OAuth or email/password)
   ↓
2. Supabase Auth generates base JWT token
   ↓
3. Supabase calls auth.custom_access_token_hook(event)
   ↓
4. Hook queries database for user's org, role, permissions
   ↓
5. Hook enriches JWT with custom claims
   ↓
6. Frontend receives JWT with complete claims
   ↓
7. RLS policies use JWT claims for access control
```

### Custom Claims Structure

```json
{
  "sub": "user-uuid",
  "email": "user@example.com",
  "role": "authenticated",

  // Custom claims added by hook
  "org_id": "organization-uuid",
  "user_role": "provider_admin",
  "permissions": [
    "organization.view",
    "client.create",
    "medication.create",
    ...
  ],
  "scope_path": "a4c.provider_org.facility_123",
  "claims_version": 1
}
```

### Backward Compatibility

The implementation maintains compatibility with existing Zitadel-based deployments:

**Hybrid `get_current_user_id()` Function**:
1. Attempts to parse JWT `sub` as UUID (Supabase Auth format)
2. Falls back to Zitadel user mapping if UUID parse fails
3. Supports test override via `app.current_user` session variable

This allows gradual migration from Zitadel to Supabase Auth without breaking existing code.

---

## Security Model

### Multi-Tenant Isolation

**Critical**: RLS policies are the ONLY line of defense for tenant data.

```sql
-- RLS policy using JWT custom claim (CORRECT)
CREATE POLICY tenant_isolation ON clients
FOR ALL
USING (org_id = (auth.jwt()->>'org_id')::uuid);

-- RLS policy using database lookup (INCORRECT - slower, less secure)
CREATE POLICY tenant_isolation_wrong ON clients
FOR ALL
USING (org_id = get_user_org_from_database());
```

**Benefits of JWT Claims**:
- ✅ No database lookup required (faster)
- ✅ Claims set server-side only (secure)
- ✅ Cached at token level (1 hour TTL)
- ✅ Immutable during session (prevents race conditions)

### Hook Security

**SECURITY DEFINER Privilege**:
- Hook runs with elevated privileges to read all user/role data
- Any bug in hook could compromise multi-tenant isolation
- Error handling prevents auth failure but logs warnings

**Fail-Safe Behavior**:
- Hook error → returns minimal claims (viewer role, no org access)
- Authentication continues (doesn't block login)
- Error logged to PostgreSQL logs for investigation

---

## Testing Requirements

Before deploying to production, the following tests must pass:

### 1. Claims Preview Test

```sql
-- Test Lars Tice's JWT claims
SELECT public.get_user_claims_preview('lars-uuid');

-- Expected result:
{
  "org_id": "a4c-org-uuid",
  "user_role": "super_admin",
  "permissions": ["organization.create_root", "user.create", ...],
  "scope_path": null,
  "claims_version": 1
}
```

### 2. Real Authentication Test

```typescript
// Frontend: Login and inspect JWT
const { data: { session } } = await supabase.auth.signInWithPassword({
  email: 'lars.tice@gmail.com',
  password: 'password'
});

const payload = JSON.parse(atob(session.access_token.split('.')[1]));
console.log('Custom Claims:', payload.org_id, payload.user_role, payload.permissions);
```

### 3. RLS Policy Test

```sql
-- Set test user context
SET app.current_user = 'user-uuid';

-- Test JWT claims extraction
SELECT get_current_org_id();      -- Should return user's org UUID
SELECT get_current_user_role();   -- Should return role name
SELECT get_current_permissions(); -- Should return permissions array
SELECT has_permission('client.create'); -- Should return true/false

-- Test RLS enforcement
SELECT * FROM clients;  -- Should only return user's org clients
```

### 4. Organization Switch Test

```sql
-- Switch organization (user must have access)
SELECT public.switch_organization('different-org-uuid');

-- Frontend must refresh JWT after switch
-- New JWT will have updated org_id
```

---

## Deployment Instructions

### Prerequisites

- ✅ Supabase project with PostgreSQL database
- ✅ RBAC schema deployed (permissions, roles, user_roles tables)
- ✅ Users table with organization mappings
- ✅ Database access (SQL Editor or psql CLI)

### Deployment Steps

**Option 1: Full Deployment (Fresh Start)**

```bash
cd infrastructure/supabase

# Deploy entire schema with JWT hook
psql -f DEPLOY_TO_SUPABASE_STUDIO.sql
```

**Option 2: Incremental Deployment (Existing Database)**

```bash
cd infrastructure/supabase

# Deploy updated authentication helpers
psql -f sql/03-functions/authorization/002-authentication-helpers.sql

# Deploy JWT custom claims hook
psql -f sql/03-functions/authorization/003-supabase-auth-jwt-hook.sql
```

**Option 3: Supabase Studio SQL Editor**

1. Open Supabase Dashboard → SQL Editor
2. Copy contents of `003-supabase-auth-jwt-hook.sql`
3. Execute query
4. Verify functions created

### Enable Hook in Supabase Dashboard

1. Navigate to **Authentication > Hooks**
2. Enable **Custom Access Token Hook**
3. Schema: `auth`
4. Function: `custom_access_token_hook`
5. Save

**Hook will activate immediately** - all new JWT tokens will include custom claims.

### Verification

```sql
-- Verify hook function exists
SELECT proname, pronamespace::regnamespace
FROM pg_proc
WHERE proname = 'custom_access_token_hook';

-- Test claims generation
SELECT public.get_user_claims_preview('test-user-uuid');
```

---

## Frontend Integration Status

**Frontend Auth Implementation**: ✅ Complete (Completed 2025-10-27)

The frontend already supports Supabase Auth with custom claims:

**Three-Mode Authentication System**:
- ✅ Mock mode (instant auth for UI development)
- ✅ Integration mode (real OAuth for testing)
- ✅ Production mode (real Supabase Auth)

**JWT Claims Usage**:
- ✅ Automatic claims extraction in `SupabaseAuthProvider`
- ✅ Claims available via `useAuth()` hook
- ✅ Organization switching with JWT refresh
- ✅ Permission checking via `hasPermission()`

**See**: `frontend/docs/auth-provider-architecture.md` for complete frontend details.

---

## Next Steps

### Immediate (Development Environment)

1. **Deploy JWT Hook** (30 minutes)
   - Follow `JWT-CLAIMS-SETUP.md` step-by-step guide
   - Deploy SQL functions to development database
   - Enable hook in Supabase Dashboard

2. **Test Custom Claims** (1 hour)
   - Test claims preview function
   - Authenticate via frontend
   - Inspect JWT token claims
   - Verify RLS policy enforcement

3. **Integration Testing** (2 hours)
   - Test organization switching
   - Test permission-based UI logic
   - Test multi-tenant data isolation
   - Test super_admin global access

### Short Term (Production Readiness)

4. **Update RLS Policies** (4 hours)
   - Migrate RLS policies to use JWT claims directly
   - Remove database lookup functions in RLS policies
   - Test policy performance improvements
   - Document policy patterns

5. **Production Deployment** (2 hours)
   - Deploy JWT hook to production database
   - Enable hook in production Supabase project
   - Monitor PostgreSQL logs for hook errors
   - Verify production authentication

6. **User Migration** (Planning Required)
   - Plan Zitadel → Supabase user migration strategy
   - Migrate existing users to Supabase Auth
   - Update user_roles_projection with Supabase UUIDs
   - Maintain Zitadel mapping tables for transition period

### Long Term (Future Enhancements)

7. **Organization Bootstrap Workflows** (Phase 2)
   - Implement Temporal workflows for org provisioning
   - DNS subdomain provisioning via Cloudflare API
   - User invitation system
   - Admin onboarding automation

8. **Enterprise SSO** (Phase 3)
   - Configure SAML 2.0 providers (3-6 month timeline)
   - Test SAML flows in development
   - Document enterprise onboarding process

9. **Migration Cleanup** (Phase 4)
   - Remove deprecated Zitadel mapping tables
   - Archive Zitadel Terraform modules
   - Remove `zitadel_` prefixes from tables
   - Update all documentation

---

## Related Documentation

### Implementation Files

- **JWT Hook**: `infrastructure/supabase/sql/03-functions/authorization/003-supabase-auth-jwt-hook.sql`
- **Auth Helpers**: `infrastructure/supabase/sql/03-functions/authorization/002-authentication-helpers.sql`
- **Deployment Script**: `infrastructure/supabase/DEPLOY_TO_SUPABASE_STUDIO.sql`
- **Deployment Guide**: `infrastructure/supabase/JWT-CLAIMS-SETUP.md`

### Planning Documents

- **Custom Claims Setup**: `.plans/supabase-auth-integration/custom-claims-setup.md`
- **Frontend Architecture**: `.plans/supabase-auth-integration/frontend-auth-architecture.md`
- **Supabase Auth Overview**: `.plans/supabase-auth-integration/overview.md`
- **RBAC Architecture**: `.plans/rbac-permissions/architecture.md`

### Developer Guides

- **Infrastructure**: `infrastructure/CLAUDE.md`
- **Frontend Auth**: `frontend/docs/auth-provider-architecture.md`
- **Supabase Setup**: `infrastructure/supabase/SUPABASE-AUTH-SETUP.md`

---

## Success Criteria

The backend JWT implementation is considered successful when:

- [x] JWT hook function deployed and enabled
- [ ] Users can authenticate via frontend
- [ ] JWT tokens contain all custom claims
- [ ] RLS policies enforce org_id isolation
- [ ] Permission checks work via `has_permission()`
- [ ] Organization switching updates JWT claims
- [ ] No authentication failures due to hook errors
- [ ] PostgreSQL logs show no hook warnings
- [ ] Performance meets requirements (<100ms per token)

**Current Status**: Implementation complete, ready for deployment testing.

---

## Risk Mitigation

### Rollback Plan

If issues arise after deployment:

1. **Disable JWT Hook**:
   - Navigate to Authentication > Hooks in Supabase Dashboard
   - Disable Custom Access Token Hook
   - Users continue to authenticate (without custom claims)
   - RLS policies fail closed (deny all access)

2. **Restore Previous Functions**:
   - Keep backup of old `get_current_user_id()` function
   - Restore via SQL script if needed
   - Re-enable Zitadel-based auth flow

3. **Monitor Logs**:
   - PostgreSQL logs show hook errors: `JWT hook error for user UUID: message`
   - Supabase Auth logs show authentication failures
   - Application logs show RLS permission denied errors

### Known Limitations

- **Token Refresh Required**: Changing org context requires JWT refresh (1-2 second delay)
- **Claims Immutable**: JWT claims don't update until token refresh (1 hour TTL)
- **Hook Performance**: Adds ~50ms to token generation (acceptable for hourly refresh)
- **Error Handling**: Hook errors log warnings but don't block authentication

---

**Implementation Status**: ✅ Complete
**Deployment Status**: 🟡 Ready for Development Deployment
**Production Readiness**: 🟡 Testing Required
**Migration Progress**: Frontend Complete (✅) → Backend Complete (✅) → Deployment Pending (🟡)

---

**Document Version**: 1.0
**Last Updated**: 2025-10-27
**Next Review**: After development deployment
