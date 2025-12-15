# Implementation Plan: Invitation Acceptance UX

## Plan Status: PHASE 2+ DEFERRED

**Last Updated**: 2025-12-15
**Phase 1**: ✅ COMPLETE - Research & bug fixes done
**Phase 2-5**: ⏸️ DEFERRED - Multi-org user scenario needs more design thought

**Immediate Next Steps** (when resuming):
1. Design multi-org user flow (user in Org A invited to Org B)
2. Decide if OAuth acceptance is priority before multi-org support
3. Consider simpler MVP: Just fix OAuth 501 without existing user detection

---

## Executive Summary

This feature improves the first-time user experience when accepting an organization invitation. The current implementation requires users to manually select their authentication method (email/password vs Google OAuth). The enhanced UX will auto-detect SSO providers based on email domain while allowing manual override, properly handle existing users (login vs. create account), and ignore any current session state to focus solely on the invited email.

The goal is to create a frictionless onboarding experience that guides users through account creation or login based on their invitation context, not their browser's current authentication state.

## Phase 1: Research & Analysis

### 1.1 Current Implementation Review
- Document existing AcceptInvitationPage flow
- Map Edge Function behavior (validate-invitation, accept-invitation)
- Identify gaps between current and desired UX
- Expected outcome: Clear understanding of what exists vs. what's needed

### 1.2 User Testing
- Test invitation acceptance flow with real invitations
- Document actual behavior vs. expected behavior
- Identify edge cases (existing user, Google session conflicts)
- Expected outcome: Validated understanding of current UX issues

## Phase 2: Design UX Flow

### 2.1 Define User Journeys
- New user with unknown email domain → Create account (email/password default)
- New user with recognized SSO domain → Create account (SSO pre-selected, override allowed)
- Existing user → Login to link to new organization
- Expected outcome: Complete journey maps for all scenarios

### 2.2 Wireframe/Design
- Mock acceptance page states
- SSO detection UI with manual override
- "Already have an account?" login flow
- Error states and edge cases
- Expected outcome: Approved designs for implementation

## Phase 3: Backend Implementation

### 3.1 Email Existence Check
- Add Edge Function or RPC to check if email exists in Supabase Auth
- Return user status: new_user | existing_user
- Expected outcome: API to query user existence by email

### 3.2 SSO Domain Detection
- Create SSO domain configuration (database or config)
- Add domain lookup logic
- Return: detected_provider | null
- Expected outcome: Domain-to-provider mapping system

### 3.3 Update accept-invitation Edge Function
- Handle existing user case (link to org instead of create)
- Emit appropriate events for existing user joining org
- Expected outcome: Edge Function handles both new and existing users

## Phase 4: Frontend Implementation

### 4.1 Update AcceptInvitationPage
- Remove dependence on current session state
- Add email existence check on token validation
- Implement SSO auto-detection with override
- Add "login to accept" flow for existing users
- Expected outcome: Refactored page with new UX flows

### 4.2 Update ViewModel
- Add computed properties for user status, detected SSO
- Handle login-to-accept flow state
- Manage SSO override selection
- Expected outcome: InvitationAcceptanceViewModel supports all flows

## Phase 5: Testing & Validation

### 5.1 Unit Tests
- ViewModel tests for all user journeys
- Edge Function tests for existing user handling
- SSO detection logic tests
- Expected outcome: Comprehensive unit test coverage

### 5.2 E2E Tests
- New user with email/password
- New user with Google OAuth
- New user with SSO auto-detect
- Existing user login-to-accept
- Expected outcome: Playwright tests for all flows

## Success Metrics

### Immediate
- [x] Invitation acceptance works for new users (email/password) ✅ DONE
- [ ] Invitation acceptance works for new users (Google OAuth) - Returns 501
- [x] Page ignores current session state ✅ DONE (by design)

### Medium-Term
- [ ] SSO auto-detection shows correct provider based on email domain
- [ ] Users can override SSO suggestion
- [ ] Existing users can login and link to new organization

### Long-Term
- [ ] Reduced support tickets for invitation issues
- [ ] High completion rate for invitation acceptance
- [ ] Clean audit trail in domain_events

## Risk Mitigation

| Risk | Mitigation |
|------|------------|
| Google session confusion | Ignore current session; validate OAuth email against invitation |
| Existing user creates duplicate | Check email existence before showing create form |
| SSO domain detection wrong | Allow manual override; keep email/password as fallback |
| Edge Function complexity | Thorough testing; maintain backward compatibility |

## Next Steps After Completion

1. Enterprise SSO (SAML 2.0) integration for corporate domains
2. Multi-organization user dashboard
3. Invitation management UI for org admins
