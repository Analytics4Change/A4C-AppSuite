# Tasks: OAuth Invitation Acceptance

## Phase 1: Edge Function Migration ✅ COMPLETE

- [x] Update `UserCredentials` interface (lines 44-48)
  - Remove `oauth?: OAuthProvider`
  - Add `authMethod?: AuthMethod`
  - Add `authenticatedUserId?: string`
- [x] Define `AuthMethod` type in Edge Function
  - `{ type: 'email_password' }`
  - `{ type: 'oauth'; provider: string }`
  - `{ type: 'sso'; config: { type: string; domain: string } }`
- [x] Update `AcceptInvitationRequest` interface (lines 55-58)
  - Add `platform?: 'web' | 'ios' | 'android'`
- [x] Update auth method detection (line 129)
  - Change `!!credentials.oauth` to `credentials.authMethod?.type === 'oauth' || 'sso'`
- [x] Update validation error message (line 133)
- [x] Replace 501 block (lines 245-257) with OAuth implementation
  - Verify `authenticatedUserId` exists
  - Get user via `auth.admin.getUserById()`
  - Validate email match
  - Check existing roles (Sally scenario)
  - Emit `user.created` only for new users
  - Use `buildEventMetadata()` for events
- [x] Update comment documentation (lines 52-53)
- [x] Deploy Edge Function to Supabase

## Phase 2: Frontend Storage + Platform ✅ COMPLETE

- [x] Create `frontend/src/services/storage/AuthContextStorage.ts`
  - Define `IAuthContextStorage` interface
  - Implement `WebAuthContextStorage` class
  - Stub `MobileAuthContextStorage` class
- [x] Create `frontend/src/services/storage/index.ts`
  - Export `getAuthContextStorage()` factory
  - Singleton pattern with platform detection
- [x] Create `frontend/src/utils/platform.ts`
  - Define `Platform` type ('web' | 'ios' | 'android')
  - Implement `detectPlatform()` function
  - Implement `getCallbackUrl(platform)` function
  - Define deep link URLs for mobile

## Phase 3: Frontend Types ✅ COMPLETE

- [x] Update `frontend/src/types/auth.types.ts`
  - Expand `OAuthProvider` to include: google, github, facebook, apple, azure, okta, keycloak
  - Add `SSOConfig` interface
  - Add `AuthMethod` discriminated union
  - Add `InvitationAuthContext` interface with `createdAt` field
- [x] Update `frontend/src/types/organization.types.ts`
  - Import `AuthMethod` from auth.types
  - Replace `oauth?: 'google'` with `authMethod?: AuthMethod`
  - Add `authenticatedUserId?: string` to `UserCredentials`

## Phase 4: ViewModel + Page ✅ COMPLETE

- [x] Update `InvitationAcceptanceViewModel.ts`
  - Add imports for storage, platform, auth types
  - Add `acceptWithOAuth(provider: OAuthProvider, authProvider: IAuthProvider)` method
  - Store invitation context with `createdAt` timestamp
  - Call `authProvider.loginWithOAuth()`
  - Remove legacy `acceptWithGoogle()` method (around line 260)
- [x] Update `AcceptInvitationPage.tsx`
  - Get `authProvider` from `useAuth()` context
  - Create thin `handleOAuthSignIn(provider)` handler
  - Delegate to `viewModel.acceptWithOAuth()`
- [x] Create `frontend/src/config/oauth-providers.config.ts`
  - Define `ENABLED_OAUTH_PROVIDERS` array
  - Define `PROVIDER_DISPLAY_NAMES` mapping

## Phase 5: AuthCallback Completion ✅ COMPLETE

- [x] Update `AuthCallback.tsx` imports
  - Import `getAuthContextStorage` from storage service
  - Import `InvitationAuthContext` from auth types
  - Import `extractEdgeFunctionError` from SupabaseUserCommandService
  - Import `generateTraceparent`, `getSessionId` from tracing
  - Import `ErrorWithCorrelation` component
- [x] Add TTL constant (10 minutes)
- [x] Add invitation detection after `handleOAuthCallback()`
  - Get context from storage
  - Remove context immediately
  - Parse as `InvitationAuthContext`
  - Check TTL (reject if expired)
  - Check `flow === 'invitation_acceptance'`
- [x] Create `completeOAuthInvitationAcceptance()` helper
  - Get session from Supabase
  - Generate tracing headers (NOT correlation ID)
  - Call Edge Function with proper body structure
  - Use `extractEdgeFunctionError()` for error handling
  - Return success/error result with correlation ID
- [x] Add error state and display
  - Use `ErrorWithCorrelation` component
  - Show error message and correlation ID
  - Provide dismiss action to navigate to login
- [x] Handle success redirect
  - Navigate to login with redirect URL parameter

## Phase 6: Documentation ✅ COMPLETE

- [x] Create `documentation/architecture/authentication/oauth-invitation-acceptance.md`
  - Add frontmatter (status: current, last_updated)
  - Add TL;DR section
  - Document problem statement
  - Document solution architecture
  - Document error handling patterns
  - Document event metadata
  - Add related documentation links
- [x] Update `documentation/AGENT-INDEX.md`
  - Add entry under Authentication section
  - Keywords: `oauth`, `invitation`, `authentication`, `correlation-id`
  - Token estimate: ~800

## Phase 7: Deploy + Test ✅ COMPLETE

- [x] Build frontend
  - `cd frontend && npm run build`
- [x] Deploy frontend to k3s
  - Push to main or run deploy workflow
- [x] UAT: New user OAuth acceptance
  - Create invitation for new email
  - Accept via Google OAuth
  - Verify redirect to organization
  - Verify events emitted (user.created, user.role.assigned, invitation.accepted)
- [x] UAT: Existing user OAuth acceptance (Sally scenario)
  - User with role in Org A accepts invite to Org B
  - Verify NO user.created event
  - Verify user.role.assigned and invitation.accepted events
- [x] UAT: Email mismatch error
  - Accept invitation with different Google account
  - Verify clear error message with both emails
  - Verify correlation ID in error display
- [x] UAT: Email/password still works (regression test)
  - Accept invitation via email/password
  - Verify flow unchanged

## Phase 8: Bug Fixes (Post-UAT) ✅ COMPLETE

Five bugs discovered during UAT testing:

### Fix 1: JWT Race Condition + Direct Subdomain Redirect ✅

**Problem**: User sees `viewer` role instead of assigned role after OAuth invitation acceptance. Also, redirecting through LoginPage adds complexity that can fail.

**Solution**:
- Call `supabase.auth.refreshSession()` after Edge Function succeeds
- Redirect DIRECTLY to subdomain URL using `window.location.href` (skip LoginPage)

**File**: `frontend/src/pages/auth/AuthCallback.tsx` (lines 302-326)

### Fix 2: Duplicate `user.created` Events ✅

**Problem**: Edge Function emits `user.created` twice for OAuth users - once in OAuth block and once in generic block.

**Solution**: Wrap generic `user.created` emission in `if (isEmailPassword)` block.

**File**: `infrastructure/supabase/supabase/functions/accept-invitation/index.ts` (lines 397-427)
**Deployed**: v14-fix-duplicate-user-created

### Fix 3: Migration Table Name ✅

**Problem**: Migration file referenced `user_org_access` but deployed function uses `user_organizations_projection`.

**Status**: Already correct in deployed version - no fix needed.

### Fix 4: Returning OAuth User Subdomain Redirect ✅

**Problem**: OAuth users logging back in are redirected to wrong subdomain. Root cause: `determineRedirectUrl()` uses stale `session` from React closure.

**Solution**: Get fresh session from `supabase.auth.getSession()` and decode JWT to extract custom claims.

**File**: `frontend/src/pages/auth/AuthCallback.tsx` (lines 195-256)

### Fix 5: Migration Consistency

**Status**: Not applicable - migration file already correct.

## Success Validation Checkpoints

### Immediate Validation ✅
- [x] Edge Function deploys without errors
- [x] Frontend builds without TypeScript errors
- [x] OAuth redirect initiates from AcceptInvitationPage

### Feature Complete Validation ✅
- [x] New user can accept invitation via Google OAuth
- [x] Existing user can join new org via OAuth
- [x] Email mismatch shows error with correlation ID
- [x] Email/password acceptance still works

### Production Validation (Pending Deployment)
- [ ] Events contain auth_provider and platform fields
- [ ] Correlation ID traceable across invitation lifecycle
- [ ] No 501 errors in Edge Function logs
- [ ] OAuth users redirect to correct subdomain after invitation acceptance
- [ ] Returning OAuth users redirect to correct subdomain

## Current Status

**Phase**: Phase 8 - Bug Fixes (Post-UAT)
**Status**: ✅ CODE COMPLETE - Ready for deployment
**Last Updated**: 2026-01-09
**Next Step**: Deploy frontend and verify fixes in production
