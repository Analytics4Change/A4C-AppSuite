# OAuth Testing Guide

This guide provides comprehensive testing procedures for Google OAuth authentication in the A4C-AppSuite platform.

## Table of Contents

- [Overview](#overview)
- [Testing Strategy](#testing-strategy)
- [Prerequisites](#prerequisites)
- [Testing Scripts](#testing-scripts)
- [Testing Procedure](#testing-procedure)
- [Verification Steps](#verification-steps)
- [Troubleshooting](#troubleshooting)
- [Common Issues](#common-issues)

## Overview

OAuth testing validates that:
1. Google OAuth is properly configured in both Supabase and Google Cloud Console
2. OAuth authorization flow completes successfully
3. Users can authenticate via Google and receive proper JWT tokens
4. JWT custom claims are correctly populated (org_id, user_role, permissions)

## Testing Strategy

We use a **two-phase testing approach** to isolate configuration issues from application integration issues:

### Phase 1: API-Level Configuration Verification
Validate OAuth configuration programmatically without browser testing:
- Verify Google OAuth provider is enabled in Supabase
- Check Client ID is configured
- Confirm redirect URI matches expectations

**Tools**: `verify-oauth-config.sh`

### Phase 2: Browser-Based OAuth Flow Testing
Test the complete OAuth flow in a browser:
- Generate OAuth authorization URL
- Complete Google account selection and consent
- Verify successful redirect and user creation
- Check JWT custom claims

**Tools**: `test-oauth-url.sh`, `test-google-oauth.js`

### Phase 3: Application Integration Testing
Test OAuth through the production frontend:
- Click "Continue with Google" button
- Complete OAuth flow
- Verify redirect to dashboard
- Confirm user role displays correctly

**Manual**: Open `https://a4c.firstovertheline.com`

## Prerequisites

### Required Tools

```bash
# Install jq (for JSON parsing in bash scripts)
# macOS
brew install jq

# Ubuntu/Debian
sudo apt-get install jq

# Fedora
sudo dnf install jq

# Install Node.js (for JavaScript testing script)
# macOS
brew install node

# Ubuntu/Debian
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs
```

### Environment Variables

```bash
# For API verification script
export SUPABASE_ACCESS_TOKEN="sbp_your_token_here"  # From Supabase Dashboard → Account → Access Tokens
export SUPABASE_PROJECT_REF="tmrjlswbsxmbglmaclxu"  # Your project reference

# For JavaScript testing script (optional - defaults provided)
export SUPABASE_URL="https://tmrjlswbsxmbglmaclxu.supabase.co"
export SUPABASE_ANON_KEY="your_anon_key"
```

### Google Cloud Console Configuration

OAuth credentials must be configured in Google Cloud Console:

1. Navigate to: https://console.cloud.google.com/apis/credentials
2. Select your OAuth 2.0 Client ID (or create one)
3. Under "Authorized redirect URIs", add:
   ```
   https://tmrjlswbsxmbglmaclxu.supabase.co/auth/v1/callback
   ```
4. Under "Authorized JavaScript origins" (optional but recommended), add:
   ```
   https://tmrjlswbsxmbglmaclxu.supabase.co
   ```

### Supabase Dashboard Configuration

OAuth provider must be enabled in Supabase Dashboard:

1. Navigate to: https://supabase.com/dashboard/project/tmrjlswbsxmbglmaclxu/auth/providers
2. Enable Google provider
3. Enter Google OAuth Client ID
4. Enter Google OAuth Client Secret
5. Save changes

## Testing Scripts

All testing scripts are located in `infrastructure/supabase/scripts/`:

### 1. verify-oauth-config.sh

**Purpose**: Verify OAuth configuration via Supabase Management API

**Usage**:
```bash
cd infrastructure/supabase/scripts
export SUPABASE_ACCESS_TOKEN="sbp_your_token"
./verify-oauth-config.sh
```

**What it checks**:
- ✓ Google OAuth provider is enabled
- ✓ Client ID is configured
- ✓ Expected redirect URI
- ✓ Additional auth settings

**Output**: Colored terminal output with clear pass/fail indicators

### 2. test-oauth-url.sh

**Purpose**: Generate OAuth URL for manual browser testing

**Usage**:
```bash
cd infrastructure/supabase/scripts
./test-oauth-url.sh
```

**What it does**:
- Generates OAuth authorization URL
- Displays step-by-step testing instructions
- Provides platform-specific commands to open URL
- Lists expected results and troubleshooting tips

**Output**: OAuth URL ready to paste in browser

### 3. test-google-oauth.js

**Purpose**: Test OAuth using Supabase JavaScript SDK (more realistic)

**Prerequisites**:
```bash
npm install @supabase/supabase-js
```

**Usage**:
```bash
cd infrastructure/supabase/scripts
node test-google-oauth.js
```

**What it does**:
- Initializes Supabase client (same as frontend)
- Calls `signInWithOAuth({ provider: 'google' })`
- Verifies auth endpoint is accessible
- Checks if Google provider is enabled
- Displays OAuth URL with testing instructions

**Output**: OAuth URL + endpoint verification results

### 4. verify-jwt-hook-complete.sql

**Purpose**: Comprehensive JWT custom claims hook diagnostics

**Usage** (via Supabase SQL Editor or psql):
```sql
-- Copy and paste into Supabase SQL Editor
-- Or run via psql:
psql -h db.tmrjlswbsxmbglmaclxu.supabase.co -U postgres -f verify-jwt-hook-complete.sql
```

**What it checks**:
- ✓ JWT hook function exists in correct schema (public)
- ✓ Permissions granted to supabase_auth_admin role
- ✓ User records exist in required tables
- ✓ Role assignments are correct
- ✓ Organizations exist
- ✓ Simulates JWT claims generation

**Output**: 10 verification checks with detailed results

## Testing Procedure

### Step 1: Verify Configuration (5 minutes)

```bash
# 1. Set environment variables
export SUPABASE_ACCESS_TOKEN="sbp_your_token"
export SUPABASE_PROJECT_REF="tmrjlswbsxmbglmaclxu"

# 2. Run configuration verification
cd infrastructure/supabase/scripts
./verify-oauth-config.sh

# Expected output:
# ✓ jq is installed
# ✓ curl is installed
# ✓ SUPABASE_ACCESS_TOKEN is set
# ✓ Successfully fetched auth configuration
# ✓ Google OAuth is ENABLED
# ✓ Client ID is configured: 12345...67890
```

**If verification fails**: See [Troubleshooting](#troubleshooting) section

### Step 2: Test OAuth Flow (5 minutes)

#### Option A: Bash Script (Simplest)

```bash
cd infrastructure/supabase/scripts
./test-oauth-url.sh

# Copy the displayed URL and open in browser
open "https://tmrjlswbsxmbglmaclxu.supabase.co/auth/v1/authorize?provider=google"
```

#### Option B: Node.js Script (More Realistic)

```bash
cd infrastructure/supabase/scripts
npm install @supabase/supabase-js  # First time only
node test-google-oauth.js

# Copy the displayed URL and open in browser
```

### Step 3: Complete OAuth in Browser (2 minutes)

1. **Open OAuth URL** in browser (from Step 2)
2. **Select Google account** (e.g., lars.tice@gmail.com)
3. **Grant permissions** on OAuth consent screen
4. **Verify redirect** back to Supabase callback URL
5. **Check for errors** - should see success or redirect to site URL

### Step 4: Verify User Creation (2 minutes)

1. Navigate to Supabase Dashboard:
   ```
   https://supabase.com/dashboard/project/tmrjlswbsxmbglmaclxu/auth/users
   ```
2. Find your email in the users list
3. Click on user to view details
4. Check "Last Sign In" timestamp (should be recent)

### Step 5: Verify JWT Custom Claims (5 minutes)

#### Method 1: Via Supabase Dashboard

1. Go to Authentication → Users → [Your User]
2. Look for custom claims in user metadata or JWT preview

#### Method 2: Via SQL Diagnostic Script

```bash
# Run comprehensive JWT hook verification
# Copy contents of verify-jwt-hook-complete.sql into Supabase SQL Editor
# Or via psql:
psql -h db.tmrjlswbsxmbglmaclxu.supabase.co -U postgres \
  -f infrastructure/supabase/scripts/verify-jwt-hook-complete.sql
```

Check the output for:
- ✓ JWT hook function exists in `public` schema
- ✓ Permissions granted to `supabase_auth_admin`
- ✓ User record exists in `public.users`
- ✓ Role assignments exist in `user_roles_projection`
- ✓ Simulated JWT claims show correct `org_id`, `user_role`, `permissions`

#### Method 3: Via Frontend Application

1. Open production frontend: https://a4c.firstovertheline.com
2. Click "Continue with Google"
3. Complete OAuth flow
4. After redirect to dashboard, open browser DevTools (F12)
5. Go to Console tab
6. Type: `localStorage.getItem('supabase.auth.token')`
7. Copy JWT token
8. Decode at https://jwt.io
9. Check custom claims in payload:
   ```json
   {
     "org_id": "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
     "user_role": "super_admin",
     "permissions": ["read:users", "write:users", ...],
     "scope_path": "a4c",
     "claims_version": 1
   }
   ```

### Step 6: Test Production Application (3 minutes)

1. **Open production frontend**: https://a4c.firstovertheline.com
2. **Click "Continue with Google"** button
3. **Complete OAuth flow** (may auto-complete if already authenticated)
4. **Verify redirect** to `/clients` dashboard
5. **Check user role display** (bottom left corner should show "super_admin")
6. **Test navigation** to verify authenticated state

## Verification Steps

### Configuration Verification Checklist

- [ ] Google OAuth provider enabled in Supabase Dashboard
- [ ] Google OAuth Client ID configured
- [ ] Google OAuth Client Secret configured
- [ ] Redirect URI matches: `https://tmrjlswbsxmbglmaclxu.supabase.co/auth/v1/callback`
- [ ] Redirect URI added to Google Cloud Console OAuth credentials
- [ ] JavaScript origin (optional) added to Google Cloud Console
- [ ] JWT custom claims hook exists in `public` schema
- [ ] JWT hook permissions granted to `supabase_auth_admin`
- [ ] JWT hook registered in Supabase Dashboard (Authentication → Hooks)

### OAuth Flow Verification Checklist

- [ ] OAuth URL generates without errors
- [ ] Browser redirects to Google consent screen
- [ ] Can select Google account
- [ ] Consent screen displays correctly (no policy errors)
- [ ] Browser redirects back to Supabase callback URL
- [ ] No error messages in browser
- [ ] User appears in Supabase Auth Users table
- [ ] Last Sign In timestamp is recent

### JWT Claims Verification Checklist

- [ ] JWT token contains standard fields (aud, exp, iat, sub, email)
- [ ] JWT token contains custom claims (org_id, user_role, permissions, scope_path)
- [ ] `org_id` is not null (or null for super_admin if expected)
- [ ] `user_role` matches expected role (e.g., "super_admin")
- [ ] `permissions` array is populated
- [ ] `scope_path` matches organization hierarchy (e.g., "a4c")
- [ ] No `claims_error` field in JWT token

### Application Integration Verification Checklist

- [ ] "Continue with Google" button visible on login page
- [ ] Button click initiates OAuth flow
- [ ] OAuth completes successfully
- [ ] User redirected to `/clients` dashboard (not login page)
- [ ] User role displays in UI (bottom left corner)
- [ ] User can navigate to protected routes
- [ ] Session persists across page refreshes
- [ ] Logout functionality works correctly

## Troubleshooting

### Issue: "OAuth 2.0 policy compliance" Error

**Symptom**: Google shows error "You can't sign in to this app because it doesn't comply with Google's OAuth 2.0 policy"

**Cause**: Redirect URI not configured in Google Cloud Console

**Solution**:
1. Go to Google Cloud Console → APIs & Services → Credentials
2. Click your OAuth 2.0 Client ID
3. Add redirect URI: `https://tmrjlswbsxmbglmaclxu.supabase.co/auth/v1/callback`
4. Save changes
5. Wait 2-3 minutes for changes to propagate
6. Retry OAuth flow

### Issue: "redirect_uri_mismatch" Error

**Symptom**: Google shows error "Error 400: redirect_uri_mismatch"

**Cause**: Redirect URI doesn't exactly match configured value

**Solution**:
1. Check the redirect URI in error message
2. Ensure EXACT match in Google Cloud Console:
   - No trailing slash: `...callback` not `...callback/`
   - Correct protocol: `https://` not `http://`
   - Correct subdomain: Check project reference
3. Remove any duplicate/incorrect URIs from Google Cloud Console
4. Save and retry

### Issue: "unauthorized_client" Error

**Symptom**: Google shows error "Error 401: unauthorized_client"

**Cause**: Client ID or Client Secret incorrect in Supabase

**Solution**:
1. Go to Google Cloud Console → APIs & Services → Credentials
2. Click your OAuth 2.0 Client ID
3. Copy Client ID and Client Secret
4. Go to Supabase Dashboard → Authentication → Providers
5. Enable Google provider
6. Paste Client ID and Client Secret
7. Save changes
8. Retry OAuth flow

### Issue: User Created but Shows "viewer" Role

**Symptom**: OAuth works, user created, but shows "viewer" instead of expected role

**Possible Causes**:
1. JWT custom claims hook not configured
2. JWT hook missing permissions
3. User record missing in `public.users` table
4. Role assignment missing in `user_roles_projection`
5. Organization record missing

**Solution**:
1. Run JWT hook diagnostic script:
   ```bash
   # Copy verify-jwt-hook-complete.sql into Supabase SQL Editor
   ```
2. Check each verification result:
   - Hook exists in `public` schema (not `auth`)
   - Permissions granted to `supabase_auth_admin`
   - User exists in `public.users`
   - Role assignment exists in `user_roles_projection`
   - Organization exists in `organizations_projection`
3. Check Supabase auth logs for JWT hook errors:
   ```
   Dashboard → Logs → Auth Logs → Search for "hook"
   ```
4. Fix identified issues and test again

### Issue: JWT Hook Not Firing

**Symptom**: JWT tokens don't contain custom claims (org_id, user_role, etc.)

**Possible Causes**:
1. Hook not registered in Supabase Dashboard
2. Hook function doesn't exist
3. Hook function has wrong signature
4. Permissions not granted to `supabase_auth_admin`

**Solution**:
1. Verify hook registration:
   - Go to Supabase Dashboard → Authentication → Hooks
   - Check "Custom Access Token" hook is enabled
   - Verify hook points to `public.custom_access_token_hook`
2. Verify function exists:
   ```sql
   SELECT n.nspname as schema, p.proname as function
   FROM pg_proc p
   JOIN pg_namespace n ON p.pronamespace = n.oid
   WHERE p.proname = 'custom_access_token_hook';
   -- Should return: public | custom_access_token_hook
   ```
3. Verify permissions:
   ```sql
   SELECT has_function_privilege('supabase_auth_admin', 'public.custom_access_token_hook', 'EXECUTE');
   -- Should return: t (true)
   ```
4. Check auth logs for hook errors:
   - Dashboard → Logs → Auth Logs
   - Look for "hook error" or "claims error"

### Issue: Schema Qualification Error

**Symptom**: JWT hook fails with error "column u.current_organization_id does not exist"

**Cause**: JWT hook uses unqualified table references, but `supabase_auth_admin` role doesn't have `public` in search path

**Solution**:
Ensure all table references in JWT hook have `public.` prefix:
```sql
-- Wrong
FROM users u
FROM user_roles_projection ur

-- Correct
FROM public.users u
FROM public.user_roles_projection ur
```

Verify fix is deployed to `infrastructure/supabase/sql/03-functions/authorization/003-supabase-auth-jwt-hook.sql`

### Issue: OAuth Works Locally but Not in Production

**Symptom**: OAuth works in development but fails in production

**Possible Causes**:
1. Environment variables not set correctly in production
2. Different Supabase project used in production
3. Production frontend not deployed with latest code
4. Cloudflare CDN caching old code

**Solution**:
1. Verify production environment variables:
   ```bash
   # Check GitHub Actions secrets
   # SUPABASE_URL, VITE_SUPABASE_ANON_KEY
   ```
2. Verify production deployment:
   ```bash
   kubectl get pods -l app=a4c-frontend
   kubectl logs -l app=a4c-frontend --tail=50
   ```
3. Check frontend image tag:
   ```bash
   kubectl get deployment a4c-frontend -o yaml | grep image:
   ```
4. Clear Cloudflare CDN cache:
   - Cloudflare Dashboard → Caching → Purge Everything
   - Or use Cloudflare API with cache purge permission

## Common Issues

### Frontend Shows "Multiple GoTrueClient Instances" Warning

**Cause**: Multiple Supabase client instances created in application

**Impact**: OAuth callbacks may fail, redirect loops, session storage conflicts

**Solution**: Use singleton pattern - all code must import from `/lib/supabase.ts`

**Files to check**:
- `frontend/src/lib/supabase.ts` - Should export singleton
- `frontend/src/services/auth/SupabaseAuthProvider.ts` - Should use imported singleton
- `frontend/src/services/auth/supabase.service.ts` - Should use imported singleton

### Session Not Persisting Across Page Refreshes

**Cause**: Session storage not configured correctly

**Solution**:
1. Verify Supabase client configuration in `frontend/src/lib/supabase.ts`:
   ```typescript
   const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
     auth: {
       persistSession: true,        // Must be true
       storageKey: 'supabase.auth', // Consistent key
       storage: window.localStorage // Or sessionStorage
     }
   });
   ```
2. Check browser localStorage:
   - Open DevTools → Application → Local Storage
   - Look for key: `supabase.auth.token`
   - Should contain JWT token

### JWT Token Missing Standard Fields

**Symptom**: JWT hook returns error "output claims do not conform to expected schema: aud is required, exp is required, etc."

**Cause**: JWT hook uses wrong return format

**Solution**:
Hook must return: `{ "claims": { ...all claims... } }`

**Correct implementation**:
```sql
-- Merge incoming claims with custom claims
v_claims := COALESCE(event->'claims', '{}'::jsonb) || jsonb_build_object(
  'org_id', v_org_id,
  'user_role', v_user_role,
  'permissions', to_jsonb(v_permissions),
  'scope_path', v_scope_path
);

-- Return in correct format
RETURN jsonb_build_object('claims', v_claims);
```

**Wrong implementation** (don't use):
```sql
-- Wrong - uses jsonb_set
RETURN jsonb_set(event, '{claims}', v_claims);
```

## Reference

### Useful Links

**Google Cloud Console**:
- OAuth Credentials: https://console.cloud.google.com/apis/credentials
- OAuth Consent Screen: https://console.cloud.google.com/apis/credentials/consent

**Supabase Dashboard**:
- Auth Providers: https://supabase.com/dashboard/project/tmrjlswbsxmbglmaclxu/auth/providers
- Auth Users: https://supabase.com/dashboard/project/tmrjlswbsxmbglmaclxu/auth/users
- Auth Hooks: https://supabase.com/dashboard/project/tmrjlswbsxmbglmaclxu/auth/hooks
- Auth Logs: https://supabase.com/dashboard/project/tmrjlswbsxmbglmaclxu/logs/auth-logs

**Documentation**:
- Supabase Auth: https://supabase.com/docs/guides/auth
- Supabase Auth Hooks: https://supabase.com/docs/guides/auth/auth-hooks/custom-access-token-hook
- Google OAuth 2.0: https://developers.google.com/identity/protocols/oauth2
- JWT.io (decoder): https://jwt.io

**Internal Documentation**:
- `infrastructure/CLAUDE.md` - Infrastructure overview
- `infrastructure/supabase/SUPABASE-AUTH-SETUP.md` - Auth setup guide
- `frontend/CLAUDE.md` - Frontend auth architecture
- `.plans/supabase-auth-integration/` - Auth migration planning docs

### Testing Scripts Location

All testing scripts: `infrastructure/supabase/scripts/`
- `verify-oauth-config.sh` - API verification
- `test-oauth-url.sh` - URL generation (bash)
- `test-google-oauth.js` - URL generation (Node.js)
- `verify-jwt-hook-complete.sql` - JWT diagnostics

### Production URLs

- **Frontend**: https://a4c.firstovertheline.com
- **Supabase Project**: https://tmrjlswbsxmbglmaclxu.supabase.co
- **OAuth Callback**: https://tmrjlswbsxmbglmaclxu.supabase.co/auth/v1/callback

### Support

For issues not covered in this guide:
1. Check Supabase auth logs for specific error messages
2. Review `dev/active/google-oauth-configuration-*.md` for historical context
3. Consult internal documentation (see Useful Links above)
4. Check GitHub issues for similar problems

---

**Last Updated**: 2025-11-12
**Author**: A4C Development Team
**Status**: Production-ready documentation
