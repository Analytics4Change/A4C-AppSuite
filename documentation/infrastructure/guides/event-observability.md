---
status: current
last_updated: 2026-02-07
---

<!-- TL;DR-START -->
## TL;DR

**Summary**: Guide for monitoring and debugging failed domain events using the event processing observability system, including W3C Trace Context support for end-to-end tracing and automatic tracing via PostgREST pre-request hook.

**When to read**:
- Debugging why an operation silently failed (user created but no role assigned)
- Investigating event processing errors in production
- Setting up error alerting or monitoring dashboards
- Understanding how correlation IDs and trace context trace requests across services
- Tracing requests from frontend through Edge Functions to database

**Prerequisites**: Understanding of CQRS event sourcing, access to Supabase dashboard or SQL

**Key topics**: `event-errors`, `observability`, `tracing`, `correlation-id`, `trace-id`, `span-id`, `session-id`, `traceparent`, `w3c-trace-context`, `duration-ms`, `failed-events`, `event-processing`, `debugging`, `pre-request-hook`, `session-variable`, `automatic-tracing`

**Estimated read time**: 15 minutes (full), 5 minutes (relevant sections)
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
│  │ Edge Function path:                                          │   │
│  │   Error → FunctionsHttpError → User Notification             │   │
│  │                                                              │   │
│  │ RPC path (automatic tracing):                                │   │
│  │   Custom fetch → X-Correlation-ID + traceparent headers      │   │
│  └─────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────┘
           │                                    │
     (RPC calls)                         (Edge Functions)
           │                                    │
           ▼                                    ▼
┌──────────────────────────┐   ┌──────────────────────────────────────┐
│  PostgREST Pre-Request   │   │          Edge Functions               │
│  Hook                    │   │  ┌──────────────────────────────┐   │
│  ┌────────────────────┐  │   │  │ correlation_id = generate()  │   │
│  │ Headers → app.*    │  │   │  │ supabase.rpc('emit_domain_  │   │
│  │ session variables  │  │   │  │   event', { metadata: ... }) │   │
│  └────────────────────┘  │   │  └──────────────────────────────┘   │
└──────────────────────────┘   └──────────────────────────────────────┘
           │                                    │
           └────────────────┬───────────────────┘
                            ▼
┌─────────────────────────────────────────────────────────────────────┐
│                    api.emit_domain_event()                          │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │ 1. Extract tracing from p_event_metadata (explicit)          │   │
│  │ 2. Fallback to app.* session vars (from pre-request hook)   │   │
│  │ 3. Enrich metadata JSONB with resolved tracing fields       │   │
│  │ 4. Auto-inject user_id from auth.uid()                      │   │
│  │ 5. INSERT event → domain_events table                       │   │
│  │ 6. Trigger: process_domain_event()                          │   │
│  │ 7. If critical event AND processing_error IS NOT NULL:      │   │
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
| `correlation_id` | Auto-populated | Auto via pre-request hook for RPC calls; explicit for Edge Functions |
| `user_id` | Auto-populated | Auto-injected from `auth.uid()` for RPC calls; explicit for Edge Functions |
| `organization_id` | When applicable | Org context |
| `source_function` | Recommended | Function name for debugging |
| `reason` | When meaningful | Human-readable justification |
| `ip_address` | Edge Functions | Client IP |
| `user_agent` | Edge Functions | Client info |

---

## Automatic Tracing for RPC Calls

> **Added 2026-02-07**: PostgREST pre-request hook + frontend fetch wrapper

### Overview

Frontend RPC calls (via `supabase.schema('api').rpc(...)`) now get automatic tracing without any code changes in the calling functions. This closes the HIPAA observability gap where `api.*` RPC functions were emitting events without `correlation_id`, `trace_id`, or `span_id`.

### How It Works

1. **Frontend fetch wrapper** (`supabase-ssr.ts`): Injects `X-Correlation-ID` and `traceparent` headers on every Supabase request via a custom `global.fetch` passed to `createBrowserClient`

2. **PostgREST pre-request hook** (`public.postgrest_pre_request()`): Runs before every PostgREST request, extracts headers into `app.*` session variables:
   - `X-Correlation-ID` → `app.correlation_id` (auto-generated if not sent)
   - `traceparent` → `app.trace_id` + `app.span_id` (parsed from W3C format)
   - `X-Session-ID` → `app.session_id`

3. **`api.emit_domain_event()` fallback**: After extracting tracing from `p_event_metadata`, falls back to `app.*` session variables when fields are NULL. Also enriches the `event_metadata` JSONB so all tracing is queryable in one place.

### Precedence Rules

**Explicit metadata always wins.** Session variables are only used as fallback:

| Source | When Used | Example |
|--------|-----------|---------|
| `p_event_metadata` fields | Always checked first | Edge Functions pass full tracing in metadata |
| `app.*` session variables | Only when metadata field is NULL | Frontend RPC calls get tracing from headers |
| `auth.uid()` | Only when `user_id` not in metadata | Auto-injected for authenticated requests |

This means Edge Functions that already pass `correlation_id`, `trace_id`, etc. in metadata are **completely unaffected** — their explicit values take precedence.

### Auto-Injected Fields

| Field | Source | Notes |
|-------|--------|-------|
| `correlation_id` | `X-Correlation-ID` header or auto-generated UUID | Always populated for PostgREST requests |
| `trace_id` | Parsed from `traceparent` header | 32 hex chars from W3C format |
| `span_id` | Parsed from `traceparent` header | 16 hex chars from W3C format |
| `user_id` | `auth.uid()` | Injected when not in metadata and user is authenticated |

### Limitations

- **`session_id` is NOT auto-populated** via the fetch wrapper (requires async JWT decode). It is only populated when explicitly passed in metadata (e.g., from Edge Functions). Session context is available via `auth.uid()` in the database.
- **Non-PostgREST contexts** (psql, migrations, Temporal workers): Session variables are NULL; `current_setting('app.*', true)` returns NULL gracefully. No impact.
- **PostgREST supports only ONE `db_pre_request` function**. If additional pre-request logic is needed, add it to `postgrest_pre_request()` body — do not create a second function.

### Verification

To verify automatic tracing is working after deployment:

```bash
# Via PostgREST HTTP call (use actual project URL and anon key)
curl -X POST 'https://<project>.supabase.co/rest/v1/rpc/emit_domain_event' \
  -H 'apikey: <anon-key>' \
  -H 'Authorization: Bearer <jwt>' \
  -H 'Content-Type: application/json' \
  -d '{
    "p_stream_id": "<test-uuid>",
    "p_stream_type": "test",
    "p_event_type": "test.tracing_check",
    "p_event_data": {"test": true},
    "p_event_metadata": {}
  }'

# Then check the event — correlation_id and trace_id should be populated
# even though p_event_metadata was empty:
SELECT id, correlation_id, trace_id, span_id,
       event_metadata->>'correlation_id' as meta_correlation,
       event_metadata->>'user_id' as meta_user
FROM domain_events
WHERE event_type = 'test.tracing_check'
ORDER BY created_at DESC LIMIT 1;

-- Cleanup
DELETE FROM domain_events WHERE event_type = 'test.tracing_check';
```

---

## W3C Trace Context

The system supports [W3C Trace Context](https://www.w3.org/TR/trace-context/) for distributed tracing across services. This enables end-to-end visibility from frontend through Edge Functions, Temporal workflows, and into the database.

### Trace Context Fields

| Field | Column | Description | Format |
|-------|--------|-------------|--------|
| `trace_id` | ✅ Column | Unique identifier for the entire trace | 32 hex chars (UUID without dashes) |
| `span_id` | ✅ Column | Unique identifier for a single operation | 16 hex chars |
| `parent_span_id` | ✅ Column | Parent span for causation chains | 16 hex chars |
| `session_id` | ✅ Column | Supabase Auth session ID | UUID |
| `correlation_id` | ✅ Column | Business request correlation | UUID |
| `duration_ms` | JSONB | Operation duration in milliseconds | number |

**Note**: `trace_id`, `span_id`, `parent_span_id`, `session_id`, and `correlation_id` are promoted to dedicated columns (not just JSONB) for query performance at scale.

### Traceparent Header Format

The `traceparent` header follows W3C format:
```
traceparent: 00-{trace_id}-{span_id}-{flags}
```

Example:
```
traceparent: 00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01
              │   └──────trace_id──────────┘  └───span_id───┘  │
              version                                          sampled
```

- **version**: Always `00`
- **trace_id**: 32 lowercase hex characters (128-bit)
- **span_id**: 16 lowercase hex characters (64-bit)
- **flags**: `01` = sampled, `00` = not sampled

### Frontend Integration

> **Note**: For `supabase.schema('api').rpc()` calls, tracing headers are injected automatically via the fetch wrapper in `supabase-ssr.ts`. The manual approach below is only needed for `supabase.functions.invoke()` (Edge Function calls).

Frontend services create tracing context and pass headers to Edge Functions:

```typescript
import { createTracingContext, buildHeadersFromContext } from '@/utils/tracing';
import { Logger } from '@/utils/logger';

// Create context once, use for both logging and headers
const tracingContext = await createTracingContext();
Logger.pushTracingContext(tracingContext);

try {
  const headers = buildHeadersFromContext(tracingContext);
  const { data, error } = await supabase.functions.invoke('invite-user', {
    body: { email, roleId },
    headers,  // Includes traceparent, X-Correlation-ID, X-Session-ID
  });

  if (error) {
    // Error includes correlation ID for support tickets
    console.error(`Failed: ${error.message} (Ref: ${error.correlationId})`);
  }
} finally {
  Logger.popTracingContext();  // Always pop in finally block
}
```

**Headers sent**:
```
traceparent: 00-{traceId}-{spanId}-01
X-Correlation-ID: {correlationId}
X-Session-ID: {sessionId}
```

### Edge Function Integration

Edge Functions extract tracing context and propagate to events:

```typescript
import { extractTracingContext, createSpan, endSpan } from '../_shared/tracing-context.ts';
import { buildEventMetadata } from '../_shared/emit-event.ts';

Deno.serve(async (req) => {
  const context = extractTracingContext(req);  // Parse headers
  const span = createSpan(context, 'invite-user');

  try {
    // Build event metadata with tracing
    const eventMetadata = buildEventMetadata(context, 'user.invited', req, {
      user_id: actingUser.id,
      reason: 'User invited via UI',
    });

    await supabase.rpc('emit_domain_event', {
      p_stream_id: userId,
      p_stream_type: 'user',
      p_event_type: 'user.invited',
      p_event_data: { email, roles: [roleId] },
      p_event_metadata: eventMetadata,  // Tracing auto-extracted by DB function
    });

    endSpan(span, 'ok');
    return new Response(JSON.stringify({ success: true }));
  } catch (error) {
    endSpan(span, 'error');
    throw error;
  }
});
```

### Temporal Workflow Integration

Workflows receive tracing context and propagate to activities:

```typescript
// Workflow receives tracing in params
export async function organizationBootstrapWorkflow(
  params: OrganizationBootstrapParams
): Promise<OrganizationBootstrapResult> {
  // Pass tracing to each activity
  await createOrganization({
    ...orgParams,
    tracing: params.tracing,  // { correlationId, sessionId, traceId, parentSpanId }
  });
}

// Activity uses tracing in emitEvent
async function createOrganization(params: CreateOrganizationParams) {
  const tracingParams = buildTracingForEvent(params.tracing);

  await emitEvent({
    eventType: 'organization.created',
    aggregateId: orgId,
    eventData: { name, slug },
    ...tracingParams,  // Includes trace_id, span_id, parent_span_id
  });
}
```

---

## Span Timing

Every operation can capture timing information via `duration_ms` for latency analysis.

### Capturing Span Timing

Edge Functions use `createSpan()` and `endSpan()`:

```typescript
import { createSpan, endSpan } from '../_shared/tracing-context.ts';

const span = createSpan(context, 'invite-user');
try {
  // ... operation logic ...
  endSpan(span, 'ok');  // Calculates duration automatically
} catch (error) {
  endSpan(span, 'error');
  throw error;
}
```

The span object contains:
```typescript
interface Span {
  spanId: string;
  parentSpanId: string | null;
  operationName: string;
  startTime: number;      // Date.now() at span creation
  endTime?: number;       // Date.now() at endSpan()
  status?: 'ok' | 'error';
  durationMs?: number;    // Calculated: endTime - startTime
  attributes: Record<string, unknown>;
}
```

### Querying by Duration

Find slow operations:

```sql
-- Events taking >1 second
SELECT
  id,
  event_type,
  (event_metadata->>'duration_ms')::int AS duration_ms,
  event_metadata->>'operation_name' AS operation,
  created_at
FROM domain_events
WHERE (event_metadata->>'duration_ms')::int > 1000
ORDER BY (event_metadata->>'duration_ms')::int DESC
LIMIT 20;
```

---

## Trace Timeline (RPC Functions)

Three RPC functions enable querying events by tracing context:

### `api.get_events_by_correlation()`

Find all events for a business request:

```sql
SELECT * FROM api.get_events_by_correlation(
  p_correlation_id := '550e8400-e29b-41d4-a716-446655440000'::uuid
);
```

Returns events ordered by `created_at ASC` for request flow analysis.

### `api.get_events_by_session()`

Find all events for a user session:

```sql
SELECT * FROM api.get_events_by_session(
  p_session_id := 'f47ac10b-58cc-4372-a567-0e02b2c3d479'::uuid
);
```

Useful for debugging user-reported issues when they provide session info.

### `api.get_trace_timeline()`

Get full trace with parent-child span relationships:

```sql
SELECT * FROM api.get_trace_timeline(
  p_trace_id := '4bf92f3577b34da6a3ce929d0e0e4736'
);
```

Returns:
- `id` - Event UUID
- `event_type` - Event type
- `span_id` - Operation span
- `parent_span_id` - Parent span (NULL for root)
- `duration_ms` - Operation duration (if available)
- `service_name` - Source service (edge-function, temporal-worker)
- `operation_name` - Operation name
- `created_at` - Timestamp
- `depth` - Nesting level in call tree (0 = root)
- `path` - Full path from root

### Admin Dashboard Search

The Failed Events page (`/admin/events`) supports multiple search modes:

| Search Type | Input | Color | Description |
|------------|-------|-------|-------------|
| Failed Events | - | Default | View events with processing_error |
| Correlation | UUID | Blue | Search by `correlation_id` |
| Session | UUID | Purple | Search by `session_id` |
| Trace | Hex string | Green | Search by `trace_id` |

Each search mode displays:
- **Tracing Info**: correlation_id, session_id, trace_id, span_id, parent_span_id
- **Audit Context**: user_id, source_function, reason, ip_address
- **Copy buttons** for all ID fields

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

- [Observability Operations](./observability-operations.md) - **[Aspirational]** Production-scale: retention, sampling, APM integration
- [Event Sourcing Overview](../../architecture/data/event-sourcing-overview.md) - CQRS architecture
- [Event Metadata Schema](../../workflows/reference/event-metadata-schema.md) - Complete metadata field definitions
- [Database Tables Reference](../reference/database/tables/) - Schema documentation
- [Edge Functions](../../../infrastructure/supabase/supabase/functions/) - Source code

## Migration History

### 2026-02-07: PostgREST Pre-Request Hook for Automatic Tracing

**Migration**: `20260207013604_p2_postgrest_pre_request_tracing.sql`

**Changes**:
- Added `public.postgrest_pre_request()` function that extracts tracing headers into `app.*` session variables
- Registered pre-request function via `ALTER ROLE authenticator SET pgrst.db_pre_request`
- Updated `api.emit_domain_event()` to fall back to session variables when metadata fields are NULL
- Added metadata enrichment (tracing fields written back to `event_metadata` JSONB)
- Added `user_id` auto-injection from `auth.uid()`
- Frontend: custom fetch wrapper in `supabase-ssr.ts` injects `X-Correlation-ID` and `traceparent` headers

**Backward Compatibility**: Fully compatible
- Explicit metadata (from Edge Functions) always takes precedence
- Non-PostgREST contexts (psql, Temporal) gracefully get NULL from session variables
- Function signature unchanged — zero impact on callers

## Files Modified

| File | Purpose |
|------|---------|
| `infrastructure/supabase/supabase/migrations/20260107002820_event_processing_observability.sql` | RPC functions + error propagation |
| `infrastructure/supabase/supabase/migrations/20260207013604_p2_postgrest_pre_request_tracing.sql` | Pre-request hook + emit_domain_event update |
| `infrastructure/supabase/supabase/functions/_shared/error-response.ts` | Shared error utilities |
| `frontend/src/utils/trace-ids.ts` | Zero-dependency tracing ID generators |
| `frontend/src/lib/supabase-ssr.ts` | Custom fetch wrapper for tracing headers |
| `frontend/src/services/admin/EventMonitoringService.ts` | Frontend service |
| `frontend/src/pages/admin/FailedEventsPage.tsx` | Admin dashboard |
| `frontend/src/types/event-monitoring.types.ts` | TypeScript types |
