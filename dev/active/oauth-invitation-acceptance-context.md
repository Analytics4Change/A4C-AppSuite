# Context: OAuth Invitation Acceptance

## Decision Record

**Date**: 2026-01-09
**Feature**: OAuth Invitation Acceptance
**Goal**: Enable users to accept organization invitations via OAuth providers (starting with Google) instead of requiring email/password.

### Key Decisions

1. **OAuth-First Flow Pattern**: Use browser redirect flow (like LoginPage) instead of direct Edge Function calls. Store invitation context in sessionStorage before OAuth redirect, then complete in AuthCallback.

2. **Generic Provider Design**: Implement `AuthMethod` discriminated union supporting OAuth, SSO, and email/password. Not hardcoded to Google - supports future providers.

3. **No Backward Compatibility**: Since this is an unreleased application, migrate entirely from legacy `oauth: 'google'` format to `authMethod: { type: 'oauth', provider }` object format. No dual format support.

4. **ViewModel Pattern**: OAuth initiation logic lives in `InvitationAcceptanceViewModel.acceptWithOAuth()`, not in page component. Follows MVVM pattern per frontend/CLAUDE.md.

5. **Business-Scoped Correlation ID**: Frontend does NOT generate new correlation ID for OAuth callback. Edge Function reuses the stored `correlation_id` from the original invitation record. This ensures complete lifecycle traceability.

6. **Tracing Headers**: Frontend sends `traceparent` and `X-Session-ID` headers, but NOT `X-Correlation-ID`. Backend extracts correlation ID from invitation record.

7. **Mobile-Ready Architecture**: Storage abstraction with `IAuthContextStorage` interface supports web (sessionStorage) and future mobile (SecureStore). Platform detection ready for deep links.

## Technical Context

### Architecture

This feature bridges the gap between the invitation system and authentication system:

```
[AcceptInvitationPage] → [sessionStorage] → [OAuth Provider] → [AuthCallback] → [Edge Function] → [Events]
```

**Flow**:
1. User clicks "Sign in with Google" on AcceptInvitationPage
2. ViewModel stores `InvitationAuthContext` in sessionStorage
3. `loginWithOAuth()` redirects to Google
4. Google authenticates and redirects to `/auth/callback`
5. AuthCallback detects invitation context, calls Edge Function with authenticated user ID
6. Edge Function verifies user, emits events, assigns role
7. Redirect to organization subdomain

### Tech Stack

- **Frontend**: React 19, TypeScript, MobX (ViewModel pattern)
- **Auth**: Supabase Auth with PKCE (handled automatically)
- **Edge Function**: Deno, Supabase Admin SDK
- **Storage**: sessionStorage (web), SecureStore (mobile - future)
- **Events**: CQRS pattern via `emit_domain_event()` RPC

### Dependencies

- `@supabase/supabase-js` - Auth client
- Supabase Edge Functions runtime
- Existing `accept-invitation` Edge Function
- Existing `emit_domain_event` RPC function
- Existing `buildEventMetadata()` utility

## File Structure

### Existing Files Modified

- `frontend/src/types/auth.types.ts` - Add AuthMethod union, InvitationAuthContext, expand OAuthProvider
- `frontend/src/types/organization.types.ts` - Replace `oauth?: 'google'` with `authMethod?: AuthMethod`
- `frontend/src/viewModels/organization/InvitationAcceptanceViewModel.ts` - Add `acceptWithOAuth()`, remove `acceptWithGoogle()`
- `frontend/src/pages/organizations/AcceptInvitationPage.tsx` - Thin component delegates to ViewModel
- `frontend/src/pages/auth/AuthCallback.tsx` - Add invitation completion with error handling + tracing
- `infrastructure/supabase/supabase/functions/accept-invitation/index.ts` - Migrate to AuthMethod format, implement OAuth handling

### New Files Created

- `frontend/src/services/storage/AuthContextStorage.ts` - Storage abstraction interface + web implementation
- `frontend/src/services/storage/index.ts` - Storage factory with platform detection
- `frontend/src/utils/platform.ts` - Platform detection + callback URL helper
- `frontend/src/config/oauth-providers.config.ts` - OAuth provider configuration
- `documentation/architecture/authentication/oauth-invitation-acceptance.md` - Architecture doc

## Related Components

- `frontend/src/services/auth/SupabaseAuthProvider.ts` - OAuth methods (`loginWithOAuth`)
- `frontend/src/pages/auth/LoginPage.tsx` - Working OAuth pattern to follow
- `frontend/src/services/users/SupabaseUserCommandService.ts` - `extractEdgeFunctionError()` utility
- `frontend/src/components/ui/ErrorWithCorrelation.tsx` - Error display component
- `frontend/src/utils/tracing.ts` - `generateTraceparent()`, `getSessionId()`
- `infrastructure/supabase/supabase/functions/_shared/emit-event.ts` - `buildEventMetadata()`

## Key Patterns and Conventions

### Error Handling Pattern
```typescript
const extracted = await extractEdgeFunctionError(error, 'Accept invitation via OAuth');
return {
  success: false,
  error: extracted.message,
  correlationId: extracted.correlationId,
};
```

### Tracing Headers Pattern
```typescript
const { header: traceparent, traceId, spanId } = generateTraceparent();
const sessionId = await getSessionId();
const headers = {
  traceparent,
  'X-Session-ID': sessionId || '',
  // NO X-Correlation-ID - backend uses stored value
};
```

### Event Metadata Pattern
```typescript
const metadata = buildEventMetadata(tracingContext, 'user.created', req, {
  user_id: userId,
  organization_id: invitation.organization_id,
  automated: true,
});
```

### AuthMethod Discriminated Union
```typescript
type AuthMethod =
  | { type: 'email_password' }
  | { type: 'oauth'; provider: OAuthProvider }
  | { type: 'sso'; config: SSOConfig };
```

## Reference Materials

- **Plan File**: `/home/lars/.claude/plans/vivid-zooming-sutherland.md`
- **Architect Review**: `/home/lars/.claude/plans/vivid-zooming-sutherland-agent-a58d26d.md`
- **Frontend Auth Architecture**: `documentation/architecture/authentication/frontend-auth-architecture.md`
- **Event Metadata Schema**: `documentation/workflows/reference/event-metadata-schema.md`
- **AGENT-GUIDELINES**: `documentation/AGENT-GUIDELINES.md`

## Important Constraints

1. **PKCE is automatic** - Supabase's `signInWithOAuth()` handles PKCE automatically, no custom implementation needed.

2. **Correlation ID preservation** - The `correlation_id` from the original invitation MUST be reused for all subsequent events. This enables lifecycle queries by correlation ID.

3. **Existing user detection** - If OAuth user already has roles in ANY organization (Sally scenario), skip `user.created` event and only emit `user.role.assigned`.

4. **TTL for context** - SessionStorage context includes `createdAt` timestamp. Context older than 10 minutes is rejected.

5. **Email match required** - OAuth account email MUST match invitation email exactly (case-insensitive). Mismatch returns clear error.

## Why This Approach?

**Why OAuth redirect flow instead of direct API call?**
OAuth requires browser redirect - the identity provider (Google) must authenticate the user directly. The Edge Function cannot initiate OAuth because it runs server-side.

**Why sessionStorage instead of URL state?**
- SessionStorage survives the OAuth redirect
- Doesn't pollute OAuth URL with custom state
- Automatically cleared when tab closes
- Mobile future: can swap implementation to SecureStore

**Why not backward compatibility?**
- Application is unreleased, no production users
- Single format is simpler to maintain
- Avoids dual-path code complexity
- Clean migration to proper discriminated union types

**Why business-scoped correlation ID?**
- Single correlation ID across entire invitation lifecycle
- Query `domain_events WHERE correlation_id = X` returns complete story
- Alternative (request-scoped) would fragment the lifecycle
