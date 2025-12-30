---
status: aspirational
last_updated: 2025-12-30
---

<!-- TL;DR-START -->
## TL;DR

**Summary**: Planned architecture for Super Admin impersonation allowing authorized admins to view/operate the application as any user while maintaining comprehensive audit trails for compliance.

**When to read**:
- Planning impersonation feature implementation
- Understanding cross-tenant support requirements
- Reviewing audit trail architecture for compliance
- Designing session management for impersonation

**Prerequisites**: [impersonation-security-controls.md](impersonation-security-controls.md) for security requirements

**Key topics**: `impersonation`, `super-admin`, `audit-trail`, `cross-tenant`, `session-management`, `compliance`

**Estimated read time**: 20 minutes
<!-- TL;DR-END -->

# Super Admin Impersonation Architecture
> [!WARNING]
> **This feature is not yet implemented.** This document describes planned functionality that has not been built. Implementation timeline and approach are subject to change based on business priorities.


## Executive Summary

This document specifies the architecture for Super Admin impersonation capabilities in the A4C platform. Impersonation allows authorized administrators to view and operate the application as any user in any organization (provider or provider_partner types) while maintaining comprehensive audit trails for compliance and security.

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
- Access any provider or provider_partner organization for support purposes
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
**Scenario:** provider_admin locked out of account, urgent medication update needed

**Action:**
1. Super Admin verifies emergency (phone call, support ticket)
2. Impersonates provider_admin
3. Updates critical medication data
4. Ends impersonation
5. Full audit trail for compliance review

### 3. Compliance Audit
**Scenario:** Internal audit requires verification of HIPAA controls

**Action:**
1. Compliance Officer (Super Admin role) impersonates various roles
2. Verifies data isolation (can't see other organization data)
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

### CQRS/Event Sourcing Foundation

Impersonation follows the platform's **event-sourced CQRS architecture**:

- **Events**: All impersonation state changes captured as immutable events in `domain_events` table
- **Stream Type**: `'impersonation'` (dedicated stream)
- **Projections**: `impersonation_sessions_projection` table for read queries
- **Event Processor**: `process_impersonation_event()` maintains projection state
- **Audit Trail**: Complete event history provides compliance and forensics

For CQRS architecture details, see:
- `/infrastructure/supabase/docs/EVENT-DRIVEN-ARCHITECTURE.md`
- `.plans/consolidated/agent-observations.md` (CQRS Foundation section)

### System Architecture

```
┌─────────────────────────────────────────────────────────┐
│                  Super Admin Console                     │
│  - User selection dropdown                               │
│  - Organization selection                                │
│  - Justification capture (required for events)           │
│  - MFA challenge (provider.impersonate permission)       │
└──────────────────────┬──────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────┐
│             Impersonation Service (Backend)              │
│  - Validates provider.impersonate permission (RBAC)      │
│  - Verifies MFA                                          │
│  - Creates impersonation session (Redis)                 │
│  - Emits impersonation.started event (domain_events)     │
│  - Issues JWT with impersonation context                 │
└──────────────────────┬──────────────────────────────────┘
                       │
          ┌────────────┴────────────┐
          │                         │
          ▼                         ▼
┌──────────────────┐      ┌──────────────────────────────┐
│  Redis Session   │      │   domain_events table        │
│  - sessionId     │      │  - stream_type: impersonation│
│  - expiresAt     │      │  - Event processor projects  │
│  - targetUser    │      │    to projection table       │
│  - TTL: 30 min   │      │  - Audit trail preserved     │
└──────────────────┘      └──────────┬───────────────────┘
          │                          │
          │                          ▼
          │              ┌──────────────────────────────┐
          │              │ impersonation_sessions_      │
          │              │        projection            │
          │              │  - Active sessions (query)   │
          │              │  - Audit reports             │
          │              │  - Compliance dashboard      │
          │              └──────────────────────────────┘
          │
          ▼
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
  'impersonation',  // stream_type
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
  'impersonation',  // stream_type
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
  'impersonation',  // stream_type
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
        'impersonation',  // stream_type
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

### CQRS Implementation

**Event Storage:**
- All impersonation events stored in `domain_events` table with `stream_type = 'impersonation'`
- Events are immutable and provide complete audit trail
- Stream ID is the Super Admin's user UUID

**Projection Table:**
- `impersonation_sessions_projection` maintains current session state
- Updated by `process_impersonation_event()` function via database trigger
- Optimized for queries: active sessions, audit reports, compliance dashboards

**AsyncAPI Contract:**
- Event schemas defined in `/infrastructure/supabase/contracts/asyncapi/domains/impersonation.yaml`
- TypeScript types generated via `./scripts/generate-contracts.sh`
- Ensures type safety across frontend and backend

**Related Infrastructure:**
- Event processor: `/infrastructure/supabase/sql/03-functions/event-processing/005-process-impersonation-events.sql`
- Projection table: `/infrastructure/supabase/sql/02-tables/impersonation/001-impersonation_sessions_projection.sql`
- Event router: `/infrastructure/supabase/sql/03-functions/event-processing/001-main-event-router.sql`

### Impersonation Lifecycle Events

See `.plans/impersonation/event-schema.md` for detailed event definitions and `/infrastructure/supabase/contracts/asyncapi/domains/impersonation.yaml` for AsyncAPI schemas.

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

**Query Projection Table (Optimized):**
```sql
-- All impersonation sessions by Super Admin X
SELECT * FROM impersonation_sessions_projection
WHERE super_admin_user_id = :super_admin_id
ORDER BY started_at DESC;

-- Active impersonation sessions
SELECT * FROM impersonation_sessions_projection
WHERE status = 'active'
  AND expires_at > NOW()
ORDER BY started_at DESC;

-- All impersonation access to Provider Y (using helper function)
SELECT * FROM get_org_impersonation_audit(
  :provider_org_id,
  NOW() - INTERVAL '30 days',
  NOW()
);

-- Get user's active impersonation sessions
SELECT * FROM get_user_active_impersonation_sessions(:user_id);
```

**Query Event Store (Complete History):**
```sql
-- All impersonation lifecycle events for Super Admin X
SELECT * FROM domain_events
WHERE stream_type = 'impersonation'
  AND stream_id = :super_admin_id
ORDER BY created_at DESC;

-- All actions performed during specific impersonation session
SELECT * FROM domain_events
WHERE event_metadata->>'impersonation_session_id' = :session_id
ORDER BY created_at ASC;

-- Detailed event history for specific session
SELECT
  event_type,
  event_data,
  event_metadata,
  created_at
FROM domain_events
WHERE stream_type = 'impersonation'
  AND (
    event_data->>'session_id' = :session_id
    OR event_metadata->>'impersonation_session_id' = :session_id
  )
ORDER BY created_at ASC;
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

### Organizational Hierarchy Context

**CRITICAL ARCHITECTURAL PRINCIPLE:**
All Provider organizations exist at the **root level** in Zitadel (flat structure). VAR (Value-Added Reseller) relationships with Providers are tracked as **business metadata** in the `var_partnerships_projection` table, NOT as hierarchical ownership in Zitadel.

**Hierarchy Model Reference:**
```
Zitadel Instance: analytics4change-zdswvg.us1.zitadel.cloud
│
├── Analytics4Change (Zitadel Org) - Internal A4C Organization
│   └── Super Admin (role) - Can impersonate any user across all orgs
│
├── VAR Partner XYZ (Zitadel Org) - Value Added Reseller/Partner
│   ├── Administrator (role)
│   └── Access: Via cross_tenant_access_grants (NOT hierarchical ownership)
│       └── Partnership metadata in var_partnerships_projection table
│
├── Provider A (Zitadel Org) - Healthcare Provider Organization
│   ├── Administrator (role)
│   └── Provider-defined internal hierarchy (flexible structure)
│       └── Example: facility → wing → pod
│       └── Example: home_1, home_2, home_3 (flat)
│       └── Example: campus → residential_unit → clinic
│
└── Provider B (Zitadel Org) - Direct Customer (No VAR)
    └── Provider-defined internal hierarchy
```

For complete hierarchy model details, see:
- `.plans/consolidated/agent-observations.md` (Hierarchy Model section)
- `.plans/auth-integration/tenants-as-organization-thoughts.md` (Organizational Hierarchy section)
- `.plans/multi-tenancy/multi-tenancy-organization.html` (Section 7.1)

### Security Considerations

**Risk:** Super Admin could access Provider data without legitimate need

**Mitigations:**
1. **Audit Trail:** Every cross-tenant impersonation logged
2. **Justification Required:** Must provide reason for access
3. **Provider Notification (Post-Launch):** Email Provider Admin when Super Admin accesses their org
4. **Anomaly Detection (Future):** Alert on unusual patterns (same admin accessing many orgs rapidly)

### VAR Partner Impersonation

**Use Case:** Super Admin needs to verify VAR Partner dashboard shows correct data

**Implementation:**
- Impersonate VAR user in VAR Partner org (root-level Zitadel org)
- View scoped dashboards (only Providers with active partnerships)
- Verify cross-tenant access grants functioning correctly
- Test VAR access to Provider data via metadata-based grants

**Special Handling:**
- VAR dashboards aggregate data from multiple Providers (via `cross_tenant_access_grants_projection`)
- Partnership status checked via `var_partnerships_projection` (event-sourced metadata)
- Impersonation audit must log which Provider data was viewed
- Enhanced metadata: `accessedProviderOrgs: ['org-1', 'org-2']`

**VAR Access Model:**
```typescript
// VAR access is NOT hierarchical - it's metadata-based
interface VARAccess {
  // VAR org is root-level (NOT parent of Provider)
  varOrgId: UUID;

  // Partnership tracked in projection table (event-sourced)
  partnerships: VARPartnership[];  // From var_partnerships_projection

  // Access via grants (NOT Zitadel hierarchy)
  grants: CrossTenantGrant[];  // From cross_tenant_access_grants_projection

  // Provider orgs remain at root level
  providerOrgIds: UUID[];  // All root-level orgs
}
```

### Provider Internal Hierarchy Impersonation

**Use Case:** Super Admin troubleshoots permission issue in Provider's organizational structure

**Implementation:**
- Impersonate user scoped to specific unit within Provider
- Provider defines their own hierarchy (no prescribed structure)
- Examples of diverse Provider hierarchies:
  - **Group Home Provider:** `org_homes_inc.home_3` (flat, 2 levels)
  - **Detention Center:** `org_youth_detention.main_facility.behavioral_health_wing.crisis_stabilization` (deep, 5 levels)
  - **Treatment Center:** `org_healing_horizons.south_campus.residential_unit_c.art_therapy` (medium, 4 levels)

**Impersonation Context:**
```typescript
{
  sessionId: 'session-uuid',
  targetUserId: 'user-uuid',
  targetOrgId: 'org_healing_horizons',  // Root Provider org
  targetOrgPath: 'org_healing_horizons.south_campus.residential_unit_c',  // User's scope
  originalUserId: 'super-admin-uuid',
  justification: {
    reason: 'support_ticket',
    referenceId: 'TICKET-8901',
    notes: 'User cannot view clients in Residential Unit C'
  }
}
```

**Audit Trail:**
```sql
-- Query impersonation sessions scoped to specific Provider units
SELECT
  ips.*,
  o.org_name,
  ips.target_scope_path,
  nlevel(ips.target_scope_path) AS hierarchy_depth
FROM impersonation_sessions_projection ips
JOIN organizations o ON ips.target_org_id = o.id
WHERE ips.target_org_id = :provider_org_id
  AND ips.target_scope_path <@ 'org_healing_horizons.south_campus'::LTREE
ORDER BY ips.started_at DESC;
```

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

### Planning Documents
- `.plans/impersonation/event-schema.md` - Detailed event definitions (markdown)
- `.plans/impersonation/ui-specification.md` - Visual indicators and UX flows
- `.plans/impersonation/security-controls.md` - Comprehensive security measures
- `.plans/impersonation/implementation-guide.md` - Step-by-step implementation guide
- `.plans/consolidated/agent-observations.md` - Overall architecture context (includes hierarchy model)
- `.plans/rbac-permissions/architecture.md` - RBAC system (includes provider.impersonate permission)
- `.plans/auth-integration/tenants-as-organization-thoughts.md` - Authentication foundation (flat Provider structure)
- `.plans/multi-tenancy/multi-tenancy-organization.html` - Multi-tenancy specification (VAR partnerships as metadata)

### Infrastructure Files
- `/infrastructure/supabase/contracts/asyncapi/domains/impersonation.yaml` - AsyncAPI event schemas
- `/infrastructure/supabase/sql/02-tables/impersonation/001-impersonation_sessions_projection.sql` - Projection table
- `/infrastructure/supabase/sql/03-functions/event-processing/005-process-impersonation-events.sql` - Event processor
- `/infrastructure/supabase/sql/03-functions/event-processing/001-main-event-router.sql` - Event router (includes impersonation)
- `/infrastructure/supabase/docs/EVENT-DRIVEN-ARCHITECTURE.md` - CQRS foundation documentation

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
