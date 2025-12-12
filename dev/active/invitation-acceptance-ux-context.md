# Context: Invitation Acceptance UX

## Decision Record

**Date**: 2025-12-10
**Feature**: Invitation Acceptance UX Improvements
**Goal**: Create a frictionless first-time user onboarding experience that auto-detects SSO, handles existing users, and ignores current session state.

### Key Decisions

1. **Session Independence**: The acceptance page will ignore any current authentication state. It only cares about the invited email, not who is currently logged in. This prevents confusion when a super_admin tests invitations for other users.

2. **SSO Auto-Detection with Override**: The system will detect SSO providers based on email domain (e.g., @company.com → Google Workspace) but will NOT enforce it. Users can always override and choose email/password if preferred.

3. **Existing User Handling**: If the invited email already has a Supabase Auth account, show a "Login to Accept" flow instead of account creation. This links the user to the new organization without creating duplicate accounts.

4. **Event-Driven Architecture**: All state changes continue to flow through domain events. The accept-invitation Edge Function emits events that PostgreSQL triggers process to update projections.

## Technical Context

### Architecture

```
Invitation Email Link
    ↓
AcceptInvitationPage (React)
    ↓
validate-invitation Edge Function
    ├─ Validates token
    ├─ Checks if email exists in auth.users
    └─ Detects SSO provider from domain
    ↓
Frontend displays appropriate flow:
    ├─ New User → Create account form (SSO pre-selected if detected)
    └─ Existing User → Login form to accept
    ↓
accept-invitation Edge Function
    ├─ New User: Create Supabase Auth user + emit events
    └─ Existing User: Link to org + emit events
    ↓
PostgreSQL Triggers → Update projections
```

### Tech Stack

- **Frontend**: React 19, TypeScript, MobX, Tailwind CSS
- **Backend**: Supabase Edge Functions (Deno)
- **Database**: PostgreSQL with RLS, domain_events table
- **Auth**: Supabase Auth (OAuth2 PKCE for social, SAML 2.0 for enterprise)
- **Workflows**: Temporal.io (generates invitations)

### Dependencies

- `invitations_projection` table - stores pending invitations
- `users` table - shadow table for Supabase Auth users
- `user_roles_projection` - links users to organizations with roles
- Supabase Auth - user creation and authentication
- validate-invitation Edge Function - token validation
- accept-invitation Edge Function - user creation/linking

## File Structure

### Files Already Modified (2025-12-10)

- `frontend/src/App.tsx` line 72 - **DEPLOYED** - Fixed route from `/organizations/invitation` to `/accept-invitation`

### Files Modified (2025-12-11)

- `infrastructure/supabase/supabase/config.toml` - Added `verify_jwt = false` for validate-invitation and accept-invitation
- `infrastructure/supabase/supabase/functions/_shared/env-schema.ts` - Fixed Zod import for Deno (`https://deno.land/x/zod@v3.22.4/mod.ts`)
- `infrastructure/supabase/supabase/functions/validate-invitation/index.ts` - v8: Use API schema RPC, read token from POST body
- `infrastructure/supabase/supabase/functions/accept-invitation/index.ts` - v4: Use API schema RPC, align request/response with frontend

### Files Modified (2025-12-12)

- `workflows/src/activities/organization-bootstrap/verify-dns.ts` - **Quorum-based DNS verification** (complete rewrite)
  - Changed from `dns.resolveCname()` to quorum-based A record verification
  - Queries 3 DNS servers (Google, Cloudflare, OpenDNS) in parallel
  - Requires 2/3 quorum for success
  - 5s timeout per server prevents hanging
  - Emits `organization.subdomain.verified` event
- `infrastructure/supabase/contracts/asyncapi/domains/organization.yaml` - Added subdomain event definitions:
  - `organization.subdomain.dns_created`
  - `organization.subdomain.verified`
  - `organization.subdomain.verification_failed`
- `documentation/workflows/reference/activities-reference.md` (v1.1) - Updated verifyDNSActivity section
- `documentation/workflows/architecture/organization-bootstrap-workflow-design.md` - Updated activity contract and workflow calls
- `documentation/architecture/workflows/organization-onboarding-workflow.md` - Updated Activity 3 section

### Database Functions Created (2025-12-11)

Created SECURITY DEFINER functions in `api` schema to bypass PostgREST schema restriction:

- `api.get_invitation_by_token(p_token text)` - Returns invitation details with org name
- `api.accept_invitation(p_invitation_id uuid)` - Marks invitation as accepted
- `api.get_organization_by_id(p_org_id uuid)` - Returns organization details for redirect

### Existing Files to Modify (Future Phases)

- `frontend/src/pages/organizations/AcceptInvitationPage.tsx` - Main acceptance UI (SSO auto-detection)
- `frontend/src/viewModels/organization/InvitationAcceptanceViewModel.ts` - State management (SSO handling)
- `frontend/src/services/invitation/IInvitationService.ts` - Service interface (SSO response fields)
- `frontend/src/services/invitation/SupabaseInvitationService.ts` - Edge Function calls (SSO support)
- `infrastructure/supabase/supabase/functions/validate-invitation/index.ts` - Token validation (SSO detection)
- `infrastructure/supabase/supabase/functions/accept-invitation/index.ts` - User creation (existing user linking)

### Files Already Modified for Bug Fixes ✅ COMPLETE
- `workflows/src/activities/organization-bootstrap/verify-dns.ts` - ✅ Fixed 2025-12-12 (quorum-based DNS verification)

### New Files to Create

- `frontend/src/config/sso-domains.config.ts` - SSO domain mappings (or database table)
- `frontend/src/components/auth/SSOProviderSelector.tsx` - SSO selection with override
- `frontend/src/components/auth/LoginToAccept.tsx` - Login flow for existing users

## Related Components

- **Organization Bootstrap Workflow** (`workflows/src/workflows/organization-bootstrap/`) - Generates invitations
- **Generate Invitations Activity** (`workflows/src/activities/organization-bootstrap/generate-invitations.ts`) - Creates invitation tokens
- **Send Invitation Emails Activity** - Sends invitation emails with links
- **Auth Provider System** (`frontend/src/services/auth/`) - Handles authentication

## Key Patterns and Conventions

### Event-Driven User Creation

```typescript
// NEVER insert directly into users table
// ALWAYS emit events and let triggers handle projections

// Good: Edge Function emits event
await emitDomainEvent({
  event_type: 'user.created',
  aggregate_type: 'user',
  aggregate_id: userId,
  event_data: { ... }
});

// Bad: Direct insert
await supabase.from('users').insert({ ... }); // NO!
```

### ViewModel Pattern

```typescript
// AcceptInvitationPage uses InvitationAcceptanceViewModel
// All business logic in ViewModel, presentation in Component
const [viewModel] = useState(() => new InvitationAcceptanceViewModel());
```

### Service Interface Pattern

```typescript
// Use IInvitationService interface for dependency injection
// Allows MockInvitationService for development
export interface IInvitationService {
  validateInvitation(token: string): Promise<InvitationDetails>;
  acceptInvitation(token: string, credentials: UserCredentials): Promise<AcceptInvitationResult>;
}
```

## Reference Materials

- `documentation/architecture/authentication/frontend-auth-architecture.md` - Auth system design
- `documentation/architecture/workflows/organization-onboarding-workflow.md` - Bootstrap workflow
- `documentation/infrastructure/reference/database/tables/invitations_projection.md` - Invitation schema
- `documentation/infrastructure/reference/database/tables/users.md` - User schema

## Important Constraints

1. **Supabase Auth is Source of Truth**: User accounts are created in Supabase Auth first, then shadow records created via events.

2. **RLS Requires JWT Claims**: Users must have org_id in JWT claims for RLS to work. The JWT hook populates these from user_roles_projection.

3. **Token Expiration**: Invitation tokens expire after 7 days. The Edge Function checks `expires_at > NOW()`.

4. **Email Must Match**: For OAuth flows, the email from Google/GitHub MUST match the invitation email (or be validated against it).

5. **No Direct Database Writes**: All writes go through domain events. The Edge Functions emit events, triggers update projections.

6. **PostgREST Schema Restriction**: This Supabase project only exposes `api` schema through PostgREST. Edge Functions must use `api.*` functions or RPC calls, NOT direct `public.*` table queries. - Discovered 2025-12-11

7. **Edge Functions verify_jwt Default**: Supabase Edge Functions default to `verify_jwt: true`. For unauthenticated endpoints (invitation acceptance), must explicitly set `verify_jwt = false` in `config.toml`. - Discovered 2025-12-11

8. **Deno Import Syntax**: In Supabase Edge Functions (Deno runtime), use full URL imports: `import { z } from 'https://deno.land/x/zod@v3.22.4/mod.ts'`. Node-style imports like `from 'zod'` don't work without import maps. - Discovered 2025-12-11

## Why This Approach?

### Session Independence
- **Chosen**: Ignore current session, focus on invited email
- **Alternative**: Warn user if logged in as different account
- **Rationale**: Simpler UX, no confusing warnings, supports testing scenarios (super_admin testing other user invitations)

### SSO Auto-Detection with Override
- **Chosen**: Pre-select detected SSO provider, allow manual override
- **Alternative**: Force SSO for recognized domains
- **Rationale**: Better UX (smart defaults) while maintaining flexibility (users may have personal accounts)

### Login-to-Accept for Existing Users
- **Chosen**: Separate "login to accept" flow
- **Alternative**: Auto-detect and silently link
- **Rationale**: User needs to authenticate to prove ownership of email; transparent about what's happening

## Open Questions (To Resolve During Implementation)

1. Where to store SSO domain mappings? (config file vs. database table)
2. Should we support multiple SSO providers per organization?
3. How to handle edge case: existing user but different OAuth provider?
4. Should invitation acceptance send a confirmation email?

## Pre-Requisite Fixes (Must Complete Before Finalizing Plan)

### 1. Frontend Route Deployment ✅ COMPLETE
- **Issue**: Route fix (`/accept-invitation`) is local only, not deployed
- **File**: `frontend/src/App.tsx` line 72
- **Action**: ~~Deploy frontend to k8s cluster~~
- **Status**: Deployed 2025-12-10 21:35 UTC via GitHub Actions

### 2. DNS Verification Bug ✅ FIXED (2025-12-12)
- **Issue**: `verifyDNS` activity fails for Cloudflare proxied records
- **Root Cause**: `dns.resolveCname()` fails with ENODATA because Cloudflare proxy returns A records (IPs), not CNAME
- **Solution Implemented**: Quorum-based multi-server DNS verification
  - Queries 3 DNS servers in parallel (Google 8.8.8.8, Cloudflare 1.1.1.1, OpenDNS 208.67.222.222)
  - Requires 2/3 quorum for success
  - Uses `Resolver.resolve4()` to check A records (works with Cloudflare proxy)
  - Emits `organization.subdomain.verified` event on success
- **Files Modified**:
  - `workflows/src/activities/organization-bootstrap/verify-dns.ts` - Complete rewrite with quorum logic
  - `infrastructure/supabase/contracts/asyncapi/domains/organization.yaml` - Added subdomain events
- **Documentation Updated**:
  - `documentation/workflows/reference/activities-reference.md` - Updated verifyDNSActivity section
  - `documentation/workflows/architecture/organization-bootstrap-workflow-design.md` - Updated activity contract
  - `documentation/architecture/workflows/organization-onboarding-workflow.md` - Updated Activity 3 section
- **Status**: ✅ Implemented and documented. Ready for deployment (commit 7239902f)
