# Context: Event Tracing (correlation_id + session_id)

## Decision Record

**Date**: 2026-01-07 (Updated after architectural review)
**Feature**: End-to-end event tracing with correlation_id, session_id, and span timing
**Goal**: Enable debugging failed requests by tracing events from frontend through Edge Functions to database, attributing events to user sessions, and measuring operation latency.

### Key Decisions

1. **Session ID Source**: Use Supabase Auth JWT's `session_id` claim rather than generating a frontend UUID. This ties events to actual auth sessions and doesn't require frontend state management.

2. **Transport Mechanism**: Use HTTP headers (`X-Correlation-ID`, `X-Session-ID`, `traceparent`) rather than request body. Headers are the standard mechanism for request metadata and don't pollute the business payload.

3. **W3C Trace Context Compatibility**: Support `traceparent` header alongside custom headers for future APM tool interoperability. Format: `00-{trace_id}-{span_id}-{flags}`.

4. **Shared Emit Helper**: Create `_shared/emit-event.ts` for Edge Functions rather than updating each function's emit logic individually. Centralizes tracing metadata construction.

5. **Span Timing**: Capture `duration_ms` for each operation to enable latency debugging and performance analysis.

6. **Parent-Child Relationships**: Include `span_id` and `parent_span_id` to track causation chains across services.

7. **Column Promotion**: Promote `correlation_id`, `session_id`, `trace_id`, `span_id` to dedicated columns (not just JSONB) for query performance at scale.

8. **Server-side Query RPCs**: Add `api.get_events_by_session()`, `api.get_events_by_correlation()`, and `api.get_trace_timeline()` for efficient server-side queries.

9. **Stack-based Logger Context**: Use push/pop pattern instead of set/clear to handle concurrent operations safely. If operation B starts while A is in progress, popping B's context restores A's context correctly. - Added 2026-01-07

10. **Single Context for Logs and Headers**: Create `TracingContext` once via `createTracingContext()`, then use `buildHeadersFromContext(context)` to build headers. This ensures the same trace/span/correlation IDs appear in both logs and HTTP headers. - Added 2026-01-07

11. **Correlation ID in Error Responses**: Extract `x-correlation-id` header from Edge Function error responses and include in error messages as `(Ref: {id})` for support ticket correlation. - Added 2026-01-07

## Technical Context

### Architecture

```
Frontend                    Edge Functions              Temporal                Database
   │                              │                        │                       │
   │ X-Correlation-ID: uuid       │                        │                       │
   │ X-Session-ID: jwt-session    │                        │                       │
   │ traceparent: 00-trace-span   │                        │                       │
   ├──────────────────────────────►                        │                       │
   │                              │                        │                       │
   │                    extractTracingContext(req)         │                       │
   │                    createSpan(context, 'op-name')     │                       │
   │                              │                        │                       │
   │                    emitDomainEvent({                  │                       │
   │                      correlationId,                   │                       │
   │                      sessionId,                       │                       │
   │                      traceId, spanId,                 │                       │
   │                      durationMs,                      │                       │
   │                      ...                              │                       │
   │                    })        │                        │                       │
   │                              ├────────────────────────►                       │
   │                              │ (workflow with context)│                       │
   │                              │                        ├───────────────────────►
   │                              │                        │   columns: {          │
   │                              │                        │     correlation_id,   │
   │                              │                        │     session_id,       │
   │                              │                        │     trace_id,         │
   │                              │                        │     span_id,          │
   │                              │                        │     parent_span_id    │
   │                              │                        │   }                   │
   │                              │                        │   event_metadata: {   │
   │                              │                        │     duration_ms,      │
   │                              │                        │     service_name,     │
   │                              │                        │     operation_name    │
   │                              │                        │   }                   │
```

### Event Metadata Schema (Extended)

```typescript
interface EventMetadata {
  // Identity (required)
  user_id: string;

  // Tracing - stored in columns for query performance
  correlation_id: string;      // Business request correlation
  session_id: string | null;   // User auth session
  trace_id: string;            // W3C compatible trace ID (32 hex chars)
  span_id: string;             // Operation ID (16 hex chars)
  parent_span_id: string | null; // Parent operation (causation chain)

  // Timing
  duration_ms?: number;        // Operation duration

  // Context (in JSONB)
  service_name: string;        // 'edge-function', 'temporal-worker', 'frontend'
  operation_name: string;      // 'invite-user', 'bootstrap-org', etc.
  source_ip?: string;
  user_agent?: string;

  // Business context
  reason?: string;
}
```

### Tech Stack

- **Frontend**: React + TypeScript, Supabase JS client
- **Edge Functions**: Deno, Supabase Edge Runtime
- **Database**: PostgreSQL with JSONB indexes on event_metadata
- **Temporal**: Already supports correlation_id in `emitEvent()` interface

### Dependencies

- Supabase Auth must include `session_id` in JWT claims
- CORS must allow custom headers (`x-correlation-id`, `x-session-id`)
- Edge Functions must extract headers and pass to event metadata

## File Structure

### New Files Created (Phase 1, 2 & 3 - 2026-01-07)

- ✅ `infrastructure/supabase/supabase/functions/_shared/tracing-context.ts` - W3C trace context extraction and span management
- ✅ `infrastructure/supabase/supabase/functions/_shared/emit-event.ts` - Shared event emission helper with buildEventMetadata()
- ✅ `infrastructure/supabase/supabase/migrations/20260107170706_add_event_tracing_columns.sql` - Add columns, indexes, RPC functions
- ✅ `infrastructure/supabase/supabase/migrations/20260107171628_update_emit_domain_event_tracing.sql` - Update api.emit_domain_event to extract tracing from metadata
- ✅ `frontend/src/utils/tracing.ts` - Frontend tracing utilities (W3C traceparent, correlation IDs, session extraction)

### New Files Created (Phase 4 - 2026-01-07)

- No new files - extended existing types and utilities

### Files Created (Phase 6 - 2026-01-07)

- ✅ `frontend/src/components/ui/ErrorWithCorrelation.tsx` - Error display with reference ID, trace ID (non-prod), copy buttons, InlineErrorWithCorrelation variant

### Files Still To Create (Phase 7+)

- `infrastructure/supabase/supabase/functions/_shared/__tests__/emit-event.test.ts` - Unit tests
- `frontend/src/utils/__tests__/tracing.test.ts` - Unit tests

### Existing Files Modified (Phase 4 - 2026-01-07)

- ✅ `workflows/src/shared/types/index.ts` - Added TracingContext, WorkflowTracingParams, tracing to activity params
- ✅ `workflows/src/shared/utils/emit-event.ts` - Added tracing fields, generateSpanId, buildTracingForEvent, createActivityTracingContext
- ✅ `workflows/src/shared/utils/index.ts` - Exported new tracing functions
- ✅ `workflows/src/workflows/organization-bootstrap/workflow.ts` - Pass tracing to all forward activities
- ✅ `workflows/src/activities/organization-bootstrap/create-organization.ts` - Use buildTracingForEvent for all events
- ✅ `workflows/src/activities/organization-bootstrap/configure-dns.ts` - Use buildTracingForEvent
- ✅ `workflows/src/activities/organization-bootstrap/verify-dns.ts` - Use buildTracingForEvent
- ✅ `workflows/src/activities/organization-bootstrap/generate-invitations.ts` - Use buildTracingForEvent
- ✅ `workflows/src/activities/organization-bootstrap/send-invitation-emails.ts` - Use buildTracingForEvent
- ✅ `workflows/src/activities/organization-bootstrap/activate-organization.ts` - Use buildTracingForEvent
- ✅ `workflows/src/activities/organization-bootstrap/grant-provider-admin-permissions.ts` - Use buildTracingForEvent, use types from shared/types

### Existing Files Modified (Phase 2 & 3 - 2026-01-07)

- ✅ `infrastructure/supabase/supabase/functions/_shared/error-response.ts` - Added CORS headers for tracing (traceparent, x-correlation-id, x-session-id)
- ✅ `infrastructure/supabase/supabase/functions/accept-invitation/index.ts` - v12-tracing: Full tracing with span timing, buildEventMetadata for 3 events
- ✅ `infrastructure/supabase/supabase/functions/invite-user/index.ts` - v7-tracing: Full tracing with span timing
- ✅ `infrastructure/supabase/supabase/functions/manage-user/index.ts` - v4-tracing: Full tracing with span timing
- ✅ `infrastructure/supabase/supabase/functions/organization-bootstrap/index.ts` - v5-tracing: Tracing header propagation to Backend API
- ✅ `infrastructure/supabase/supabase/functions/validate-invitation/index.ts` - v10-tracing: Basic tracing context extraction
- ✅ `infrastructure/supabase/supabase/functions/workflow-status/index.ts` - v25-tracing: Basic tracing context extraction
- ✅ `frontend/src/utils/logger.ts` - Extended with TracingLogContext, pushTracingContext/popTracingContext (stack-based), trace ID display in console
- ✅ `frontend/src/services/invitation/SupabaseInvitationService.ts` - Added tracing headers to all Edge Function calls, correlation ID in errors
- ✅ `frontend/src/services/users/SupabaseUserCommandService.ts` - Added tracing headers to all Edge Function calls, correlation ID in errors
- ✅ `frontend/src/types/user.types.ts` - Added `correlationId` to `UserOperationResult.errorDetails` type - Updated 2026-01-07

### Files Modified (Phase 5 - 2026-01-07)

- ✅ `frontend/src/types/event-monitoring.types.ts` - Added TracedEvent, TracedEventsResult, TraceSpan, TraceTimelineResult types for tracing queries
- ✅ `frontend/src/services/admin/EventMonitoringService.ts` - Added getEventsBySession(), getEventsByCorrelation(), getTraceTimeline() methods
- ✅ `frontend/src/pages/admin/FailedEventsPage.tsx` - Added:
  - Search type selector (Failed Events / Correlation / Session / Trace)
  - Color-coded search inputs (blue=correlation, purple=session, green=trace)
  - Tracing info section with copy buttons for all tracing fields
  - Audit context section (user_id, source_function, reason, ip_address)
  - CopyButton component for clipboard functionality

### Files Still To Modify (Phase 6+)

- `documentation/infrastructure/guides/event-observability.md` - Update docs
- `documentation/workflows/reference/event-metadata-schema.md` - Add trace_id, span_id, duration_ms fields
- `documentation/AGENT-INDEX.md` - Add session-id, trace-id, span-id keywords

## Related Components

- **Event Processing Observability** (commit 43ab29ac): Recently added error visibility, RPC functions for failed events, admin dashboard
- **Temporal emit-event.ts**: `workflows/src/shared/utils/emit-event.ts` already supports `correlation_id` parameter
- **Event Metadata Schema**: `documentation/workflows/reference/event-metadata-schema.md` defines metadata structure

## Key Patterns and Conventions

### Header Naming
```
traceparent: 00-{trace_id}-{span_id}-01   # W3C Trace Context (primary)
X-Correlation-ID: uuid                     # Business correlation (fallback/compatibility)
X-Session-ID: uuid                         # User session from JWT
```

### Tracing Context Pattern (Edge Functions)
```typescript
import { extractTracingContext, createSpan, endSpan } from '../_shared/tracing-context.ts';
import { emitDomainEvent } from '../_shared/emit-event.ts';

Deno.serve(async (req) => {
  const context = extractTracingContext(req);
  const span = createSpan(context, 'invite-user');

  try {
    // Business logic here...

    await emitDomainEvent({
      supabase,
      streamId, streamType, eventType, eventData,
      tracing: context,
      userId: user.id,
      reason: 'Description',
      req,
    });

    endSpan(span, 'ok');
    return new Response(JSON.stringify(result));
  } catch (error) {
    endSpan(span, 'error');
    throw error;
  }
});
```

### Frontend Header Pattern (Recommended - 2026-01-07)
```typescript
import { createTracingContext, buildHeadersFromContext } from '@/utils/tracing';
import { Logger } from '@/utils/logger';

// Create context once, use for both logging and headers
const tracingContext = await createTracingContext();
Logger.pushTracingContext(tracingContext);  // Stack-based for concurrency safety

try {
  const headers = buildHeadersFromContext(tracingContext);  // Same IDs as logging
  const { data, error } = await client.functions.invoke('function-name', {
    body: { ... },
    headers,
  });
  // ... handle response ...
} finally {
  Logger.popTracingContext();  // Always pop in finally block
}
```

### Frontend Header Pattern (Deprecated)
```typescript
// ❌ DEPRECATED - generates different IDs for logs vs headers
import { buildTracingHeaders, generateTraceparent } from '@/utils/tracing';
import { logger } from '@/utils/logger';

const traceparent = generateTraceparent();
logger.setContext({ traceId: traceparent.traceId, spanId: traceparent.spanId });
const headers = await buildTracingHeaders();  // Different IDs!
```

### Structured Logging Pattern
```typescript
import { logger } from '@/utils/logger';

// Logger automatically includes trace context
logger.info('Starting invitation process', { email: recipientEmail });
logger.error('Failed to send invitation', error, { invitationId });
```

## Reference Materials

- Plan file: `/home/lars/.claude/plans/partitioned-inventing-whale.md`
- Existing observability docs: `documentation/infrastructure/guides/event-observability.md`
- Event metadata schema: `documentation/workflows/reference/event-metadata-schema.md`
- AGENT-GUIDELINES.md for documentation requirements

## Important Constraints

1. **Supabase Auth JWT Structure**: Must verify `session_id` claim exists. If not, getSessionId() returns null gracefully.

2. **CORS Preflight**: Edge Functions must handle OPTIONS requests with the new headers allowed.

3. **Backward Compatibility**: Events without tracing metadata should still work (fields are optional in event_metadata JSONB).

4. **Platform-Only Admin**: FailedEventsPage is restricted to super_admin in Analytics4Change org.

5. **Always Use Push/Pop Pattern**: Logger context must use `pushTracingContext()` / `popTracingContext()` pattern, NOT `setTracingContext()` / `clearTracingContext()`. The stack-based approach prevents race conditions when multiple async operations run concurrently. Always call `popTracingContext()` in a `finally` block. - Added 2026-01-07

6. **Single Context Source**: Always create tracing context once with `createTracingContext()`, then use `buildHeadersFromContext(context)` to build headers. Never call `buildTracingHeaders()` separately as it generates different IDs. - Added 2026-01-07

7. **TracingLogContext Type Compatibility**: `TracingLogContext.sessionId` must be `string | null` (not `string | undefined`) to match `TracingContext.sessionId`. This was fixed during implementation. - Discovered 2026-01-07

## Why This Approach?

**vs. generating session_id in frontend**: Using Supabase Auth's session_id ties events to actual auth sessions without requiring frontend state management. More reliable.

**vs. putting tracing in request body**: Headers are the HTTP standard for request metadata. Keeps business payload clean and works with existing Supabase client patterns.

**vs. client-side filtering only**: Server-side RPC functions with indexes are more efficient for large event stores. Client-side filtering loads all events then filters.

**vs. JSONB-only storage for trace IDs**: Promoting trace fields to columns enables efficient composite indexes with time ranges. JSONB extraction prevents index usage in `WHERE correlation_id = X AND created_at > Y` queries.

**vs. custom-only headers**: Supporting W3C `traceparent` alongside custom headers ensures future interoperability with APM tools (Datadog, Jaeger, etc.) without breaking existing code.

**vs. skipping span timing**: Capturing `duration_ms` is essential for identifying slow operations. Without timing data, you can only see *what* happened, not *how long* it took.

**vs. flat trace structure**: Using `parent_span_id` enables reconstructing the full call tree. When debugging a failed workflow, you can see which activity failed and trace back to the originating request.

## Implementation Notes (Phase 1 & 2 - 2026-01-07)

### Tracing Context Module Implementation

The `_shared/tracing-context.ts` module provides:
- `extractTracingContext(req)` - Parses W3C traceparent header first, falls back to X-Correlation-ID and X-Session-ID
- `createSpan(context, operationName)` - Creates span with start timestamp
- `endSpan(span, status)` - Completes span with duration calculation
- `buildTracingHeaders(context)` - Builds headers for downstream HTTP calls

### Event Metadata Helper Implementation

The `_shared/emit-event.ts` module provides:
- `buildEventMetadata(tracingContext, operationName, req, additionalMetadata)` - Constructs standardized event metadata
- `emitDomainEvent(supabase, params, context, req)` - Full emit with tracing (not used yet in current functions)
- `safeEmitEvent()` - Non-throwing wrapper for tracing (optional)
- `extractClientInfo(req)` - Extracts IP address and user agent from headers

### Database Function Update

The `api.emit_domain_event()` function was updated to:
1. Extract tracing fields from `p_event_metadata` JSONB parameter
2. Populate dedicated columns: `correlation_id`, `session_id`, `trace_id`, `span_id`, `parent_span_id`
3. This means Edge Functions can pass tracing in metadata and columns get auto-populated

### Edge Function Versioning

Each Edge Function was versioned with tracing support:
- `accept-invitation` v12-tracing
- `invite-user` v7-tracing
- `manage-user` v4-tracing
- `organization-bootstrap` v5-tracing
- `validate-invitation` v10-tracing
- `workflow-status` v25-tracing

### CORS Headers Configuration

Added to `standardCorsHeaders` in error-response.ts:
```
Access-Control-Allow-Headers: traceparent, tracestate, x-correlation-id, x-session-id
Access-Control-Expose-Headers: traceparent, x-correlation-id
```

### Key Pattern: buildEventMetadata Usage

Edge Functions use `buildEventMetadata()` to construct standardized metadata:
```typescript
const eventMetadata = buildEventMetadata(tracingContext, eventType, req, {
  user_id: user.id,
  reason: 'Description',
  // additional fields...
});

await supabase.rpc('emit_domain_event', {
  p_stream_id: streamId,
  p_stream_type: 'user',
  p_event_type: eventType,
  p_event_data: eventData,
  p_event_metadata: eventMetadata,  // Tracing fields auto-extracted by DB function
});
```

## Phase 3 Refinements (2026-01-07)

### Issues Identified During Architectural Review

After initial Phase 3 implementation, four issues were identified and fixed:

#### Issue 1: Duplicate ID Generation
**Problem**: `createTracingContext()` and `buildTracingHeaders()` generated different trace/span/correlation IDs, causing mismatch between logs and HTTP headers.

**Solution**: Added `buildHeadersFromContext(context: TracingContext)` that builds headers from an existing context, ensuring the same IDs are used everywhere.

#### Issue 2: Redundant Async Calls
**Problem**: `getSessionId()` was called twice per operation - once in `createTracingContext()` and once in `buildTracingHeaders()`.

**Solution**: `buildHeadersFromContext()` uses the pre-created context which already contains the session ID, eliminating redundant JWT decoding.

#### Issue 3: Static Logger Context Race Condition
**Problem**: `Logger.setTracingContext()` used a single static variable. If operation B started while A was in progress, B would overwrite A's context, then A's `clearTracingContext()` would clear B's context.

**Solution**: Changed to stack-based context management:
- `tracingContextStack: TracingLogContext[]` instead of `tracingContext: TracingLogContext | null`
- `pushTracingContext(ctx)` pushes onto stack
- `popTracingContext()` pops from stack
- `getTracingContext()` returns top of stack

#### Issue 4: No Correlation ID in Error Responses
**Problem**: When Edge Functions returned errors, the correlation ID from the response wasn't captured for support tickets.

**Solution**: Updated `extractEdgeFunctionError()` in both service files to:
1. Extract `x-correlation-id` from `error.context.headers`
2. Include in error messages as `(Ref: {correlationId})`
3. Return via `correlationId` field in result
4. Added `correlationId` to `UserOperationResult.errorDetails` type
