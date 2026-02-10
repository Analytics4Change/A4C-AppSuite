---
status: current
last_updated: 2026-02-10
---

<!-- TL;DR-START -->
## TL;DR

**Summary**: Edge Function API reference for accepting invitations and creating user accounts with support for email/password and OAuth authentication. Handles multi-role assignment, phone numbers, notification preferences, and contact-user linking during invitation acceptance.

**When to read**:
- Implementing invitation acceptance UI
- Understanding OAuth invitation flow
- Debugging user creation from invitations
- Troubleshooting role assignment during acceptance
- Understanding contact-user linking logic
- Implementing phone and preference setup on acceptance

**Prerequisites**:
- [oauth-invitation-acceptance.md](../../../architecture/authentication/oauth-invitation-acceptance.md) - OAuth invitation architecture
- [invitations_projection.md](../database/tables/invitations_projection.md) - Invitation data model
- [validate-invitation.md](./validate-invitation.md) - Pre-acceptance validation

**Key topics**: `accept-invitation`, `edge-function`, `user-creation`, `oauth`, `email-password`, `role-assignment`, `contact-linking`, `notification-preferences`

**Estimated read time**: 15 minutes
<!-- TL;DR-END -->

# accept-invitation Edge Function

## Overview

The `accept-invitation` Edge Function is the **command** entry point for accepting invitations and creating user accounts. It supports two authentication methods:

1. **Email/Password**: Creates new user account with password
2. **OAuth/SSO**: Links pre-authenticated OAuth user to organization

All operations emit domain events that update CQRS projections via event handlers.

## Endpoint

```
POST https://<project-ref>.supabase.co/functions/v1/accept-invitation
```

## Authentication

**OAuth Flow**: Pre-authenticated (user already signed in with OAuth provider)
**Email/Password Flow**: Unauthenticated (creates auth account)

The function validates the invitation token and creates/links the user account.

## Request Format

### Email/Password Authentication

```typescript
{
  token: string;                    // Invitation token from email
  credentials: {
    email: string;                  // Must match invitation email
    password: string;               // User's chosen password
  };
}
```

### OAuth Authentication

```typescript
{
  token: string;                    // Invitation token from email
  credentials: {
    email: string;                  // Must match invitation email
    authMethod: {
      type: 'oauth';
      provider: 'google' | 'github' | 'facebook' | 'apple' | 'azure' | 'okta' | 'keycloak';
    };
    authenticatedUserId: string;    // UUID from OAuth provider sign-in
  };
  platform?: 'web' | 'ios' | 'android';  // Optional platform identifier
}
```

### SSO Authentication

```typescript
{
  token: string;
  credentials: {
    email: string;
    authMethod: {
      type: 'sso';
      config: {
        type: 'saml';
        domain: string;             // e.g., 'acme.com'
      };
    };
    authenticatedUserId: string;
  };
  platform?: 'web' | 'ios' | 'android';
}
```

## Response Format

**Success Response** (HTTP 200):
```typescript
{
  success: true;
  userId: string;                   // Created/linked user UUID
  orgId: string;                    // Organization ID
  redirectUrl: string;              // Tenant subdomain or org path
}
```

**Error Response** (HTTP 4xx/5xx):
```typescript
{
  success: false;
  error: string;                    // Human-readable error message
  details?: string;                 // Additional error context
}
```

## Validation Rules

### Pre-Flight Validation

1. **Token Required**: Request must include valid `token` field
2. **Credentials Required**: Request must include `credentials` object
3. **Auth Method Required**: Either `password` OR `authMethod` must be provided

### Invitation Validation

1. **Token Valid**: Invitation with token must exist
2. **Not Expired**: `expires_at` must be in the future
3. **Not Accepted**: `accepted_at` must be null
4. **Email Match** (OAuth only): OAuth user email must match invitation email (case-insensitive)

### Role Validation

1. **Role ID Required**: All roles must be resolved to `role_id` (NOT NULL in projection)
2. **Role Exists**: Role lookup via `get_role_by_name()` must succeed
3. **Failure Fatal**: Role lookup failure blocks invitation acceptance

## Process Flow

### Email/Password Flow

```
1. Validate invitation token
   ├─ Check expiration
   └─ Check not already accepted

2. Create Supabase Auth user
   ├─ Email: invitation.email
   ├─ Password: credentials.password
   ├─ Auto-confirm email (trusted invitation)
   └─ User metadata: organization_id, invited_via

3. Emit user.created event
   ├─ Stream ID: user_id
   ├─ Stream Type: 'user'
   ├─ Event data: user details + auth_method='email_password'
   └─ Triggers: Users projection handler

4. Emit contact.user.linked event (if contact_id exists)
   ├─ Stream ID: contact_id
   ├─ Stream Type: 'contact'
   └─ Links contact to user account

5. Emit user.role.assigned events
   ├─ One event per role in invitation.roles
   ├─ Resolve role_id via get_role_by_name()
   └─ Triggers: User roles projection handler

6. Emit user.phone.added events
   ├─ One event per phone in invitation.phones
   └─ Triggers: User phones handler

7. Emit user.notification_preferences.updated
   ├─ Email, SMS, in-app preferences
   ├─ Auto-select SMS phone if enabled
   └─ Triggers: Notification preferences handler

8. Emit invitation.accepted event
   ├─ Stream ID: invitation_id
   ├─ Stream Type: 'invitation'
   └─ Triggers: Invitation projection handler

9. Build redirect URL
   ├─ Tenant subdomain (if verified)
   └─ Or org ID path (fallback)
```

### OAuth/SSO Flow

```
1. Validate invitation token
   (same as email/password)

2. Verify authenticated user exists
   ├─ Lookup via admin.getUserById()
   └─ Validate email matches invitation

3. Check if existing user (Sally scenario)
   ├─ Query user_roles_projection for ANY org
   └─ Skip user.created if has existing roles

4. Emit user.created event (new users only)
   ├─ Stream ID: user_id
   ├─ Auth method: 'oauth' or 'sso'
   ├─ Provider: 'google', 'saml', etc.
   ├─ Platform: 'web', 'ios', 'android'
   └─ Skip if user has roles in other orgs

5. Continue with steps 4-9 from email/password flow
   (contact linking, roles, phones, prefs, acceptance)
```

## Domain Events Emitted

### 1. user.created

**Stream ID**: `user_id`
**Stream Type**: `'user'`

**Event Data** (Email/Password):
```typescript
{
  user_id: string;
  email: string;
  first_name: string;
  last_name: string;
  organization_id: string;
  invited_via: 'organization_bootstrap';
  auth_method: 'email_password';
  contact_id?: string;              // If user is also a contact
}
```

**Event Data** (OAuth/SSO):
```typescript
{
  user_id: string;
  email: string;
  first_name: string;
  last_name: string;
  organization_id: string;
  invited_via: 'organization_bootstrap';
  auth_method: 'oauth' | 'sso';
  auth_provider: 'google' | 'saml' | ...;
  platform: 'web' | 'ios' | 'android';
  contact_id?: string;
}
```

**Handler**: `handle_user_created()` → Populates `users_projection`

---

### 2. contact.user.linked

**Condition**: Only emitted if `invitation.contact_id` exists

**Stream ID**: `contact_id`
**Stream Type**: `'contact'`

**Event Data**:
```typescript
{
  contact_id: string;
  user_id: string;
  organization_id: string;
  linked_reason: 'User accepted invitation for contact email';
}
```

**Handler**: `handle_contact_user_linked()` → Links contact to user account

---

### 3. user.role.assigned

**Stream ID**: `user_id`
**Stream Type**: `'user'`

**Event Data** (one event per role):
```typescript
{
  user_id: string;
  role_id: string;                  // Resolved via get_role_by_name()
  role_name: string;
  org_id: string;
  scope_path: null;                 // Organization-level scope
}
```

**Handler**: `handle_user_role_assigned()` → Populates `user_roles_projection`

---

### 4. user.phone.added

**Stream ID**: `user_id`
**Stream Type**: `'user'`

**Event Data** (one event per phone):
```typescript
{
  phone_id: string;                 // Generated UUID
  user_id: string;
  org_id: null;                     // Global phone, not org-specific
  label: string;                    // e.g., 'Mobile', 'Work'
  type: 'mobile' | 'office' | 'fax' | 'emergency';
  number: string;
  country_code: string;             // Default: '+1'
  is_primary: boolean;
  is_active: true;
  sms_capable: boolean;
}
```

**Handler**: `handle_user_phone_added()` → Populates `user_phones`

---

### 5. user.notification_preferences.updated

**Stream ID**: `user_id`
**Stream Type**: `'user'`

**Event Data**:
```typescript
{
  user_id: string;
  org_id: string;
  notification_preferences: {
    email: boolean;
    sms: {
      enabled: boolean;
      phoneId: string | null;       // Auto-selected if not specified
    };
    inApp: boolean;
  };
}
```

**Handler**: `handle_user_notification_preferences_updated()` → Populates `user_notification_preferences_projection`

---

### 6. invitation.accepted

**Stream ID**: `invitation_id`
**Stream Type**: `'invitation'`

**Event Data**:
```typescript
{
  invitation_id: string;
  org_id: string;
  user_id: string;
  email: string;
  role: string;                     // Legacy single role (deprecated)
  accepted_at: string;              // ISO timestamp
}
```

**Handler**: `handle_invitation_accepted()` → Updates `invitations_projection.accepted_at`

## OAuth Invitation Acceptance Flow

### Frontend Flow

```typescript
// 1. User clicks invitation link
const token = new URLSearchParams(window.location.search).get('token');

// 2. Validate invitation
const { data: validation } = await supabase.functions.invoke('validate-invitation', {
  body: { token }
});

// 3. User selects OAuth provider
if (validation.valid) {
  // Initiate OAuth sign-in
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo: `${window.location.origin}/accept-invitation?token=${token}`
    }
  });
}

// 4. After OAuth redirect, accept invitation
const session = await supabase.auth.getSession();
if (session?.user) {
  const { data } = await supabase.functions.invoke('accept-invitation', {
    body: {
      token,
      credentials: {
        email: session.user.email,
        authMethod: { type: 'oauth', provider: 'google' },
        authenticatedUserId: session.user.id
      },
      platform: 'web'
    }
  });

  // 5. Redirect to tenant or org dashboard
  window.location.href = data.redirectUrl;
}
```

### Email Mismatch Handling

If OAuth user email doesn't match invitation email:

```typescript
{
  error: 'Email mismatch',
  message: 'Your google account (alice@example.com) doesn\'t match the invitation email (bob@example.com). Please sign in with the correct account.',
  correlationId: '...'
}
```

**Status Code**: 400 Bad Request

## Sally Scenario (Multi-Org User)

**Sally**: User with active role in Org A accepts invitation to Org B.

**Behavior**:
- `user.created` event **skipped** (user already exists in system)
- `user.role.assigned` events **emitted** (new org role)
- `invitation.accepted` event **emitted**
- Sally can now access both Org A and Org B

**Detection Logic**:
```typescript
const { data: existingRoles } = await supabase
  .from('user_roles_projection')
  .select('id')
  .eq('user_id', userId)
  .limit(1);

const isExistingUser = existingRoles && existingRoles.length > 0;
if (!isExistingUser) {
  // Emit user.created
}
```

## Redirect URL Logic

### Tenant Subdomain (Preferred)

If organization has verified subdomain:
```
https://{org.slug}.{PLATFORM_BASE_DOMAIN}/dashboard
```

**Requirements**:
- `organizations_projection.slug` is set
- `organizations_projection.subdomain_status = 'verified'`
- `PLATFORM_BASE_DOMAIN` env var configured

**Example**: `https://acme.a4c.app/dashboard`

### Organization Path (Fallback)

If subdomain not verified:
```
/organizations/{organization_id}/dashboard
```

**Example**: `/organizations/550e8400-e29b-41d4-a716-446655440000/dashboard`

## Error Codes

| HTTP Status | Error | Description |
|-------------|-------|-------------|
| 400 | Missing token | No `token` field in request |
| 400 | Missing credentials | No `credentials` object in request |
| 400 | Missing password or authMethod | Neither password nor authMethod provided |
| 400 | Invitation has expired | Token valid but past `expires_at` |
| 400 | Invitation has already been accepted | Token valid but `accepted_at` is set |
| 400 | Email mismatch | OAuth user email ≠ invitation email |
| 400 | Authentication required | OAuth flow but no `authenticatedUserId` |
| 400 | role_lookup_failed | Cannot resolve role name to role_id |
| 404 | Invitation not found | Invalid or non-existent token |
| 500 | Failed to create user account | Supabase Auth error |
| 500 | Failed to emit event | Domain event emission failed |

## Business-Scoped Correlation ID

The Edge Function uses the **stored correlation ID** from the invitation for lifecycle tracing:

```typescript
// Override request correlation_id with stored value
if (invitation.correlation_id) {
  correlationId = invitation.correlation_id;
  tracingContext = { ...tracingContext, correlationId };
}
```

**Lifecycle Trace**:
```sql
SELECT event_type, created_at, event_metadata->>'user_id' as actor
FROM domain_events
WHERE event_metadata->>'correlation_id' = '<stored-correlation-id>'
ORDER BY created_at;
```

**Result**:
```
user.invited           → 2025-01-10 10:00:00
invitation.resent      → 2025-01-11 15:30:00
user.created           → 2025-01-12 09:15:00
user.role.assigned     → 2025-01-12 09:15:01
invitation.accepted    → 2025-01-12 09:15:02
```

All events tied to same `correlation_id` for complete audit trail.

## Idempotency

The Edge Function handles partial failures gracefully:

### User Already Exists

If user creation succeeds but event emission fails, subsequent retry will:
1. Look up existing user by email
2. Skip user creation
3. Emit events for role assignment
4. Complete invitation acceptance

**Implementation**:
```typescript
if (createError.message?.includes('already been registered')) {
  const { data: existingUsers } = await supabase.auth.admin.listUsers();
  const existingUser = existingUsers.users.find(u => u.email === invitation.email);
  if (existingUser) {
    userId = existingUser.id;
    // Continue with role assignment...
  }
}
```

### Event Emission Failure

Event handlers are idempotent via projection logic:
- `user.created` → Upserts `users_projection`
- `user.role.assigned` → Inserts with `ON CONFLICT DO NOTHING`
- `invitation.accepted` → Updates `accepted_at` (idempotent)

Safe to retry entire acceptance flow.

## Frontend Integration

### Using Service Abstraction

```typescript
// frontend/src/services/invitations/SupabaseInvitationService.ts

class SupabaseInvitationService implements IInvitationService {

  async acceptInvitation(request: AcceptInvitationRequest): Promise<AcceptInvitationResult> {
    const { data, error } = await supabase.functions.invoke('accept-invitation', {
      body: {
        token: request.token,
        credentials: {
          email: request.credentials.email,
          password: request.credentials.password,
          authMethod: request.credentials.authMethod,
          authenticatedUserId: request.credentials.authenticatedUserId,
        },
        platform: request.platform,
      },
    });

    if (error) {
      return {
        success: false,
        error: error.message,
      };
    }

    return {
      success: true,
      userId: data.userId,
      orgId: data.orgId,
      redirectUrl: data.redirectUrl,
    };
  }
}
```

### Direct Invocation

```typescript
import { supabaseService } from '@/lib/supabase';

const client = supabaseService.getClient();

// Email/password acceptance
const { data, error } = await client.functions.invoke('accept-invitation', {
  body: {
    token: invitationToken,
    credentials: {
      email: 'user@example.com',
      password: 'securePassword123',
    },
  },
});

// OAuth acceptance
const session = await client.auth.getSession();
const { data, error } = await client.functions.invoke('accept-invitation', {
  body: {
    token: invitationToken,
    credentials: {
      email: session.data.session?.user.email,
      authMethod: { type: 'oauth', provider: 'google' },
      authenticatedUserId: session.data.session?.user.id,
    },
    platform: 'web',
  },
});

if (!error) {
  window.location.href = data.redirectUrl;
}
```

## Event Processing Flow

```
accept-invitation Edge Function
    │
    ├─ Validate invitation token
    ├─ Create/verify user account
    │
    ▼
api.emit_domain_event() × 6 event types
    │
    ▼
domain_events table (6 INSERTs)
    │
    ▼
process_domain_event() trigger (BEFORE INSERT)
    │
    ├─ process_user_event()
    │   ├─ handle_user_created()
    │   ├─ handle_user_role_assigned() × N roles
    │   ├─ handle_user_phone_added() × N phones
    │   └─ handle_user_notification_preferences_updated()
    │
    ├─ process_contact_event()
    │   └─ handle_contact_user_linked()
    │
    └─ process_invitation_event()
        └─ handle_invitation_accepted()
    │
    ▼
Projection tables updated
    ├─ users_projection
    ├─ user_roles_projection
    ├─ user_phones
    ├─ user_notification_preferences_projection
    ├─ contacts_projection (if linked)
    └─ invitations_projection
```

## Security Considerations

1. **Email Auto-Confirm**: Email confirmation bypassed for invited users (trusted invitation flow)

2. **Token Validation**: Cryptographically secure 256-bit tokens prevent guessing

3. **Email Verification** (OAuth): OAuth user email must match invitation email exactly

4. **Organization Context**: Organization ID from invitation token, NOT request body

5. **Role Validation**: Role assignments validated against organization role definitions

6. **Idempotent Events**: Safe to retry acceptance without creating duplicate users/roles

## Observability

All events include full W3C Trace Context metadata:

| Field | Description |
|-------|-------------|
| `correlation_id` | Business transaction ID (from invitation storage) |
| `trace_id` | W3C trace context ID |
| `span_id` | Current operation span |
| `user_id` | Created/linked user UUID |
| `organization_id` | Target organization |
| `automated` | Always `true` (system-initiated) |

**Query Full Acceptance Flow**:
```sql
SELECT event_type, stream_type, created_at,
       event_data->>'user_id' as user_id,
       event_data->>'role_name' as role_name
FROM domain_events
WHERE event_metadata->>'correlation_id' = '<correlation-id>'
  AND created_at >= '2025-01-12 09:15:00'
ORDER BY created_at;
```

## Related Documentation

- **[OAuth Invitation Acceptance](../../../architecture/authentication/oauth-invitation-acceptance.md)** - Architecture and flow diagrams
- **[Event-Driven Architecture](../../guides/supabase/docs/EVENT-DRIVEN-ARCHITECTURE.md)** - Backend event sourcing specification
- **[invitations_projection Table](../database/tables/invitations_projection.md)** - Invitation data model
- **[validate-invitation Edge Function](./validate-invitation.md)** - Pre-acceptance validation
- **[invite-user Edge Function](./invite-user.md)** - Invitation creation flow
- **[user_roles_projection Table](../database/tables/user_roles_projection.md)** - Role assignment model
