# Tasks: Invitation Acceptance UX

## Phase 1: Research & Analysis ✅ COMPLETE

- [x] Review AcceptInvitationPage.tsx implementation
- [x] Review InvitationAcceptanceViewModel.ts implementation
- [x] Review IInvitationService interface and implementations
- [x] Document current flow (token validation → credential collection → user creation)
- [x] Confirm architectural decisions (session independence, SSO auto-detect with override)
- [x] Test current invitation acceptance flow with real invitation
- [x] Document observed behavior vs. expected behavior
- [x] Identify specific bugs or UX friction points
- [x] Fix route mismatch bug and deploy to production
- [x] Fix subdomain_status for test organization

### Bug Found & Fixed
- **Issue**: Route mismatch - email links to `/accept-invitation` but frontend route was `/organizations/invitation`
- **Symptom**: Invitation links redirected to `/clients` (if logged in) or `/login` (if not) due to 404 fallback
- **Fix**: Changed route in `App.tsx` from `/organizations/invitation` to `/accept-invitation`
- **Status**: ✅ DEPLOYED to k8s cluster (2025-12-10 21:35 UTC)

### Bug Found & Fixed: DNS Verification Fails for Cloudflare Proxied Records ✅ FIXED (2025-12-12)
- **Issue**: `verifyDNS` activity uses `dns.resolveCname()` but Cloudflare proxied records return A records (IPs), not CNAME
- **Symptom**: `subdomain_status` stays `'pending'` even though DNS is working
- **Root Cause**: Cloudflare masks CNAME behind proxy IPs; workflow treats verification failure as non-fatal
- **Solution Implemented**: Quorum-based multi-server DNS verification
  - Queries 3 DNS servers (Google 8.8.8.8, Cloudflare 1.1.1.1, OpenDNS 208.67.222.222)
  - Requires 2/3 quorum for success
  - Uses `Resolver.resolve4()` (A records, not CNAME)
  - 5s timeout per server prevents hanging
  - Emits `organization.subdomain.verified` event on success
- **Files Modified**:
  - `workflows/src/activities/organization-bootstrap/verify-dns.ts` - Complete rewrite with quorum logic
  - `infrastructure/supabase/contracts/asyncapi/domains/organization.yaml` - Added subdomain events
- **Documentation Updated**:
  - `documentation/workflows/reference/activities-reference.md` (v1.1)
  - `documentation/workflows/architecture/organization-bootstrap-workflow-design.md`
  - `documentation/architecture/workflows/organization-onboarding-workflow.md`
- **Status**: ✅ Implemented and documented. Ready for deployment (commit 7239902f)

### Bugs Found & Fixed (2025-12-11)

#### Edge Functions Schema Restriction
- **Issue**: Edge Functions using `db: { schema: 'public' }` failed with "The schema must be one of the following: api"
- **Root Cause**: Supabase project configured to only expose `api` schema through PostgREST
- **Fix**: Created SECURITY DEFINER functions in `api` schema to query `public` tables:
  - `api.get_invitation_by_token(p_token text)` - Query invitation with org name
  - `api.accept_invitation(p_invitation_id uuid)` - Mark invitation accepted
  - `api.get_organization_by_id(p_org_id uuid)` - Get organization details
- **Status**: ✅ DEPLOYED

#### Edge Functions verify_jwt Configuration
- **Issue**: `validate-invitation` and `accept-invitation` had `verify_jwt: true` blocking unauthenticated users
- **Fix**: Added `[functions.*] verify_jwt = false` in `config.toml` and deployed via Supabase CLI
- **Files Modified**:
  - `infrastructure/supabase/supabase/config.toml`
- **Status**: ✅ DEPLOYED

#### Request/Response Format Mismatch
- **Issue**: Frontend sends `{ token, credentials: { email, password } }` but Edge Function expected `{ token, method, password }`
- **Fix**: Updated accept-invitation interface to match frontend's `UserCredentials` format
- **Also Fixed**: Response uses `orgId` instead of `organizationId` (matching frontend expectations)
- **Status**: ✅ DEPLOYED (commit fb046a06)

#### Deno Import Syntax
- **Issue**: `import { z } from 'zod'` doesn't work in Deno without import map
- **Fix**: Changed to `import { z } from 'https://deno.land/x/zod@v3.22.4/mod.ts'`
- **File**: `infrastructure/supabase/supabase/functions/_shared/env-schema.ts`
- **Status**: ✅ DEPLOYED

## Phase 2: Design UX Flow ⏸️ PENDING

- [ ] Define complete user journey: New user, unknown domain
- [ ] Define complete user journey: New user, recognized SSO domain
- [ ] Define complete user journey: Existing user accepting new org invitation
- [ ] Design SSO provider selector UI with override capability
- [ ] Design "Login to Accept" flow for existing users
- [ ] Design error states (expired token, already accepted, email mismatch)
- [ ] Review designs with stakeholder

## Phase 3: Backend Implementation ⏸️ PENDING

- [ ] Add email existence check to validate-invitation Edge Function
- [ ] Determine SSO domain storage approach (config vs. database)
- [ ] Implement SSO domain detection logic
- [ ] Update validate-invitation response with: user_status, detected_sso_provider
- [ ] Update accept-invitation to handle existing user case
- [ ] Add events for existing user joining organization
- [ ] Test Edge Function changes locally

## Phase 4: Frontend Implementation ⏸️ PENDING

- [ ] Refactor AcceptInvitationPage to ignore current session
- [ ] Add email existence handling to ViewModel
- [ ] Create SSOProviderSelector component with override
- [ ] Create LoginToAccept component for existing users
- [ ] Update InvitationAcceptanceViewModel for new flows
- [ ] Update SupabaseInvitationService for new API responses
- [ ] Implement proper error handling for all edge cases

## Phase 5: Testing & Validation ⏸️ PENDING

- [ ] Unit tests: InvitationAcceptanceViewModel (all user journeys)
- [ ] Unit tests: SSO domain detection logic
- [ ] Integration tests: validate-invitation Edge Function
- [ ] Integration tests: accept-invitation Edge Function (new + existing user)
- [ ] E2E test: New user with email/password
- [ ] E2E test: New user with Google OAuth
- [ ] E2E test: New user with auto-detected SSO
- [ ] E2E test: Existing user login-to-accept
- [ ] Manual testing: Full flow verification

## Success Validation Checkpoints

### Immediate Validation (Phase 1) ✅ COMPLETE
- [x] Can successfully test invitation acceptance with real invitation
- [x] Documented actual current behavior
- [x] Identified specific improvements needed

### Feature Complete Validation (Phase 4-5)
- [ ] New user can accept invitation with email/password
- [ ] New user can accept invitation with Google OAuth
- [ ] SSO auto-detection shows correct provider for known domains
- [ ] User can override SSO suggestion
- [ ] Existing user can login and link to new organization
- [ ] Page works correctly regardless of current session state
- [ ] All E2E tests passing

## Current Status

**Phase**: 1 - Research & Analysis ✅ COMPLETE
**Status**: ✅ Email/Password invitation acceptance flow working end-to-end
**Last Updated**: 2025-12-14
**Next Step**:
1. Proceed to Phase 2 UX design for SSO auto-detection
2. Design SSO provider selector UI with override capability
3. Design "Login to Accept" flow for existing users

**Note**: All infrastructure/schema fixes complete. Bootstrap and invitation flows tested and verified.

### Completed Since Last Update (2025-12-13/14)

1. **Fixed roles_projection constraints** (ce816dfa) - Multi-org support
   - Changed `UNIQUE(name)` to `UNIQUE(name, organization_id)`
   - Fixed CHECK constraint for organization-scoped roles
   - Fixed `process_invitation_accepted_event` trigger ON CONFLICT clause

2. **Fixed CONSOLIDATED_SCHEMA.sql** (fea92366, 02edcf72) - Deployment fixes
   - Added `DROP FUNCTION IF EXISTS get_bootstrap_status(uuid)` for idempotency
   - Added 13 missing artifacts:
     - `process_user_event()` function
     - 6 OU management functions (`api.get_organization_units`, etc.)
     - 4 OU RLS policies (`organizations_scope_select`, etc.)

3. **Fixed org-cleanup slash commands** - DNS discovery improvement
   - Commands now extract actual FQDN from `organization.subdomain.dns_created` event
   - Search Cloudflare using contains pattern (catches any subdomain format)
   - Prevents missing DNS records like `{org}.firstovertheline.com` vs `{org}.a4c.firstovertheline.com`

4. **Organization cleanup tested** - `poc-test1-20251213` fully cleaned
   - Auth user deleted
   - All database records cleaned
   - DNS record deleted (was at `poc-test1-20251213.firstovertheline.com`, not `.a4c.`)

## Session Notes

### 2025-12-13/14 - Schema Fixes & Org Cleanup Testing

**Context:**
User `johnltice@yahoo.com` for org `poc-test1-20251213` had "viewer" role instead of expected `provider_admin`. Investigation revealed two critical bugs in `roles_projection` table.

**Bug 1: UNIQUE(name) Constraint**
- `roles_projection.name` had global UNIQUE constraint
- Should be `UNIQUE(name, organization_id)` for multi-org support
- When `process_invitation_accepted_event` tried to create `provider_admin` for new org, it failed because `provider_admin` already existed for different org
- Fix: Changed constraint to composite unique

**Bug 2: CHECK Constraint Mismatch**
- CONSOLIDATED_SCHEMA.sql had outdated CHECK constraint allowing `provider_admin`/`partner_admin` with NULL org_id
- Production data (correctly) has these roles with non-NULL org_id
- Fix: Updated CHECK to only allow `super_admin` with NULL org_id

**Bug 3: Missing Artifacts in CONSOLIDATED_SCHEMA.sql**
- Audit found 13 artifacts in source SQL files missing from deployment schema
- GitHub Actions only deploys CONSOLIDATED_SCHEMA.sql, not individual files
- Fix: Added all missing functions and RLS policies

**Bug 4: org-cleanup DNS Discovery**
- Cleanup command searched for `{org}.a4c.firstovertheline.com`
- Actual DNS record was `{org}.firstovertheline.com` (no `.a4c`)
- Fix: Updated both org-cleanup and org-cleanup-dryrun commands to:
  1. Extract actual FQDN from `organization.subdomain.dns_created` event
  2. Search Cloudflare with contains pattern for org name

**Files Modified:**
- `infrastructure/supabase/sql/02-tables/rbac/002-roles_projection.sql`
- `infrastructure/supabase/sql/04-triggers/process_invitation_accepted.sql`
- `infrastructure/supabase/CONSOLIDATED_SCHEMA.sql` (multiple fixes)
- `.claude/commands/org-cleanup.md`
- `.claude/commands/org-cleanup-dryrun.md`

**Key Commits:**
- `ce816dfa` - fix(rbac): Fix roles_projection constraints for multi-org support
- `02edcf72` - fix(schema): Add DROP FUNCTION for get_bootstrap_status idempotency
- `fea92366` - fix(schema): Add missing artifacts to CONSOLIDATED_SCHEMA.sql

**Organization Cleaned Up:**
- Name: `poc-test1-20251213`
- ID: `78a58df8-0f07-47fc-9e1e-1140061e9c30`
- User: `johnltice@yahoo.com` (ID: `532bafd4-6152-497b-93fd-242e8114004d`)
- All database records deleted
- DNS record `poc-test1-20251213.firstovertheline.com` deleted

**Key Learning:**
GitHub Actions deployment only uses CONSOLIDATED_SCHEMA.sql. Any new functions/policies in source SQL files MUST be added to consolidated schema or they won't be deployed.

### 2025-12-10 - Initial Planning & Bug Fixes

**Explored:**
- Complete invitation flow from email to acceptance
- AcceptInvitationPage, ViewModel, Service implementations
- Edge Functions (validate-invitation, accept-invitation)
- JWT custom claims and organization membership
- Temporal workflow for invitation generation

**Key Findings:**
1. Invited user does NOT exist in Supabase Auth until acceptance completed
2. AcceptInvitationPage handles credential creation inline (NOT redirect to login)
3. No SSO auto-detection currently exists
4. User manually selects Email/Password vs Google OAuth
5. Post-acceptance redirect depends on `subdomain_status = 'verified'`

**Bugs Found & Fixed:**
1. **Route Mismatch** - Email links to `/accept-invitation` but route was `/organizations/invitation`
   - Fixed in `frontend/src/App.tsx` line 72
   - Deployed via GitHub Actions (commit 8715f8a5)

2. **DNS Verification Bug** - `verifyDNS` uses `dns.resolveCname()` but Cloudflare returns A records
   - NOT FIXED YET - tracked in Pre-Requisite Fixes
   - Workaround: Manually set `subdomain_status = 'verified'` for test org

**Architectural Decisions Made:**
1. **Session Independence**: Ignore current auth state, only care about invited email
2. **SSO Auto-Detect with Override**: Pre-select detected provider, allow manual change
3. **Existing User Handling**: Show "Login to Accept" flow (not implemented yet)

**Test Organization:**
- Name: `poc-test1-20251210`
- ID: `0364ef4a-c3ec-4ef7-8ab6-0413f652019f`
- Subdomain: `poc-test1-20251210.firstovertheline.com`
- subdomain_status: `verified` (manually set)
- Invitation token: `_i0TFM2BkFQtAgRatphv7w6SJEVhK-s2C1yyVh9ndus` **(CONSUMED)**

**User Created:**
- Email: johnltice@yahoo.com
- Password: SimplePassword123
- User ID: ed15bb88-1789-49fb-95ab-e8cefdf75cff
- Organization: poc-test1-20251210

### 2025-12-11 - Edge Function Debugging & Fixes

**Issues Debugged:**
1. Token not being read from request body → Fixed to support POST body
2. Response format mismatch (`organizationName` vs `orgName`) → Fixed
3. `verify_jwt=true` blocking unauthenticated requests → Set to false in config.toml
4. Deno Zod import syntax → Changed to full URL import
5. Schema restriction ("must be one of: api") → Created API schema wrapper functions
6. Request format mismatch (frontend sends `credentials` object) → Updated interface

**Key Commits:**
- `74794dd3` - fix(edge-functions): Enable unauthenticated invitation acceptance
- `fb046a06` - fix(accept-invitation): Align request/response format with frontend

**API Functions Created (via MCP):**
- `api.get_invitation_by_token(p_token text)` - SECURITY DEFINER to query public.invitations_projection
- `api.accept_invitation(p_invitation_id uuid)` - Mark invitation as accepted
- `api.get_organization_by_id(p_org_id uuid)` - Get org details for redirect

**Edge Function Versions Deployed:**
- validate-invitation: v8 (version 34 in Supabase)
- accept-invitation: v4 (version 34 in Supabase)

**Result:**
- ✅ Email/password invitation acceptance works end-to-end via curl
- ✅ User created successfully in Supabase Auth
- ✅ Invitation marked as accepted
- ⚠️ OAuth acceptance returns 501 Not Implemented (deferred)

**Important Learnings:**
1. Supabase Edge Functions default to `verify_jwt=true` - must set in config.toml
2. PostgREST schema exposure is project-configured - this project only exposes `api` schema
3. Service role key bypasses RLS but NOT schema restrictions
4. CI/CD workflow preserves verify_jwt settings from config.toml

### 2025-12-12 - DNS Verification Bug Fix

**Context:**
User requested to understand and fix the known DNS verification defect before deployment.

**Root Cause Analysis:**
- `verify-dns.ts` used `dns.resolveCname()` which fails for Cloudflare proxied records
- Cloudflare proxy returns A records (IPs like 104.21.x.x, 172.67.x.x), not CNAME
- Activity threw `ENODATA` error, workflow caught it as non-fatal
- `organization.subdomain.verified` event was never emitted
- `subdomain_status` stayed at `'verifying'` forever

**Solution Implemented:**
Quorum-based multi-server DNS verification:
1. Query 3 DNS servers in parallel (Google, Cloudflare, OpenDNS)
2. Require 2/3 quorum for success
3. Use `Resolver.resolve4()` to check A records (works with proxied domains)
4. 5s timeout per server prevents hanging on slow servers
5. Emit `organization.subdomain.verified` event with rich debugging data

**Files Modified:**
1. `workflows/src/activities/organization-bootstrap/verify-dns.ts` - Complete rewrite
2. `infrastructure/supabase/contracts/asyncapi/domains/organization.yaml` - Added subdomain events

**Documentation Updated:**
1. `documentation/workflows/reference/activities-reference.md` (v1.0 → v1.1)
2. `documentation/workflows/architecture/organization-bootstrap-workflow-design.md`
3. `documentation/architecture/workflows/organization-onboarding-workflow.md`

**Commit:** 7239902f fix(dns): Align event type with AsyncAPI contract

**Key Technical Decisions:**
1. **Why quorum?** - Single DNS server might be temporarily unreachable; different providers = global confirmation
2. **Why A records not CNAME?** - Cloudflare proxy masks CNAME behind proxy IPs
3. **Why 3 servers?** - Google, Cloudflare, OpenDNS provide diverse network paths
4. **Why 2/3 quorum?** - Tolerates one server failure while requiring consensus
5. **Why isolated Resolver instances?** - Each query uses separate Resolver to avoid affecting other queries

**Pending Deployment:**
- Worker needs rebuild: `docker build -t ghcr.io/analytics4change/a4c-workflows:latest .`
- Worker needs deploy: `kubectl set image deployment/workflow-worker ...`
- Test with new organization bootstrap to verify subdomain_status transitions correctly

### 2025-12-12 - Bootstrap Status UI Redesign

**Context:**
User noticed bootstrap status page should display DNS verification as a separate step. Investigation revealed:
1. UI showed 10 steps, but workflow actually has 11 stages (including DNS verification)
2. Event mapping grouped `organization.subdomain.verified` with `organization.subdomain.dns_created`
3. Step labels were misleading (e.g., "Create Admin Contact" when creating multiple contacts)

**Investigation Findings:**
- Bootstrap status page route: `/organizations/:organizationId/bootstrap`
- Edge Function `workflow-status` (v22) queries `get_bootstrap_status()` database function
- Database function maps domain events to stages using CASE statement
- UI was driven by events, not workflow activities (intentional for granular progress)
- `dns_verification` event existed but was grouped under `dns_provisioning` stage

**Changes Implemented:**

1. **Database Function** (`get_bootstrap_status` in `bootstrap-event-listener.sql`):
   - Split `dns_provisioning` stage
   - `organization.subdomain.dns_created` → `dns_provisioning`
   - `organization.subdomain.verified` → `dns_verification` (new)

2. **Edge Function** (`workflow-status/index.ts` v23):
   - Added `dns_verification` to `stageOrder` array
   - Added "Verify DNS" stage entry
   - Updated labels to be generic (pluralized)

3. **Frontend** (`OrganizationBootstrapStatusPage.tsx`):
   - Compacted layout (p-4→p-3, space-y-4→space-y-2)
   - All 11 steps fit without scrolling

**New 11-Step Layout:**
1. Initialize Organization
2. Create Organization Record
3. Create Contacts
4. Create Addresses
5. Create Phones
6. Create Program
7. Configure DNS
8. **Verify DNS** ← NEW
9. Assign Admin Role
10. Send Invitations
11. Complete Bootstrap

**Commits:**
- `a96e8bb6` - feat(bootstrap): Add DNS verification as separate step in status UI

**Deployments:**
- ✅ Database function applied via MCP
- ✅ Edge Function v23 deployed via Supabase CLI
- ⏳ Frontend will auto-deploy via GitHub Actions

**Key Learning:**
Bootstrap status UI is event-driven (not activity-driven) for granular progress visibility. One activity can emit multiple events → multiple UI steps.
