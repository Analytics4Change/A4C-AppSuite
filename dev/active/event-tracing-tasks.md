# Tasks: Event Tracing (correlation_id + session_id)

## Phase 1: Database Schema Enhancement ✅ COMPLETE

**Priority**: Must complete first (other phases depend on this)

### 1.1 Add Tracing Columns
- [x] Create migration via `supabase migration new add_tracing_columns`
- [x] Add `correlation_id UUID` column to `domain_events`
- [x] Add `session_id UUID` column to `domain_events`
- [x] Add `trace_id TEXT` column (32 hex chars, W3C compatible)
- [x] Add `span_id TEXT` column (16 hex chars)
- [x] Add `parent_span_id TEXT` column (causation chain)

### 1.2 Create Composite Indexes
- [x] Create `idx_events_correlation_time` on `(correlation_id, created_at DESC) WHERE correlation_id IS NOT NULL`
- [x] Create `idx_events_session_time` on `(session_id, created_at DESC) WHERE session_id IS NOT NULL`
- [x] Create `idx_events_trace_time` on `(trace_id, created_at DESC) WHERE trace_id IS NOT NULL`
- [x] Use `CREATE INDEX CONCURRENTLY` to avoid locking

### 1.3 Query RPC Functions
- [x] Create `api.get_events_by_session(p_session_id UUID)` RPC function
- [x] Create `api.get_events_by_correlation(p_correlation_id UUID)` RPC function
- [x] Create `api.get_trace_timeline(p_trace_id TEXT)` RPC function with recursive CTE for parent-child
- [x] Grant EXECUTE to authenticated role
- [x] Deploy migration to Supabase

**Migration file**: `20260107163024_add_event_tracing_columns.sql`
**Deployed**: 2026-01-07

---

## Phase 2: Edge Functions Foundation ✅ COMPLETE

### 2.1 Tracing Context Module
- [x] Create `_shared/tracing-context.ts` with:
  - [x] `TracingContext` interface (correlationId, sessionId, traceId, spanId, parentSpanId, sampled)
  - [x] `extractTracingContext(req)` - Parse W3C traceparent first, fall back to custom headers
  - [x] `generateTraceId()` - 32 hex chars (W3C format)
  - [x] `generateSpanId()` - 16 hex chars (W3C format)
  - [x] `createSpan(context, operationName)` - Start span with timestamp
  - [x] `endSpan(span, status)` - Complete span, calculate duration_ms
  - [x] `buildTraceparentHeader(context)` - Format for downstream propagation

### 2.2 CORS and Emit Helper
- [x] Update `_shared/error-response.ts` to add CORS headers:
  - [x] `traceparent`, `tracestate` in Access-Control-Allow-Headers
  - [x] `x-correlation-id`, `x-session-id` in Access-Control-Allow-Headers
  - [x] `traceparent`, `x-correlation-id` in Access-Control-Expose-Headers
- [x] Create `_shared/emit-event.ts` with:
  - [x] `emitDomainEvent()` function that populates columns AND event_metadata
  - [x] `safeEmitEvent()` wrapper that never throws (tracing is non-critical)
  - [x] Automatic ip_address, user_agent extraction from req
- [x] Update `api.emit_domain_event()` to extract tracing from metadata and populate columns

### 2.3 Update Edge Functions
- [x] Update `accept-invitation/index.ts` (v12-tracing):
  - [x] Import tracing-context and emit-event
  - [x] Extract tracing context at handler start
  - [x] Create span for operation
  - [x] Use buildEventMetadata with tracing for all 3 events
  - [x] End span before response
- [x] Update `invite-user/index.ts` (v7-tracing)
- [x] Update `manage-user/index.ts` (v4-tracing)
- [x] Update `organization-bootstrap/index.ts` (v5-tracing):
  - [x] Same pattern as above
  - [x] Pass tracing headers to Backend API
- [x] Update `validate-invitation/index.ts` (v10-tracing) - basic tracing extraction
- [x] Update `workflow-status/index.ts` (v25-tracing) - basic tracing extraction
- [x] Deploy all 6 Edge Functions to Supabase

**Migration file**: `20260107171628_update_emit_domain_event_tracing.sql`
**Deployed**: 2026-01-07

---

## Phase 3: Frontend Integration ⏸️ PENDING

### 3.1 Tracing Utilities
- [ ] Create `frontend/src/utils/tracing.ts` with:
  - [ ] `generateCorrelationId()` - UUID v4
  - [ ] `generateTraceId()` - 32 hex chars (UUID without dashes)
  - [ ] `generateSpanId()` - 16 hex chars
  - [ ] `generateTraceparent()` - W3C format: `00-{traceId}-{spanId}-01`
  - [ ] `getSessionId()` - Extract `session_id` from Supabase Auth JWT
  - [ ] `buildTracingHeaders()` - Build all headers for Edge Function calls

### 3.2 Structured Logging
- [ ] Create `frontend/src/utils/logger.ts` with:
  - [ ] `LogContext` interface (correlationId, sessionId, traceId, spanId)
  - [ ] `StructuredLogger` class
  - [ ] `setContext(ctx)` - Set trace context for subsequent logs
  - [ ] `info(message, data?)` - Log with automatic trace context
  - [ ] `warn(message, data?)` - Log with automatic trace context
  - [ ] `error(message, error, data?)` - Log with stack trace and trace context
  - [ ] Export singleton `logger` instance

### 3.3 Service Updates
- [ ] Update `SupabaseInvitationService.ts`:
  - [ ] Import buildTracingHeaders
  - [ ] Add headers to `acceptInvitation()` Edge Function call
  - [ ] Add headers to `sendInvitation()` Edge Function call
  - [ ] Set logger context before calls
- [ ] Update `SupabaseUserCommandService.ts`:
  - [ ] Import buildTracingHeaders
  - [ ] Add headers to all Edge Function calls
  - [ ] Set logger context before calls
- [ ] Test headers are sent to Edge Functions (verify in browser Network tab)

---

## Phase 4: Temporal Workflow Integration ⏸️ PENDING

### 4.1 Workflow Types
- [ ] Update `workflows/src/shared/types/index.ts`:
  - [ ] Add `TracingContext` interface
  - [ ] Add tracing fields to `OrganizationBootstrapParams`:
    - correlationId: string
    - sessionId: string | null
    - traceId: string
    - parentSpanId: string

### 4.2 Activity Updates
- [ ] Update `workflows/src/shared/utils/emit-event.ts`:
  - [ ] Accept `TracingContext` parameter
  - [ ] Generate new span_id for each event
  - [ ] Populate trace columns (not just JSONB)
  - [ ] Include duration_ms if span timing provided
- [ ] Update all activities to accept and pass tracing context
- [ ] Verify emitEvent calls include tracing

### 4.3 Cross-Service Linking
- [ ] Update `organization-bootstrap/workflow.ts`:
  - [ ] Accept tracing context from workflow params
  - [ ] Create child span for workflow execution
  - [ ] Pass tracing context to each activity call
- [ ] Test trace chain: Edge Function → Workflow → Activity

---

## Phase 5: Admin Dashboard Enhancements ⏸️ PENDING

### 5.1 EventMonitoringService
- [ ] Add `getEventsBySession(sessionId: string)` method
- [ ] Add `getEventsByCorrelation(correlationId: string)` method
- [ ] Add `getTraceTimeline(traceId: string)` method
- [ ] Add TypeScript types for RPC responses

### 5.2 FailedEventsPage Updates
- [ ] Add session_id column to event table
- [ ] Add trace_id column to event table
- [ ] Add "Search by Session ID" input field
- [ ] Add "Search by Trace ID" input field
- [ ] Update event details panel to show:
  - [ ] correlation_id (with copy button)
  - [ ] session_id (with copy button)
  - [ ] trace_id (with copy button)
  - [ ] span_id and parent_span_id
  - [ ] duration_ms if available

### 5.3 Trace Timeline Component
- [ ] Create `TraceTimeline.tsx` component
- [ ] Fetch trace timeline via getTraceTimeline RPC
- [ ] Render spans as indented list (tree structure)
- [ ] Show operation_name, service_name, duration_ms
- [ ] Highlight failed spans (status === 'error') in red
- [ ] Add to FailedEventsPage event details panel

---

## Phase 6: Frontend Error UX ⏸️ PENDING

### 6.1 Error Display Component
- [ ] Create `ErrorWithCorrelation.tsx` component:
  - [ ] Props: error message, correlationId, traceId (optional)
  - [ ] Display user-friendly error message
  - [ ] Show "Reference: {correlationId}" for support tickets
  - [ ] Add "Copy Reference ID" button
  - [ ] In non-production: show traceId for debugging

### 6.2 Service Error Handling
- [ ] Update `SupabaseInvitationService.ts`:
  - [ ] Extract correlation_id from error response headers
  - [ ] Return correlation_id with error for UI display
- [ ] Update `SupabaseUserCommandService.ts` (same pattern)
- [ ] Update UI components to use ErrorWithCorrelation where Edge Function errors occur

---

## Phase 7: Unit Tests ⏸️ PENDING

### 7.1 Frontend Tests
- [ ] Create `frontend/src/utils/__tests__/tracing.test.ts`:
  - [ ] Test `generateCorrelationId()` returns valid UUID format
  - [ ] Test `generateTraceId()` returns 32 hex chars
  - [ ] Test `generateSpanId()` returns 16 hex chars
  - [ ] Test `generateTraceparent()` returns valid W3C format
  - [ ] Test `getSessionId()` extracts session_id from valid JWT
  - [ ] Test `getSessionId()` returns null when no session
  - [ ] Test `buildTracingHeaders()` includes all expected headers

### 7.2 Edge Function Tests
- [ ] Create `_shared/__tests__/tracing-context.test.ts`:
  - [ ] Test `extractTracingContext()` parses W3C traceparent correctly
  - [ ] Test `extractTracingContext()` falls back to X-Correlation-ID
  - [ ] Test `extractTracingContext()` generates new IDs when headers missing
  - [ ] Test `createSpan()` records start time
  - [ ] Test `endSpan()` calculates duration_ms
  - [ ] Test `buildTraceparentHeader()` returns valid format

- [ ] Create `_shared/__tests__/emit-event.test.ts`:
  - [ ] Test `emitDomainEvent()` populates trace columns
  - [ ] Test `emitDomainEvent()` populates event_metadata JSONB
  - [ ] Test `emitDomainEvent()` generates new span_id
  - [ ] Test `emitDomainEvent()` preserves parent_span_id
  - [ ] Test `safeEmitEvent()` catches and logs errors without throwing

### 7.3 Integration Tests
- [ ] Test end-to-end: Frontend → Edge Function → Database
- [ ] Verify trace_id is consistent across the chain
- [ ] Verify parent_span_id links correctly
- [ ] Test `api.get_trace_timeline()` returns correct hierarchy
- [ ] Performance test: verify indexed queries are <100ms

---

## Phase 8: Documentation ⏸️ PENDING

### 8.1 Update Existing Docs
- [ ] Update `event-observability.md`:
  - [ ] Add "W3C Trace Context" section
  - [ ] Document traceparent header format
  - [ ] Add "Span Timing" section with duration_ms usage
  - [ ] Add "Trace Timeline" section with RPC function docs
  - [ ] Update correlation_id section for frontend flow
  - [ ] Update `last_updated` frontmatter

- [ ] Update `event-metadata-schema.md`:
  - [ ] Add trace_id field definition
  - [ ] Add span_id field definition
  - [ ] Add parent_span_id field definition
  - [ ] Add duration_ms field definition
  - [ ] Document column vs JSONB storage strategy
  - [ ] Update `last_updated` frontmatter

### 8.2 Index Updates
- [ ] Update `AGENT-INDEX.md`:
  - [ ] Add `session-id` keyword → event-observability.md
  - [ ] Add `trace-id` keyword → event-observability.md
  - [ ] Add `span-id` keyword → event-observability.md
  - [ ] Add `traceparent` keyword → event-observability.md
  - [ ] Add `w3c-trace-context` keyword → event-observability.md
  - [ ] Add `duration-ms` keyword → event-observability.md
  - [ ] Verify `correlation-id` keyword exists

---

## Phase 9: Observability Operations ⏸️ DEFERRED

**Note**: These tasks are recommended for production scale but can be implemented after initial rollout.

### 9.1 Retention Policy
- [ ] Create `domain_events_archive` partitioned table
- [ ] Create `archive_old_events()` function
- [ ] Schedule via pg_cron or Temporal workflow (90-day retention)

### 9.2 Sampling Strategy
- [ ] Add `TRACE_SAMPLING_RATE` environment variable
- [ ] Implement `shouldSample()` function
- [ ] Always sample errors (regardless of rate)
- [ ] Honor client sampling flag in traceparent

### 9.3 APM Integration Hooks
- [ ] Create `trace-exporter.ts` module
- [ ] Implement OTLP JSON format conversion
- [ ] Add `OTLP_ENDPOINT` environment variable
- [ ] Fire-and-forget export (async, no await)

---

## Success Validation Checkpoints

### Phase 1 Complete ✅
- [x] Columns exist on domain_events table
- [x] Indexes created successfully
- [x] RPC functions work via Supabase client

### Phase 2 Complete ✅
- [x] Edge Functions accept traceparent header
- [x] Edge Functions accept X-Correlation-ID and X-Session-ID headers
- [x] Events in domain_events have trace columns populated (via emit_domain_event extraction)
- [x] CORS headers configured for tracing headers

### Phase 3 Complete
- [ ] Frontend generates valid traceparent headers
- [ ] Headers are sent with Edge Function invocations
- [ ] Logger outputs JSON with trace context

### Phase 4 Complete
- [ ] Temporal workflow receives tracing context
- [ ] Activity events have correct parent_span_id
- [ ] Full trace chain visible in database

### Phase 5 Complete
- [ ] Admin dashboard shows session_id column
- [ ] Search by session_id returns correct events
- [ ] Search by trace_id returns correct events
- [ ] Trace timeline visualization works

### Phase 6 Complete
- [ ] Error display shows correlation_id reference
- [ ] Copy button works
- [ ] Non-production shows trace_id

### End-to-End Validation
- [ ] Accept invitation flow: frontend sends headers → Edge Function extracts → event has all trace IDs
- [ ] Invite user flow: same full tracing
- [ ] Organization bootstrap: Temporal activities have correct parent_span_id linking to Edge Function

---

## Current Status

**Phase**: Phase 3 - Frontend Integration
**Status**: ⏸️ PENDING (not started)
**Last Updated**: 2026-01-07
**Next Step**: Create `frontend/src/utils/tracing.ts` with W3C traceparent generation

**Completed Phases**:
- ✅ Phase 1: Database Schema Enhancement (2026-01-07)
- ✅ Phase 2: Edge Functions Foundation (2026-01-07)
