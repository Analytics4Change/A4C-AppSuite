---
status: current
last_updated: 2026-04-24
---

<!-- TL;DR-START -->
## TL;DR

**Summary**: Edge Function API reference for user lifecycle operations: deactivate, reactivate, delete, and role modification. All operations emit domain events for CQRS projection updates. Notification preferences updates were extracted to `api.update_user_notification_preferences` SQL RPC (2026-04-24, first Edge→RPC extraction per [adr-edge-function-vs-sql-rpc.md](../../../architecture/decisions/adr-edge-function-vs-sql-rpc.md)).

**When to read**:
- Implementing user management UI (deactivate/reactivate/delete users)
- Modifying user roles programmatically
- Understanding permission requirements for user operations
- Troubleshooting user management API calls

**Prerequisites**:
- [frontend-auth-architecture.md](../../../architecture/authentication/frontend-auth-architecture.md) - JWT custom claims
- [rbac-architecture.md](../../../architecture/authorization/rbac-architecture.md) - Permission model

**Key topics**: `manage-user`, `edge-function`, `user-lifecycle`, `role-modification`, `user-deactivation`

**Estimated read time**: 8 minutes
<!-- TL;DR-END -->

# manage-user Edge Function

## Overview

The `manage-user` Edge Function is the **command** entry point for all user lifecycle operations. It follows the CQRS pattern:

- **Commands** (writes): Through this Edge Function
- **Queries** (reads): Through `api.` schema RPC functions (e.g., `api.list_users()`)

All operations emit domain events that are processed by event handlers to update CQRS projections.

## Endpoint

```
POST https://<project-ref>.supabase.co/functions/v1/manage-user
```

## Authentication

**Required**: Bearer token with JWT custom claims

```typescript
const { data, error } = await supabase.functions.invoke('manage-user', {
  body: { operation: '...', userId: '...' }
});
```

The Edge Function extracts authorization context from JWT custom claims:
- `org_id` - Organization context (SECURITY CRITICAL - never from request body)
- `permissions` - Array of permission strings

## Operations

### 1. Deactivate User

Deactivates an active user within the organization.

**Permission Required**: `user.update`

**Request**:
```typescript
{
  operation: 'deactivate',
  userId: string,      // Target user UUID
  reason?: string      // Optional audit reason
}
```

**Event Emitted**: `user.deactivated`

**Validation Rules**:
- Target user must exist in the organization
- Target user must be active
- Cannot deactivate yourself

---

### 2. Reactivate User

Reactivates a deactivated user.

**Permission Required**: `user.update`

**Request**:
```typescript
{
  operation: 'reactivate',
  userId: string,
  reason?: string
}
```

**Event Emitted**: `user.reactivated`

**Validation Rules**:
- Target user must exist in the organization
- Target user must be deactivated

---

### 3. Delete User

Permanently deletes a deactivated user (soft-delete via `deleted_at` timestamp).

**Permission Required**: `user.delete`

**Request**:
```typescript
{
  operation: 'delete',
  userId: string,
  reason?: string
}
```

**Event Emitted**: `user.deleted`

**Validation Rules**:
- Target user must exist in the organization
- Target user must be deactivated first (cannot delete active users)
- Cannot delete yourself

---

### 4. Modify Roles

Add and/or remove roles for a user.

**Permission Required**: `user.role_assign`

**Request**:
```typescript
{
  operation: 'modify_roles',
  userId: string,
  roleIdsToAdd?: string[],      // Role UUIDs to assign
  roleIdsToRemove?: string[],   // Role UUIDs to revoke
  reason?: string
}
```

**Events Emitted**:
- `user.role.assigned` (one per role added)
- `user.role.revoked` (one per role removed)

**Validation Rules**:
- At least one of `roleIdsToAdd` or `roleIdsToRemove` must be provided
- Target user must be active (cannot modify roles for deactivated users)
- Roles are validated via `validate_role_assignment()` RPC

---

### 5. Update Notification Preferences — *Extracted (2026-04-24)*

> **Moved to SQL RPC.** This operation was extracted from the `manage-user` Edge
> Function into `api.update_user_notification_preferences` per
> [adr-edge-function-vs-sql-rpc.md](../../../architecture/decisions/adr-edge-function-vs-sql-rpc.md).
> The RPC is the new canonical path; the Edge Function no longer accepts
> `operation: 'update_notification_preferences'` (removed in `DEPLOY_VERSION`
> `v12-post-notification-prefs-extraction`).
>
> Frontend callers use `SupabaseUserCommandService.updateNotificationPreferences`
> which now calls `supabase.schema('api').rpc('update_user_notification_preferences', ...)`.
> The AsyncAPI event contract (`user.notification_preferences.updated`) is
> unchanged; only the emit path moved.
>
> Reference migration: `infrastructure/supabase/supabase/migrations/20260424194102_add_update_user_notification_preferences_rpc.sql`.

## Response Format

**Success Response** (HTTP 200):
```typescript
{
  success: true,
  userId: string,
  operation: string
}
```

**Error Response** (HTTP 4xx/5xx):
```typescript
{
  error: string,           // Human-readable error message
  code?: string,           // Error code (e.g., 'PERMISSION_DENIED')
  correlationId?: string   // For support/debugging
}
```

## Error Codes

| HTTP Status | Error | Description |
|-------------|-------|-------------|
| 400 | Missing operation | No `operation` field in request |
| 400 | Invalid operation | Operation not one of supported types |
| 400 | Missing userId | No `userId` field in request |
| 400 | Cannot deactivate yourself | Self-deactivation attempted |
| 400 | User is already deactivated | Deactivate on inactive user |
| 400 | User is already active | Reactivate on active user |
| 400 | Cannot delete active user | Delete without prior deactivation |
| 401 | Missing authorization header | No Bearer token |
| 401 | Invalid or expired token | JWT validation failed |
| 403 | No organization context | JWT missing `org_id` claim |
| 403 | Permission denied | User lacks required permission |
| 404 | User not found in this organization | Target user doesn't exist in org |

## Frontend Integration

### Using SupabaseUserCommandService

The recommended way to call this Edge Function is through the service abstraction:

```typescript
// frontend/src/services/users/SupabaseUserCommandService.ts

class SupabaseUserCommandService implements IUserCommandService {

  async deactivateUser(request: DeactivateUserRequest): Promise<UserVoidResult> {
    const { data, error } = await supabase.functions.invoke('manage-user', {
      body: {
        operation: 'deactivate',
        userId: request.userId,
        reason: request.reason,
      },
    });

    if (error) {
      return this.extractEdgeFunctionError(error);
    }
    return { success: true, data };
  }

  // updateNotificationPreferences was extracted to api.update_user_notification_preferences
  // SQL RPC (2026-04-24). See adr-edge-function-vs-sql-rpc.md for the full rationale.
}
```

### Direct Invocation

```typescript
import { supabaseService } from '@/lib/supabase';

const client = supabaseService.getClient();

// For user lifecycle ops (deactivate/reactivate/delete/modify_roles):
const { data, error } = await client.functions.invoke('manage-user', {
  body: { operation: 'deactivate', userId: targetUserId },
});

// Notification preferences use the SQL RPC instead:
const { data, error } = await client
  .schema('api')
  .rpc('update_user_notification_preferences', {
    p_user_id: currentUser.id,
    p_notification_preferences: {
      email: true,
      sms: { enabled: false, phone_id: null },
      in_app: true,
    },
  });
```

## Event Flow

```
Frontend UI
    │
    ▼
manage-user Edge Function
    │
    ├─ Validate JWT (extract org_id, permissions)
    ├─ Check permission for operation
    ├─ Validate request body
    ├─ Validate target user state
    │
    ▼
api.emit_domain_event()
    │
    ▼
domain_events table (INSERT)
    │
    ▼
PostgreSQL trigger (process_domain_event)
    │
    ▼
Event handler (e.g., handle_user_notification_preferences_updated)
    │
    ▼
Projection tables updated (users_projection, etc.)
```

## Observability

All operations include full W3C Trace Context metadata in emitted events:

| Field | Description |
|-------|-------------|
| `correlation_id` | Business transaction ID (for complete lifecycle queries) |
| `trace_id` | W3C trace context ID |
| `span_id` | Current operation span |
| `session_id` | User session ID |
| `ip_address` | Client IP (audit) |
| `user_agent` | Client user agent (audit) |
| `user_id` | Actor who performed the operation |
| `reason` | Business justification |

Query events by correlation ID:
```sql
SELECT event_type, created_at, event_metadata->>'user_id' as actor
FROM domain_events
WHERE event_metadata->>'correlation_id' = '<correlation-id>'
ORDER BY created_at;
```

## Security Considerations

1. **org_id from JWT**: The organization context is ALWAYS extracted from JWT custom claims, NEVER from the request body. This prevents cross-tenant attacks.

2. **Permission enforcement**: Each operation validates the required permission from JWT claims before processing.

3. **Self-operation prevention**: Users cannot deactivate or delete themselves.

4. **Soft-delete pattern**: Delete operation requires prior deactivation, ensuring no accidental permanent deletions.

## Related Documentation

- [Edge Functions Deployment Guide](../../guides/supabase/edge-functions-deployment.md) - Deployment and configuration
- [Edge Function Tests](../../guides/supabase/EDGE_FUNCTION_TESTS.md) - Testing verification
- [Event Observability](../../guides/event-observability.md) - Tracing and metadata
- [RBAC Architecture](../../../architecture/authorization/rbac-architecture.md) - Permission model
- [Event Sourcing Overview](../../../architecture/data/event-sourcing-overview.md) - CQRS pattern
