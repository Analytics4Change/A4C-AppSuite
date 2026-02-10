---
status: current
last_updated: 2026-02-06
---

<!-- TL;DR-START -->
## TL;DR

**Summary**: Decision guide for choosing between synchronous trigger handlers (projection updates) and async pg_notify + Temporal (side effects like email, DNS, webhooks). Includes decision tree, anti-patterns, and error handling differences.

**When to read**:
- Adding a new event type and deciding how to process it
- Choosing between synchronous projection update vs async workflow
- Understanding why the system has two event processing patterns
- Reviewing whether an API function follows CQRS correctly

**Prerequisites**: [event-handler-pattern.md](./event-handler-pattern.md), [event-driven-workflow-triggering.md](../../architecture/workflows/event-driven-workflow-triggering.md)

**Key topics**: `event-processing-patterns`, `pattern-selection`, `pg-notify-pattern`, `synchronous-handler`, `async-workflow`, `dual-write`

**Estimated read time**: 10 minutes
<!-- TL;DR-END -->

# Event Processing Pattern Selection

A4C-AppSuite uses two distinct patterns for processing domain events. Every new event type must be processed by one or both patterns. This guide explains when to use each.

## The Two Patterns

### Pattern 1: Synchronous Trigger Handler

**Use for**: Projection table updates (read models)

```
API function
  → INSERT INTO domain_events
  → BEFORE INSERT trigger fires (same transaction)
  → process_domain_event() routes by stream_type
  → process_{type}_event() routes by event_type
  → handle_{event}() updates projection table
  → Trigger sets processed_at, returns NEW
  → INSERT completes (projection already updated)
  → API function reads back from projection ← immediate consistency
```

**Characteristics**:
- Synchronous — runs inside the INSERT transaction
- Immediate consistency — projection is updated before INSERT returns
- No external I/O — pure SQL, fast (< 10ms)
- Errors caught — `process_domain_event()` EXCEPTION handler records `processing_error`
- Idempotent — handlers use `ON CONFLICT`

**Example**: Creating a role
```sql
-- In api.create_role():
PERFORM api.emit_domain_event(
  p_stream_type := 'role',
  p_event_type := 'role.created',
  ...
);
-- By the time this returns, roles_projection already has the new row
```

### Pattern 2: Async pg_notify + Temporal

**Use for**: Side effects requiring external I/O, retries, or multi-step orchestration

```
API function / Edge Function
  → INSERT INTO domain_events
  → BEFORE INSERT trigger: projection handler runs (if applicable)
  → Row written to domain_events
  → AFTER INSERT trigger fires
  → pg_notify('workflow_events', payload)
  → Temporal worker receives notification (~5ms)
  → Worker starts Temporal workflow
  → Workflow executes activities (email, DNS, HTTP calls)
  → Activities have retry policies for resilience
```

**Characteristics**:
- Asynchronous — decoupled from the INSERT transaction
- Eventually consistent — side effects happen after commit
- External I/O safe — retries, timeouts, compensation via Temporal
- Observable — Temporal Web UI shows workflow progress
- ~185ms end-to-end latency from event to workflow start

**Example**: Organization bootstrap
```sql
-- Edge Function emits:
INSERT INTO domain_events (event_type, ...) VALUES ('organization.bootstrap.initiated', ...);
-- AFTER trigger sends pg_notify
-- Temporal worker starts organizationBootstrapWorkflow
-- Workflow creates DNS, sends emails, provisions resources
```

## Decision Tree

```
Is this a projection/read-model update?
├─ YES → Pattern 1 (Synchronous Trigger Handler)
│         Examples: user.created, role.permission.granted, organization_unit.updated
│
└─ NO → Does it involve external I/O (email, HTTP, DNS)?
   ├─ YES → Pattern 2 (Async pg_notify + Temporal)
   │         Examples: invitation email, DNS provisioning, webhook delivery
   │
   └─ NO → Does it require multi-step orchestration with compensation?
      ├─ YES → Pattern 2
      │         Examples: organization bootstrap (create org + DNS + admin user + email)
      │
      └─ NO → Does the caller need the result immediately?
         ├─ YES → Pattern 1 (keeps it in the same transaction)
         └─ NO  → Pattern 2 (keeps trigger handlers fast)
```

### Quick Reference Table

| Event Purpose | Pattern | Mechanism | Latency |
|---------------|---------|-----------|---------|
| Update projection table | **Synchronous** | BEFORE trigger → handler | < 10ms |
| Send email | **Async** | AFTER trigger → pg_notify → Temporal → Resend | ~200ms+ |
| Provision DNS | **Async** | AFTER trigger → pg_notify → Temporal → Cloudflare | ~200ms+ |
| Deliver webhook | **Async** | AFTER trigger → pg_notify → Temporal → HTTP POST | ~200ms+ |
| Multi-step onboarding | **Async** | AFTER trigger → pg_notify → Temporal workflow with saga | ~200ms+ |
| Projection + email | **Hybrid** | BEFORE handler (projection) + AFTER trigger (email) | Both |

## Hybrid Pattern

Some events need **both** a projection update and a side effect. Use both patterns together:

```
INSERT INTO domain_events (event_type := 'user.invited', ...)
  ↓
BEFORE INSERT trigger:
  → process_domain_event() → process_invitation_event() → handle_user_invited()
  → INSERT INTO invitations_projection (synchronous, immediate)
  ↓
Row written to domain_events
  ↓
AFTER INSERT trigger:
  → pg_notify('workflow_events', ...) (async, decoupled)
  → Temporal worker → sendInvitationEmailActivity → Resend API
```

The projection is updated synchronously (the frontend can read it back immediately). The email is sent asynchronously (with Temporal retry policies if Resend is down).

## Anti-Patterns

### 1. Direct Projection Writes in API Functions

```sql
-- ❌ WRONG: Bypasses event store, no audit trail, breaks event replay
UPDATE invitations_projection SET status = 'revoked' WHERE id = p_id;

-- ✅ CORRECT: Emit event, let handler update projection
PERFORM api.emit_domain_event(
  p_stream_type := 'invitation',
  p_stream_id := p_id,
  p_event_type := 'invitation.revoked',
  p_event_data := jsonb_build_object('invitation_id', p_id, 'reason', p_reason),
  p_event_metadata := jsonb_build_object('user_id', auth.uid())
);
```

### 2. Dual Writes (Event + Direct Write)

```sql
-- ❌ WRONG: Both the API function and the handler update the same row
UPDATE organizations_projection SET direct_care_settings = v_settings;
PERFORM api.emit_domain_event(..., 'organization.direct_care_settings_updated', ...);
-- The handler ALSO does UPDATE organizations_projection SET direct_care_settings = ...

-- ✅ CORRECT: Only the handler updates the projection
PERFORM api.emit_domain_event(..., 'organization.direct_care_settings_updated', ...);
-- Handler does the UPDATE; API function reads back after emit returns
```

### 3. External I/O in Synchronous Handlers

```sql
-- ❌ WRONG: HTTP call blocks the INSERT transaction
CREATE OR REPLACE FUNCTION handle_user_invited(p_event record)
RETURNS void AS $$
BEGIN
  -- This blocks every domain_events INSERT until the HTTP call returns
  PERFORM http_post('https://api.resend.com/emails', ...);
END; $$;

-- ✅ CORRECT: Use async pattern for external I/O
-- AFTER INSERT trigger → pg_notify → Temporal activity calls Resend
```

### 4. Async Processing for Projection Updates

```sql
-- ❌ WRONG: Eventual consistency for projections causes read-your-own-writes bugs
-- (API function returns before projection is updated)
CREATE TRIGGER async_projection_trigger AFTER INSERT ON domain_events
  FOR EACH ROW EXECUTE FUNCTION notify_projection_worker();

-- ✅ CORRECT: Synchronous BEFORE trigger for projections (immediate consistency)
-- process_domain_event_trigger already handles this
```

## Error Handling

### Pattern 1 (Synchronous): Errors Recorded, Not Raised

```sql
-- In process_domain_event():
EXCEPTION
  WHEN OTHERS THEN
    NEW.processing_error = v_error_msg;  -- Recorded on the event row
    -- Event IS inserted (with error). Projection is NOT updated.
    -- Visible in admin dashboard at /admin/events
    -- Retryable via: SELECT api.retry_failed_event('<event_id>');
```

**Unhandled event types** must RAISE EXCEPTION (not WARNING):

```sql
-- ✅ CORRECT: Exception is caught and recorded in processing_error
ELSE
  RAISE EXCEPTION 'Unhandled event type "%" in process_user_event', p_event.event_type
    USING ERRCODE = 'P9001';

-- ❌ WRONG: Warning is invisible, event marked as successfully processed
ELSE
  RAISE WARNING 'Unknown user event type: %', p_event.event_type;
```

### Pattern 2 (Async): Temporal Retry Policies

```typescript
// Temporal activities have configurable retry policies
const activities = proxyActivities<Activities>({
  startToCloseTimeout: '30 seconds',
  retry: {
    maximumAttempts: 5,
    initialInterval: '1 second',
    backoffCoefficient: 2,
    maximumInterval: '30 seconds',
    nonRetryableErrorTypes: ['ValidationError'],
  },
});
```

Temporal provides:
- Automatic retries with exponential backoff
- Dead letter queue for permanently failed activities
- Saga compensation to roll back partial progress
- Workflow replay for debugging

## Adding a New Event Type: Checklist

1. **Decide the pattern** using the decision tree above
2. **If Pattern 1 (projection update)**:
   - Create handler: `handle_{aggregate}_{action}(p_event record)`
   - Add CASE clause to the appropriate router function
   - Handler uses `ON CONFLICT` for idempotency
   - Handler uses `p_event.created_at` for timestamps (not `NOW()`)
   - See: [event-handler-pattern.md](./event-handler-pattern.md)
3. **If Pattern 2 (async side effect)**:
   - Create AFTER INSERT trigger with WHEN clause for the event type
   - Create `pg_notify` function
   - Create Temporal workflow + activity
   - See: [event-driven-workflow-triggering.md](../../architecture/workflows/event-driven-workflow-triggering.md)
4. **If Hybrid (both)**:
   - Do both steps 2 and 3
   - The BEFORE trigger handles the projection (step 2)
   - The AFTER trigger handles the side effect (step 3)
5. **In all cases**:
   - Include `user_id` and `reason` in event metadata (audit compliance)
   - Add event type to AsyncAPI contract if applicable
   - Update the router/handler table in [event-handler-pattern.md](./event-handler-pattern.md)

## Related Documentation

- [Event Handler Pattern](./event-handler-pattern.md) - How synchronous handlers work (routers, handlers, adding new ones)
- [Event-Driven Workflow Triggering](../../architecture/workflows/event-driven-workflow-triggering.md) - How async pg_notify + Temporal works
- [Event Observability](../../infrastructure/guides/event-observability.md) - Monitoring, tracing, failed events
- [CQRS Dual-Write Audit](../../../dev/archived/cqrs-dual-write-audit/cqrs-dual-write-audit-context.md) - Audit of functions that violate the patterns above
- [Event Sourcing Overview](../../architecture/data/event-sourcing-overview.md) - CQRS architecture overview
