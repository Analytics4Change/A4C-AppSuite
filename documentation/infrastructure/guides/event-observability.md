<!-- TL;DR-START -->
## TL;DR

**Summary**: Guide for monitoring and debugging failed domain events using the event processing observability system.

**When to read**:
- Debugging why an operation silently failed (user created but no role assigned)
- Investigating event processing errors in production
- Setting up error alerting or monitoring dashboards
- Understanding how correlation IDs trace requests across services

**Prerequisites**: Understanding of CQRS event sourcing, access to Supabase dashboard or SQL

**Key topics**: `event-errors`, `observability`, `tracing`, `correlation-id`, `failed-events`, `event-processing`, `debugging`

**Estimated read time**: 10 minutes (full), 3 minutes (relevant sections)
<!-- TL;DR-END -->

# Event Processing & Observability Guide

This guide covers the event processing observability system for the A4C-AppSuite. It explains how to monitor, debug, and retry failed domain events.

## Quick Reference

### Check for Failed Events (SQL)

```sql
-- Count failed events in last 24 hours
SELECT COUNT(*) FROM domain_events
WHERE processing_error IS NOT NULL
  AND created_at > NOW() - INTERVAL '24 hours';

-- Get recent failed events with details
SELECT id, event_type, stream_type, processing_error, created_at
FROM domain_events
WHERE processing_error IS NOT NULL
ORDER BY created_at DESC
LIMIT 20;
```

### Use Admin Dashboard (Frontend)

Navigate to `/admin/events` (requires super_admin role in A4C org) to:
- View failed event statistics
- Search by correlation ID
- Filter by event/stream type
- Retry failed events

### Retry a Failed Event (SQL)

```sql
SELECT * FROM api.retry_failed_event('event-uuid-here');
```

---

## Problem Background

### Silent Failures in Event Processing

Domain events in A4C follow the CQRS pattern:
1. **Event Emission**: Edge Function calls `api.emit_domain_event()`
2. **Event Stored**: Event inserted into `domain_events` table
3. **Trigger Processing**: PostgreSQL trigger calls event processor
4. **Projection Update**: Processor updates read model tables

**The Problem**: Before this observability system, step 3 could fail silently:

```sql
-- Old behavior in process_domain_event()
EXCEPTION
  WHEN OTHERS THEN
    NEW.processing_error = v_error_msg;  -- Stored but NOT raised!
    RETURN NEW;  -- INSERT succeeded, caller saw success
END;
```

**Impact**: Users saw "success" but data was broken:
- User invited but no role assigned
- Organization created but bootstrap incomplete
- Invitation accepted but status not updated

### Error Propagation for Critical Events

The system now propagates errors for **critical events** back to the caller:

**Critical Event Types**:
- `user.created`
- `user.role.assigned`
- `user.role.removed`
- `invitation.accepted`
- `invitation.created`
- `organization.created`
- `organization.bootstrap.completed`

When a critical event's trigger processing fails, `api.emit_domain_event()` raises an exception instead of returning success. Edge Functions catch this and return proper error responses.

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│                           Frontend                                   │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │ Edge Function Error → FunctionsHttpError → User Notification│   │
│  └─────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────┐
│                       Edge Functions                                 │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │ correlation_id = generateCorrelationId()                     │   │
│  │ const { error } = await supabase.rpc('emit_domain_event')   │   │
│  │ if (error) return handleRpcError(error, correlationId)      │   │
│  └─────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────┐
│                    api.emit_domain_event()                          │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │ 1. INSERT event → domain_events table                       │   │
│  │ 2. Trigger: process_domain_event()                          │   │
│  │ 3. If critical event AND processing_error IS NOT NULL:      │   │
│  │    RAISE EXCEPTION 'Event processing failed: %', error      │   │
│  └─────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────┐
│                     Projection Tables                                │
│  ┌──────────────────┐  ┌──────────────────┐  ┌─────────────────┐   │
│  │users_projection │  │roles_projection │  │invitations_proj│   │
│  └──────────────────┘  └──────────────────┘  └─────────────────┘   │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Correlation ID Tracing

### What is a Correlation ID?

A **correlation ID** is a UUID generated at the start of each request that follows the request through all services. It enables:

- Tracing a user action across Edge Functions, database, and logs
- Grouping related events from a single operation
- Debugging failed requests by searching logs/events

### Generating Correlation IDs

**Edge Functions** (Deno/TypeScript):
```typescript
import { generateCorrelationId } from '../_shared/error-response.ts';

serve(async (req) => {
  const correlationId = generateCorrelationId();
  console.log(`[function-name] Processing request, correlation_id=${correlationId}`);

  // Include in event metadata
  await supabase.rpc('emit_domain_event', {
    p_stream_id: entityId,
    p_event_type: 'entity.created',
    p_event_data: { ... },
    p_event_metadata: {
      correlation_id: correlationId,
      user_id: user.id,
      // ...
    }
  });
});
```

### Required Event Metadata

All events emitted via `api.emit_domain_event()` should include:

| Field | Required | Description |
|-------|----------|-------------|
| `correlation_id` | ✅ Yes | Request-level trace ID |
| `user_id` | ✅ Yes | UUID of acting user |
| `organization_id` | When applicable | Org context |
| `source_function` | Recommended | Function name for debugging |
| `reason` | When meaningful | Human-readable justification |
| `ip_address` | Edge Functions | Client IP |
| `user_agent` | Edge Functions | Client info |

---

## Monitoring Failed Events

### RPC Functions

Three RPC functions provide observability:

#### `api.get_failed_events()`

Query events with processing errors:

```sql
SELECT * FROM api.get_failed_events(
  p_limit := 50,           -- Max results (default 50)
  p_event_type := NULL,    -- Filter by event type
  p_stream_type := NULL,   -- Filter by stream type
  p_since := NULL          -- Filter by created_at
);
```

Returns:
- `id` - Event UUID
- `stream_id`, `stream_type`, `event_type`
- `event_data`, `event_metadata`
- `processing_error` - Error message
- `created_at`, `processed_at`

#### `api.retry_failed_event()`

Retry a specific failed event:

```sql
SELECT * FROM api.retry_failed_event(
  p_event_id := 'uuid-of-failed-event'
);
```

Returns:
- `success` - Whether reprocessing succeeded
- `event_id` - The event that was retried
- `new_error` - New error if retry failed, NULL if succeeded
- `retried_at` - Timestamp of retry

#### `api.get_event_processing_stats()`

Get aggregate statistics:

```sql
SELECT * FROM api.get_event_processing_stats();
```

Returns:
- `total_failed` - Total count of failed events
- `failed_last_24h` - Failures in last 24 hours
- `failed_last_7d` - Failures in last 7 days
- `by_event_type` - JSON array of counts per event type
- `by_stream_type` - JSON array of counts per stream type

### Admin Dashboard

The frontend admin dashboard at `/admin/events` provides:

1. **Stats Summary** - Total failures, last 24h, last 7d
2. **Event List** - Filterable table of failed events
3. **Correlation Search** - Find events by correlation ID
4. **Retry Button** - Re-process individual events
5. **Event Details** - Expandable view of event data/metadata

**Access Control**: Platform-owner only (super_admin in Analytics4Change org)

---

## Debugging Workflow

### Scenario: User Invited But No Role

1. **Check if event was emitted**:
   ```sql
   SELECT * FROM domain_events
   WHERE stream_type = 'user'
     AND event_type = 'user.invited'
     AND event_data->>'email' = 'user@example.com'
   ORDER BY created_at DESC
   LIMIT 5;
   ```

2. **Check for processing error**:
   ```sql
   SELECT id, event_type, processing_error, created_at
   FROM domain_events
   WHERE stream_id = '<user_id>'
     AND processing_error IS NOT NULL;
   ```

3. **If error found**, examine the error message and fix root cause

4. **Retry the event**:
   ```sql
   SELECT * FROM api.retry_failed_event('<event_id>');
   ```

### Scenario: Search by Correlation ID

1. **Get correlation ID from logs** (Edge Function logs contain it)

2. **Search in admin dashboard** at `/admin/events`

3. **Or query directly**:
   ```sql
   SELECT * FROM domain_events
   WHERE event_metadata->>'correlation_id' = '<correlation_id>'
   ORDER BY created_at;
   ```

---

## Edge Function Error Handling

All Edge Functions use standardized error handling from `_shared/error-response.ts`:

```typescript
import {
  generateCorrelationId,
  handleRpcError,
  createValidationError,
  createInternalError,
  standardCorsHeaders,
} from '../_shared/error-response.ts';

// Generate correlation ID at request start
const correlationId = generateCorrelationId();

// Handle RPC errors (detects event processing failures)
const { error } = await supabase.rpc('emit_domain_event', {...});
if (error) {
  return handleRpcError(error, correlationId, corsHeaders, 'Emit event');
}

// handleRpcError automatically detects "Event processing failed"
// and returns EVENT_PROCESSING_FAILED error code
```

### Error Response Format

```typescript
interface EdgeFunctionErrorResponse {
  error: string;           // User-friendly message
  code: string;            // Machine-readable code
  details?: string;        // Technical details
  correlation_id?: string; // For tracing
}
```

**Error Codes**:
- `EVENT_PROCESSING_FAILED` - Critical event trigger failed
- `RPC_ERROR` - General database error
- `VALIDATION_ERROR` - Invalid input
- `UNAUTHORIZED`, `FORBIDDEN` - Auth errors
- `NOT_FOUND` - Resource not found
- `INTERNAL_ERROR` - Unhandled exception

---

## Future Enhancements

### Planned Features

1. **Alerting Integration** - Slack/email notifications for critical event failures
2. **Bulk Retry** - Retry all events of a specific type
3. **Event Replay** - Replay all events for a stream to rebuild projections
4. **ELK Integration** - Ship event metadata to Elasticsearch for advanced querying

### Extending the System

To add monitoring for new event types:

1. **Add to critical events** (if error should propagate):
   ```sql
   -- In api.emit_domain_event()
   v_critical_event_types := ARRAY[
     'user.created', 'user.role.assigned', ...
     'new.event.type'  -- Add here
   ];
   ```

2. **Include correlation ID** in all emitters:
   ```typescript
   p_event_metadata: {
     correlation_id: correlationId,
     user_id: user.id,
     source_function: 'new-edge-function',
   }
   ```

---

## Related Documentation

- [Event Sourcing Overview](../../architecture/data/event-sourcing-overview.md) - CQRS architecture
- [Database Tables Reference](../reference/database/tables/) - Schema documentation
- [Edge Functions](../../../infrastructure/supabase/supabase/functions/) - Source code

## Files Modified

| File | Purpose |
|------|---------|
| `infrastructure/supabase/supabase/migrations/20260107002820_event_processing_observability.sql` | RPC functions + error propagation |
| `infrastructure/supabase/supabase/functions/_shared/error-response.ts` | Shared error utilities |
| `frontend/src/services/admin/EventMonitoringService.ts` | Frontend service |
| `frontend/src/pages/admin/FailedEventsPage.tsx` | Admin dashboard |
| `frontend/src/types/event-monitoring.types.ts` | TypeScript types |
