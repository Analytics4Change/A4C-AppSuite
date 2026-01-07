/**
 * Unit tests for Edge Function emit-event utilities
 *
 * Run with: deno test --allow-net _shared/__tests__/emit-event.test.ts
 *
 * Tests domain event emission with tracing context.
 */

import {
  assertEquals,
  assertExists,
  assertMatch,
  assertNotEquals,
} from 'https://deno.land/std@0.220.1/assert/mod.ts';

import {
  extractClientInfo,
  buildEventMetadata,
  type EmitEventParams,
} from '../emit-event.ts';

import {
  extractTracingContext,
  type TracingContext,
} from '../tracing-context.ts';

// =============================================================================
// extractClientInfo Tests
// =============================================================================

Deno.test('extractClientInfo: should extract IP from x-forwarded-for (first IP)', () => {
  const req = new Request('https://example.com', {
    headers: {
      'x-forwarded-for': '192.168.1.100, 10.0.0.1, 172.16.0.1',
    },
  });

  const info = extractClientInfo(req);

  assertEquals(info.ipAddress, '192.168.1.100');
});

Deno.test('extractClientInfo: should trim whitespace from IP', () => {
  const req = new Request('https://example.com', {
    headers: {
      'x-forwarded-for': '  192.168.1.100  ,  10.0.0.1  ',
    },
  });

  const info = extractClientInfo(req);

  assertEquals(info.ipAddress, '192.168.1.100');
});

Deno.test('extractClientInfo: should extract IP from x-real-ip', () => {
  const req = new Request('https://example.com', {
    headers: {
      'x-real-ip': '10.0.0.50',
    },
  });

  const info = extractClientInfo(req);

  assertEquals(info.ipAddress, '10.0.0.50');
});

Deno.test('extractClientInfo: should extract user-agent', () => {
  const req = new Request('https://example.com', {
    headers: {
      'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    },
  });

  const info = extractClientInfo(req);

  assertEquals(
    info.userAgent,
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
  );
});

Deno.test('extractClientInfo: should return null for missing headers', () => {
  const req = new Request('https://example.com');

  const info = extractClientInfo(req);

  assertEquals(info.ipAddress, null);
  assertEquals(info.userAgent, null);
});

// =============================================================================
// buildEventMetadata Tests
// =============================================================================

Deno.test('buildEventMetadata: should include all tracing fields', () => {
  const context: TracingContext = {
    correlationId: 'corr-123',
    sessionId: 'sess-456',
    traceId: '550e8400e29b41d4a716446655440000',
    spanId: 'a716446655440000',
    parentSpanId: 'b827567282349342',
    sampled: true,
  };

  const metadata = buildEventMetadata(context, 'user.created');

  assertEquals(metadata.correlation_id, 'corr-123');
  assertEquals(metadata.session_id, 'sess-456');
  assertEquals(metadata.trace_id, '550e8400e29b41d4a716446655440000');
  // span_id should be a new generated span ID (not the context's spanId)
  assertMatch(metadata.span_id as string, /^[0-9a-f]{16}$/);
  // parent_span_id should be the context's spanId (this event is a child of current span)
  assertEquals(metadata.parent_span_id, 'a716446655440000');
});

Deno.test('buildEventMetadata: should include service and operation name', () => {
  const context: TracingContext = {
    correlationId: 'corr-123',
    sessionId: null,
    traceId: '550e8400e29b41d4a716446655440000',
    spanId: 'a716446655440000',
    parentSpanId: null,
    sampled: true,
  };

  const metadata = buildEventMetadata(context, 'user.invited');

  assertEquals(metadata.service_name, 'edge-function');
  assertEquals(metadata.operation_name, 'user.invited');
});

Deno.test('buildEventMetadata: should include client info from request', () => {
  const context: TracingContext = {
    correlationId: 'corr-123',
    sessionId: null,
    traceId: '550e8400e29b41d4a716446655440000',
    spanId: 'a716446655440000',
    parentSpanId: null,
    sampled: true,
  };

  const req = new Request('https://example.com', {
    headers: {
      'x-forwarded-for': '192.168.1.100',
      'user-agent': 'TestAgent/1.0',
    },
  });

  const metadata = buildEventMetadata(context, 'user.created', req);

  assertEquals(metadata.ip_address, '192.168.1.100');
  assertEquals(metadata.user_agent, 'TestAgent/1.0');
});

Deno.test('buildEventMetadata: should set null for missing client info', () => {
  const context: TracingContext = {
    correlationId: 'corr-123',
    sessionId: null,
    traceId: '550e8400e29b41d4a716446655440000',
    spanId: 'a716446655440000',
    parentSpanId: null,
    sampled: true,
  };

  const metadata = buildEventMetadata(context, 'user.created');

  assertEquals(metadata.ip_address, null);
  assertEquals(metadata.user_agent, null);
});

Deno.test('buildEventMetadata: should merge additional metadata', () => {
  const context: TracingContext = {
    correlationId: 'corr-123',
    sessionId: null,
    traceId: '550e8400e29b41d4a716446655440000',
    spanId: 'a716446655440000',
    parentSpanId: null,
    sampled: true,
  };

  const metadata = buildEventMetadata(context, 'user.created', undefined, {
    user_id: 'user-789',
    reason: 'User invited via admin panel',
    custom_field: 'custom_value',
  });

  assertEquals(metadata.user_id, 'user-789');
  assertEquals(metadata.reason, 'User invited via admin panel');
  assertEquals(metadata.custom_field, 'custom_value');
  // Should still have tracing fields
  assertEquals(metadata.correlation_id, 'corr-123');
});

Deno.test('buildEventMetadata: should handle null sessionId', () => {
  const context: TracingContext = {
    correlationId: 'corr-123',
    sessionId: null,
    traceId: '550e8400e29b41d4a716446655440000',
    spanId: 'a716446655440000',
    parentSpanId: null,
    sampled: true,
  };

  const metadata = buildEventMetadata(context, 'user.created');

  assertEquals(metadata.session_id, null);
});

Deno.test('buildEventMetadata: should generate unique span_id for each call', () => {
  const context: TracingContext = {
    correlationId: 'corr-123',
    sessionId: null,
    traceId: '550e8400e29b41d4a716446655440000',
    spanId: 'a716446655440000',
    parentSpanId: null,
    sampled: true,
  };

  const metadata1 = buildEventMetadata(context, 'event1');
  const metadata2 = buildEventMetadata(context, 'event2');

  assertNotEquals(metadata1.span_id, metadata2.span_id);
});

// =============================================================================
// Integration Tests: Tracing Context Flow
// =============================================================================

Deno.test('Integration: extractTracingContext + buildEventMetadata should link spans correctly', () => {
  // Simulate incoming request with traceparent
  // Note: span ID must be valid 16-char hex (a716446655440000), not arbitrary text
  const req = new Request('https://example.com', {
    headers: {
      traceparent: '00-550e8400e29b41d4a716446655440000-a716446655440000-01',
      'x-correlation-id': 'corr-from-frontend',
      'x-session-id': 'sess-from-jwt',
    },
  });

  // Extract context (simulating Edge Function startup)
  const context = extractTracingContext(req);

  // Build metadata for an event (simulating event emission)
  const metadata = buildEventMetadata(context, 'user.created', req);

  // Verify trace chain
  assertEquals(metadata.trace_id, '550e8400e29b41d4a716446655440000');
  // Event's parent should be the Edge Function's span (which has frontend's span as parent)
  assertEquals(metadata.parent_span_id, context.spanId);
  // Event gets its own span ID
  assertMatch(metadata.span_id as string, /^[0-9a-f]{16}$/);
  assertNotEquals(metadata.span_id, metadata.parent_span_id);

  // Correlation flows through
  assertEquals(metadata.correlation_id, 'corr-from-frontend');
  assertEquals(metadata.session_id, 'sess-from-jwt');
});

Deno.test('Integration: multiple events should share trace_id but have unique span_ids', () => {
  const req = new Request('https://example.com', {
    headers: {
      traceparent: '00-550e8400e29b41d4a716446655440000-a716446655440000-01',
      'x-correlation-id': 'corr-123',
    },
  });

  const context = extractTracingContext(req);

  const metadata1 = buildEventMetadata(context, 'user.invited');
  const metadata2 = buildEventMetadata(context, 'invitation.created');
  const metadata3 = buildEventMetadata(context, 'email.sent');

  // All events share the same trace ID
  assertEquals(metadata1.trace_id, '550e8400e29b41d4a716446655440000');
  assertEquals(metadata2.trace_id, '550e8400e29b41d4a716446655440000');
  assertEquals(metadata3.trace_id, '550e8400e29b41d4a716446655440000');

  // All events share the same correlation ID
  assertEquals(metadata1.correlation_id, 'corr-123');
  assertEquals(metadata2.correlation_id, 'corr-123');
  assertEquals(metadata3.correlation_id, 'corr-123');

  // Each event has a unique span ID
  assertNotEquals(metadata1.span_id, metadata2.span_id);
  assertNotEquals(metadata2.span_id, metadata3.span_id);
  assertNotEquals(metadata1.span_id, metadata3.span_id);

  // All events have the same parent (the Edge Function's span)
  assertEquals(metadata1.parent_span_id, context.spanId);
  assertEquals(metadata2.parent_span_id, context.spanId);
  assertEquals(metadata3.parent_span_id, context.spanId);
});

// =============================================================================
// EmitEventParams Type Tests
// =============================================================================

Deno.test('EmitEventParams: should accept valid parameters structure', () => {
  const params: EmitEventParams = {
    streamId: 'user-123',
    streamType: 'user',
    eventType: 'user.created',
    eventData: {
      name: 'John Doe',
      email: 'john@example.com',
    },
    additionalMetadata: {
      reason: 'User registration',
    },
  };

  // Type-level test: if this compiles, the type is correct
  assertExists(params.streamId);
  assertExists(params.streamType);
  assertExists(params.eventType);
  assertExists(params.eventData);
  assertExists(params.additionalMetadata);
});

Deno.test('EmitEventParams: additionalMetadata should be optional', () => {
  const params: EmitEventParams = {
    streamId: 'user-123',
    streamType: 'user',
    eventType: 'user.created',
    eventData: { name: 'John' },
  };

  // Type-level test: should compile without additionalMetadata
  assertExists(params.streamId);
  assertEquals(params.additionalMetadata, undefined);
});
