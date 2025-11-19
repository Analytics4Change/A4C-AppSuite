# Context: Security Advisor Issues

**Date Created**: 2025-11-18
**Status**: ALL PHASES COMPLETE ✅
**Priority**: RESOLVED
**Source**: Supabase Security Advisors (run 2025-11-18)
**Last Updated**: 2025-11-19

## Completed Work

### Phase 1 & 2 - Completed 2025-11-18

**Commit**: `730d5d1a` - fix(security): Enable RLS and add missing policies for 7 tables
**Deployed**: GitHub Actions workflow `19485306633` completed successfully

#### Phase 1: Enable RLS on 3 Tables
Added to `infrastructure/supabase/sql/06-rls/001-core-projection-policies.sql` (lines 331-339):
- `ALTER TABLE public.domain_events ENABLE ROW LEVEL SECURITY`
- `ALTER TABLE public.event_types ENABLE ROW LEVEL SECURITY`
- `ALTER TABLE public.organization_business_profiles_projection ENABLE ROW LEVEL SECURITY`

#### Phase 2: Add RLS Policies to 4 Tables
Added policies to `infrastructure/supabase/sql/06-rls/001-core-projection-policies.sql` (lines 342-453):

**invitations_projection**:
- `invitations_super_admin_all` - Super admins full access
- `invitations_org_admin_select` - Org admins view their org's invitations
- `invitations_user_own_select` - Users view own invitation by email

**audit_log**:
- `audit_log_super_admin_all` - Super admins full access
- `audit_log_org_admin_select` - Org admins view their org's entries (org_id IS NOT NULL)

**api_audit_log**:
- `api_audit_log_super_admin_all` - Super admins full access
- `api_audit_log_org_admin_select` - Org admins view their org's entries (org_id IS NOT NULL)

**cross_tenant_access_grants_projection**:
- `cross_tenant_grants_super_admin_all` - Super admins full access
- `cross_tenant_grants_org_admin_select` - Org admins view grants where their org is consultant_org_id OR provider_org_id

### Phase 3A - Completed 2025-11-19

**Commits**:
- `6707f7f4` - fix(security): Remove Zitadel artifacts, add immutable search_path to 48+ functions
- `17815794` - fix(security): Add search_path to is_subdomain_required function

**Changes**:
- Deleted 8 Zitadel files/directories (complete removal per user directive)
- Added `SET search_path = public, extensions, pg_temp;` to 48+ functions across 16 files
- Removed Zitadel references from RLS policies and triggers
- Updated impersonation event processing to use UUID format directly

**Files Modified**:
- `infrastructure/supabase/sql/03-functions/authorization/` (3 files, 15 functions)
- `infrastructure/supabase/sql/03-functions/event-processing/` (11 files, 38 functions)
- `infrastructure/supabase/sql/03-functions/external-services/` (1 file, 3 functions)
- `infrastructure/supabase/sql/04-triggers/` (3 files)
- `infrastructure/supabase/sql/02-tables/organizations/` (2 files)
- `infrastructure/supabase/sql/06-rls/` (1 file)

### Phase 3B - Completed 2025-11-19

**Commit**: `573f1b2a` - fix(security): Move ltree extension from public to extensions schema

**Changes**:
- Created extensions schema if not exists
- Moved ltree extension from public to extensions schema (idempotent)
- Works because all functions now have `SET search_path = public, extensions, pg_temp;`

**File Modified**: `infrastructure/supabase/sql/00-extensions/003-ltree.sql`

---

## Problem Description

Security advisors scan identified several issues that should be addressed for production readiness. These are pre-existing issues in the codebase, not introduced by recent changes.

## Issues by Severity

### ERROR Level (High Priority)

#### 1. Policy Exists RLS Disabled

Three tables have RLS policies defined but RLS is NOT enabled on the table itself, meaning the policies are not enforced.

| Table | Policies Exist |
|-------|----------------|
| `public.domain_events` | `domain_events_super_admin_all` |
| `public.event_types` | `event_types_authenticated_select`, `event_types_super_admin_all` |
| `public.organization_business_profiles_projection` | `business_profiles_org_admin_select`, `business_profiles_super_admin_all` |

**Fix Required**: Enable RLS on these tables:
```sql
ALTER TABLE public.domain_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.event_types ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organization_business_profiles_projection ENABLE ROW LEVEL SECURITY;
```

**Remediation**: https://supabase.com/docs/guides/database/database-linter?lint=0007_policy_exists_rls_disabled

---

### INFO Level (Advisory)

#### 2. RLS Enabled No Policy

Four tables have RLS enabled but no policies defined, meaning all access is blocked.

| Table | Impact |
|-------|--------|
| `public.invitations_projection` | May block invitation queries |
| `public.audit_log` | May block audit access |
| `public.api_audit_log` | May block API audit access |
| `public.cross_tenant_access_grants_projection` | May block cross-tenant grant queries |

**Action**: Create appropriate RLS policies or disable RLS if not needed.

**Remediation**: https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy

---

### WARN Level (Improvement)

#### 3. Function Search Path Mutable

Many functions (60+) have mutable search_path, which is a potential security issue. This is a codebase-wide pattern.

**Selected Functions Needing Fix**:
- `process_invitation_revoked_event` (newly deployed)
- `user_has_permission`
- `is_super_admin`
- `get_current_user_id`
- `get_current_org_id`
- `has_permission`
- `custom_access_token_hook`
- `process_domain_event`
- All `safe_jsonb_extract_*` functions
- All event processor functions

**Fix Pattern**: Set explicit search_path in function definition:
```sql
CREATE OR REPLACE FUNCTION function_name()
RETURNS ... AS $$
...
$$ LANGUAGE plpgsql
SET search_path = public, pg_temp;  -- Add this line
```

**Remediation**: https://supabase.com/docs/guides/database/database-linter?lint=0011_function_search_path_mutable

#### 4. Extension in Public Schema

The `ltree` extension is installed in the public schema, which is not recommended.

**Fix**: Move extension to a dedicated schema:
```sql
-- Create extension schema if not exists
CREATE SCHEMA IF NOT EXISTS extensions;

-- Move extension (requires recreation)
DROP EXTENSION ltree CASCADE;
CREATE EXTENSION ltree WITH SCHEMA extensions;

-- Update code that uses ltree to reference extensions.ltree
```

**Note**: This is a breaking change - all ltree usage must be updated.

**Remediation**: https://supabase.com/docs/guides/database/database-linter?lint=0014_extension_in_public

#### 5. Leaked Password Protection Disabled

Supabase Auth's leaked password protection (HaveIBeenPwned.org check) is disabled.

**Fix**: Enable in Supabase Dashboard:
1. Go to Authentication > Settings
2. Enable "Block compromised passwords"

**Remediation**: https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection

---

## Recommended Fix Order

### Phase 1: Critical Security (Immediate) ✅ COMPLETE
1. ✅ Enable RLS on 3 tables with existing policies - Deployed 2025-11-18
2. ⚠️ Enable leaked password protection - **Requires paid Supabase plan** (not available on free tier)

### Phase 2: Access Control ✅ COMPLETE
3. ✅ Add RLS policies to `invitations_projection` - Deployed 2025-11-18
4. ✅ Add RLS policies to `audit_log`, `api_audit_log`, `cross_tenant_access_grants_projection` - Deployed 2025-11-18

### Phase 3A: Function Security ✅ COMPLETE
5. ✅ Updated 48+ functions with `SET search_path = public, extensions, pg_temp;` - Deployed 2025-11-19
6. ✅ Removed all Zitadel artifacts from codebase - Deployed 2025-11-19

### Phase 3B: Extension Security ✅ COMPLETE
7. ✅ Moved ltree extension from public to extensions schema - Deployed 2025-11-19

---

## Implementation Notes

### RLS Policies for invitations_projection

This table needs policies for the organization bootstrap workflow. Suggested policies:

```sql
-- Super admins can see all invitations
CREATE POLICY invitations_super_admin_all ON invitations_projection
  FOR ALL TO authenticated
  USING (is_super_admin());

-- Org admins can see their org's invitations
CREATE POLICY invitations_org_admin_select ON invitations_projection
  FOR SELECT TO authenticated
  USING (
    org_id = get_current_org_id()
    AND is_org_admin()
  );

-- Users can see their own invitation
CREATE POLICY invitations_user_own_select ON invitations_projection
  FOR SELECT TO authenticated
  USING (email = current_setting('request.jwt.claims', true)::json->>'email');
```

### Function Search Path Pattern

When fixing search_path, use this pattern consistently:

```sql
CREATE OR REPLACE FUNCTION public.function_name(...)
RETURNS ... AS $$
BEGIN
  -- function body
END;
$$ LANGUAGE plpgsql
SECURITY DEFINER  -- if needed
SET search_path = public, pg_temp;  -- Required fix
```

---

## Reference Materials

- [Supabase Database Linter](https://supabase.com/docs/guides/database/database-linter)
- [Row Level Security](https://supabase.com/docs/guides/auth/row-level-security)
- [Function Security](https://www.postgresql.org/docs/current/sql-createfunction.html)
- [Password Security](https://supabase.com/docs/guides/auth/password-security)

---

## After /clear, run:

```bash
# View security issues context
cat dev/active/security-advisor-issues-context.md

# Re-run security advisors to verify all fixes
# (Use mcp__supabase__get_advisors with type "security")
```

### Current Status: ALL PHASES COMPLETE ✅

**Final Security Advisor Results** (2025-11-19):
- ✅ ERROR level issues (0007 - policy_exists_rls_disabled) - RESOLVED
- ✅ INFO level issues (0008 - rls_enabled_no_policy) - RESOLVED
- ✅ WARN level issues (0011 - function_search_path_mutable) - RESOLVED
- ✅ WARN level issues (0014 - extension_in_public) - RESOLVED
- ⚠️ WARN level issues (auth_leaked_password_protection) - **Requires paid Supabase plan**

**Remaining Advisory**:
The only remaining security advisor warning is `auth_leaked_password_protection`, which requires a paid Supabase plan to enable. This feature checks passwords against HaveIBeenPwned.org to prevent use of compromised passwords. Enable this when upgrading to a paid plan.

### Verification Steps
1. Run `mcp__supabase__get_advisors` with type "security"
2. Should show only 1 remaining warning: `auth_leaked_password_protection`
3. All other security issues have been resolved

**Commits Summary**:
- `730d5d1a` - Phase 1 & 2: Enable RLS and add policies (2025-11-18)
- `6707f7f4` - Phase 3A: Add search_path to 48+ functions (2025-11-19)
- `17815794` - Phase 3A: Fix missed function (2025-11-19)
- `573f1b2a` - Phase 3B: Move ltree to extensions schema (2025-11-19)
