# Tasks: OAuth Invitation Acceptance

## Phase 1: Edge Function Migration (Start Here)

- [ ] Update `UserCredentials` interface (lines 44-48)
  - Remove `oauth?: OAuthProvider`
  - Add `authMethod?: AuthMethod`
  - Add `authenticatedUserId?: string`
- [ ] Define `AuthMethod` type in Edge Function
  - `{ type: 'email_password' }`
  - `{ type: 'oauth'; provider: string }`
  - `{ type: 'sso'; config: { type: string; domain: string } }`
- [ ] Update `AcceptInvitationRequest` interface (lines 55-58)
  - Add `platform?: 'web' | 'ios' | 'android'`
- [ ] Update auth method detection (line 129)
  - Change `!!credentials.oauth` to `credentials.authMethod?.type === 'oauth' || 'sso'`
- [ ] Update validation error message (line 133)
- [ ] Replace 501 block (lines 245-257) with OAuth implementation
  - Verify `authenticatedUserId` exists
  - Get user via `auth.admin.getUserById()`
  - Validate email match
  - Check existing roles (Sally scenario)
  - Emit `user.created` only for new users
  - Use `buildEventMetadata()` for events
- [ ] Update comment documentation (lines 52-53)
- [ ] Deploy Edge Function to Supabase

## Phase 2: Frontend Storage + Platform

- [ ] Create `frontend/src/services/storage/AuthContextStorage.ts`
  - Define `IAuthContextStorage` interface
  - Implement `WebAuthContextStorage` class
  - Stub `MobileAuthContextStorage` class
- [ ] Create `frontend/src/services/storage/index.ts`
  - Export `getAuthContextStorage()` factory
  - Singleton pattern with platform detection
- [ ] Create `frontend/src/utils/platform.ts`
  - Define `Platform` type ('web' | 'ios' | 'android')
  - Implement `detectPlatform()` function
  - Implement `getCallbackUrl(platform)` function
  - Define deep link URLs for mobile

## Phase 3: Frontend Types

- [ ] Update `frontend/src/types/auth.types.ts`
  - Expand `OAuthProvider` to include: google, github, facebook, apple, azure, okta, keycloak
  - Add `SSOConfig` interface
  - Add `AuthMethod` discriminated union
  - Add `InvitationAuthContext` interface with `createdAt` field
- [ ] Update `frontend/src/types/organization.types.ts`
  - Import `AuthMethod` from auth.types
  - Replace `oauth?: 'google'` with `authMethod?: AuthMethod`
  - Add `authenticatedUserId?: string` to `UserCredentials`

## Phase 4: ViewModel + Page

- [ ] Update `InvitationAcceptanceViewModel.ts`
  - Add imports for storage, platform, auth types
  - Add `acceptWithOAuth(provider: OAuthProvider, authProvider: IAuthProvider)` method
  - Store invitation context with `createdAt` timestamp
  - Call `authProvider.loginWithOAuth()`
  - Remove legacy `acceptWithGoogle()` method (around line 260)
- [ ] Update `AcceptInvitationPage.tsx`
  - Get `authProvider` from `useAuth()` context
  - Create thin `handleOAuthSignIn(provider)` handler
  - Delegate to `viewModel.acceptWithOAuth()`
- [ ] Create `frontend/src/config/oauth-providers.config.ts`
  - Define `ENABLED_OAUTH_PROVIDERS` array
  - Define `PROVIDER_DISPLAY_NAMES` mapping

## Phase 5: AuthCallback Completion

- [ ] Update `AuthCallback.tsx` imports
  - Import `getAuthContextStorage` from storage service
  - Import `InvitationAuthContext` from auth types
  - Import `extractEdgeFunctionError` from SupabaseUserCommandService
  - Import `generateTraceparent`, `getSessionId` from tracing
  - Import `ErrorWithCorrelation` component
- [ ] Add TTL constant (10 minutes)
- [ ] Add invitation detection after `handleOAuthCallback()`
  - Get context from storage
  - Remove context immediately
  - Parse as `InvitationAuthContext`
  - Check TTL (reject if expired)
  - Check `flow === 'invitation_acceptance'`
- [ ] Create `completeOAuthInvitationAcceptance()` helper
  - Get session from Supabase
  - Generate tracing headers (NOT correlation ID)
  - Call Edge Function with proper body structure
  - Use `extractEdgeFunctionError()` for error handling
  - Return success/error result with correlation ID
- [ ] Add error state and display
  - Use `ErrorWithCorrelation` component
  - Show error message and correlation ID
  - Provide dismiss action to navigate to login
- [ ] Handle success redirect
  - Navigate to login with redirect URL parameter

## Phase 6: Documentation

- [ ] Create `documentation/architecture/authentication/oauth-invitation-acceptance.md`
  - Add frontmatter (status: current, last_updated)
  - Add TL;DR section
  - Document problem statement
  - Document solution architecture
  - Document error handling patterns
  - Document event metadata
  - Add related documentation links
- [ ] Update `documentation/AGENT-INDEX.md`
  - Add entry under Authentication section
  - Keywords: `oauth`, `invitation`, `authentication`, `correlation-id`
  - Token estimate: ~800

## Phase 7: Deploy + Test

- [ ] Build frontend
  - `cd frontend && npm run build`
- [ ] Deploy frontend to k3s
  - Push to main or run deploy workflow
- [ ] UAT: New user OAuth acceptance
  - Create invitation for new email
  - Accept via Google OAuth
  - Verify redirect to organization
  - Verify events emitted (user.created, user.role.assigned, invitation.accepted)
- [ ] UAT: Existing user OAuth acceptance (Sally scenario)
  - User with role in Org A accepts invite to Org B
  - Verify NO user.created event
  - Verify user.role.assigned and invitation.accepted events
- [ ] UAT: Email mismatch error
  - Accept invitation with different Google account
  - Verify clear error message with both emails
  - Verify correlation ID in error display
- [ ] UAT: Email/password still works (regression test)
  - Accept invitation via email/password
  - Verify flow unchanged

## Success Validation Checkpoints

### Immediate Validation
- [ ] Edge Function deploys without errors
- [ ] Frontend builds without TypeScript errors
- [ ] OAuth redirect initiates from AcceptInvitationPage

### Feature Complete Validation
- [ ] New user can accept invitation via Google OAuth
- [ ] Existing user can join new org via OAuth
- [ ] Email mismatch shows error with correlation ID
- [ ] Email/password acceptance still works

### Production Validation
- [ ] Events contain auth_provider and platform fields
- [ ] Correlation ID traceable across invitation lifecycle
- [ ] No 501 errors in Edge Function logs

## Current Status

**Phase**: Phase 1 - Edge Function Migration
**Status**: ✅ IN PROGRESS
**Last Updated**: 2026-01-09
**Next Step**: Update UserCredentials interface in accept-invitation Edge Function
