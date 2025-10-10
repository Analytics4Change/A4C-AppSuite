# Impersonation Event Schema

## Overview

This document defines the event schemas for impersonation lifecycle events in the A4C platform. These events integrate with the existing event-driven architecture to provide comprehensive audit trails for Super Admin impersonation sessions.

**Related Documents:**
- `.plans/impersonation/architecture.md` - Overall impersonation architecture
- `/docs/EVENT-DRIVEN-GUIDE.md` - Event-driven architecture guide (Frontend)

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
  streamType: 'user';
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

### Example

```json
{
  "id": "evt_9a7b3c5d-1e2f-4a6b-8c9d-0e1f2a3b4c5d",
  "streamId": "user_super_admin_123",
  "streamType": "user",
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

---

## impersonation.renewed

**Emitted when:** User clicks "Continue Impersonation" in renewal modal

**Stream:** Super Admin's user ID

### Event Schema

```typescript
interface ImpersonationRenewedEvent {
  id: string;                    // UUID
  streamId: string;              // Super Admin user ID
  streamType: 'user';
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
  "streamType": "user",
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
  streamType: 'user';
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
  "streamType": "user",
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
  "streamType": "user",
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
      'user',
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
      'user',
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
      'user',
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

Events are stored in Supabase `events` table following the existing schema:

```sql
-- Query all impersonation sessions
SELECT * FROM events
WHERE event_type LIKE 'impersonation.%'
ORDER BY timestamp DESC;

-- Query specific session timeline
SELECT * FROM events
WHERE metadata->>'impersonationSessionId' = 'session_abc123xyz'
ORDER BY timestamp ASC;

-- Query all sessions for a Super Admin
SELECT * FROM events
WHERE event_type = 'impersonation.started'
  AND data->>'superAdmin'->>'userId' = 'user_super_admin_123'
ORDER BY timestamp DESC;

-- Count actions performed during a session
SELECT COUNT(*) FROM events
WHERE metadata->>'impersonationSessionId' = 'session_abc123xyz'
  AND event_type != 'impersonation.renewed';
```

---

## Audit Report Queries

### Super Admin Activity Report

```sql
-- All impersonation sessions by Super Admin in date range
SELECT
  e.timestamp as started_at,
  e.data->>'target'->>'email' as target_user,
  e.data->>'target'->>'orgName' as target_org,
  e.data->>'justification'->>'reason' as reason,
  e.data->>'justification'->>'referenceId' as reference,
  (SELECT data->>'totalDuration'
   FROM events
   WHERE event_type = 'impersonation.ended'
     AND data->>'sessionId' = e.data->>'sessionId'
  ) as duration_ms
FROM events e
WHERE e.event_type = 'impersonation.started'
  AND e.data->>'superAdmin'->>'userId' = :super_admin_id
  AND e.timestamp BETWEEN :start_date AND :end_date
ORDER BY e.timestamp DESC;
```

### Provider Access Report

```sql
-- All Super Admin access to specific Provider org
SELECT
  e.timestamp as accessed_at,
  e.data->>'superAdmin'->>'email' as super_admin,
  e.data->>'target'->>'email' as impersonated_user,
  e.data->>'justification'->>'reason' as reason,
  (SELECT data->>'totalDuration'
   FROM events
   WHERE event_type = 'impersonation.ended'
     AND data->>'sessionId' = e.data->>'sessionId'
  ) as duration_ms,
  (SELECT data->>'actionsPerformed'
   FROM events
   WHERE event_type = 'impersonation.ended'
     AND data->>'sessionId' = e.data->>'sessionId'
  ) as actions_count
FROM events e
WHERE e.event_type = 'impersonation.started'
  AND e.data->>'target'->>'orgId' = :provider_org_id
ORDER BY e.timestamp DESC;
```

---

## Compliance Retention

**Requirement:** Healthcare regulations require 7-year audit trail retention

**Implementation:**
- All impersonation events stored in `events` table
- Never deleted (append-only)
- Archived to cold storage after 90 days (hot storage limit)
- Archived events still queryable for compliance reports

---

## Related Documents

- `.plans/impersonation/architecture.md` - Overall architecture
- `.plans/impersonation/ui-specification.md` - Visual indicators and UX
- `.plans/impersonation/security-controls.md` - Security measures
- `.plans/event-resilience/plan.md` - Event resilience and offline handling
- `/docs/EVENT-DRIVEN-GUIDE.md` - Frontend event-driven guide

---

**Document Version:** 1.0
**Last Updated:** 2025-10-09
**Status:** Final Specification
