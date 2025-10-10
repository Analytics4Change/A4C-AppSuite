# Super Admin Impersonation Architecture

## Executive Summary

This document specifies the architecture for Super Admin impersonation capabilities in the A4C platform. Impersonation allows authorized administrators to view and operate the application as any user in any Provider organization while maintaining comprehensive audit trails for compliance and security.

**Status:** Architectural Specification
**Version:** 1.0
**Last Updated:** 2025-10-09

---

## Table of Contents

1. [Problem Statement](#problem-statement)
2. [Use Cases](#use-cases)
3. [Architecture Overview](#architecture-overview)
4. [Session Management](#session-management)
5. [Event-Driven Audit Trail](#event-driven-audit-trail)
6. [JWT Structure](#jwt-structure)
7. [Security Controls](#security-controls)
8. [Cross-Tenant Impersonation](#cross-tenant-impersonation)
9. [Implementation Phases](#implementation-phases)
10. [Testing Strategy](#testing-strategy)

---

## Problem Statement

Platform support, emergency access, and compliance audits require Super Admin ability to:
- View the application exactly as any user sees it
- Perform actions on behalf of users (with full audit trail)
- Troubleshoot user-reported issues in production
- Access any Provider organization for support purposes
- Conduct compliance audits and data verification

**Without impersonation**, support staff must:
- Request screenshots from users (incomplete information)
- Ask users to perform actions (slow, error-prone)
- Lack context for troubleshooting
- Cannot verify reported bugs

**With impersonation**, support becomes:
- Immediate (see exactly what user sees)
- Accurate (reproduce bugs in real-time)
- Documented (every action logged)
- Secure (time-limited, MFA-protected)

---

## Use Cases

### 1. Customer Support
**Scenario:** User reports "I can't see my client's medication list"

**Without Impersonation:**
1. Support asks for screenshots
2. Support requests user to check specific settings
3. Back-and-forth over email/phone (slow)
4. Issue may not be reproducible

**With Impersonation:**
1. Super Admin impersonates user
2. Immediately sees the exact issue
3. Diagnoses problem (permission issue, data filter, etc.)
4. Resolves or escalates with full context
5. Total time: 5 minutes instead of hours

### 2. Emergency Access
**Scenario:** Provider Admin locked out of account, urgent medication update needed

**Action:**
1. Super Admin verifies emergency (phone call, support ticket)
2. Impersonates Provider Admin
3. Updates critical medication data
4. Ends impersonation
5. Full audit trail for compliance review

### 3. Compliance Audit
**Scenario:** Internal audit requires verification of HIPAA controls

**Action:**
1. Compliance Officer (Super Admin role) impersonates various roles
2. Verifies data isolation (can't see other Provider data)
3. Tests RLS policies
4. Documents findings with audit trail

### 4. Training & Demonstrations
**Scenario:** Onboarding new support staff, demonstrating features

**Action:**
1. Trainer impersonates demo user in A4C-Demo org
2. Walks through features as end-user
3. Safe environment (demo data only)
4. Trainees see real user experience

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────┐
│                  Super Admin Console                     │
│  - User selection dropdown                               │
│  - Organization selection                                │
│  - Justification capture                                 │
│  - MFA challenge                                         │
└──────────────────────┬──────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────┐
│             Impersonation Service (Backend)              │
│  - Validates Super Admin permissions                     │
│  - Verifies MFA                                          │
│  - Creates impersonation session (Redis)                 │
│  - Emits impersonation.started event                     │
│  - Issues JWT with impersonation context                 │
└──────────────────────┬──────────────────────────────────┘
                       │
          ┌────────────┴────────────┐
          │                         │
          ▼                         ▼
┌──────────────────┐      ┌──────────────────────┐
│  Redis Session   │      │   Event Emitter      │
│  - sessionId     │      │  - Audit trail       │
│  - expiresAt     │      │  - Lifecycle events  │
│  - targetUser    │      │  - Action metadata   │
│  - TTL: 30 min   │      │                      │
└──────────────────┘      └──────────────────────┘
          │                         │
          ▼                         ▼
┌─────────────────────────────────────────────────────────┐
│                  Application Layer                       │
│  - Visual indicators (red border, banner)                │
│  - Renewal modal (1-minute warning)                      │
│  - All actions include impersonation metadata            │
│  - Automatic logout on timeout                           │
└─────────────────────────────────────────────────────────┘
```

---

## Session Management

### Session Duration
- **Default:** 30 minutes (configurable per environment)
- **Rationale:** Balance between usability and security
  - Long enough for typical support tasks
  - Short enough to prevent forgotten sessions
  - Forces periodic re-evaluation of access need

### Session Lifecycle

**1. Session Start**
```typescript
// Frontend: Impersonation request
const session = await impersonationService.start({
  targetUserId: 'uuid-456',
  justification: {
    reason: 'support_ticket',
    referenceId: 'TICKET-7890',
    notes: 'User cannot access medication list'
  }
});

// Backend: Create session
const sessionId = generateUUID();
const session = {
  sessionId,
  superAdminId: currentUser.id,
  targetUserId: request.targetUserId,
  targetOrgId: targetUser.orgId,
  startedAt: new Date(),
  expiresAt: new Date(Date.now() + 30 * 60 * 1000),
  renewalCount: 0,
  justification: request.justification
};

await redis.setex(
  `impersonation:${sessionId}`,
  1800, // 30 minutes in seconds
  JSON.stringify(session)
);

await eventEmitter.emit(
  superAdminId,
  'user',
  'impersonation.started',
  session,
  'Super Admin started impersonation session'
);
```

**2. Session Renewal**
```typescript
// Renewal modal appears at 1-minute warning
// User clicks "Continue Impersonation"
const renewed = await impersonationService.renew(sessionId);

// Backend: Extend TTL
await redis.expire(`impersonation:${sessionId}`, 1800);
session.expiresAt = new Date(Date.now() + 30 * 60 * 1000);
session.renewalCount += 1;

await eventEmitter.emit(
  superAdminId,
  'user',
  'impersonation.renewed',
  { sessionId, renewalCount, newExpiresAt },
  'Impersonation session renewed'
);
```

**3. Session End**
```typescript
// Manual logout, timeout, or renewal declined
await impersonationService.end(sessionId, reason);

// Backend: Delete session, emit event
await redis.del(`impersonation:${sessionId}`);

await eventEmitter.emit(
  superAdminId,
  'user',
  'impersonation.ended',
  { sessionId, reason, duration, actionsPerformed },
  'Impersonation session ended'
);
```

### Server-Side Validation

**Every API request validates impersonation session:**
```typescript
async function validateImpersonation(jwt: JWT) {
  if (!jwt.impersonation) {
    return; // Not an impersonation session
  }

  const session = await redis.get(
    `impersonation:${jwt.impersonation.sessionId}`
  );

  if (!session) {
    throw new UnauthorizedError('Impersonation session not found or expired');
  }

  if (new Date(session.expiresAt) < new Date()) {
    throw new UnauthorizedError('Impersonation session expired');
  }

  // Update last activity
  await redis.setex(
    `impersonation:${jwt.impersonation.sessionId}`,
    1800,
    JSON.stringify({ ...session, lastActivity: new Date() })
  );
}
```

### Session Cleanup

**Automatic cleanup on timeout:**
```typescript
// Redis TTL automatically deletes expired sessions

// Background job emits missing end events
setInterval(async () => {
  const sessions = await redis.keys('impersonation:*');
  for (const key of sessions) {
    const session = JSON.parse(await redis.get(key));
    if (new Date(session.expiresAt) < new Date()) {
      // Emit timeout event if not already ended
      await eventEmitter.emit(
        session.superAdminId,
        'user',
        'impersonation.ended',
        { sessionId, reason: 'timeout', ...session },
        'Impersonation session timed out'
      );
      await redis.del(key);
    }
  }
}, 60000); // Every minute
```

---

## Event-Driven Audit Trail

**Philosophy:** Leverage existing event-driven architecture for comprehensive audit logging.

### Impersonation Lifecycle Events

See `.plans/impersonation/event-schema.md` for detailed event definitions.

**Event Flow:**
```
impersonation.started
  → [user actions with impersonation metadata]
  → impersonation.renewed (0-N times)
  → impersonation.ended
```

### Metadata Injection

**All events during impersonation session include metadata:**
```typescript
{
  eventType: 'client.updated',
  streamId: client_id,
  streamType: 'client',
  data: { /* normal event data */ },
  metadata: {
    performedBy: 'uuid-456',  // Target user
    impersonatedBy: 'uuid-123',  // Super admin
    impersonationSessionId: 'session-uuid',
    // Standard metadata
    userId: 'uuid-456',
    orgId: 'provider-org-uuid',
    timestamp: '2025-10-09T15:15:30Z'
  }
}
```

### Audit Queries

**Example queries for compliance:**
```sql
-- All impersonation sessions by Super Admin X
SELECT * FROM events
WHERE event_type LIKE 'impersonation.%'
  AND metadata->>'impersonatedBy' = :super_admin_id
ORDER BY timestamp DESC;

-- All actions performed during specific impersonation session
SELECT * FROM events
WHERE metadata->>'impersonationSessionId' = :session_id
ORDER BY timestamp ASC;

-- All impersonation access to Provider Y
SELECT * FROM events
WHERE event_type = 'impersonation.started'
  AND data->>'targetOrgId' = :provider_org_id
ORDER BY timestamp DESC;
```

---

## JWT Structure

**Standard JWT (no impersonation):**
```json
{
  "sub": "user-id",
  "email": "user@example.com",
  "org_id": "org-uuid",
  "org_type": "provider",
  "roles": ["provider_admin"],
  "exp": 1728484200,
  "iat": 1728480600
}
```

**Impersonation JWT:**
```json
{
  "sub": "target-user-id",
  "email": "target@provider.com",
  "org_id": "target-org-uuid",
  "org_type": "provider",
  "roles": ["staff"],
  "impersonation": {
    "sessionId": "impersonation-session-uuid",
    "originalUserId": "super-admin-id",
    "originalEmail": "admin@a4c.com",
    "targetUserId": "target-user-id",
    "expiresAt": 1728482400
  },
  "exp": 1728482400,  // Session expiry (30 minutes from start)
  "iat": 1728480600
}
```

**Key Points:**
- `sub` is **target user** (RLS policies use this for data access)
- `impersonation.originalUserId` tracks **Super Admin identity**
- `impersonation.sessionId` links to Redis session
- JWT expiry matches session expiry (prevents token reuse after session ends)

---

## Security Controls

See `.plans/impersonation/security-controls.md` for comprehensive security specification.

### Core Requirements

1. **MFA Required:** TOTP + hardware key recommended before impersonation start
2. **Justification Required:** Dropdown + optional notes
3. **Time-Limited:** 30-minute sessions with renewal prompts
4. **Nested Prevention:** Cannot impersonate while already impersonating
5. **Audit Logging:** All lifecycle events + action metadata
6. **Visual Indicators:** Red border, banner, favicon, title prefix
7. **Automatic Logout:** On timeout, no grace period

### Justification Capture

**Required fields:**
```typescript
interface ImpersonationJustification {
  reason: 'support_ticket' | 'emergency' | 'audit' | 'training';
  referenceId?: string;  // Ticket number, incident ID, audit case
  notes?: string;        // Optional free-text explanation
}
```

**Validation:**
- `reason` required (dropdown selection)
- `referenceId` required for support_ticket reason
- `notes` optional but recommended

### Concurrent Sessions

**Policy:** Allow multiple concurrent impersonation sessions (different tabs/users)

**Rationale:**
- Flexibility for complex support scenarios
- Each session independently tracked
- Visual indicators prevent confusion

**UI Warning:** Dashboard shows "Active impersonation sessions: N" when N > 1

---

## Cross-Tenant Impersonation

**Capability:** Super Admin can impersonate users in **any** Provider organization

### Security Considerations

**Risk:** Super Admin could access Provider data without legitimate need

**Mitigations:**
1. **Audit Trail:** Every cross-tenant impersonation logged
2. **Justification Required:** Must provide reason for access
3. **Provider Notification (Post-Launch):** Email Provider Admin when Super Admin accesses their org
4. **Anomaly Detection (Future):** Alert on unusual patterns (same admin accessing many orgs rapidly)

### Provider Partner Impersonation

**Use Case:** Super Admin needs to verify VAR dashboard shows correct data

**Implementation:**
- Impersonate VAR user in Provider Partner org
- View scoped dashboards (only their referred Providers)
- Verify cross-tenant access grants functioning correctly

**Special Handling:**
- VAR dashboards aggregate data from multiple Providers
- Impersonation audit must log which Provider data was viewed
- Enhanced metadata: `accessedProviderOrgs: ['org-1', 'org-2']`

---

## Implementation Phases

### Phase 1: MVP (Foundation)
**Timeline:** 2-3 weeks

**Deliverables:**
- Backend session management (Redis store)
- JWT structure with impersonation context
- Event emitters (started, renewed, ended)
- Frontend visual indicators (red border, banner)
- Renewal modal with countdown timer
- MFA challenge before impersonation
- Justification capture form

**Acceptance Criteria:**
- Super Admin can impersonate any user
- 30-minute sessions with renewals
- All lifecycle events emitted
- Visual indicators visible
- Audit trail queryable

### Phase 2: Enhanced Security (Post-Launch)
**Timeline:** 1-2 weeks after MVP

**Deliverables:**
- IP restrictions (office/VPN only)
- Action restrictions (prevent certain operations during impersonation)
- Provider notification emails
- Impersonation analytics dashboard
- Role separation (System vs. Support vs. Compliance Super Admins)

### Phase 3: Advanced Features (Future)
**Timeline:** TBD

**Deliverables:**
- Just-In-Time access (request → approval → time-limited grant)
- Anomaly detection (suspicious impersonation patterns)
- Session recording (video capture for high-security)
- Compliance reporting (automated audit reports)

---

## Testing Strategy

### Unit Tests
- Session creation, renewal, expiration
- JWT generation with impersonation context
- Event emission for lifecycle events
- Metadata injection for user actions

### Integration Tests
- Full impersonation flow (start → actions → renew → end)
- Session timeout and automatic cleanup
- Nested impersonation prevention
- Concurrent session handling

### End-to-End Tests
- Super Admin logs in, impersonates user, performs actions, logs out
- Renewal modal appears at 1-minute warning
- Visual indicators display correctly
- Audit trail verifiable in database

### Security Tests
- MFA bypass attempts (should fail)
- JWT replay after session end (should fail)
- Impersonate without justification (should fail)
- Nested impersonation attempt (should fail)
- Session hijacking attempts (should fail)

### Compliance Tests
- All impersonation events logged
- Audit queries return correct results
- Provider Partner cross-org access audit trails complete
- 7-year retention verified

---

## Related Documents

- `.plans/impersonation/event-schema.md` - Detailed event definitions
- `.plans/impersonation/ui-specification.md` - Visual indicators and UX flows
- `.plans/impersonation/security-controls.md` - Comprehensive security measures
- `.plans/consolidated/agent-observations.md` - Overall architecture context
- `.plans/auth-integration/tenants-as-organization-thoughts.md` - Authentication foundation

---

## Decision Log

| Date | Decision | Rationale |
|------|----------|-----------|
| 2025-10-09 | 30-minute session duration | Balance usability + security, forces periodic re-evaluation |
| 2025-10-09 | Event-driven audit trail | Leverage existing infrastructure, consistent with platform patterns |
| 2025-10-09 | Allow concurrent sessions | Flexibility for complex support, each session independently tracked |
| 2025-10-09 | Red border visual indicator | Critical for user awareness, prevents accidental actions |
| 2025-10-09 | Renewal modal at 1-minute | Provides warning buffer, prevents abrupt disconnection |
| 2025-10-09 | Sub = target user in JWT | RLS policies use sub for data access, maintains consistency |

---

**Document Version:** 1.0
**Last Updated:** 2025-10-09
**Status:** Approved for Implementation
**Owner:** A4C Architecture Team
