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

8. **GitHub OAuth Disabled in Production**: Only Google OAuth supported - Added 2025-11-11
   - **Choice**: Commented out GitHub OAuth button in `LoginPage.tsx` (lines 120-135)
   - **Rationale**: GitHub OAuth not configured in Supabase, causing HTTP 400 errors; user only needs Google OAuth
   - **Implementation**: GitHub button removed from production UI to prevent confusion
   - **Deployment**: Committed in `a5f9a32e`, deployed via GitHub Actions to Kubernetes

9. **Cloudflare CDN Caching Strategy**: CDN caching requires manual purge after deployments - Discovered 2025-11-11
   - **Problem**: Cloudflare CDN caches JavaScript bundles, preventing immediate deployment visibility
   - **Root Cause**: Vite generates content-hashed filenames (`index-ByeozVEU.js`) that don't change if content is similar
   - **Workaround**: Manual cache purge via Cloudflare Dashboard or API required after deployments
   - **Long-term Solution**: Configure Vite to include commit SHA in bundle names or set proper cache headers

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

### Cloudflare CDN Caching Prevents Immediate Deployment Visibility - Discovered 2025-11-11

**Constraint**: Cloudflare CDN aggressively caches static assets, including JavaScript bundles, even after Kubernetes deployment completes.

**Problem**:
- Kubernetes deployment succeeds and pods serve new code
- Cloudflare edge cache still serves old `index-ByeozVEU.js` bundle
- Users (even in private/incognito windows) see old code
- Cache persists for 2-4 hours by default

**Evidence**:
```bash
# Pods serve new bundle WITHOUT "Continue with GitHub" text
kubectl exec deployment/a4c-frontend -- grep -o 'Continue with GitHub' /usr/share/nginx/html/assets/*.js
# Result: NOT FOUND

# Cloudflare serves old bundle WITH the text
curl -s "https://a4c.firstovertheline.com/assets/index-ByeozVEU.js" | grep -o "Continue with GitHub"
# Result: Continue with GitHub
```

**Root Cause**: Vite content-based hashing keeps same filename if changes are small enough not to alter hash.

**Solutions**:
1. **Manual Purge (Immediate)**:
   - Cloudflare Dashboard → Caching → Purge Everything
   - OR Cloudflare API with token that has "Cache Purge" permission

2. **Automatic Purge (CI/CD)**:
   - Add cache purge step to GitHub Actions workflow after deployment
   - Requires CLOUDFLARE_API_TOKEN and CLOUDFLARE_ZONE_ID secrets

3. **Prevent Issue (Long-term)**:
   - Configure Vite to include commit SHA in bundle names
   - Set appropriate Cache-Control headers in Nginx
   - Configure Cloudflare to respect origin cache headers

**Workaround for Now**: User must manually purge Cloudflare cache after each frontend deployment.

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

**Date**: 2025-11-11 23:15 UTC
**Phase**: 4 - GitHub OAuth Removal ✅ COMPLETE
**Next Phase**: Phase 5 - Documentation & Cleanup
**Next Step**: Commit testing scripts and update infrastructure documentation

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
- ✅ Disabled GitHub OAuth button in LoginPage.tsx
- ✅ Committed and pushed changes via GitHub Actions
- ✅ Verified Kubernetes deployment with new code
- ✅ Discovered Cloudflare CDN caching issue
- ✅ Added Cloudflare API credentials to ~/.bashrc.local
- ✅ User manually purged Cloudflare cache via dashboard
- ✅ Verified GitHub button no longer renders in production

**OAuth Provider Status** (Updated 2025-11-11):
- ✅ Google OAuth: Fully configured and working
- ❌ GitHub OAuth: NOT configured (disabled in frontend LoginPage.tsx:120-135)
- **Note**: User only wants Google OAuth, GitHub button removed from UI

**Deployment Changes** (2025-11-11):
- ✅ Removed GitHub OAuth button from LoginPage.tsx
- ✅ Committed and deployed fix via GitHub Actions (commit: a5f9a32e)
- ✅ Kubernetes rollout completed (2/2 pods updated)
- ⏸️ Cloudflare CDN cache still serving old bundle (requires purge)

**Cloudflare Configuration** (2025-11-11):
- ✅ Added `CLOUDFLARE_API_TOKEN` to ~/.bashrc.local
- ✅ Retrieved Zone ID: `538e5229b00f5660508a1c7fcd097f97`
- ✅ Added `CLOUDFLARE_ZONE_ID` to ~/.bashrc.local
- ⏸️ API token lacks "Cache Purge" permission (authentication error)
- **Next**: User needs to create new API token with Cache Purge permission OR manually purge via dashboard

**Pending**:
- ✅ **[MANUAL]** Purge Cloudflare cache (User manually purged via dashboard)
- ✅ **[MANUAL]** Register JWT hook in Supabase Dashboard (Completed)
- ✅ Test login with Google OAuth to verify super_admin role appears in JWT claims (WORKING!)
- ⏸️ Commit testing scripts to repository
- ⏸️ Update documentation with OAuth testing procedures

### Decision 3: JWT Hook Return Format Must Use jsonb_build_object

**Date**: 2025-11-12

**Context**: OAuth login worked but JWT contained `claims_error: "output claims do not conform to expected schema"`. All standard JWT fields (aud, exp, iat, sub, etc.) were reported as missing.

**Problem**: The JWT hook was using `jsonb_set(event, '{claims}', merged_claims)` which doesn't match Supabase Auth's expected return format.

**Root Cause**: Supabase Auth expects hooks to return `{ "claims": { ...all claims... } }` but `jsonb_set` was modifying the event object incorrectly.

**Decision**: Change JWT hook to return `jsonb_build_object('claims', merged_claims)` format.

**Implementation** (lines 115-125 in `003-supabase-auth-jwt-hook.sql`):
```sql
-- OLD (WRONG):
RETURN jsonb_set(event, '{claims}', (COALESCE(event->'claims', '{}'::jsonb) || v_claims));

-- NEW (CORRECT):
v_claims := COALESCE(event->'claims', '{}'::jsonb) || jsonb_build_object(...);
RETURN jsonb_build_object('claims', v_claims);
```

**Result**: All standard JWT fields now preserved while adding custom claims (org_id, user_role, permissions, scope_path).

**References**:
- Supabase Auth Hooks Documentation: https://supabase.com/docs/guides/auth/auth-hooks/custom-access-token-hook
- Migration: `fix_jwt_hook_claims_structure` (2025-11-12)

### Decision 4: JWT Hook Must Use Schema-Qualified Table References

**Date**: 2025-11-12

**Context**: JWT hook was running but failing with error `"column u.current_organization_id does not exist"` even though the column exists in the `users` table.

**Problem**: The `supabase_auth_admin` role doesn't have `public` in its default schema search path. Unqualified table references like `FROM users` fail.

**Root Cause**: PostgreSQL search_path for `supabase_auth_admin` doesn't include `public` schema by default for security reasons.

**Decision**: Add `public.` prefix to ALL table references in JWT hook and helper functions.

**Implementation**: Updated 8+ table references in `003-supabase-auth-jwt-hook.sql`:
```sql
-- OLD (WRONG):
FROM users u
FROM user_roles_projection ur
FROM roles_projection r

-- NEW (CORRECT):
FROM public.users u
FROM public.user_roles_projection ur
FROM public.roles_projection r
```

**Files Modified**:
- `infrastructure/supabase/sql/03-functions/authorization/003-supabase-auth-jwt-hook.sql`

**Result**: JWT hook can now find all tables and execute without schema resolution errors.

**References**:
- Migration: `fix_jwt_hook_schema_qualification` (2025-11-12)
- PostgreSQL search_path documentation

### Decision 5: Bootstrap Platform Organization Required

**Date**: 2025-11-12

**Context**: Multi-tenant architecture requires all users to have organization context, but `organizations_projection` table was empty.

**Problem**: Queries referencing organization context failed, JWT hook couldn't populate org_id claim.

**Decision**: Create bootstrap platform organization for initial system setup.

**Implementation**:
```sql
INSERT INTO organizations_projection (
  id, name, display_name, slug, type, path, parent_path, timezone, is_active
) VALUES (
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid,
  'Analytics4Change', 'Analytics4Change', 'a4c', 'platform_owner',
  'a4c'::ltree, NULL, 'America/New_York', true
);
```

**Organization Details**:
- **ID**: `aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa` (fixed UUID for bootstrap)
- **Type**: `platform_owner` (highest level in organization hierarchy)
- **Path**: `a4c` (ltree root node)
- **Depth**: 1 (auto-calculated from path)

**Result**: Organization context now available for JWT claims and RLS policies.

**Notes**: Future organizations will be created via event-driven workflows, but bootstrap organization created manually for initial setup.

### Decision 6: Comprehensive Documentation Strategy for Testing Scripts

**Date**: 2025-11-12

**Context**: Testing scripts were functional but lacked comprehensive documentation. Future developers would struggle to understand OAuth testing procedures and troubleshoot issues.

**Problem**:
- Testing scripts had minimal inline documentation
- No comprehensive testing guide existed
- Troubleshooting knowledge existed only in conversation history
- No quick reference for common OAuth issues

**Decision**: Create multi-layered documentation approach:
1. **Inline script documentation**: Detailed comments in all testing scripts
2. **Comprehensive testing guide**: Dedicated OAUTH-TESTING.md with full procedures
3. **Quick reference**: OAuth testing commands in infrastructure CLAUDE.md
4. **Integration guide**: OAuth verification section in SUPABASE-AUTH-SETUP.md

**Implementation**:

**Layer 1 - Inline Documentation** (+179 lines):
- verify-oauth-config.sh: Added function docs, explained jq syntax, documented curl techniques (+79 lines)
- test-oauth-url.sh: Added OAuth flow explanation, documented URL generation (+53 lines)
- test-google-oauth.js: Added comprehensive JSDoc, documented all functions (+78 lines)

**Layer 2 - Comprehensive Guide** (637 lines):
- Created infrastructure/supabase/OAUTH-TESTING.md
- Two-phase testing strategy (API verification → OAuth flow → Application integration)
- 6-phase testing procedure (~20 minutes total)
- 4 verification checklists (32 items total)
- Troubleshooting for 8+ common OAuth issues with detailed solutions
- Reference section with all useful links and commands

**Layer 3 - Quick Reference** (+34 lines):
- Updated infrastructure/CLAUDE.md with "OAuth Testing" section
- Quick commands for all 4 testing scripts
- Common troubleshooting tips
- Link to comprehensive guide

**Layer 4 - Integration Documentation** (+97 lines):
- Updated infrastructure/supabase/SUPABASE-AUTH-SETUP.md
- Added "Test 4.4: OAuth Configuration Verification"
- Quick verification steps with code examples
- Common OAuth issues and solutions
- Reference to comprehensive testing guide

**Rationale**:
- **Inline docs**: Make scripts self-documenting for maintenance
- **Comprehensive guide**: Provide complete reference for OAuth testing and troubleshooting
- **Quick reference**: Enable fast lookups for common commands
- **Integration docs**: Connect OAuth testing to broader auth setup process

**Result**: Complete OAuth testing documentation enabling any team member to:
- Verify OAuth configuration programmatically
- Test OAuth flows end-to-end
- Diagnose and fix JWT custom claims issues
- Troubleshoot common OAuth problems independently

**Total Documentation**: 1,125 lines across 6 files

**References**:
- infrastructure/supabase/OAUTH-TESTING.md (primary guide)
- infrastructure/CLAUDE.md (quick reference)
- infrastructure/supabase/SUPABASE-AUTH-SETUP.md (integration guide)

## Final Status

**Feature Status**: ✅ **ALL PHASES COMPLETE** (including documentation)

**What Works**:
1. ✅ Google OAuth login via production frontend
2. ✅ User authenticated with correct JWT claims
3. ✅ User role shows "super_admin" in UI
4. ✅ JWT includes org_id, user_role, permissions, scope_path
5. ✅ No schema resolution errors
6. ✅ No claims validation errors
7. ✅ Bootstrap organization exists for multi-tenant queries
8. ✅ Comprehensive testing documentation available
9. ✅ All testing scripts fully documented

**Completed Migrations**:
1. `fix_jwt_hook_claims_structure` (2025-11-12) - Fixed return format
2. `fix_jwt_hook_schema_qualification` (2025-11-12) - Added public. prefix

**New Files Created**:
- `infrastructure/supabase/scripts/verify-jwt-hook-complete.sql` - JWT hook diagnostic script (358 lines)
- `infrastructure/supabase/OAUTH-TESTING.md` - Comprehensive OAuth testing guide (637 lines) - Added 2025-11-12
- `.gitignore` - Added .claude/tsc-cache/ exclusion - Updated 2025-11-12

**Modified Files (Phase 5 - Documentation)**:
- `infrastructure/supabase/scripts/verify-oauth-config.sh` - Enhanced with inline documentation (+79 lines) - Updated 2025-11-12
- `infrastructure/supabase/scripts/test-oauth-url.sh` - Enhanced with inline documentation (+53 lines) - Updated 2025-11-12
- `infrastructure/supabase/scripts/test-google-oauth.js` - Enhanced with JSDoc (+78 lines) - Updated 2025-11-12
- `infrastructure/supabase/SUPABASE-AUTH-SETUP.md` - Added OAuth verification section (+97 lines) - Updated 2025-11-12
- `infrastructure/CLAUDE.md` - Added OAuth testing commands (+34 lines) - Updated 2025-11-12

**Modified Files (Phase 3.5 - JWT Fix)**:
- `infrastructure/supabase/sql/03-functions/authorization/003-supabase-auth-jwt-hook.sql` - JWT hook with correct format and schema qualification
