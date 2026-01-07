# Implementation Plan: Event Tracing (correlation_id + session_id)

## Executive Summary

Add end-to-end request tracing to all domain events by wiring up `correlation_id`, `session_id`, and span timing through the entire stack: Frontend → Edge Functions → Temporal → Database. This enables debugging failed requests by correlation ID, attributing events to user sessions, and measuring operation latency.

**Why now**: The observability system (commit 43ab29ac) added error visibility, but events lack tracing context. When errors occur, we can't easily trace which request caused them or group events by user session.

**Architectural Review**: Plan updated 2026-01-07 based on software-architect-dbc evaluation. Key additions: W3C trace context compatibility, column promotion for query performance, span timing capture.

---

## Phase 1: Database Schema Enhancement

**Priority**: Must complete before other phases (enables efficient queries)

### 1.1 Add Tracing Columns
- Add `correlation_id UUID` column to `domain_events`
- Add `session_id UUID` column to `domain_events`
- Add `trace_id TEXT` column (32 hex chars, W3C compatible)
- Add `span_id TEXT` column (16 hex chars)
- Add `parent_span_id TEXT` column (causation chain)

### 1.2 Create Composite Indexes
- `idx_events_correlation_time` on `(correlation_id, created_at DESC)`
- `idx_events_session_time` on `(session_id, created_at DESC)`
- `idx_events_trace_time` on `(trace_id, created_at DESC)`
- All indexes are partial: `WHERE column IS NOT NULL`

### 1.3 Query RPC Functions
- `api.get_events_by_session(p_session_id UUID)` - Query by session
- `api.get_events_by_correlation(p_correlation_id UUID)` - Query by correlation
- `api.get_trace_timeline(p_trace_id TEXT)` - Reconstruct full trace with parent-child relationships

---

## Phase 2: Edge Functions Foundation

### 2.1 Tracing Context Module
- Create `_shared/tracing-context.ts` with:
  - `extractTracingContext(req)` - Parse W3C traceparent + custom headers
  - `createSpan(context, operationName)` - Start a new span
  - `endSpan(span, status)` - Complete span with duration
  - `generateTraceId()` - 32 hex chars (W3C format)
  - `generateSpanId()` - 16 hex chars (W3C format)

### 2.2 CORS and Emit Helper
- Update `_shared/error-response.ts` to allow headers:
  - `traceparent`, `tracestate` (W3C)
  - `x-correlation-id`, `x-session-id` (custom)
- Create `_shared/emit-event.ts` shared helper for standardized event emission
- Helper populates both columns AND event_metadata JSONB

### 2.3 Update Edge Functions
- Update 4 event-emitting Edge Functions to use shared helpers:
  - `accept-invitation/index.ts`
  - `invite-user/index.ts`
  - `manage-user/index.ts`
  - `organization-bootstrap/index.ts`
- Add span timing to each operation

---

## Phase 3: Frontend Integration

### 3.1 Tracing Utilities
- Create `frontend/src/utils/tracing.ts`:
  - `generateCorrelationId()` - UUID v4 per request
  - `getSessionId()` - Extract from Supabase Auth JWT
  - `generateTraceparent()` - W3C format header value
  - `buildTracingHeaders()` - Build all headers for Edge Function calls

### 3.2 Structured Logging
- Create `frontend/src/utils/logger.ts`:
  - Structured JSON logging with trace context
  - `setContext()` - Set correlation/trace IDs for all subsequent logs
  - `info()`, `warn()`, `error()` - Log with automatic trace context

### 3.3 Service Updates
- Update `SupabaseInvitationService.ts` to include tracing headers
- Update `SupabaseUserCommandService.ts` to include tracing headers
- Set logger context before service calls

---

## Phase 4: Temporal Workflow Integration

### 4.1 Workflow Types
- Add tracing fields to `OrganizationBootstrapParams`:
  - `correlationId: string`
  - `sessionId: string | null`
  - `traceId: string`
  - `parentSpanId: string`

### 4.2 Activity Updates
- Update `workflows/src/shared/utils/emit-event.ts` to:
  - Accept full tracing context
  - Generate new span_id for each activity
  - Populate trace columns in domain_events
- Pass trace context through workflow to all activities

### 4.3 Cross-Service Linking
- Edge Function creates workflow with its span_id as `parentSpanId`
- Workflow creates child spans for each activity
- Full trace chain: Frontend → Edge Function → Workflow → Activity

---

## Phase 5: Admin Dashboard Enhancements

### 5.1 EventMonitoringService
- Add `getEventsBySession(sessionId)` method
- Add `getEventsByCorrelation(correlationId)` method
- Add `getTraceTimeline(traceId)` method for full trace reconstruction

### 5.2 FailedEventsPage Updates
- Add session_id column to event table
- Add trace_id column to event table
- Add "Search by Session ID" input
- Add "Search by Trace ID" input
- Show trace timeline in event details panel (parent-child visualization)

### 5.3 Trace Timeline Component
- Create component to visualize span hierarchy
- Show operation names, durations, and status
- Highlight failed spans in red

---

## Phase 6: Frontend Error UX

### 6.1 Error Display Component
- Create `ErrorWithCorrelation.tsx` component
- Shows error message + correlation ID for support tickets
- User can copy reference ID
- Include trace context in non-production for debugging

### 6.2 Service Error Handling
- Extract correlation_id from Edge Function error responses
- Pass to UI components for display
- Log errors with full trace context

---

## Phase 7: Testing

### 7.1 Frontend Tests
- `frontend/src/utils/__tests__/tracing.test.ts`:
  - Test `generateCorrelationId()` returns valid UUID
  - Test `generateTraceparent()` returns valid W3C format
  - Test `getSessionId()` extracts from JWT
  - Test `getSessionId()` returns null when no session
  - Test `buildTracingHeaders()` includes all headers

### 7.2 Edge Function Tests
- `_shared/__tests__/tracing-context.test.ts`:
  - Test W3C traceparent parsing
  - Test fallback to custom headers
  - Test span creation/completion with timing

- `_shared/__tests__/emit-event.test.ts`:
  - Test column population (not just JSONB)
  - Test span_id generation
  - Test parent_span_id propagation

### 7.3 Integration Tests
- End-to-end trace verification
- Verify trace timeline reconstruction
- Performance test: query latency with indexes

---

## Phase 8: Documentation

### 8.1 Update Existing Docs
- `event-observability.md`:
  - Add section on W3C trace context
  - Document span timing and trace timeline
  - Update correlation_id section for frontend flow
- `event-metadata-schema.md`:
  - Add trace_id, span_id, parent_span_id fields
  - Document column vs JSONB storage strategy

### 8.2 Index Updates
- Add keywords to AGENT-INDEX.md:
  - `session-id`
  - `trace-id`
  - `span-id`
  - `traceparent`
  - `w3c-trace-context`

---

## Phase 9: Observability Operations (Future)

**Note**: These are recommended for production scale but can be deferred.

### 9.1 Retention Policy
- Archive events older than 90 days
- Create time-partitioned archive table
- Scheduled job (pg_cron or Temporal workflow)

### 9.2 Sampling Strategy
- Configure sampling rate (default: 100% in dev, 10% in prod)
- Always sample errors
- Allow client to force sampling via header

### 9.3 APM Integration Hooks
- OTLP export capability for future Datadog/Jaeger integration
- Fire-and-forget export (don't block business logic)
- Environment variable to enable/configure

---

## Success Metrics

### Immediate
- [ ] Events from frontend have correlation_id, session_id, trace_id populated
- [ ] Admin can search events by correlation_id, session_id, and trace_id
- [ ] Trace timeline shows parent-child relationships

### Medium-Term
- [ ] Support tickets include correlation_id for faster debugging
- [ ] Can trace full request lifecycle from frontend to event store
- [ ] Can identify slow operations via duration_ms

### Long-Term
- [ ] All events (Edge Functions + Temporal) have consistent tracing metadata
- [ ] Query performance remains <100ms at 1M+ events
- [ ] APM integration ready (OTLP export hooks in place)

---

## Risk Mitigation

| Risk | Mitigation |
|------|------------|
| JWT doesn't have session_id claim | Verify Supabase Auth includes it; fallback to null |
| CORS preflight issues | Test headers in development before Edge Function deploy |
| Query performance at scale | Column promotion + composite indexes (not JSONB extraction) |
| Tracing adds latency | Span recording is async; never blocks business logic |
| Breaking existing events | All new columns are nullable; existing events unaffected |

---

## Next Steps After Completion

1. **Alerting**: Add Slack/email alerts for failed events with correlation context
2. **Replay Dashboard**: Build event replay using correlation_id grouping
3. **APM Integration**: Connect to Datadog/Jaeger via OTLP export
4. **Distributed Tracing UI**: Full flame graph visualization in admin dashboard
