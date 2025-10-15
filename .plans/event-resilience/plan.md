# Event Resilience and Error Recovery Plan

## Overview

This document outlines the plan for implementing event resilience and error recovery mechanisms in the A4C Frontend application. The goal is to ensure events are reliably delivered even in the face of network failures, temporary outages, and other transient errors.

## Current State Analysis

### What We Have

- ✅ Event emitter with basic validation (reason, event type format)
- ✅ Event schema validation for required fields
- ✅ Supabase integration for event storage
- ✅ Real-time event subscriptions via Supabase channels
- ✅ Event history retrieval
- ✅ Batch event emission

### What's Missing

- ❌ Offline queue for failed events
- ❌ Automatic retry mechanism with exponential backoff
- ❌ Network status detection
- ❌ Event persistence during offline periods
- ❌ Circuit breaker pattern for failing services
- ❌ Event reconciliation after reconnection

## Problem Statement

Healthcare applications require high reliability for event delivery. Critical events like medication administration, client admission, or discharge must not be lost due to:

1. **Network Failures**: Temporary loss of connectivity
2. **Service Outages**: Supabase or backend service temporarily unavailable
3. **Rate Limiting**: Too many requests in a short period
4. **Client-Side Errors**: Browser crashes, page refreshes during event emission
5. **Cross-Tenant Audit Events**: Provider Partner access disclosure tracking MUST be synchronous (HIPAA compliance, no IndexedDB queue - data leakage risk)
6. **Impersonation Audit Events**: Session lifecycle events cannot be lost (compliance requirement for Super Admin impersonation)

## Proposed Solution

### Architecture Components

```
┌─────────────────────────────────────────────────────────────────────┐
│                        Application Layer                             │
│                    (ViewModels, Components)                          │
└──────────────────────┬──────────────────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────────────────┐
│                  Resilient Event Emitter                             │
│  - Wraps EventEmitter with resilience features                      │
│  - Detects failures and queues events                                │
│  - EXCEPTION: Cross-tenant audit + impersonation events → Sync only │
│  - Manages retry logic                                               │
└──────────────────────┬──────────────────────────────────────────────┘
                       │
           ┌───────────┴───────────┐
           ▼                       ▼
┌──────────────────┐    ┌──────────────────────────────┐
│   Event Queue    │    │   Network Monitor            │
│  - IndexedDB     │    │  - Online/offline detection  │
│  - Pending queue │    │  - Connection quality check  │
│  - Failed queue  │    │  - Retry trigger             │
└──────────────────┘    └──────────────────────────────┘
           │
           ▼
┌─────────────────────────────────────────────────────────────────────┐
│                      Event Emitter                                   │
│              (Current Implementation)                                │
└──────────────────────┬──────────────────────────────────────────────┘
                       │
                       ▼
              ┌────────────────┐
              │    Supabase    │
              └────────────────┘
```

### Component Specifications

#### 1. Event Queue (`event-queue.ts`)

**Purpose**: Persist events locally when they cannot be immediately sent.

**Features**:
- IndexedDB for durable storage
- Two queues:
  - **Pending Queue**: Events waiting to be sent
  - **Failed Queue**: Events that failed after retries
- Queue operations:
  - `enqueue(event)`: Add event to pending queue
  - `dequeue()`: Get next pending event
  - `moveTo FailedQueue(eventId)`: Move to failed queue after max retries
  - `retry(eventId)`: Move from failed back to pending
  - `clear()`: Clear all queues
  - `getStatistics()`: Get queue health metrics

**Schema**:
```typescript
interface QueuedEvent {
  id: string;
  event: DomainEvent;
  attempts: number;
  lastAttempt: Date | null;
  nextRetry: Date;
  error?: string;
  createdAt: Date;
}
```

**Storage Strategy**:
- IndexedDB database: `a4c-event-queue`
- Object stores:
  - `pending-events`: Events to be sent
  - `failed-events`: Events that exceeded retry limit
- Indexes:
  - `nextRetry`: For efficient retry scheduling
  - `createdAt`: For chronological ordering

#### 2. Network Monitor (`network-monitor.ts`)

**Purpose**: Track network connectivity and trigger event processing.

**Features**:
- Online/offline detection via `navigator.onLine`
- Connection quality estimation (optional)
- Event triggers:
  - `onOnline`: Network restored
  - `onOffline`: Network lost
  - `onQualityChange`: Connection quality changed
- Automatic event queue processing on reconnection

**Implementation**:
```typescript
class NetworkMonitor {
  isOnline(): boolean;
  subscribe(callback: (online: boolean) => void): () => void;
  checkConnection(): Promise<boolean>;
}
```

#### 3. Resilient Event Emitter (`resilient-event-emitter.ts`)

**Purpose**: Wrap EventEmitter with automatic retry and queue management.

**Features**:
- Transparent failover to queue on network errors
- Automatic retry with exponential backoff
- Circuit breaker pattern
- Event correlation (track related events)
- Health reporting

**Retry Strategy**:
- **Initial Delay**: 1 second
- **Max Delay**: 5 minutes
- **Backoff Factor**: 2x
- **Max Attempts**: 5
- **Jitter**: ±20% randomization to prevent thundering herd

**Retry Schedule Example**:
```
Attempt 1: Immediate
Attempt 2: 1 second
Attempt 3: 2 seconds
Attempt 4: 4 seconds
Attempt 5: 8 seconds
Failed: Move to failed queue
```

**Circuit Breaker**:
- **Closed**: Normal operation
- **Open**: Stop trying after N consecutive failures (5)
- **Half-Open**: Test with single request after timeout (30s)

**Implementation**:
```typescript
class ResilientEventEmitter {
  async emit(
    streamId: string,
    streamType: StreamType,
    eventType: string,
    eventData: any,
    reason: string
  ): Promise<DomainEvent>;

  async processQueue(): Promise<void>;
  getHealth(): HealthStatus;
}

interface HealthStatus {
  isOnline: boolean;
  queueSize: number;
  failedCount: number;
  circuitBreakerState: 'closed' | 'open' | 'half-open';
  lastSuccess: Date | null;
  lastFailure: Date | null;
}
```

## Implementation Plan

### Phase 1: Event Queue (Priority: HIGH)
**Estimated Time**: 2-3 hours

1. Create `event-queue.ts`
2. Set up IndexedDB schema and initialization
3. Implement queue operations (enqueue, dequeue, move to failed)
4. Add comprehensive error handling
5. Write unit tests for queue operations

**Files**:
- `src/lib/events/event-queue.ts`
- `src/lib/events/__tests__/event-queue.test.ts`

### Phase 2: Network Monitor (Priority: HIGH)
**Estimated Time**: 1-2 hours

1. Create `network-monitor.ts`
2. Implement online/offline detection
3. Add subscription system for status changes
4. Integrate with browser visibility API (pause when tab hidden)
5. Write unit tests

**Files**:
- `src/lib/events/network-monitor.ts`
- `src/lib/events/__tests__/network-monitor.test.ts`

### Phase 3: Resilient Event Emitter (Priority: HIGH)
**Estimated Time**: 3-4 hours

1. Create `resilient-event-emitter.ts`
2. Implement retry logic with exponential backoff
3. Integrate EventQueue for failed events
4. Implement circuit breaker pattern
5. Add health monitoring and metrics
6. Process queue on network restoration
7. Write comprehensive tests

**Files**:
- `src/lib/events/resilient-event-emitter.ts`
- `src/lib/events/__tests__/resilient-event-emitter.test.ts`

### Phase 4: Integration and Migration (Priority: MEDIUM)
**Estimated Time**: 2-3 hours

1. Create migration guide for existing code
2. Update ViewModels to use ResilientEventEmitter
3. Add health dashboard component (optional)
4. Update documentation
5. End-to-end testing

**Files**:
- `docs/EVENT-DRIVEN-GUIDE.md` (update)
- `src/components/EventHealthDashboard.tsx` (optional)

### Phase 5: Monitoring and Observability (Priority: LOW)
**Estimated Time**: 1-2 hours

1. Add event metrics (success rate, retry count, queue size)
2. Log critical events for debugging
3. Create developer tools for queue inspection
4. Add Sentry/error tracking integration

## Success Criteria

### Functional Requirements

- ✅ Events are never lost due to network failures
- ✅ Automatic retry with exponential backoff
- ✅ Events are processed in order (FIFO)
- ✅ Failed events are stored for manual review
- ✅ Queue processes automatically on reconnection
- ✅ Circuit breaker prevents excessive retries

### Non-Functional Requirements

- ✅ Performance: < 50ms latency for queue operations
- ✅ Storage: Support up to 10,000 queued events
- ✅ Memory: < 10MB memory footprint
- ✅ Battery: Minimal impact on mobile devices
- ✅ UX: User feedback for offline state

## Error Scenarios and Handling

### Scenario 1: Network Disconnection During Event Emission
**Trigger**: WiFi/cellular connection lost
**Behavior**:
1. EventEmitter throws network error
2. ResilientEventEmitter catches error
3. Event queued to IndexedDB pending queue
4. User sees toast: "Event saved. Will sync when online."
5. NetworkMonitor triggers `processQueue()` on reconnection
6. Event successfully sent, removed from queue

### Scenario 2: Supabase Service Outage
**Trigger**: Supabase returns 503 Service Unavailable
**Behavior**:
1. ResilientEventEmitter receives error
2. Circuit breaker increments failure count
3. Event queued for retry with backoff
4. After 5 failures, circuit opens
5. Subsequent events immediately queued (no retry attempts)
6. Circuit half-opens after 30s, tests with single event
7. Success closes circuit, normal operation resumes

### Scenario 3: Browser Crash Mid-Event
**Trigger**: Browser tab crashes during event emission
**Behavior**:
1. Event was added to IndexedDB queue first
2. On next app load, queue is checked
3. Pending events are processed
4. Duplicates prevented by database constraints

### Scenario 4: Rate Limiting (429 Too Many Requests)
**Trigger**: Too many events sent in short period
**Behavior**:
1. Supabase returns 429 with Retry-After header
2. ResilientEventEmitter respects Retry-After
3. Event queued with nextRetry = now + Retry-After
4. Queue processor waits for appropriate time
5. Event retried when allowed

### Scenario 5: Quota Exceeded (IndexedDB Full)
**Trigger**: 50MB IndexedDB quota exceeded
**Behavior**:
1. Queue write fails with QuotaExceededError
2. Display critical error to user
3. Option to manually sync or clear old failed events
4. Log to error tracking service
5. Degrade gracefully: continue without queue

### Scenario 6: Impersonation Session During Network Failure
**Trigger**: Super Admin impersonating user, network disconnects mid-session
**Behavior**:
1. `impersonation.started` event already sent (synchronous at session start)
2. User actions during session queued (standard event resilience)
3. `impersonation.renewed` event attempted, fails, queued
4. On timeout: Local-only `impersonation.ended` event with special flag
5. On reconnection:
   - Send queued user action events (with impersonation metadata)
   - Send queued renewal events
   - Send deferred `impersonation.ended` event
6. Server reconciles session timeline from events

**Critical:** Session timeout still enforced client-side even if network offline.

### Scenario 7: VAR Partner Cross-Tenant Access During Network Failure
**Trigger**: VAR Partner (Value-Added Reseller) user attempts to access Provider data while offline

**Organizational Context:**
- All Provider organizations exist at root level in Zitadel (flat structure)
- VAR Partner organizations also exist at root level (NOT hierarchical parent of Providers)
- VAR partnerships tracked in `var_partnerships_projection` table (event-sourced metadata)
- Cross-tenant access via `cross_tenant_access_grants_projection` (NOT Zitadel hierarchy)

**Behavior**:
1. Access MUST be blocked if audit event cannot be written synchronously
2. User sees: "Network required for compliance audit logging. Cross-tenant access requires real-time disclosure tracking."
3. No IndexedDB queue for cross-tenant audit (prevents data exposure if device stolen)
4. Rationale: HIPAA requires disclosure tracking before data access
5. VAR partnership metadata validation requires online connection:
   - Check `var_partnerships_projection.status = 'active'`
   - Validate `contract_end_date` has not expired
   - Verify `cross_tenant_access_grants_projection.revoked_at IS NULL`

**Security Note:** Cross-tenant audit events contain sensitive metadata (who accessed which org, partnership status, grant IDs) and must not be persisted in client-accessible storage.

**Enhanced Cross-Tenant Event Metadata:**
```typescript
{
  eventType: 'client.viewed',
  streamId: 'client_uuid',
  streamType: 'client',
  metadata: {
    userId: 'var_consultant_uuid',
    orgId: 'provider_org_uuid',  // Cross-tenant access (not consultant's org)
    crossTenantAccess: {
      consultantOrgId: 'var_partner_org_uuid',  // VAR Partner org (root level)
      grantId: 'grant_uuid',
      authorizationType: 'var_contract',
      partnershipId: 'partnership_uuid',  // Reference to var_partnerships_projection
      partnershipStatus: 'active',  // Validated at access time
      contractEndDate: '2026-12-31'  // For audit purposes
    },
    timestamp: '2025-10-09T...'
  }
}
```

**Related Architecture:**
- `.plans/consolidated/agent-observations.md` - Hierarchy model, VAR partnerships
- `.plans/auth-integration/tenants-as-organization-thoughts.md` - Flat Provider structure
- `.plans/multi-tenancy/multi-tenancy-organization.html` - VAR partnerships as metadata

## Testing Strategy

### Unit Tests

- Event Queue CRUD operations
- Retry logic and backoff calculation
- Circuit breaker state transitions
- Network monitor status changes

### Integration Tests

- Queue → EventEmitter flow
- Network monitor → Queue processor trigger
- Failed event recovery

### End-to-End Tests

- Simulate network disconnection during event emission
- Verify queue processing on reconnection
- Test circuit breaker with repeated failures
- Verify event ordering and deduplication

### Manual Testing Checklist

- [ ] Disconnect WiFi, emit event, reconnect, verify delivery
- [ ] Close tab mid-event, reopen, verify event sent
- [ ] Fill queue with 100 events offline, verify batch processing
- [ ] Trigger rate limiting, verify backoff behavior
- [ ] Exceed IndexedDB quota, verify graceful degradation

## Rollout Plan

### Stage 1: Internal Testing (1 week)
- Deploy to development environment
- Test with synthetic offline scenarios
- Monitor queue health and metrics

### Stage 2: Beta Testing (2 weeks)
- Deploy to staging environment
- Limited user group testing
- Collect feedback on UX and reliability

### Stage 3: Production Rollout (Phased)
- Week 1: 10% of users
- Week 2: 50% of users
- Week 3: 100% of users
- Monitor error rates and queue growth

### Rollback Plan

If critical issues arise:
1. Feature flag to disable resilient emitter
2. Fall back to direct EventEmitter
3. Preserve queued events for later processing
4. Investigate and fix issues
5. Re-enable with additional monitoring

## Monitoring and Alerts

### Key Metrics

- **Queue Growth Rate**: Events/hour added to queue
- **Queue Processing Rate**: Events/hour successfully sent
- **Retry Success Rate**: % of retries that succeed
- **Circuit Breaker State**: Time spent in each state
- **Failed Event Count**: Events in failed queue

### Alerts

- **Critical**: Failed queue > 100 events
- **Warning**: Queue size > 500 events for > 5 minutes
- **Info**: Circuit breaker opened
- **Info**: Queue cleared after reconnection

## Future Enhancements

### Priority 1 (Next Quarter)

- Background sync via Service Workers
- Compression for large event payloads
- Event batching for efficiency
- Conflict resolution for concurrent edits

### Priority 2 (Later)

- Event sourcing projections
- Event replay capability
- Snapshot and restore
- Multi-device synchronization

## Appendices

### A. References

- [Offline First Architecture](https://offlinefirst.org/)
- [Circuit Breaker Pattern](https://martinfowler.com/bliki/CircuitBreaker.html)
- [Exponential Backoff](https://aws.amazon.com/blogs/architecture/exponential-backoff-and-jitter/)
- [IndexedDB API](https://developer.mozilla.org/en-US/docs/Web/API/IndexedDB_API)

### B. Related Documents

#### Platform Architecture
- `.plans/consolidated/agent-observations.md` - Overall architecture (hierarchy model, VAR partnerships)
- `.plans/auth-integration/tenants-as-organization-thoughts.md` - Organizational structure (flat Provider model)
- `.plans/multi-tenancy/multi-tenancy-organization.html` - Multi-tenancy specification (VAR partnerships as metadata)

#### Event-Driven Architecture
- `/docs/EVENT-DRIVEN-GUIDE.md` - Event-driven architecture guide
- `/docs/MIGRATION-FROM-CRUD.md` - Migration from CRUD to events
- `.plans/impersonation/event-schema.md` - Impersonation event schemas (includes VAR context)
- `/infrastructure/supabase/docs/EVENT-DRIVEN-ARCHITECTURE.md` - CQRS foundation

### C. Code Examples

See implementation files for detailed examples of:
- Queue operations
- Retry logic
- Circuit breaker implementation
- Network monitoring

---

**Document Version**: 1.0
**Last Updated**: 2025-10-02
**Status**: Approved for Implementation
**Owner**: A4C Development Team
