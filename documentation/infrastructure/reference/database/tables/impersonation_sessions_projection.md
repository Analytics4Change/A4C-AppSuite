---
status: current
last_updated: 2025-12-30
---

<!-- TL;DR-START -->
## TL;DR

**Summary**: CQRS projection tracking user impersonation sessions. Records when super admins temporarily act as other users for support purposes. Provides complete audit trail including justification, duration, and session lifecycle.

**When to read**:
- Understanding impersonation audit requirements
- Building impersonation session management
- Querying impersonation history for compliance
- Implementing session expiration logic

**Prerequisites**: [users](./users.md), [organizations_projection](./organizations_projection.md)

**Key topics**: `impersonation`, `audit-trail`, `super-admin`, `session-management`, `compliance`

**Estimated read time**: 10 minutes
<!-- TL;DR-END -->

# impersonation_sessions_projection

## Overview

CQRS projection table that tracks user impersonation sessions. When a super admin needs to temporarily act as another user for support or troubleshooting, this table records the complete audit trail including who impersonated whom, why, for how long, and what actions were taken.

> **Note**: The impersonation feature infrastructure is scaffolded but the end-to-end flow is NOT fully functional. The frontend UI uses mock data for user selection, and JWT claims are not actually swapped during impersonation.

## Table Schema

| Column | Type | Nullable | Default | Description |
|--------|------|----------|---------|-------------|
| id | uuid | NO | gen_random_uuid() | Primary key |
| session_id | text | NO | - | Unique session identifier |
| super_admin_user_id | uuid | NO | - | User ID of the impersonating admin |
| super_admin_email | text | NO | - | Email of the impersonating admin |
| target_user_id | uuid | NO | - | User ID being impersonated |
| target_email | text | NO | - | Email being impersonated |
| target_org_id | uuid | NO | - | Organization of target user |
| justification_reason | text | NO | - | Required reason for impersonation |
| status | text | NO | - | Session status |
| started_at | timestamptz | NO | - | Session start time |
| expires_at | timestamptz | NO | - | Session expiration time |
| ended_at | timestamptz | YES | - | Actual end time |
| renewal_count | integer | NO | 0 | Number of session renewals |
| created_at | timestamptz | YES | now() | Record creation timestamp |
| updated_at | timestamptz | YES | now() | Record update timestamp |
| duration_ms | integer | YES | - | Session duration in milliseconds |
| total_duration_ms | integer | NO | 0 | Total duration including renewals |
| actions_performed | integer | NO | 0 | Count of actions during session |
| ended_reason | text | YES | - | Reason session ended |
| ended_by_user_id | uuid | YES | - | Who ended the session |
| ip_address | text | YES | - | Client IP address |
| user_agent | text | YES | - | Client user agent |
| justification_details | text | YES | - | Extended justification text |

### Column Details

#### session_id

- **Type**: `text`
- **Purpose**: Unique identifier for the impersonation session
- **Format**: UUID or similar unique string
- **Usage**: Used for session lookup and Redis cache synchronization

#### status

- **Type**: `text` with CHECK constraint
- **Purpose**: Tracks session lifecycle
- **Values**:
  - `active` - Session currently in progress
  - `ended` - Session manually ended
  - `expired` - Session timed out
- **Constraint**: `CHECK (status IN ('active', 'ended', 'expired'))`

#### justification_reason

- **Type**: `text`
- **Purpose**: Required audit field documenting why impersonation was needed
- **Constraint**: NOT NULL - impersonation cannot proceed without justification
- **Examples**: "Customer support ticket #1234", "Investigating reported bug"

#### ended_reason

- **Type**: `text`
- **Purpose**: Documents how/why the session ended
- **Values**: "user_logout", "timeout", "admin_terminated", "target_user_action"

## Relationships

### Foreign Key References

- **users** → `super_admin_user_id` - The admin performing impersonation
- **users** → `target_user_id` - The user being impersonated
- **users** → `ended_by_user_id` - Who ended the session (if not automatic)
- **organizations_projection** → `target_org_id` - Target user's organization

## Security Considerations

### Access Control

- Only super admins can start impersonation sessions
- Cannot impersonate other super admins
- Sessions have mandatory time limits (default 30 minutes)
- All sessions are logged for compliance

### Blocked Actions During Impersonation

The following actions are blocked during impersonation:
- `users.impersonate` - Cannot chain impersonation
- `global_roles.create` - Too dangerous
- `provider.delete` - Too dangerous
- `cross_org.grant` - Too dangerous

## Query Functions

### get_impersonation_session_details(session_id)

Returns session details for Redis cache synchronization:

```sql
SELECT * FROM get_impersonation_session_details('session-id-here');
```

### get_org_impersonation_audit(org_id, start_date, end_date)

Returns impersonation audit trail for an organization:

```sql
SELECT * FROM get_org_impersonation_audit(
  'org-uuid-here',
  now() - interval '30 days',
  now()
);
```

### get_user_active_impersonation_sessions(user_id)

Returns all active sessions for a user (as admin or target):

```sql
SELECT * FROM get_user_active_impersonation_sessions('user-uuid-here');
```

### is_impersonation_session_active(session_id)

Checks if a session is currently active and not expired:

```sql
SELECT is_impersonation_session_active('session-id-here');
```

## Event Processing

This table is updated by `process_impersonation_event()` in response to:

- **`impersonation.started`**: Creates new session record
- **`impersonation.renewed`**: Extends expiration, increments renewal_count
- **`impersonation.ended`**: Sets ended_at, status, ended_reason
- **`impersonation.action_logged`**: Increments actions_performed

## Usage Examples

### Query Active Sessions

```sql
SELECT
  super_admin_email,
  target_email,
  justification_reason,
  started_at,
  expires_at
FROM impersonation_sessions_projection
WHERE status = 'active'
  AND expires_at > now();
```

### Query Session History for Compliance

```sql
SELECT
  super_admin_email,
  target_email,
  target_org_id,
  justification_reason,
  started_at,
  ended_at,
  total_duration_ms / 1000 / 60 AS duration_minutes,
  actions_performed
FROM impersonation_sessions_projection
WHERE started_at >= now() - interval '90 days'
ORDER BY started_at DESC;
```

### Query by Target Organization

```sql
SELECT *
FROM impersonation_sessions_projection
WHERE target_org_id = 'org-uuid-here'
ORDER BY started_at DESC;
```

## Related Documentation

- [Impersonation Architecture](../../../../architecture/authentication/impersonation-architecture.md) - Design overview
- [Impersonation Security Controls](../../../../architecture/authentication/impersonation-security-controls.md) - Security details
- [users](./users.md) - User table reference
- [Event Sourcing Overview](../../../../architecture/data/event-sourcing-overview.md) - CQRS pattern
