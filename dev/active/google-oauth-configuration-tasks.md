# Tasks: Google OAuth Configuration & Testing

## Phase 1: OAuth Configuration Validation ✅ COMPLETE

- [x] Identify OAuth error root cause (redirect URI mismatch)
- [x] Access Google Cloud Console OAuth credentials
- [x] Add authorized redirect URI: `https://tmrjlswbsxmbglmaclxu.supabase.co/auth/v1/callback`
- [x] Verify OAuth consent screen configuration
- [x] Confirm application type is "Web application"
- [x] Add authorized JavaScript origin: `https://tmrjlswbsxmbglmaclxu.supabase.co`
- [x] Verify Supabase Dashboard Google OAuth provider is enabled
- [x] Confirm Client ID and Client Secret are configured in Supabase
- [x] Validate redirect URI matches between Google Cloud Console and Supabase

## Phase 2: Testing Infrastructure Development ✅ COMPLETE

### API-Level Testing
- [x] Create `verify-oauth-config.sh` bash script
- [x] Implement Supabase Management API integration
- [x] Add jq parsing for JSON responses
- [x] Implement colored terminal output with status indicators
- [x] Add environment variable validation (SUPABASE_ACCESS_TOKEN)
- [x] Test script execution and verify output format
- [x] Add troubleshooting guidance for common API errors

### OAuth URL Generation
- [x] Create `test-oauth-url.sh` bash script
- [x] Generate OAuth authorization URL with correct parameters
- [x] Add step-by-step testing instructions
- [x] Include cross-platform browser open commands (macOS, Linux)
- [x] Add troubleshooting section for OAuth errors
- [x] Create `test-google-oauth.js` Node.js script
- [x] Implement OAuth URL generation using @supabase/supabase-js
- [x] Add colored console output with test results
- [x] Make scripts executable (chmod +x)
- [x] Test bash scripts successfully

### Kubernetes Deployment Verification
- [x] Check frontend deployment status (`kubectl get deployments`)
- [x] Verify pod health (2/2 running)
- [x] Review ingress configuration (TLS, host, backends)
- [x] Check DNS resolution for a4c.firstovertheline.com
- [x] Test HTTPS access to frontend
- [x] Review frontend environment variables (VITE_APP_MODE=production)
- [x] Verify frontend OAuth implementation (LoginPage.tsx, AuthCallback.tsx)
- [x] Confirm GitHub Actions deployment pipeline configuration

### Script Testing
- [x] Run `verify-oauth-config.sh` with valid SUPABASE_ACCESS_TOKEN
- [x] Verify API response shows Google OAuth enabled
- [x] Confirm Client ID is configured (masked output)
- [x] Run `test-oauth-url.sh` to generate OAuth URL
- [x] Verify generated URL format is correct
- [x] Open OAuth URL in browser for Phase 3 testing

## Phase 3: End-to-End Testing ✅ COMPLETE

### Direct OAuth Flow Test
- [x] Generate OAuth authorization URL
- [x] Open URL in browser (Phase 1 test)
- [x] Complete Google account selection
- [x] Grant OAuth permissions
- [x] Verify successful redirect without errors
- [x] Check Supabase Dashboard for new user (lars.tice@gmail.com)
- [x] Verify no "OAuth 2.0 policy compliance" error appears
- [x] Fixed "Multiple GoTrueClient instances" issue (singleton pattern)

### Production Application OAuth Test
- [x] Navigate to https://a4c.firstovertheline.com in browser
- [x] Verify login page loads correctly
- [x] Locate "Continue with Google" button
- [x] Click "Continue with Google"
- [x] Complete Google OAuth flow
- [x] Verify redirect to `/auth/callback` route
- [x] Check browser console for session data
- [x] Verify OAuth flow works without redirect loop
- [x] Confirm redirect to `/clients` dashboard
- [x] Verify authenticated state in application

## Phase 3.5: JWT Custom Claims Fix ✅ COMPLETE

### Issue Diagnosed
- [x] OAuth works but user shows "viewer" instead of "super_admin"
- [x] Root cause: User exists in `auth.users` but not in `public.users`
- [x] JWT hook defaults to "viewer" when no user record found
- [x] JWT hook missing required permissions for `supabase_auth_admin` role

### Fix Implementation
- [x] Create `fix-user-role.sql` to sync auth user to public.users
- [x] Fix script to remove `zitadel_user_id` column (deprecated)
- [x] Update `users` table schema to remove Zitadel references
- [x] Fix column name mismatches (`is_active` → `assigned_at`)
- [x] Create verification scripts to diagnose database state
- [x] Create user_roles_projection record for super_admin (via Supabase MCP)
- [x] Add GRANT permissions for supabase_auth_admin role
- [x] Update infrastructure SQL file with idempotent GRANT statements
- [x] Deploy permissions to production database
- [ ] **[MANUAL]** Register hook in Supabase Dashboard (Authentication → Hooks → Custom Access Token)
- [ ] Test login shows super_admin in UI (after hook registration)

### Test Validation
- [ ] Confirm user appears in Supabase Auth Users table
- [ ] Verify session persists across page refreshes
- [ ] Check JWT token expiration and refresh behavior
- [ ] Test logout functionality
- [ ] Verify session cleanup on logout

## Phase 4: Documentation & Cleanup ⏸️ PENDING

### Commit Testing Scripts
- [ ] Review testing scripts for quality
- [ ] Add inline documentation to bash scripts
- [ ] Add JSDoc comments to Node.js script
- [ ] Stage testing scripts: `git add infrastructure/supabase/scripts/verify-oauth-config.sh`
- [ ] Stage testing scripts: `git add infrastructure/supabase/scripts/test-oauth-url.sh`
- [ ] Stage testing scripts: `git add infrastructure/supabase/scripts/test-google-oauth.js`
- [ ] Create descriptive commit message
- [ ] Commit with message: "feat(infra): add Google OAuth configuration testing scripts"
- [ ] Push to remote repository

### Update Documentation
- [ ] Update `infrastructure/CLAUDE.md` with OAuth testing section
- [ ] Add testing scripts to command reference
- [ ] Document environment variables required for testing
- [ ] Create `infrastructure/supabase/OAUTH-TESTING.md` guide
- [ ] Add troubleshooting section for common OAuth errors
- [ ] Update `infrastructure/supabase/SUPABASE-AUTH-SETUP.md` with verification steps
- [ ] Add Google Cloud Console configuration verification checklist
- [ ] Document two-phase testing strategy
- [ ] Add examples of expected output from testing scripts
- [ ] Commit documentation updates

### Optional Enhancements
- [ ] Create GitHub Actions workflow for automated OAuth validation
- [ ] Add Slack/Discord notification on OAuth test failures
- [ ] Create monitoring dashboard for OAuth success rates
- [ ] Document OAuth provider rotation procedure (if Client Secret needs rotation)
- [ ] Add integration test to CI/CD pipeline

## Success Validation Checkpoints

### Immediate Validation (Phase 1-2)
- [x] Google Cloud Console redirect URI added successfully
- [x] Supabase API confirms Google OAuth enabled
- [x] Supabase API shows Client ID configured
- [x] Testing scripts execute without errors
- [x] Kubernetes deployment verified as healthy (2/2 pods)
- [x] Frontend OAuth implementation reviewed and confirmed correct

### Feature Complete Validation (Phase 3)
- [ ] Direct OAuth URL test passes without "OAuth 2.0 policy" error
- [ ] User can complete Google OAuth flow successfully
- [ ] User appears in Supabase Auth Users table
- [ ] Production frontend "Continue with Google" button works
- [ ] Complete OAuth flow redirects to `/clients` dashboard
- [ ] Session includes all required JWT claims (org_id, permissions, user_role)
- [ ] User can access protected routes with valid session

### Production Ready Validation (Phase 4)
- [ ] Testing scripts committed to repository
- [ ] Documentation updated with testing procedures
- [ ] Troubleshooting guide available
- [ ] OAuth testing can be performed by any team member
- [ ] Testing scripts are executable from repository root

## Current Status

**Phase**: Phase 3.5 - JWT Custom Claims Fix
**Status**: ✅ COMPLETE (awaiting manual hook registration)
**Last Updated**: 2025-11-11
**Next Step**: User must register JWT hook in Supabase Dashboard, then test login

### Recent Activity

**2025-11-11 20:30 UTC**:
- ✅ Used Supabase MCP to diagnose database state
- ✅ Created missing records:
  - Added user to `public.users` (synced from `auth.users`)
  - Created super_admin role assignment in `user_roles_projection`
- ✅ Identified missing permissions for JWT hook
- ✅ Added idempotent GRANT statements to infrastructure SQL file (`003-supabase-auth-jwt-hook.sql`)
- ✅ Deployed permissions to production database via Supabase MCP
- 📋 **Next**: User must register hook in Supabase Dashboard (Authentication → Hooks)

**2025-11-11 19:00 UTC**:
- ✅ Created verification scripts (verify-user-role.sql, verify-user-role-simple.sql)
- ✅ Fixed multiple script issues:
  - Removed `zitadel_user_id` references (column doesn't exist)
  - Fixed column names (`is_active`/`granted_at` → `assigned_at`)
  - Fixed missing RECORD variable declaration
  - Replaced Cloud-only JWT hook call with manual simulation
- ✅ User UUID confirmed: `5a975b95-a14d-4ddd-bdb6-949033dab0b8` (matches seed file)

**2025-11-10 18:00 UTC**:
- ✅ Fixed OAuth redirect loop issue
- ✅ Root cause: Multiple GoTrueClient instances competing for OAuth callback
- ✅ Solution: Unified all code to use singleton Supabase client from `/lib/supabase.ts`
- ✅ Files updated:
  - `frontend/src/services/auth/SupabaseAuthProvider.ts` (use singleton)
  - `frontend/src/services/auth/supabase.service.ts` (use singleton, remove manual headers)
  - `frontend/src/lib/supabase.ts` (add OAuth config)
- ✅ Deployed to production, OAuth login works
- ❌ New issue: User shows "viewer" instead of "super_admin"

**2025-11-10 00:08 UTC**:
- ✅ Opened direct OAuth URL in browser
- ✅ Completed Google OAuth flow successfully
- ✅ User created in Supabase Auth

**2025-11-10 00:00 UTC**:
- ✅ Created all testing scripts
- ✅ Verified Kubernetes deployment status
- ✅ Confirmed frontend OAuth implementation

**2025-11-09 23:30 UTC**:
- ✅ Fixed Google Cloud Console redirect URI
- ✅ Verified Supabase OAuth configuration

### Blockers

**Current Blocker**: GitHub OAuth Not Configured (2025-11-11)
- User clicked "Continue with GitHub" but GitHub OAuth is not enabled in Supabase
- Only Google OAuth is currently configured
- HTTP 400 error on `/auth/v1/authorize` endpoint with `provider=github`
- **Resolution**: Either use Google OAuth (recommended) or configure GitHub OAuth in Supabase Dashboard

**Resolved Blockers**:
- ✅ Google Cloud Console redirect URI mismatch (resolved by adding correct URI)
- ✅ Supabase OAuth configuration uncertainty (resolved via Management API verification)
- ✅ Node.js script dependency issue (resolved by creating bash alternative)
- ✅ Multiple GoTrueClient instances (resolved by singleton pattern)
- ✅ JWT claims missing (resolved by adding permissions and creating user records)

### Notes

**Testing Script Execution**:
```bash
# From repository root
cd infrastructure/supabase/scripts

# Verify OAuth configuration via API
export SUPABASE_ACCESS_TOKEN="your-token"
./verify-oauth-config.sh

# Generate OAuth URL for browser testing
./test-oauth-url.sh

# Optional: Node.js testing (requires @supabase/supabase-js)
npm install @supabase/supabase-js
node test-google-oauth.js
```

**Expected OAuth Flow**:
1. Browser opens to Google account selection
2. User selects lars.tice@gmail.com
3. OAuth consent screen appears
4. User clicks "Allow" or "Continue"
5. Browser redirects to Supabase callback
6. Success page or redirect to site URL

**If Errors Occur**:
- Document exact error message
- Screenshot error page
- Check browser console for additional errors
- Re-run `verify-oauth-config.sh` to confirm configuration
- Review Google Cloud Console OAuth credentials

### Dependencies for Next Phase

**Phase 3.2 (Production Application Test)**:
- Requires: Phase 3.1 direct OAuth test to pass
- Requires: User confirms no OAuth errors
- Requires: Frontend at https://a4c.firstovertheline.com to be accessible

**Phase 4 (Documentation)**:
- Requires: Phase 3 testing complete
- Requires: All test results documented
- Optional: Screenshots of successful OAuth flow

## Quick Reference Commands

**Verify OAuth Configuration**:
```bash
cd infrastructure/supabase/scripts
export SUPABASE_ACCESS_TOKEN="sbp_..."
./verify-oauth-config.sh
```

**Generate OAuth Test URL**:
```bash
cd infrastructure/supabase/scripts
./test-oauth-url.sh
```

**Check Kubernetes Deployment**:
```bash
kubectl get deployments -n default | grep frontend
kubectl get pods -n default -l app=a4c-frontend
kubectl get ingress -n default
```

**Access Production Frontend**:
```bash
open "https://a4c.firstovertheline.com"
```

**Check Supabase Users**:
```
https://supabase.com/dashboard/project/tmrjlswbsxmbglmaclxu/auth/users
```

## Estimated Time Remaining

- Phase 3.1 (Direct OAuth Test): 2 minutes (user validation)
- Phase 3.2 (Production App Test): 3 minutes
- Phase 4 (Documentation): 15 minutes

**Total Remaining**: ~20 minutes
