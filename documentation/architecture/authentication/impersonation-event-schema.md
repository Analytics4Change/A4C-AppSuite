---
status: current
last_updated: 2025-12-30
---

<!-- TL;DR-START -->
## TL;DR

**Summary**: Event schema definitions for impersonation. Database table `impersonation_sessions_projection` exists but events are NOT being emitted - end-to-end flow NOT functional.

**When to read**:
- Implementing impersonation event emission
- Designing impersonation_sessions_projection
- Writing event processors for impersonation
- Understanding audit trail event structure

**Prerequisites**: [impersonation-architecture.md](impersonation-architecture.md), [EVENT-DRIVEN-ARCHITECTURE.md](../../infrastructure/guides/supabase/docs/EVENT-DRIVEN-ARCHITECTURE.md)

**Key topics**: `impersonation`, `events`, `cqrs`, `asyncapi`, `audit-trail`, `projection`

**Estimated read time**: 10 minutes
<!-- TL;DR-END -->

# Impersonation Event Schema

> [!WARNING]
> **Database schema exists but events NOT being emitted.**
> - ✅ `impersonation_sessions_projection` table exists
> - ✅ Query functions exist (`get_impersonation_session_details`, etc.)
> - ❌ No backend code emits `impersonation.started` or other events
> See [impersonation-architecture.md](impersonation-architecture.md) for full implementation status.


## Overview

This document defines the event schemas for impersonation lifecycle events in the A4C platform. These events follow the **CQRS/Event Sourcing architecture** and integrate with the existing event-driven infrastructure to provide comprehensive audit trails for Super Admin impersonation sessions.

### CQRS/Event Sourcing Implementation

- **AsyncAPI Contract**: Event schemas formally defined in `/infrastructure/supabase/contracts/asyncapi/domains/impersonation.yaml`
- **Event Storage**: All events stored in `domain_events` table with `stream_type = 'impersonation'`
- **Projection**: `impersonation_sessions_projection` table maintains queryable session state
- **Event Processor**: `process_impersonation_event()` function projects events to table
- **Type Generation**: Run `./scripts/generate-contracts.sh` to generate TypeScript types from AsyncAPI schemas

**Related Documents:**
- `.plans/impersonation/architecture.md` - Overall impersonation architecture (includes CQRS details)
- `/infrastructure/supabase/contracts/asyncapi/domains/impersonation.yaml` - AsyncAPI event schemas
- `/infrastructure/supabase/docs/EVENT-DRIVEN-ARCHITECTURE.md` - CQRS foundation documentation
- `/frontend/docs/EVENT-DRIVEN-GUIDE.md` - Frontend event-driven guide

---

## Event Types

All impersonation events follow the domain event pattern established in the platform:

```typescript
interface DomainEvent {
  id: string;
  streamId: string;
  streamType: StreamType;
  eventType: string;
  data: any;
  metadata: EventMetadata;
  timestamp: string;
  reason: string;
}
```

**Impersonation event types:**
1. `impersonation.started` - Session initiated
2. `impersonation.renewed` - Session extended
3. `impersonation.ended` - Session terminated

---

## impersonation.started

**Emitted when:** Super Admin initiates an impersonation session

**Stream:** Super Admin's user ID (the person doing the impersonating)

### Event Schema

```typescript
interface ImpersonationStartedEvent {
  id: string;                    // UUID
  streamId: string;              // Super Admin user ID
  streamType: 'impersonation';   // Dedicated stream type for impersonation
  eventType: 'impersonation.started';
  data: {
    sessionId: string;           // Unique session identifier
    superAdmin: {
      userId: string;            // Super Admin user ID
      email: string;             // Super Admin email
      name: string;              // Super Admin display name
      orgId: string;             // AnalyticsForChange org ID
    };
    target: {
      userId: string;            // Target user ID (being impersonated)
      email: string;             // Target user email
      name: string;              // Target user display name
      orgId: string;             // Target user's organization ID
      orgName: string;           // Target organization name
      orgType: 'provider' | 'provider_partner';  // Organization type
    };
    justification: {
      reason: 'support_ticket' | 'emergency' | 'audit' | 'training';
      referenceId?: string;      // Ticket #, incident ID, audit case #
      notes?: string;            // Optional free-text explanation
    };
    sessionConfig: {
      duration: number;          // Session duration in milliseconds
      expiresAt: string;         // ISO 8601 timestamp
    };
    ipAddress?: string;          // Super Admin IP address (optional)
    userAgent?: string;          // Browser/client info (optional)
  };
  metadata: {
    userId: string;              // Super Admin user ID
    orgId: string;               // AnalyticsForChange org ID
    timestamp: string;           // ISO 8601 timestamp
  };
  timestamp: string;             // ISO 8601 timestamp
  reason: string;                // Human-readable description
}
```

### Example: Provider User Impersonation

```json
{
  "id": "evt_9a7b3c5d-1e2f-4a6b-8c9d-0e1f2a3b4c5d",
  "streamId": "user_super_admin_123",
  "streamType": "impersonation",
  "eventType": "impersonation.started",
  "data": {
    "sessionId": "session_abc123xyz",
    "superAdmin": {
      "userId": "user_super_admin_123",
      "email": "admin@a4c.com",
      "name": "Alice Admin",
      "orgId": "org_a4c_platform"
    },
    "target": {
      "userId": "user_staff_456",
      "email": "john.doe@sunshineyouth.org",
      "name": "John Doe",
      "orgId": "org_sunshine_youth_001",
      "orgName": "Sunshine Youth Services",
      "orgType": "provider"
    },
    "justification": {
      "reason": "support_ticket",
      "referenceId": "TICKET-7890",
      "notes": "User reports medication list not loading, investigating client permissions"
    },
    "sessionConfig": {
      "duration": 1800000,
      "expiresAt": "2025-10-09T15:30:00Z"
    },
    "ipAddress": "192.168.1.100",
    "userAgent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)"
  },
  "metadata": {
    "userId": "user_super_admin_123",
    "orgId": "org_a4c_platform",
    "timestamp": "2025-10-09T15:00:00Z"
  },
  "timestamp": "2025-10-09T15:00:00Z",
  "reason": "Super Admin started impersonation session for support ticket TICKET-7890"
}
```

### Example: VAR Partner User Impersonation

**Organizational Context:**
- All Provider organizations exist at root level in Zitadel (flat structure)
- VAR Partner organizations also exist at root level (NOT hierarchical parent of Providers)
- VAR partnerships tracked in `var_partnerships_projection` table (event-sourced metadata)
- VAR access to Provider data via `cross_tenant_access_grants_projection` (NOT Zitadel hierarchy)

**Use Case:** Super Admin verifying VAR Partner dashboard shows correct Provider data

```json
{
  "id": "evt_8a6b2c4d-0e1f-3a5b-7c8d-9e0f1a2b3c4d",
  "streamId": "user_super_admin_123",
  "streamType": "impersonation",
  "eventType": "impersonation.started",
  "data": {
    "sessionId": "session_var_xyz456",
    "superAdmin": {
      "userId": "user_super_admin_123",
      "email": "admin@a4c.com",
      "name": "Alice Admin",
      "orgId": "org_a4c_platform"
    },
    "target": {
      "userId": "user_var_consultant_789",
      "email": "consultant@var-partner-xyz.com",
      "name": "Bob Consultant",
      "orgId": "org_var_partner_xyz",
      "orgName": "VAR Partner XYZ",
      "orgType": "provider_partner"
    },
    "justification": {
      "reason": "audit",
      "referenceId": "AUDIT-2025-Q4-001",
      "notes": "Verifying VAR dashboard displays correct cross-tenant Provider data and partnership metadata"
    },
    "sessionConfig": {
      "duration": 1800000,
      "expiresAt": "2025-10-09T17:00:00Z"
    },
    "ipAddress": "192.168.1.100",
    "userAgent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)"
  },
  "metadata": {
    "userId": "user_super_admin_123",
    "orgId": "org_a4c_platform",
    "timestamp": "2025-10-09T16:30:00Z"
  },
  "timestamp": "2025-10-09T16:30:00Z",
  "reason": "Super Admin started impersonation session to verify VAR Partner dashboard"
}
```

---

## impersonation.renewed

**Emitted when:** User clicks "Continue Impersonation" in renewal modal

**Stream:** Super Admin's user ID

### Event Schema

```typescript
interface ImpersonationRenewedEvent {
  id: string;                    // UUID
  streamId: string;              // Super Admin user ID
  streamType: 'impersonation';
  eventType: 'impersonation.renewed';
  data: {
    sessionId: string;           // Session identifier
    renewalCount: number;        // Number of renewals (1, 2, 3, ...)
    previousExpiresAt: string;   // Previous expiry timestamp
    newExpiresAt: string;        // New expiry timestamp
    totalDuration: number;       // Total session duration in milliseconds
    targetUserId: string;        // Target user (for query convenience)
    targetOrgId: string;         // Target org (for query convenience)
  };
  metadata: {
    userId: string;              // Super Admin user ID
    orgId: string;               // AnalyticsForChange org ID
    impersonationSessionId: string;  // Link to session
    timestamp: string;
  };
  timestamp: string;
  reason: string;
}
```

### Example

```json
{
  "id": "evt_1b2c3d4e-5f6a-7b8c-9d0e-1f2a3b4c5d6e",
  "streamId": "user_super_admin_123",
  "streamType": "impersonation",
  "eventType": "impersonation.renewed",
  "data": {
    "sessionId": "session_abc123xyz",
    "renewalCount": 1,
    "previousExpiresAt": "2025-10-09T15:30:00Z",
    "newExpiresAt": "2025-10-09T16:00:00Z",
    "totalDuration": 1800000,
    "targetUserId": "user_staff_456",
    "targetOrgId": "org_sunshine_youth_001"
  },
  "metadata": {
    "userId": "user_super_admin_123",
    "orgId": "org_a4c_platform",
    "impersonationSessionId": "session_abc123xyz",
    "timestamp": "2025-10-09T15:29:00Z"
  },
  "timestamp": "2025-10-09T15:29:00Z",
  "reason": "Impersonation session renewed (renewal #1)"
}
```

---

## impersonation.ended

**Emitted when:** Session ends (manual logout, timeout, or renewal declined)

**Stream:** Super Admin's user ID

### Event Schema

```typescript
interface ImpersonationEndedEvent {
  id: string;                    // UUID
  streamId: string;              // Super Admin user ID
  streamType: 'impersonation';
  eventType: 'impersonation.ended';
  data: {
    sessionId: string;           // Session identifier
    reason: 'manual_logout' | 'timeout' | 'renewal_declined' | 'forced_by_admin';
    totalDuration: number;       // Total session duration in milliseconds
    renewalCount: number;        // Number of renewals that occurred
    actionsPerformed: number;    // Count of events emitted during session
    targetUserId: string;        // Target user (for query convenience)
    targetOrgId: string;         // Target org (for query convenience)
    endedBy?: string;            // User ID if forced by another admin
    summary: {
      startedAt: string;         // Session start timestamp
      endedAt: string;           // Session end timestamp
      targetUser: string;        // Target user email
      targetOrg: string;         // Target org name
    };
  };
  metadata: {
    userId: string;              // Super Admin user ID
    orgId: string;               // AnalyticsForChange org ID
    impersonationSessionId: string;  // Link to session
    timestamp: string;
  };
  timestamp: string;
  reason: string;
}
```

### Example (Manual Logout)

```json
{
  "id": "evt_2c3d4e5f-6a7b-8c9d-0e1f-2a3b4c5d6e7f",
  "streamId": "user_super_admin_123",
  "streamType": "impersonation",
  "eventType": "impersonation.ended",
  "data": {
    "sessionId": "session_abc123xyz",
    "reason": "manual_logout",
    "totalDuration": 2400000,
    "renewalCount": 1,
    "actionsPerformed": 12,
    "targetUserId": "user_staff_456",
    "targetOrgId": "org_sunshine_youth_001",
    "summary": {
      "startedAt": "2025-10-09T15:00:00Z",
      "endedAt": "2025-10-09T15:40:00Z",
      "targetUser": "john.doe@sunshineyouth.org",
      "targetOrg": "Sunshine Youth Services"
    }
  },
  "metadata": {
    "userId": "user_super_admin_123",
    "orgId": "org_a4c_platform",
    "impersonationSessionId": "session_abc123xyz",
    "timestamp": "2025-10-09T15:40:00Z"
  },
  "timestamp": "2025-10-09T15:40:00Z",
  "reason": "Super Admin manually ended impersonation session after 40 minutes (1 renewal)"
}
```

### Example (Timeout)

```json
{
  "id": "evt_3d4e5f6a-7b8c-9d0e-1f2a-3b4c5d6e7f8a",
  "streamId": "user_super_admin_123",
  "streamType": "impersonation",
  "eventType": "impersonation.ended",
  "data": {
    "sessionId": "session_xyz789abc",
    "reason": "timeout",
    "totalDuration": 1800000,
    "renewalCount": 0,
    "actionsPerformed": 5,
    "targetUserId": "user_staff_789",
    "targetOrgId": "org_hope_house_002",
    "summary": {
      "startedAt": "2025-10-09T16:00:00Z",
      "endedAt": "2025-10-09T16:30:00Z",
      "targetUser": "jane.smith@hopehouse.org",
      "targetOrg": "Hope House"
    }
  },
  "metadata": {
    "userId": "user_super_admin_123",
    "orgId": "org_a4c_platform",
    "impersonationSessionId": "session_xyz789abc",
    "timestamp": "2025-10-09T16:30:00Z"
  },
  "timestamp": "2025-10-09T16:30:00Z",
  "reason": "Impersonation session timed out after 30 minutes (no renewals)"
}
```

---

## Action Events with Impersonation Metadata

**All events emitted during an impersonation session include additional metadata:**

```typescript
interface EventMetadata {
  // Standard metadata
  userId: string;                // Target user ID (performing the action)
  orgId: string;                 // Target organization ID
  timestamp: string;             // ISO 8601 timestamp

  // Impersonation metadata (when applicable)
  performedBy?: string;          // Target user ID
  impersonatedBy?: string;       // Super Admin user ID
  impersonationSessionId?: string;  // Session identifier
}
```

### Example: Client Updated During Impersonation

```json
{
  "id": "evt_4e5f6a7b-8c9d-0e1f-2a3b-4c5d6e7f8a9b",
  "streamId": "client_12345",
  "streamType": "client",
  "eventType": "client.updated",
  "data": {
    "clientId": "client_12345",
    "changes": {
      "status": "active"
    }
  },
  "metadata": {
    "userId": "user_staff_456",
    "orgId": "org_sunshine_youth_001",
    "timestamp": "2025-10-09T15:15:30Z",
    "performedBy": "user_staff_456",
    "impersonatedBy": "user_super_admin_123",
    "impersonationSessionId": "session_abc123xyz"
  },
  "timestamp": "2025-10-09T15:15:30Z",
  "reason": "Client status updated to active (via impersonation)"
}
```

---

## Event Flow Examples

### Complete Impersonation Session (No Renewals)

```
1. impersonation.started
   └─ sessionId: session_001
   └─ expiresAt: T+30min

2. client.viewed
   └─ impersonationSessionId: session_001

3. client.updated
   └─ impersonationSessionId: session_001

4. medication.viewed
   └─ impersonationSessionId: session_001

5. impersonation.ended
   └─ sessionId: session_001
   └─ reason: manual_logout
   └─ actionsPerformed: 3
```

### Extended Session (With Renewals)

```
1. impersonation.started
   └─ sessionId: session_002
   └─ expiresAt: T+30min

2-10. [Various user actions]
   └─ impersonationSessionId: session_002

11. impersonation.renewed (T+29min)
   └─ sessionId: session_002
   └─ renewalCount: 1
   └─ newExpiresAt: T+60min

12-20. [More user actions]
   └─ impersonationSessionId: session_002

21. impersonation.renewed (T+59min)
   └─ sessionId: session_002
   └─ renewalCount: 2
   └─ newExpiresAt: T+90min

22-25. [Final actions]
   └─ impersonationSessionId: session_002

26. impersonation.ended (T+75min)
   └─ sessionId: session_002
   └─ reason: manual_logout
   └─ renewalCount: 2
   └─ totalDuration: 75min
   └─ actionsPerformed: 25
```

### Session Timeout (No Manual Logout)

```
1. impersonation.started
   └─ sessionId: session_003
   └─ expiresAt: T+30min

2-8. [User actions]
   └─ impersonationSessionId: session_003

9. impersonation.ended (T+30min, server-emitted)
   └─ sessionId: session_003
   └─ reason: timeout
   └─ actionsPerformed: 7
```

---

## Integration with Existing Event Emitter

### Frontend Event Emission

```typescript
import { EventEmitter } from '@/lib/events/event-emitter';

class ImpersonationService {
  private eventEmitter: EventEmitter;

  async startImpersonation(targetUserId: string, justification: Justification) {
    const response = await api.post('/impersonation/start', {
      targetUserId,
      justification
    });

    const { session, jwt } = response.data;

    // Emit impersonation.started event
    await this.eventEmitter.emit(
      session.superAdminId,
      'impersonation',  // stream_type
      'impersonation.started',
      {
        sessionId: session.sessionId,
        superAdmin: session.superAdmin,
        target: session.target,
        justification: session.justification,
        sessionConfig: session.sessionConfig
      },
      `Super Admin started impersonation session for ${justification.reason}`
    );

    return { session, jwt };
  }

  async renewImpersonation(sessionId: string) {
    const response = await api.post('/impersonation/renew', { sessionId });
    const { session } = response.data;

    await this.eventEmitter.emit(
      session.superAdminId,
      'impersonation',  // stream_type
      'impersonation.renewed',
      {
        sessionId: session.sessionId,
        renewalCount: session.renewalCount,
        previousExpiresAt: session.previousExpiresAt,
        newExpiresAt: session.expiresAt,
        totalDuration: session.totalDuration,
        targetUserId: session.targetUserId,
        targetOrgId: session.targetOrgId
      },
      `Impersonation session renewed (renewal #${session.renewalCount})`
    );

    return session;
  }

  async endImpersonation(sessionId: string, reason: string) {
    const response = await api.post('/impersonation/end', { sessionId, reason });
    const { session } = response.data;

    await this.eventEmitter.emit(
      session.superAdminId,
      'impersonation',  // stream_type
      'impersonation.ended',
      {
        sessionId: session.sessionId,
        reason,
        totalDuration: session.totalDuration,
        renewalCount: session.renewalCount,
        actionsPerformed: session.actionsPerformed,
        targetUserId: session.targetUserId,
        targetOrgId: session.targetOrgId,
        summary: session.summary
      },
      `Impersonation session ended: ${reason}`
    );

    return session;
  }
}
```

### Backend Event Storage

Events are stored in Supabase `domain_events` table following the CQRS architecture:

**Event Store Queries (Complete History):**
```sql
-- Query all impersonation lifecycle events
SELECT * FROM domain_events
WHERE stream_type = 'impersonation'
ORDER BY created_at DESC;

-- Query specific session timeline from event store
SELECT * FROM domain_events
WHERE stream_type = 'impersonation'
  AND (
    event_data->>'session_id' = 'session_abc123xyz'
    OR event_metadata->>'impersonation_session_id' = 'session_abc123xyz'
  )
ORDER BY created_at ASC;

-- Query all sessions for a Super Admin
SELECT * FROM domain_events
WHERE stream_type = 'impersonation'
  AND stream_id = 'user_super_admin_123'::uuid
ORDER BY created_at DESC;

-- Count actions performed during a session (from event metadata)
SELECT COUNT(*) FROM domain_events
WHERE event_metadata->>'impersonation_session_id' = 'session_abc123xyz'
  AND event_type NOT LIKE 'impersonation.%';
```

**Projection Queries (Optimized for Read Performance):**
```sql
-- Query active impersonation sessions
SELECT * FROM impersonation_sessions_projection
WHERE status = 'active'
  AND expires_at > NOW()
ORDER BY started_at DESC;

-- Query specific session details
SELECT * FROM impersonation_sessions_projection
WHERE session_id = 'session_abc123xyz';

-- Get user's active impersonation sessions (helper function)
SELECT * FROM get_user_active_impersonation_sessions('user_super_admin_123'::uuid);

-- Get organization impersonation audit (helper function)
SELECT * FROM get_org_impersonation_audit(
  'org_sunshine_youth_001',
  NOW() - INTERVAL '30 days',
  NOW()
);
```

---

## Audit Report Queries

### Super Admin Activity Report

**Using Projection Table (Recommended):**
```sql
-- All impersonation sessions by Super Admin in date range
SELECT
  started_at,
  target_email as target_user,
  target_org_name as target_org,
  justification_reason as reason,
  justification_reference_id as reference,
  total_duration_ms as duration_ms,
  renewal_count,
  actions_performed,
  status
FROM impersonation_sessions_projection
WHERE super_admin_user_id = :super_admin_id
  AND started_at BETWEEN :start_date AND :end_date
ORDER BY started_at DESC;
```

**Using Event Store (Complete History):**
```sql
-- All impersonation sessions by Super Admin in date range
SELECT
  e.created_at as started_at,
  e.event_data->'target'->>'email' as target_user,
  e.event_data->'target'->>'orgName' as target_org,
  e.event_data->'justification'->>'reason' as reason,
  e.event_data->'justification'->>'referenceId' as reference,
  (SELECT event_data->>'total_duration'
   FROM domain_events
   WHERE event_type = 'impersonation.ended'
     AND stream_type = 'impersonation'
     AND event_data->>'session_id' = e.event_data->>'session_id'
  )::integer as duration_ms
FROM domain_events e
WHERE e.event_type = 'impersonation.started'
  AND e.stream_type = 'impersonation'
  AND e.stream_id = :super_admin_id
  AND e.created_at BETWEEN :start_date AND :end_date
ORDER BY e.created_at DESC;
```

### Provider Access Report

**Using Projection Table (Recommended):**
```sql
-- All Super Admin access to specific Provider org
SELECT
  started_at as accessed_at,
  super_admin_email as super_admin,
  target_email as impersonated_user,
  justification_reason as reason,
  justification_reference_id as reference,
  total_duration_ms as duration_ms,
  actions_performed as actions_count,
  renewal_count,
  status
FROM impersonation_sessions_projection
WHERE target_org_id = :provider_org_id
ORDER BY started_at DESC;
```

**Using Helper Function:**
```sql
-- All impersonation access to specific Provider org (last 30 days)
SELECT * FROM get_org_impersonation_audit(
  :provider_org_id,
  NOW() - INTERVAL '30 days',
  NOW()
);
```

### VAR Partner Cross-Tenant Access Report

**Use Case:** Track Super Admin impersonation of VAR Partner users to verify cross-tenant access

**VAR Partnership Context:**
- VAR Partner orgs are root-level (NOT hierarchical parent of Providers)
- Partnership metadata in `var_partnerships_projection` table
- Cross-tenant access via `cross_tenant_access_grants_projection` table
- During impersonation, Super Admin sees VAR dashboard aggregating multiple Provider data

**Query VAR Partner Impersonation Sessions:**
```sql
-- All Super Admin impersonation of VAR Partner users
SELECT
  ips.started_at,
  ips.super_admin_email,
  ips.target_email as var_consultant,
  ips.target_org_name as var_partner_org,
  ips.justification_reason,
  ips.justification_reference_id,
  ips.total_duration_ms,
  ips.actions_performed,
  -- Count active partnerships for this VAR at time of impersonation
  (SELECT COUNT(*)
   FROM var_partnerships_projection vp
   WHERE vp.var_org_id = ips.target_org_id
     AND vp.status = 'active'
     AND vp.contract_start_date <= ips.started_at
     AND (vp.contract_end_date IS NULL OR vp.contract_end_date >= ips.started_at)
  ) AS active_partnerships_count,
  -- Count active cross-tenant grants at time of impersonation
  (SELECT COUNT(*)
   FROM cross_tenant_access_grants_projection ctag
   WHERE ctag.consultant_org_id = ips.target_org_id
     AND ctag.authorization_type = 'var_contract'
     AND ctag.revoked_at IS NULL
     AND ctag.granted_at <= ips.started_at
  ) AS active_grants_count
FROM impersonation_sessions_projection ips
JOIN organizations o ON ips.target_org_id = o.id
WHERE o.org_type = 'provider_partner'
  AND ips.started_at BETWEEN :start_date AND :end_date
ORDER BY ips.started_at DESC;
```

**Query Provider Data Accessed During VAR Impersonation:**
```sql
-- Find which Provider orgs' data was accessed during VAR Partner impersonation
-- (By analyzing events emitted during impersonation session)
SELECT DISTINCT
  ips.session_id,
  ips.started_at,
  ips.target_org_name AS var_partner_org,
  de.stream_type,
  de.event_type,
  de.event_metadata->>'orgId' AS accessed_provider_org_id,
  o.org_name AS accessed_provider_org_name,
  COUNT(*) OVER (PARTITION BY ips.session_id, de.event_metadata->>'orgId') AS access_count
FROM impersonation_sessions_projection ips
JOIN domain_events de ON de.event_metadata->>'impersonation_session_id' = ips.session_id::text
LEFT JOIN organizations o ON o.id::text = de.event_metadata->>'orgId'
WHERE ips.session_id = :session_id
  AND de.event_type NOT LIKE 'impersonation.%'  -- Exclude lifecycle events
  AND de.event_metadata->>'orgId' IS NOT NULL
  AND de.event_metadata->>'orgId' != ips.target_org_id::text  -- Cross-tenant access
ORDER BY de.created_at;
```

**Enhanced Metadata for VAR Impersonation:**

During VAR Partner user impersonation, when Super Admin views Provider data via cross-tenant access, events include:

```json
{
  "eventType": "client.viewed",
  "streamId": "client_12345",
  "streamType": "client",
  "metadata": {
    "userId": "user_var_consultant_789",
    "orgId": "org_sunshine_youth_001",  // Provider org (cross-tenant)
    "impersonatedBy": "user_super_admin_123",
    "impersonationSessionId": "session_var_xyz456",
    "crossTenantAccess": {
      "consultantOrgId": "org_var_partner_xyz",  // VAR org
      "grantId": "grant_uuid",
      "authorizationType": "var_contract",
      "partnershipId": "partnership_uuid"
    },
    "timestamp": "2025-10-09T16:35:00Z"
  }
}
```

---

## Compliance Retention

**Requirement:** Healthcare regulations require 7-year audit trail retention

**CQRS Implementation:**
- All impersonation events stored in `domain_events` table (immutable, append-only)
- Events never deleted, providing complete audit trail
- Projection table (`impersonation_sessions_projection`) can be rebuilt from events
- Archived to cold storage after 90 days (hot storage limit)
- Archived events still queryable for compliance reports
- Event store serves as source of truth for forensic analysis

---

## Related Documents

### Planning Documents
- `.plans/impersonation/architecture.md` - Overall architecture (includes CQRS details and VAR context)
- `.plans/impersonation/implementation-guide.md` - Step-by-step implementation guide
- `.plans/impersonation/ui-specification.md` - Visual indicators and UX
- `.plans/impersonation/security-controls.md` - Security measures
- `.plans/event-resilience/plan.md` - Event resilience and offline handling
- `.plans/consolidated/agent-observations.md` - Platform architecture (includes hierarchy model, VAR partnerships)
- `.plans/auth-integration/tenants-as-organization-thoughts.md` - Organizational structure (flat Provider model)
- `.plans/multi-tenancy/multi-tenancy-organization.html` - Multi-tenancy specification (VAR partnerships as metadata)
- `/frontend/docs/EVENT-DRIVEN-GUIDE.md` - Frontend event-driven guide

### Infrastructure Files
- `/infrastructure/supabase/contracts/asyncapi/domains/impersonation.yaml` - AsyncAPI event schemas (canonical)
- `/infrastructure/supabase/sql/02-tables/impersonation/001-impersonation_sessions_projection.sql` - Projection table
- `/infrastructure/supabase/sql/03-functions/event-processing/005-process-impersonation-events.sql` - Event processor and helper functions
- `/infrastructure/supabase/sql/03-functions/event-processing/001-main-event-router.sql` - Event router (includes impersonation)
- `/infrastructure/supabase/docs/EVENT-DRIVEN-ARCHITECTURE.md` - CQRS foundation documentation

---

**Document Version:** 1.0
**Last Updated:** 2025-10-09
**Status:** Final Specification
