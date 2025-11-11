# Context: Google OAuth Configuration & Testing

## Decision Record

**Date**: 2025-11-10
**Feature**: Google OAuth Authentication Configuration
**Goal**: Enable Google SSO authentication for lars.tice@gmail.com through production Kubernetes-deployed frontend at https://a4c.firstovertheline.com

### Key Decisions

1. **Testing Approach**: Two-phase testing strategy
   - **Phase 1**: Direct OAuth URL test to isolate OAuth configuration issues
   - **Phase 2**: Full application flow test through production frontend
   - **Rationale**: Separates OAuth configuration problems from application integration issues, making debugging faster and more targeted

2. **Script-Based Testing Infrastructure**: Created bash and Node.js testing scripts
   - **Choice**: Bash scripts for simplicity and portability, Node.js for advanced testing when @supabase/supabase-js is available
   - **Rationale**: Bash scripts work everywhere without dependencies, provide immediate feedback, and can be version-controlled for repeatable testing

3. **API-First Validation**: Use Supabase Management API to verify configuration before browser testing
   - **Choice**: `verify-oauth-config.sh` checks configuration via API before attempting browser OAuth flow
   - **Rationale**: API validation catches configuration errors faster than manual browser testing, provides programmatic verification for CI/CD

4. **Production Environment Strategy**: Deploy frontend with baked-in environment variables via Docker build
   - **Choice**: GitHub Actions builds Docker image with .env.production containing Supabase credentials
   - **Rationale**: Avoids ConfigMaps/Secrets complexity, ensures environment variables are immutable per deployment, simplifies rollback

5. **OAuth Redirect URI Pattern**: Use Supabase's standard OAuth callback endpoint
   - **Choice**: `https://tmrjlswbsxmbglmaclxu.supabase.co/auth/v1/callback` as OAuth redirect URI
   - **Rationale**: Supabase handles OAuth complexity (token exchange, session creation), then redirects to frontend's `/auth/callback` route

6. **Singleton Supabase Client Pattern**: Use single Supabase client instance across entire application - Added 2025-11-10
   - **Choice**: All authentication code uses singleton from `/lib/supabase.ts`
   - **Rationale**: Multiple GoTrueClient instances cause OAuth callback race conditions and redirect loops
   - **Implementation**: Removed separate client instantiation in `SupabaseAuthProvider` and `supabase.service`

7. **Manual Header Injection Removed**: Let Supabase handle JWT automatically - Added 2025-11-10
   - **Choice**: Removed manual `Authorization` header injection from `supabase.service.ts`
   - **Rationale**: Manual header mutation on shared singleton causes concurrency issues; Supabase automatically includes JWT from browser storage

## Technical Context

### Architecture

The authentication flow involves four main components:

```
[Frontend] ──────────────────> [Google OAuth]
    ↑                                |
    |                                ↓
    └───── [Supabase Auth] <──── [OAuth Callback]
```

**Flow Breakdown**:
1. **Frontend** (`https://a4c.firstovertheline.com`): React app with LoginPage.tsx
2. **Google OAuth** (`accounts.google.com`): Google's OAuth 2.0 authorization server
3. **Supabase Auth** (`tmrjlswbsxmbglmaclxu.supabase.co/auth/v1`): Manages OAuth provider integration
4. **Frontend Callback** (`/auth/callback`): AuthCallback.tsx processes Supabase response and establishes session

### Tech Stack

**Frontend**:
- React 19 with TypeScript
- Vite build tool
- Deployed as Nginx-served static files in Docker container
- Running on Kubernetes (k3s) with 2 replicas

**Authentication**:
- Supabase Auth (OAuth provider management)
- @supabase/supabase-js v2 (frontend SDK)
- JWT with custom claims (org_id, permissions, user_role, scope_path)

**Infrastructure**:
- Kubernetes (k3s) cluster
- Traefik ingress with Let's Encrypt TLS
- Cloudflare CDN in front
- GitHub Actions CI/CD pipeline

**Testing Scripts**:
- Bash 5.x (for verify-oauth-config.sh, test-oauth-url.sh)
- Node.js 20 (for test-google-oauth.js)
- curl (for API calls)
- jq (for JSON parsing)

### Dependencies

**External Services**:
- Google Cloud Console (OAuth 2.0 credentials configuration)
- Supabase Cloud (project: tmrjlswbsxmbglmaclxu)
- GitHub Actions (CI/CD secrets for SUPABASE_URL, VITE_SUPABASE_ANON_KEY)
- Cloudflare (DNS and CDN)

**Internal Dependencies**:
- Frontend authentication system (AuthContext, IAuthProvider interface)
- Supabase database hook for JWT custom claims
- Kubernetes deployment configuration
- GitHub Container Registry (ghcr.io) for Docker images

### Problem Context

**Original Issue**: Google OAuth failing with error:
```
"You can't sign in to this app because it doesn't comply with Google's OAuth 2.0 policy"
Request details: redirect_uri=https://tmrjlswbsxmbglmaclxu.supabase.co/auth/v1/callback
```

**Root Cause**: Redirect URI not properly configured in Google Cloud Console OAuth credentials.

**Resolution**: Added exact redirect URI to Google Cloud Console → APIs & Services → Credentials → OAuth 2.0 Client ID → Authorized redirect URIs.

## File Structure

### New Files Created

**Testing Scripts** (`infrastructure/supabase/scripts/`):
- `verify-oauth-config.sh` - Validates OAuth configuration via Supabase Management API
  - Checks if Google OAuth is enabled
  - Verifies Client ID is configured
  - Validates expected redirect URI
  - Provides colored terminal output with troubleshooting steps

- `test-oauth-url.sh` - Generates OAuth authorization URL for manual browser testing
  - Creates OAuth URL with correct parameters
  - Provides step-by-step testing instructions
  - Includes troubleshooting guide for common errors
  - Cross-platform (macOS, Linux)

- `test-google-oauth.js` - Node.js-based OAuth testing (requires @supabase/supabase-js)
  - Uses Supabase JavaScript SDK to generate OAuth URL
  - Tests OAuth flow programmatically
  - Provides detailed error messages
  - Note: Requires npm install @supabase/supabase-js to run

- `fix-user-role.sql` - Syncs OAuth user from auth.users to public.users - Added 2025-11-11
  - Queries auth.users for actual UUID
  - Creates public.users record if missing
  - Emits domain events (user.synced_from_auth, user.role.assigned)
  - Creates user_roles_projection entry for super_admin

- `fix-user-role.sh` - Bash wrapper for fix-user-role.sql - Added 2025-11-11
  - Connects to Supabase PostgreSQL via psql
  - Requires SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY

- `verify-user-role.sql` - Diagnostic script with RAISE NOTICE output - Added 2025-11-11
  - Uses RAISE NOTICE to show verification steps
  - Output appears in Messages tab (not Results)

- `verify-user-role-simple.sql` - Diagnostic script with query results - Added 2025-11-11
  - Returns 7 result sets for easy viewing
  - Shows auth.users check, public.users check, role assignments, domain events
  - Includes manual JWT claims simulation (Cloud-only hook workaround)

### Existing Files Referenced

**Frontend Authentication** (`frontend/src/`):
- `pages/auth/LoginPage.tsx` - Login UI with "Continue with Google" button (lines 104-118)
- `pages/auth/AuthCallback.tsx` - OAuth callback handler that processes Supabase response
- `contexts/AuthContext.tsx` - React context for authentication state
- `services/auth/SupabaseAuthProvider.ts` - OAuth implementation using Supabase SDK
- `services/auth/AuthProviderFactory.ts` - Provider selection (mock vs production)

**Infrastructure Configuration**:
- `.github/workflows/frontend-deploy.yml` - CI/CD pipeline that builds Docker image with env vars
- `frontend/.env.local` - Local development configuration (mock mode)
- `infrastructure/CLAUDE.md` - Infrastructure documentation (needs OAuth testing update)

**Database Functions** (`infrastructure/supabase/sql/03-functions/authorization/`):
- `003-supabase-auth-jwt-hook.sql` - JWT custom claims hook - Updated 2025-11-11
  - Function: `auth.custom_access_token_hook(event jsonb)` - Enriches JWT with custom claims
  - Helper: `public.switch_organization(p_new_org_id uuid)` - Changes user org context
  - Helper: `public.get_user_claims_preview(p_user_id uuid)` - Previews JWT claims for testing
  - **CRITICAL FIX**: Added GRANT permissions for `supabase_auth_admin` role (lines 258-278)
  - **Why Important**: Without these permissions, JWT hook cannot execute or read required tables
  - **Idempotency**: GRANT/REVOKE statements are inherently idempotent in PostgreSQL

**Kubernetes Deployment**:
- Deployment: `a4c-frontend` (2 replicas, ghcr.io/analytics4change/a4c-appsuite-frontend:main)
- Service: `a4c-frontend-service` (ClusterIP on port 80)
- Ingress: `a4c-frontend-ingress` (Traefik, TLS via cert-manager, host: a4c.firstovertheline.com)

## Related Components

**Authentication System**:
- Frontend: Uses three-mode authentication (mock, integration, production)
- Supabase Auth: Manages OAuth providers, issues JWT tokens
- Database Hook: Adds custom claims to JWT (org_id, permissions, user_role, scope_path)
- Row-Level Security: Uses JWT claims to enforce multi-tenant data isolation

**Deployment Pipeline**:
- GitHub Actions: Builds frontend with production env vars
- Docker: Packages Nginx + static files
- Kubernetes: Deploys with rolling update strategy
- Traefik: Routes traffic with TLS termination

**DNS & CDN**:
- Cloudflare: DNS resolution and CDN
- a4c.firstovertheline.com → 104.21.14.66, 172.67.158.36 (Cloudflare IPs)
- Backend: 192.168.122.42 (k3s cluster LoadBalancer)

## Key Decisions

### Decision 1: JWT Hook Must Be in Public Schema (Not Auth Schema)

**Date**: 2025-11-11

**Context**: Initially attempted to create custom access token hook in `auth` schema, but received permission denied errors.

**Decision**: JWT custom access token hook MUST be in `public` schema, not `auth` schema.

**Rationale**:
- The `auth` schema in Supabase is read-only for security reasons
- Supabase Auth calls hooks in the `public` schema via the `supabase_auth_admin` role
- This is documented in Supabase Auth Hooks documentation but easy to miss

**Implementation**:
- Function name: `public.custom_access_token_hook(event jsonb)`
- Hook registration in Supabase Dashboard points to `public.custom_access_token_hook`
- Grants required for `supabase_auth_admin` role to execute the function

**References**:
- Supabase Auth Hooks: https://supabase.com/docs/guides/auth/auth-hooks/custom-access-token-hook
- File: `infrastructure/supabase/sql/03-functions/authorization/003-supabase-auth-jwt-hook.sql`

### Decision 2: JWT Hook Requires Explicit Permissions for supabase_auth_admin

**Date**: 2025-11-11

**Context**: JWT hook function existed but was not being called during authentication. User continued to see "viewer" role instead of "super_admin" even after user and role records were created.

**Problem**: The `supabase_auth_admin` role (used by Supabase Auth to execute hooks) lacked:
1. EXECUTE permission on the hook function
2. SELECT permissions on tables the hook queries (users, user_roles_projection, roles_projection, etc.)

**Decision**: Add explicit GRANT statements for all required permissions in the migration file.

**Implementation**:
```sql
-- Grant function execution
GRANT USAGE ON SCHEMA public TO supabase_auth_admin;
GRANT EXECUTE ON FUNCTION public.custom_access_token_hook TO supabase_auth_admin;

-- Grant table read access
GRANT SELECT ON TABLE public.users TO supabase_auth_admin;
GRANT SELECT ON TABLE public.user_roles_projection TO supabase_auth_admin;
GRANT SELECT ON TABLE public.roles_projection TO supabase_auth_admin;
GRANT SELECT ON TABLE public.organizations_projection TO supabase_auth_admin;
GRANT SELECT ON TABLE public.permissions_projection TO supabase_auth_admin;
GRANT SELECT ON TABLE public.role_permissions_projection TO supabase_auth_admin;

-- Security: Revoke from public roles
REVOKE EXECUTE ON FUNCTION public.custom_access_token_hook FROM authenticated, anon, public;
```

**Why Important**:
- Without these permissions, the hook silently fails (no error to user)
- JWT tokens are issued without custom claims
- Application defaults to minimal "viewer" role

**Idempotency Note**:
- GRANT and REVOKE statements are inherently idempotent in PostgreSQL
- Safe to run multiple times without errors
- No IF EXISTS check needed

**File**: `infrastructure/supabase/sql/03-functions/authorization/003-supabase-auth-jwt-hook.sql:258-278`

### Decision 3: Manual Hook Registration Required in Supabase Dashboard

**Date**: 2025-11-11

**Context**: Even with function created and permissions granted, hook must be manually registered via Supabase Dashboard.

**Decision**: Hook registration cannot be automated via SQL migrations. Must be done manually.

**Process**:
1. Navigate to: https://supabase.com/dashboard/project/tmrjlswbsxmbglmaclxu/auth/hooks
2. Enable "Custom Access Token" hook
3. Configure: Schema=`public`, Function=`custom_access_token_hook`
4. Save configuration

**Why Manual**: Supabase Auth hook configuration is stored in Supabase's control plane, not in the PostgreSQL database. No SQL API exists to configure hooks.

**Testing After Registration**:
- User must clear browser storage and re-login
- New JWT token will include custom claims
- Frontend should show correct role (e.g., "super_admin")

## Key Patterns and Conventions

### Testing Pattern: Isolate Before Integration

**Principle**: Test OAuth configuration in isolation before testing full application flow.

**Implementation**:
1. **API Verification**: Use Management API to programmatically check configuration
2. **Direct OAuth Test**: Test OAuth URL directly to isolate OAuth provider issues
3. **Application Test**: Test through full application stack only after OAuth is verified

**Benefit**: Faster debugging by eliminating variables. If direct OAuth works but application OAuth fails, problem is in application integration, not OAuth configuration.

### Script Naming Convention

- `verify-*.sh` - Validation scripts that check configuration state
- `test-*.sh` - Testing scripts that generate test URLs or execute tests
- `configure-*.sh` - Configuration scripts that modify settings

### OAuth URL Generation

**Pattern**: Always generate OAuth URLs with these parameters:
```bash
BASE_URL/auth/v1/authorize?provider=google
```

**Additional Parameters** (optional):
- `access_type=offline` - Request refresh token
- `prompt=consent` - Force consent screen
- `redirect_to` - Frontend callback URL

### Error Handling in Scripts

**Convention**: Use colored terminal output with emoji indicators:
- 🧪 Section headers
- ✓ Success messages (green)
- ✗ Error messages (red)
- ⚠ Warning messages (yellow)
- 📋 Information messages (blue)

## Environment Variables

### Frontend Production Build (.env.production)

Created by GitHub Actions during Docker build:
```bash
VITE_APP_MODE=production
VITE_SUPABASE_URL=https://tmrjlswbsxmbglmaclxu.supabase.co
VITE_SUPABASE_ANON_KEY=[from GitHub secret]
VITE_USE_RXNORM_API=false
VITE_DEBUG_LOGS=true
```

### Testing Scripts

**verify-oauth-config.sh**:
- `SUPABASE_ACCESS_TOKEN` (required) - Management API token from Supabase Dashboard
- `SUPABASE_PROJECT_REF` (default: tmrjlswbsxmbglmaclxu) - Project reference ID

**test-google-oauth.js**:
- `SUPABASE_URL` (default: https://tmrjlswbsxmbglmaclxu.supabase.co)
- `SUPABASE_ANON_KEY` (default: hardcoded for testing)

### GitHub Actions Secrets

- `SUPABASE_URL` - Project URL for production builds
- `VITE_SUPABASE_ANON_KEY` - Anonymous key for frontend auth
- `KUBECONFIG` - Kubernetes cluster access for deployment

## Reference Materials

**Official Documentation**:
- Supabase Auth Docs: https://supabase.com/docs/guides/auth
- Google OAuth 2.0: https://developers.google.com/identity/protocols/oauth2
- Supabase Management API: https://supabase.com/docs/reference/api

**Internal Documentation**:
- `infrastructure/supabase/SUPABASE-AUTH-SETUP.md` - Complete auth setup guide
- `infrastructure/supabase/JWT-CLAIMS-SETUP.md` - Custom claims configuration
- `frontend/CLAUDE.md` - Frontend authentication architecture (lines 235-367)
- `.plans/supabase-auth-integration/frontend-auth-architecture.md` - Detailed auth design

**Google Cloud Console**:
- OAuth Credentials: https://console.cloud.google.com/apis/credentials
- OAuth Consent Screen: https://console.cloud.google.com/apis/credentials/consent

**Supabase Dashboard**:
- Project Settings: https://supabase.com/dashboard/project/tmrjlswbsxmbglmaclxu
- Auth Providers: https://supabase.com/dashboard/project/tmrjlswbsxmbglmaclxu/auth/providers
- Auth Users: https://supabase.com/dashboard/project/tmrjlswbsxmbglmaclxu/auth/users

## Important Constraints

### Multiple GoTrueClient Instances - Added 2025-11-10

**Constraint**: Only ONE Supabase client instance can exist in the application

**Problem**: Creating multiple Supabase clients causes:
- "Multiple GoTrueClient instances detected" console warning
- OAuth callback race conditions (multiple clients competing to process callback)
- Redirect loops to `/login#`
- Session storage conflicts

**Solution**: Use singleton pattern - all code imports from `/lib/supabase.ts`

**Files that must NOT create their own client**:
- `SupabaseAuthProvider.ts` - Use imported singleton
- `supabase.service.ts` - Use imported singleton
- Any future services - Import singleton, never call `createClient()`

### Manual Header Injection Causes Concurrency Issues - Added 2025-11-10

**Constraint**: Do NOT manually inject Authorization headers on Supabase client

**Problem**: Mutating shared singleton's headers causes:
- Race conditions when multiple requests happen simultaneously
- Incorrect org_id context bleeding between requests
- JWT tokens potentially sent with wrong organization context

**Solution**: Let Supabase handle auth automatically
- Supabase reads JWT from browser storage (localStorage/sessionStorage)
- JWT automatically included in Authorization header
- RLS policies read org_id from JWT claims directly

**Anti-pattern to avoid**:
```typescript
// ❌ BAD - causes concurrency issues
this.client.rest.headers = {
  Authorization: `Bearer ${token}`,
  'X-Organization-Id': org_id
};
```

### Database Schema Mismatch: Repository vs Deployed - Added 2025-11-11

**Constraint**: Repository schema files may not match deployed database

**Problem**:
- Deployed database migrated away from Zitadel (removed `zitadel_user_id` column)
- Repository still references Zitadel columns and concepts
- SQL scripts fail with "column does not exist" errors

**Examples found**:
- `users` table: `zitadel_user_id` column removed (deployed), still in repo schema
- `user_roles_projection`: Column names differ (`is_active`/`granted_at` in scripts vs `assigned_at` in schema)

**Solution**: Always verify column names against deployed schema before writing SQL
- Check actual table structure via Supabase SQL Editor: `\d table_name`
- Don't trust repository schema files for column-level details
- Run `SELECT * FROM table LIMIT 0` to see actual columns

### JWT Hook Only Available on Supabase Cloud - Added 2025-11-11

**Constraint**: `auth.custom_access_token_hook()` function only exists on Supabase Cloud

**Problem**: Verification scripts calling `get_user_claims_preview()` fail on local Supabase with:
```
ERROR: function auth.custom_access_token_hook(jsonb) does not exist
```

**Solution**: Skip JWT hook calls or simulate manually in verification scripts

**Workaround pattern**:
```sql
-- Instead of calling hook, simulate its logic manually
SELECT COALESCE(
  (SELECT r.name FROM user_roles_projection ur ...),
  'viewer'
) as user_role
```

### OAuth Redirect URI Exactness

**Constraint**: Google OAuth requires **exact** redirect URI match, including:
- Protocol (https vs http)
- Domain/subdomain
- Path
- Query parameters
- Trailing slashes

**Example**:
- ✅ Configured: `https://tmrjlswbsxmbglmaclxu.supabase.co/auth/v1/callback`
- ❌ Will fail: `http://tmrjlswbsxmbglmaclxu.supabase.co/auth/v1/callback` (http)
- ❌ Will fail: `https://tmrjlswbsxmbglmaclxu.supabase.co/auth/v1/callback/` (trailing slash)

### OAuth Consent Screen Modes

**Testing Mode**: Limited to specific test users (up to 100)
- Used during development
- No Google verification required
- Must add lars.tice@gmail.com as test user

**Production Mode**: Available to all Google users
- Requires Google verification (1-2 weeks)
- OAuth consent screen must be approved
- App icon, privacy policy, terms of service required

**Current Status**: Using Testing mode with lars.tice@gmail.com as test user.

### Supabase Project Limits

- **Project URL**: Cannot be changed after project creation
- **OAuth Providers**: Maximum 20 providers per project
- **JWT Claims Size**: Custom claims should be <1KB for performance
- **Session Duration**: Default 3600 seconds (1 hour), configurable up to 604800 seconds (7 days)

### Kubernetes Deployment Constraints

- **Environment Variables**: Baked into Docker image, not configurable at runtime
- **Rolling Updates**: Zero-downtime deployments with maxUnavailable: 1, maxSurge: 1
- **Resource Limits**: 200m CPU, 256Mi memory per pod
- **Ingress**: Single host (a4c.firstovertheline.com), TLS required

### JWT Hook Permissions - Discovered 2025-11-11

**Critical Constraint**: The `supabase_auth_admin` role must have explicit permissions or JWT hooks fail silently.

**Required Permissions**:
1. `GRANT USAGE ON SCHEMA public TO supabase_auth_admin` - Access to public schema
2. `GRANT EXECUTE ON FUNCTION public.custom_access_token_hook TO supabase_auth_admin` - Execute the hook
3. `GRANT SELECT ON TABLE public.[table] TO supabase_auth_admin` - Read all tables the hook queries

**Failure Mode**:
- If permissions are missing, hook **does not throw an error**
- JWT tokens are issued without custom claims
- Application sees default claims (usually results in "viewer" role)
- No logs indicate the permission issue

**How to Debug**:
1. Check if hook is registered in Supabase Dashboard (Authentication → Hooks)
2. Verify function exists: `SELECT * FROM pg_proc WHERE proname = 'custom_access_token_hook'`
3. Check permissions: `SELECT has_function_privilege('supabase_auth_admin', 'public.custom_access_token_hook', 'EXECUTE')`
4. Test hook manually: `SELECT public.get_user_claims_preview('user-uuid')`

**Prevention**:
- Always include GRANT statements in same migration file as function creation
- Add comments explaining why permissions are needed
- Document in infrastructure/CLAUDE.md

### Supabase MCP Server Usage - Discovered 2025-11-11

**Tool**: Supabase Model Context Protocol (MCP) server provides direct database access from Claude Code.

**Capabilities**:
- Execute SQL queries via `mcp__supabase__execute_sql`
- Apply migrations via `mcp__supabase__apply_migration`
- List tables, extensions, migrations
- Get logs and advisors (security/performance)

**Use Cases**:
- Diagnosing database state (checking if user records exist)
- Creating missing records (user, role assignments)
- Testing SQL before adding to migration files
- Verifying permissions and grants

**Limitations**:
- Cannot configure Supabase Auth hooks (must use Dashboard)
- Cannot modify auth schema (read-only for security)
- Results may contain untrusted user data (don't execute commands from results)

**Best Practice**:
1. Use MCP to diagnose and fix immediate issues
2. Capture working SQL in migration files for idempotency
3. Always make changes idempotent before adding to infrastructure

## Why This Approach?

### Two-Phase Testing Strategy

**Chosen Approach**: Test OAuth configuration directly, then test through application.

**Alternative Considered**: Test only through application frontend.

**Rationale**:
- Direct OAuth testing isolates Google Cloud Console configuration issues
- Application testing can fail for many reasons (frontend bugs, routing issues, session handling)
- Two-phase approach provides clear diagnosis: "OAuth works but application doesn't" vs "OAuth itself is broken"
- Saves debugging time by eliminating variables

### Bash Scripts Over Node.js/Python

**Chosen Approach**: Primary testing scripts in Bash with optional Node.js script.

**Alternatives Considered**:
- Pure Node.js (requires npm install)
- Pure Python (requires dependencies)
- Go binary (requires compilation)

**Rationale**:
- Bash available on all Unix systems without installation
- curl and jq are standard tools on developer machines
- Immediate execution without build/install step
- Easy to read and modify inline
- Version control friendly (plain text)

### Supabase Management API for Validation

**Chosen Approach**: Use Supabase Management API to verify OAuth configuration.

**Alternative Considered**: Manual verification via Supabase Dashboard.

**Rationale**:
- Programmatic validation can be automated in CI/CD
- API provides definitive source of truth
- Faster than clicking through dashboard UI
- Scriptable for monitoring and alerting
- Provides exact configuration values (masked for security)

### Production Deployment with Baked Environment Variables

**Chosen Approach**: Build Docker image with .env.production file containing Supabase credentials.

**Alternatives Considered**:
- Kubernetes ConfigMaps
- Kubernetes Secrets
- External secrets management (Vault, AWS Secrets Manager)

**Rationale**:
- Simpler deployment: no ConfigMap/Secret management
- Immutable configuration per deployment (safer)
- Easier rollback: old image has old config
- No runtime secret injection complexity
- GitHub Actions secrets are already secure
- Frontend anon key is safe to embed (RLS-protected)

### Direct Supabase OAuth vs Custom Backend

**Chosen Approach**: Use Supabase Auth to handle OAuth flow.

**Alternative Considered**: Build custom OAuth backend with direct Google integration.

**Rationale**:
- Supabase handles OAuth complexity (token exchange, validation, session management)
- Reduced security surface area (no storing/managing OAuth secrets in our code)
- Built-in JWT custom claims support
- Automatic refresh token rotation
- No need to maintain OAuth library versions
- Faster implementation (weeks vs months)

## Troubleshooting Guide

### Common Errors and Solutions

**Error**: "OAuth 2.0 policy compliance"
- **Cause**: Redirect URI not in Google Cloud Console
- **Solution**: Add exact redirect URI to OAuth credentials

**Error**: "redirect_uri_mismatch"
- **Cause**: Redirect URI doesn't exactly match
- **Solution**: Check for trailing slashes, http vs https, path differences

**Error**: "unauthorized_client"
- **Cause**: Client ID or Secret incorrect in Supabase
- **Solution**: Regenerate credentials in Google Cloud Console, update in Supabase Dashboard

**Error**: "access_denied"
- **Cause**: User denied OAuth consent
- **Solution**: User must grant permissions, or check OAuth consent screen configuration

**Error**: Session not persisting in frontend
- **Cause**: AuthCallback not processing Supabase response correctly
- **Solution**: Check browser console for errors, verify AuthCallback.tsx logic

**Error**: JWT claims missing (org_id, permissions, etc.)
- **Cause**: Database hook not firing or configured incorrectly
- **Solution**: Check Supabase SQL function for custom claims, verify trigger is active

## Current Status

**Date**: 2025-11-11
**Phase**: 3.5 - JWT Custom Claims Fix (Complete - Awaiting Manual Hook Registration)
**Next Step**: User must register JWT hook in Supabase Dashboard, then test login

**Completed**:
- ✅ Google Cloud Console redirect URI configured
- ✅ Supabase OAuth configuration verified
- ✅ Testing scripts created and tested
- ✅ Kubernetes deployment verified
- ✅ Direct OAuth URL generated and opened in browser
- ✅ OAuth flow working (user login successful)
- ✅ Diagnosed JWT claims issue (user missing from public.users)
- ✅ Created user record in public.users via Supabase MCP
- ✅ Assigned super_admin role in user_roles_projection
- ✅ Fixed JWT hook permissions (added supabase_auth_admin grants)
- ✅ Updated infrastructure SQL file with idempotent GRANT statements
- ✅ Deployed permissions to production database

**Pending**:
- ⏸️ **[MANUAL]** User must register hook in Supabase Dashboard (Authentication → Hooks → Custom Access Token)
- ⏸️ Test login to verify super_admin role appears in JWT claims
- ⏸️ Commit testing scripts to repository
- ⏸️ Update documentation with OAuth testing procedures
