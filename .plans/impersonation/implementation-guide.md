# Impersonation Implementation Guide

## Overview

This guide provides step-by-step instructions for implementing the Super Admin impersonation system in the A4C AppSuite. All components are event-sourced and follow the CQRS architecture.

**Related Documents:**
- `.plans/impersonation/architecture.md` - Complete architecture specification
- `.plans/impersonation/event-schema.md` - Event definitions and schemas
- `.plans/impersonation/security-controls.md` - Security measures
- `.plans/rbac-permissions/implementation-guide.md` - RBAC setup (provider.impersonate permission)
- `/infrastructure/supabase/docs/EVENT-DRIVEN-ARCHITECTURE.md` - CQRS foundation

---

## Prerequisites

Before implementing impersonation, ensure:

1. **RBAC System Deployed**: Follow `.plans/rbac-permissions/implementation-guide.md`
   - `provider.impersonate` permission exists
   - `super_admin` role has impersonation permission
   - MFA requirement enforced for impersonation permission

2. **Redis Configured**: Session storage requires Redis instance
   - Connection details in environment variables
   - TTL support enabled

3. **JWT Infrastructure**: Token generation and validation in place
   - Support for custom claims (impersonation context)
   - Token expiry aligned with session duration

---

## Phase 1: Database Setup

### Step 1: Apply Migration Scripts

Run SQL scripts in order to create projection table, event processor, and router update:

```bash
cd infrastructure/supabase

# 1. Create projection table
psql -f sql/02-tables/impersonation/001-impersonation_sessions_projection.sql

# 2. Create event processor and helper functions
psql -f sql/03-functions/event-processing/005-process-impersonation-events.sql

# 3. Update event router (already includes impersonation stream type)
psql -f sql/03-functions/event-processing/001-main-event-router.sql
```

### Step 2: Verify Projection Table

After running migrations, verify table creation:

```sql
-- Check table exists
\d impersonation_sessions_projection;

-- Verify indexes
SELECT indexname, indexdef
FROM pg_indexes
WHERE tablename = 'impersonation_sessions_projection';
-- Expected: 7 indexes (primary key + 6 performance indexes)

-- Verify RLS policies
SELECT policyname, cmd, qual
FROM pg_policies
WHERE tablename = 'impersonation_sessions_projection';
-- Expected: 3 policies (super_admin, provider_admin, own_sessions)
```

### Step 3: Verify Event Processor

Test event processing manually:

```sql
-- Insert test impersonation.started event
INSERT INTO domain_events (
  stream_id,
  stream_type,
  stream_version,
  event_type,
  event_data,
  event_metadata
) VALUES (
  '<SUPER_ADMIN_UUID>'::UUID,
  'impersonation',
  1,
  'impersonation.started',
  jsonb_build_object(
    'session_id', 'test_session_001',
    'super_admin', jsonb_build_object(
      'user_id', '<SUPER_ADMIN_UUID>',
      'email', 'admin@a4c.com',
      'name', 'Test Admin',
      'org_id', 'org_a4c_platform'
    ),
    'target', jsonb_build_object(
      'user_id', '<TARGET_USER_UUID>',
      'email', 'user@provider.com',
      'name', 'Test User',
      'org_id', 'org_test_provider',
      'org_name', 'Test Provider',
      'org_type', 'provider'
    ),
    'justification', jsonb_build_object(
      'reason', 'training',
      'notes', 'Testing impersonation system'
    ),
    'session_config', jsonb_build_object(
      'duration', 1800000,
      'expires_at', (NOW() + INTERVAL '30 minutes')::text
    )
  ),
  jsonb_build_object(
    'user_id', '<SUPER_ADMIN_UUID>',
    'reason', 'Test impersonation.started event'
  )
);

-- Verify projection was created
SELECT * FROM impersonation_sessions_projection
WHERE session_id = 'test_session_001';
-- Expected: 1 row with status = 'active'

-- Verify helper functions work
SELECT * FROM get_user_active_impersonation_sessions('<SUPER_ADMIN_UUID>'::UUID);
-- Expected: 1 active session

SELECT * FROM is_impersonation_session_active('test_session_001');
-- Expected: TRUE

-- Clean up test data
DELETE FROM impersonation_sessions_projection WHERE session_id = 'test_session_001';
DELETE FROM domain_events WHERE event_data->>'session_id' = 'test_session_001';
```

---

## Phase 2: Backend Service Implementation

### Step 1: Redis Session Store

Create Redis session management service:

```typescript
// src/services/impersonation/session-store.ts
import { Redis } from 'ioredis';

export interface ImpersonationSession {
  sessionId: string;
  superAdminId: string;
  targetUserId: string;
  targetOrgId: string;
  startedAt: Date;
  expiresAt: Date;
  renewalCount: number;
  justification: {
    reason: 'support_ticket' | 'emergency' | 'audit' | 'training';
    referenceId?: string;
    notes?: string;
  };
  lastActivity: Date;
}

export class ImpersonationSessionStore {
  private redis: Redis;
  private readonly SESSION_TTL = 1800; // 30 minutes in seconds

  constructor(redis: Redis) {
    this.redis = redis;
  }

  async create(session: ImpersonationSession): Promise<void> {
    const key = `impersonation:${session.sessionId}`;
    await this.redis.setex(
      key,
      this.SESSION_TTL,
      JSON.stringify(session)
    );
  }

  async get(sessionId: string): Promise<ImpersonationSession | null> {
    const key = `impersonation:${sessionId}`;
    const data = await this.redis.get(key);
    if (!data) return null;
    return JSON.parse(data);
  }

  async renew(sessionId: string): Promise<void> {
    const session = await this.get(sessionId);
    if (!session) {
      throw new Error('Session not found');
    }

    session.renewalCount += 1;
    session.expiresAt = new Date(Date.now() + this.SESSION_TTL * 1000);
    session.lastActivity = new Date();

    await this.create(session);
  }

  async delete(sessionId: string): Promise<void> {
    const key = `impersonation:${sessionId}`;
    await this.redis.del(key);
  }

  async exists(sessionId: string): Promise<boolean> {
    const key = `impersonation:${sessionId}`;
    const exists = await this.redis.exists(key);
    return exists === 1;
  }
}
```

### Step 2: Event Emitter Integration

Create service to emit impersonation lifecycle events:

```typescript
// src/services/impersonation/event-emitter.ts
import { EventEmitter } from '@/lib/events/event-emitter';

export class ImpersonationEventEmitter {
  private eventEmitter: EventEmitter;

  constructor(eventEmitter: EventEmitter) {
    this.eventEmitter = eventEmitter;
  }

  async emitStarted(session: ImpersonationSession): Promise<void> {
    await this.eventEmitter.emit(
      session.superAdminId,
      'impersonation',
      'impersonation.started',
      {
        session_id: session.sessionId,
        super_admin: {
          user_id: session.superAdmin.userId,
          email: session.superAdmin.email,
          name: session.superAdmin.name,
          org_id: session.superAdmin.orgId
        },
        target: {
          user_id: session.target.userId,
          email: session.target.email,
          name: session.target.name,
          org_id: session.target.orgId,
          org_name: session.target.orgName,
          org_type: session.target.orgType
        },
        justification: session.justification,
        session_config: {
          duration: 1800000,
          expires_at: session.expiresAt.toISOString()
        },
        ip_address: session.ipAddress,
        user_agent: session.userAgent
      },
      `Super Admin started impersonation session for ${session.justification.reason}`
    );
  }

  async emitRenewed(
    sessionId: string,
    superAdminId: string,
    renewalCount: number,
    previousExpiresAt: Date,
    newExpiresAt: Date,
    targetUserId: string,
    targetOrgId: string
  ): Promise<void> {
    await this.eventEmitter.emit(
      superAdminId,
      'impersonation',
      'impersonation.renewed',
      {
        session_id: sessionId,
        renewal_count: renewalCount,
        previous_expires_at: previousExpiresAt.toISOString(),
        new_expires_at: newExpiresAt.toISOString(),
        total_duration: 1800000 * (renewalCount + 1),
        target_user_id: targetUserId,
        target_org_id: targetOrgId
      },
      `Impersonation session renewed (renewal #${renewalCount})`
    );
  }

  async emitEnded(
    sessionId: string,
    superAdminId: string,
    reason: 'manual_logout' | 'timeout' | 'renewal_declined' | 'forced_by_admin',
    totalDuration: number,
    renewalCount: number,
    actionsPerformed: number,
    targetUserId: string,
    targetOrgId: string,
    startedAt: Date,
    endedAt: Date,
    targetEmail: string,
    targetOrgName: string,
    endedBy?: string
  ): Promise<void> {
    await this.eventEmitter.emit(
      superAdminId,
      'impersonation',
      'impersonation.ended',
      {
        session_id: sessionId,
        reason,
        total_duration: totalDuration,
        renewal_count: renewalCount,
        actions_performed: actionsPerformed,
        target_user_id: targetUserId,
        target_org_id: targetOrgId,
        ended_by: endedBy,
        summary: {
          started_at: startedAt.toISOString(),
          ended_at: endedAt.toISOString(),
          target_user: targetEmail,
          target_org: targetOrgName
        }
      },
      `Impersonation session ended: ${reason}`
    );
  }
}
```

### Step 3: Impersonation Service

Create main service coordinating session management and events:

```typescript
// src/services/impersonation/impersonation.service.ts
import { ImpersonationSessionStore } from './session-store';
import { ImpersonationEventEmitter } from './event-emitter';
import { JWTService } from '@/services/auth/jwt.service';
import { PermissionService } from '@/services/auth/permission.service';

export class ImpersonationService {
  constructor(
    private sessionStore: ImpersonationSessionStore,
    private eventEmitter: ImpersonationEventEmitter,
    private jwtService: JWTService,
    private permissionService: PermissionService
  ) {}

  async start(
    superAdminId: string,
    targetUserId: string,
    justification: Justification,
    ipAddress?: string,
    userAgent?: string
  ): Promise<{ session: ImpersonationSession; jwt: string }> {
    // 1. Verify permission
    const hasPermission = await this.permissionService.hasPermission(
      superAdminId,
      'provider.impersonate'
    );
    if (!hasPermission) {
      throw new Error('User does not have impersonation permission');
    }

    // 2. Verify MFA (assume MFA service checks this)
    // await this.mfaService.verify(superAdminId);

    // 3. Fetch target user details
    const targetUser = await this.getUserDetails(targetUserId);

    // 4. Create session
    const sessionId = generateUUID();
    const session: ImpersonationSession = {
      sessionId,
      superAdminId,
      targetUserId,
      targetOrgId: targetUser.orgId,
      startedAt: new Date(),
      expiresAt: new Date(Date.now() + 30 * 60 * 1000),
      renewalCount: 0,
      justification,
      lastActivity: new Date(),
      // ... additional fields
    };

    // 5. Store in Redis
    await this.sessionStore.create(session);

    // 6. Emit event
    await this.eventEmitter.emitStarted(session);

    // 7. Generate JWT with impersonation context
    const jwt = await this.jwtService.generateImpersonationToken(
      targetUser,
      {
        sessionId,
        originalUserId: superAdminId,
        originalEmail: superAdmin.email,
        targetUserId,
        expiresAt: session.expiresAt.toISOString()
      }
    );

    return { session, jwt };
  }

  async renew(sessionId: string): Promise<ImpersonationSession> {
    // 1. Fetch session
    const session = await this.sessionStore.get(sessionId);
    if (!session) {
      throw new Error('Session not found or expired');
    }

    // 2. Check not already expired
    if (new Date(session.expiresAt) < new Date()) {
      throw new Error('Cannot renew expired session');
    }

    // 3. Renew in Redis
    const previousExpiresAt = session.expiresAt;
    await this.sessionStore.renew(sessionId);

    // 4. Fetch updated session
    const updatedSession = await this.sessionStore.get(sessionId);
    if (!updatedSession) {
      throw new Error('Session disappeared during renewal');
    }

    // 5. Emit event
    await this.eventEmitter.emitRenewed(
      sessionId,
      session.superAdminId,
      updatedSession.renewalCount,
      previousExpiresAt,
      updatedSession.expiresAt,
      session.targetUserId,
      session.targetOrgId
    );

    return updatedSession;
  }

  async end(
    sessionId: string,
    reason: 'manual_logout' | 'timeout' | 'renewal_declined' | 'forced_by_admin',
    endedBy?: string
  ): Promise<void> {
    // 1. Fetch session
    const session = await this.sessionStore.get(sessionId);
    if (!session) {
      // Already ended or expired
      return;
    }

    // 2. Calculate metrics
    const endedAt = new Date();
    const totalDuration = endedAt.getTime() - session.startedAt.getTime();
    const actionsPerformed = await this.countActions(sessionId);

    // 3. Emit event
    await this.eventEmitter.emitEnded(
      sessionId,
      session.superAdminId,
      reason,
      totalDuration,
      session.renewalCount,
      actionsPerformed,
      session.targetUserId,
      session.targetOrgId,
      session.startedAt,
      endedAt,
      targetUser.email,
      targetUser.orgName,
      endedBy
    );

    // 4. Delete from Redis
    await this.sessionStore.delete(sessionId);
  }

  async validateSession(sessionId: string): Promise<boolean> {
    return await this.sessionStore.exists(sessionId);
  }

  private async countActions(sessionId: string): Promise<number> {
    // Query domain_events for actions performed during session
    const result = await supabase
      .from('domain_events')
      .select('id', { count: 'exact', head: true })
      .eq('event_metadata->>impersonation_session_id', sessionId)
      .not('event_type', 'like', 'impersonation.%');

    return result.count || 0;
  }
}
```

---

## Phase 3: Frontend Integration

### Step 1: Generate TypeScript Types

```bash
cd infrastructure/supabase
./scripts/generate-contracts.sh
```

This generates:
- `contracts/generated/typescript/impersonation-event-types.ts` - Impersonation event types

### Step 2: Copy Types to Frontend

```bash
cd ../../frontend
cp ../infrastructure/supabase/contracts/generated/typescript/impersonation-event-types.ts src/types/events/
```

### Step 3: Create Impersonation Context

```typescript
// src/contexts/ImpersonationContext.tsx
import React, { createContext, useContext, useState, useEffect } from 'react';
import { ImpersonationService } from '@/services/impersonation/impersonation.service';

interface ImpersonationContextValue {
  isImpersonating: boolean;
  sessionId: string | null;
  targetUser: UserInfo | null;
  expiresAt: Date | null;
  timeRemaining: number; // milliseconds
  renewSession: () => Promise<void>;
  endSession: () => Promise<void>;
}

const ImpersonationContext = createContext<ImpersonationContextValue | null>(null);

export function ImpersonationProvider({ children }: { children: React.ReactNode }) {
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [expiresAt, setExpiresAt] = useState<Date | null>(null);
  const [timeRemaining, setTimeRemaining] = useState<number>(0);

  // Parse JWT for impersonation context
  useEffect(() => {
    const jwt = localStorage.getItem('jwt');
    if (jwt) {
      const payload = parseJWT(jwt);
      if (payload.impersonation) {
        setSessionId(payload.impersonation.sessionId);
        setExpiresAt(new Date(payload.impersonation.expiresAt));
      }
    }
  }, []);

  // Countdown timer
  useEffect(() => {
    if (!expiresAt) return;

    const interval = setInterval(() => {
      const remaining = expiresAt.getTime() - Date.now();
      setTimeRemaining(Math.max(0, remaining));

      // Show renewal modal at 1 minute warning
      if (remaining <= 60000 && remaining > 59000) {
        showRenewalModal();
      }

      // Auto-logout on expiry
      if (remaining <= 0) {
        handleTimeout();
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [expiresAt]);

  const renewSession = async () => {
    if (!sessionId) return;
    const updated = await impersonationService.renew(sessionId);
    setExpiresAt(new Date(updated.expiresAt));
  };

  const endSession = async () => {
    if (!sessionId) return;
    await impersonationService.end(sessionId, 'manual_logout');
    setSessionId(null);
    setExpiresAt(null);
    window.location.href = '/dashboard'; // Redirect to normal view
  };

  const value = {
    isImpersonating: !!sessionId,
    sessionId,
    targetUser,
    expiresAt,
    timeRemaining,
    renewSession,
    endSession
  };

  return (
    <ImpersonationContext.Provider value={value}>
      {children}
    </ImpersonationContext.Provider>
  );
}

export function useImpersonation() {
  const context = useContext(ImpersonationContext);
  if (!context) {
    throw new Error('useImpersonation must be used within ImpersonationProvider');
  }
  return context;
}
```

### Step 4: Visual Indicators

```typescript
// src/components/ImpersonationBanner.tsx
import { useImpersonation } from '@/contexts/ImpersonationContext';

export function ImpersonationBanner() {
  const { isImpersonating, targetUser, timeRemaining, endSession } = useImpersonation();

  if (!isImpersonating) return null;

  const minutes = Math.floor(timeRemaining / 60000);
  const seconds = Math.floor((timeRemaining % 60000) / 1000);

  return (
    <div className="impersonation-banner">
      <div className="banner-content">
        <span className="warning-icon">⚠️</span>
        <span>
          Impersonating: <strong>{targetUser?.email}</strong>
        </span>
        <span className="timer">
          {minutes}:{seconds.toString().padStart(2, '0')} remaining
        </span>
        <button onClick={endSession} className="end-button">
          End Impersonation
        </button>
      </div>
    </div>
  );
}

// src/styles/impersonation.css
.impersonation-banner {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  background-color: #dc2626;
  color: white;
  padding: 12px;
  z-index: 9999;
  box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
}

body.impersonating {
  border: 4px solid #dc2626;
  min-height: 100vh;
}
```

### Step 5: Renewal Modal

```typescript
// src/components/ImpersonationRenewalModal.tsx
import { useImpersonation } from '@/contexts/ImpersonationContext';

export function ImpersonationRenewalModal() {
  const { timeRemaining, renewSession, endSession } = useImpersonation();

  // Only show when less than 1 minute remaining
  if (timeRemaining > 60000) return null;

  return (
    <div className="modal-overlay">
      <div className="renewal-modal">
        <h2>Impersonation Session Expiring</h2>
        <p>Your impersonation session will expire in {Math.floor(timeRemaining / 1000)} seconds.</p>
        <div className="modal-actions">
          <button onClick={renewSession} className="primary">
            Continue Impersonation (+30 min)
          </button>
          <button onClick={endSession} className="secondary">
            End Now
          </button>
        </div>
      </div>
    </div>
  );
}
```

---

## Phase 4: Middleware and Request Handling

### Step 1: JWT Validation Middleware

```typescript
// src/middleware/impersonation-validator.ts
export async function validateImpersonationSession(req, res, next) {
  const jwt = req.headers.authorization?.replace('Bearer ', '');
  if (!jwt) return next();

  const payload = parseJWT(jwt);
  if (!payload.impersonation) return next();

  // Validate session still exists in Redis
  const sessionId = payload.impersonation.sessionId;
  const exists = await impersonationService.validateSession(sessionId);

  if (!exists) {
    return res.status(401).json({ error: 'Impersonation session expired or invalid' });
  }

  // Add impersonation metadata to all events emitted during request
  req.impersonationContext = {
    sessionId,
    originalUserId: payload.impersonation.originalUserId,
    targetUserId: payload.sub
  };

  next();
}
```

### Step 2: Event Metadata Injection

```typescript
// src/lib/events/event-emitter.ts (modified)
export class EventEmitter {
  async emit(
    streamId: string,
    streamType: string,
    eventType: string,
    data: any,
    reason: string
  ) {
    const metadata: EventMetadata = {
      userId: getCurrentUserId(),
      orgId: getCurrentOrgId(),
      timestamp: new Date().toISOString()
    };

    // Inject impersonation metadata if session active
    if (req.impersonationContext) {
      metadata.performedBy = req.impersonationContext.targetUserId;
      metadata.impersonatedBy = req.impersonationContext.originalUserId;
      metadata.impersonationSessionId = req.impersonationContext.sessionId;
    }

    await supabase.from('domain_events').insert({
      stream_id: streamId,
      stream_type: streamType,
      event_type: eventType,
      event_data: data,
      event_metadata: metadata
    });
  }
}
```

---

## Phase 5: Testing & Validation

### Integration Test Checklist

- [ ] Super Admin can start impersonation session
- [ ] Impersonation.started event created in domain_events
- [ ] Session stored in Redis with 30-minute TTL
- [ ] Projection table updated with active session
- [ ] JWT generated with impersonation context
- [ ] Visual indicators appear (red border, banner)
- [ ] Timer countdown displays correctly
- [ ] Renewal modal appears at 1-minute warning
- [ ] Session can be renewed (event emitted, TTL extended)
- [ ] Session can be manually ended (event emitted, Redis cleared)
- [ ] Session auto-expires on timeout (cleanup job runs)
- [ ] All user actions include impersonation metadata
- [ ] Audit queries return correct results

### Security Test Checklist

- [ ] Non-super-admin users cannot impersonate
- [ ] Impersonation requires MFA
- [ ] Justification is required (validation fails without it)
- [ ] Cannot impersonate while already impersonating
- [ ] Expired JWT cannot access resources
- [ ] Session validation checks Redis on every request
- [ ] Deleting Redis session immediately invalidates access

### Compliance Test Checklist

- [ ] All lifecycle events (started, renewed, ended) logged
- [ ] Action events include impersonation metadata
- [ ] Audit queries return complete session history
- [ ] Projection table matches event store
- [ ] Helper functions return accurate results

---

## Phase 6: Monitoring & Observability

### Key Metrics

1. **Active Sessions**: `SELECT COUNT(*) FROM impersonation_sessions_projection WHERE status = 'active'`
2. **Average Session Duration**: `SELECT AVG(total_duration_ms) FROM impersonation_sessions_projection`
3. **Renewal Rate**: `SELECT AVG(renewal_count) FROM impersonation_sessions_projection`
4. **Justification Breakdown**: `SELECT justification_reason, COUNT(*) FROM impersonation_sessions_projection GROUP BY justification_reason`

### Alerts

- Alert when active sessions exceed threshold (e.g., 10+)
- Alert on sessions with 3+ renewals (unusual prolonged access)
- Alert on emergency justifications (require follow-up)
- Alert on forced terminations (investigate why)

---

## Troubleshooting

### Issue: Session validation fails despite valid JWT

**Diagnosis:**
```sql
-- Check if session exists in projection
SELECT * FROM impersonation_sessions_projection WHERE session_id = '<SESSION_ID>';

-- Check event was processed
SELECT * FROM domain_events
WHERE event_type = 'impersonation.started'
  AND event_data->>'session_id' = '<SESSION_ID>';
```

**Solution:** Redis session may have expired but JWT still valid. Ensure TTL matches JWT expiry.

### Issue: Projection table not updating

**Diagnosis:**
```sql
-- Check unprocessed events
SELECT * FROM domain_events
WHERE processed_at IS NULL
  AND stream_type = 'impersonation';

-- Check for processing errors
SELECT * FROM domain_events
WHERE processing_error IS NOT NULL
  AND stream_type = 'impersonation'
ORDER BY created_at DESC;
```

**Solution:** Review error message, fix event processor function if needed.

### Issue: Timer not counting down

**Diagnosis:** Check browser console for JavaScript errors. Verify `expiresAt` timestamp is in future.

**Solution:** Ensure JWT includes valid impersonation context with future expiry.

---

## Rollout Plan

### Stage 1: Development Testing (Week 1)
- Deploy to local dev environment
- Manual testing of full lifecycle
- Security validation
- Performance benchmarks

### Stage 2: Staging Validation (Week 2)
- Deploy to staging with realistic data
- Load test with multiple concurrent sessions
- Security audit
- Compliance review

### Stage 3: Production Rollout (Week 3)
- Deploy to production (feature flagged)
- Enable for internal A4C users only
- Monitor for 48 hours
- Gradually enable for all super admins

---

## Appendix

### A. Quick Reference: SQL Functions

- `process_impersonation_event(event)` - Event processor (automatic via trigger)
- `get_user_active_impersonation_sessions(user_id)` - Get user's active sessions
- `get_org_impersonation_audit(org_id, start_date, end_date)` - Org audit trail
- `is_impersonation_session_active(session_id)` - Check if session active
- `get_impersonation_session_details(session_id)` - Session details for Redis sync

### B. Event Type Reference

- `impersonation.started` - Session initiated
- `impersonation.renewed` - Session extended
- `impersonation.ended` - Session terminated

### C. Redis Key Pattern

- Key: `impersonation:{sessionId}`
- TTL: 1800 seconds (30 minutes)
- Value: JSON-serialized ImpersonationSession object

---

**Document Version**: 1.0
**Last Updated**: 2025-10-09
**Status**: Ready for Implementation
**Owner**: A4C Development Team
