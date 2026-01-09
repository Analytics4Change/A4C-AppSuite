# Implementation Plan: OAuth Invitation Acceptance

## Executive Summary

This initiative implements OAuth-based invitation acceptance, fixing the bug where users receive "OAuth acceptance not yet implemented. Please use email/password." when accepting organization invitations via Google OAuth.

The root cause is that `AcceptInvitationPage` calls the Edge Function directly for OAuth, but OAuth requires a browser redirect flow. The solution implements a generic OAuth-first flow: store invitation context in sessionStorage, initiate OAuth redirect via `loginWithOAuth()`, complete acceptance in callback after authentication.

**Key Design Decisions**:
- Generic provider support (Google, GitHub, Facebook, Apple, EntraID, Okta, Keycloak)
- Mobile-ready with platform detection and storage abstraction
- No backward compatibility - migrate from legacy `oauth: 'google'` to `authMethod` object
- Business-scoped correlation ID (reuse from invitation, don't generate new)

## Phase 1: Edge Function Migration

**Start here** per architect recommendation - define authoritative types first.

### 1.1 Update UserCredentials Interface
- Replace `oauth?: OAuthProvider` with `authMethod?: AuthMethod`
- Add `authenticatedUserId?: string` field
- Update comment documentation

### 1.2 Update Detection Logic
- Change `!!credentials.oauth` to `credentials.authMethod?.type === 'oauth'`
- Handle SSO type as well

### 1.3 Implement OAuth Handling
- Replace 501 block with actual OAuth verification
- Verify authenticated user via `auth.admin.getUserById()`
- Email mismatch validation
- Existing user detection (Sally scenario - skip user.created)
- Emit proper events with `buildEventMetadata()`

**Expected Outcome**: Edge Function accepts new format and processes OAuth users correctly.

## Phase 2: Frontend Storage + Platform

### 2.1 Storage Abstraction
- Create `IAuthContextStorage` interface
- Implement `WebAuthContextStorage` using sessionStorage
- Stub `MobileAuthContextStorage` for React Native future

### 2.2 Platform Detection
- Create `detectPlatform()` function (web/ios/android)
- Create `getCallbackUrl()` for platform-specific URLs
- Support deep linking for mobile (`a4c://auth/callback`)

**Expected Outcome**: Platform-agnostic storage ready for OAuth context.

## Phase 3: Frontend Types

### 3.1 Auth Types
- Expand `OAuthProvider` union type
- Create `SSOConfig` interface for SAML
- Create `AuthMethod` discriminated union
- Create `InvitationAuthContext` with TTL field

### 3.2 UserCredentials Migration
- Update `organization.types.ts` to use `authMethod` instead of `oauth`
- Add `authenticatedUserId` field

**Expected Outcome**: Type safety across frontend and Edge Function.

## Phase 4: ViewModel + Page

### 4.1 ViewModel Pattern
- Add `acceptWithOAuth(provider, authProvider)` method
- Remove legacy `acceptWithGoogle()` method
- Store invitation context before redirect

### 4.2 Page Component
- Thin component delegates to ViewModel
- OAuth handler calls `viewModel.acceptWithOAuth()`

### 4.3 Provider Config
- Create `oauth-providers.config.ts`
- Define `ENABLED_OAUTH_PROVIDERS` array
- Define `PROVIDER_DISPLAY_NAMES` mapping

**Expected Outcome**: Clean MVVM pattern with OAuth initiation.

## Phase 5: AuthCallback Completion

### 5.1 Invitation Detection
- Check sessionStorage for `invitation_acceptance_context`
- Validate TTL (10 minute expiration)
- Clear context after retrieval

### 5.2 Edge Function Call
- Include tracing headers (`traceparent`, `X-Session-ID`)
- Do NOT include `X-Correlation-ID` (backend uses stored value)
- Use `extractEdgeFunctionError()` for error extraction

### 5.3 Error Display
- Use `ErrorWithCorrelation` component
- Show correlation ID for support reference
- Clear error messages with provider context

**Expected Outcome**: Complete OAuth flow with proper observability.

## Phase 6: Documentation

### 6.1 Create Architecture Doc
- `documentation/architecture/authentication/oauth-invitation-acceptance.md`
- Include TL;DR, problem statement, solution

### 6.2 Update AGENT-INDEX.md
- Add entry under Authentication section
- Include keywords: `oauth`, `invitation`, `authentication`, `correlation-id`

**Expected Outcome**: Documentation per AGENT-GUIDELINES.md standards.

## Phase 7: Deploy + Test

### 7.1 Deploy Edge Function
- Deploy `accept-invitation` Edge Function
- Verify in Supabase dashboard

### 7.2 Build + Deploy Frontend
- Build frontend with new OAuth flow
- Deploy to k3s cluster

### 7.3 UAT Verification
- Test new user OAuth acceptance
- Test existing user (Sally scenario)
- Test email mismatch error
- Verify events have proper metadata

**Expected Outcome**: Feature working in production.

## Success Metrics

### Immediate
- [ ] Edge Function accepts `authMethod` format
- [ ] OAuth redirect initiates from AcceptInvitationPage
- [ ] Callback completes invitation acceptance

### Medium-Term
- [ ] New users can accept invitations via Google OAuth
- [ ] Existing users can join new orgs via OAuth
- [ ] Email mismatch shows clear error with correlation ID
- [ ] Events contain `auth_provider` and `platform` fields

### Long-Term
- [ ] Zero 501 errors for OAuth invitation acceptance
- [ ] Ready for additional OAuth providers (GitHub, etc.)
- [ ] Mobile deep linking ready for React Native

## Implementation Schedule

| Day | Phase | Activities |
|-----|-------|------------|
| 1 | Phase 1 | Edge Function migration |
| 1 | Phase 2 | Storage + platform utilities |
| 1 | Phase 3 | Frontend types |
| 2 | Phase 4 | ViewModel + Page updates |
| 2 | Phase 5 | AuthCallback completion |
| 2 | Phase 6 | Documentation |
| 3 | Phase 7 | Deploy + UAT |

## Risk Mitigation

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|------------|
| Type mismatch between frontend/backend | Medium | High | Start with Edge Function, match types exactly |
| Stale sessionStorage context | Low | Medium | TTL check (10 min), clear on error |
| Email mismatch confusion | Low | Low | Clear error with both emails shown |
| OAuth callback failure | Low | Medium | Error display with correlation ID |

## Next Steps After Completion

1. Add GitHub OAuth provider (enable in config)
2. Implement mobile deep linking when React Native ready
3. Add enterprise SSO (SAML) support
4. Consider URL state parameter as backup to sessionStorage
