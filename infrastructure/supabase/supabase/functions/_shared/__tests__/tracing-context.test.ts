/**
 * Unit tests for Edge Function tracing context utilities
 *
 * Run with: deno test --allow-net _shared/__tests__/tracing-context.test.ts
 *
 * Tests W3C Trace Context parsing, span lifecycle, and header building.
 */

import {
  assertEquals,
  assertExists,
  assertNotEquals,
  assertMatch,
} from 'https://deno.land/std@0.220.1/assert/mod.ts';

import {
  generateTraceId,
  generateSpanId,
  parseTraceparent,
  buildTraceparent,
  extractTracingContext,
  createSpan,
  endSpan,
  addSpanAttribute,
  buildTracingHeaders,
  validateCorrelationId,
  extractClientInfo,
} from '../tracing-context.ts';

// =============================================================================
// generateTraceId Tests
// =============================================================================

Deno.test('generateTraceId: should return 32 hex characters', () => {
  const traceId = generateTraceId();

  assertEquals(traceId.length, 32);
  assertMatch(traceId, /^[0-9a-f]{32}$/);
});

Deno.test('generateTraceId: should not contain dashes', () => {
  const traceId = generateTraceId();

  assertEquals(traceId.includes('-'), false);
});

Deno.test('generateTraceId: should generate unique IDs', () => {
  const ids = new Set<string>();
  for (let i = 0; i < 100; i++) {
    ids.add(generateTraceId());
  }
  assertEquals(ids.size, 100);
});

// =============================================================================
// generateSpanId Tests
// =============================================================================

Deno.test('generateSpanId: should return 16 hex characters', () => {
  const spanId = generateSpanId();

  assertEquals(spanId.length, 16);
  assertMatch(spanId, /^[0-9a-f]{16}$/);
});

Deno.test('generateSpanId: should generate unique IDs', () => {
  const ids = new Set<string>();
  for (let i = 0; i < 100; i++) {
    ids.add(generateSpanId());
  }
  assertEquals(ids.size, 100);
});

// =============================================================================
// parseTraceparent Tests
// =============================================================================

Deno.test('parseTraceparent: should parse valid traceparent header', () => {
  const traceparent = '00-550e8400e29b41d4a716446655440000-a716446655440000-01';
  const result = parseTraceparent(traceparent);

  assertExists(result);
  assertEquals(result!.traceId, '550e8400e29b41d4a716446655440000');
  assertEquals(result!.parentSpanId, 'a716446655440000');
  assertEquals(result!.sampled, true);
});

Deno.test('parseTraceparent: should parse unsampled trace', () => {
  const traceparent = '00-550e8400e29b41d4a716446655440000-a716446655440000-00';
  const result = parseTraceparent(traceparent);

  assertExists(result);
  assertEquals(result!.sampled, false);
});

Deno.test('parseTraceparent: should return null for null input', () => {
  const result = parseTraceparent(null);
  assertEquals(result, null);
});

Deno.test('parseTraceparent: should return null for invalid format', () => {
  assertEquals(parseTraceparent('invalid'), null);
  assertEquals(parseTraceparent('00-trace-span'), null);
  assertEquals(parseTraceparent('00-trace-span-01-extra'), null);
});

Deno.test('parseTraceparent: should return null for wrong version', () => {
  assertEquals(
    parseTraceparent('01-550e8400e29b41d4a716446655440000-a716446655440000-01'),
    null
  );
});

Deno.test('parseTraceparent: should return null for invalid trace ID length', () => {
  assertEquals(parseTraceparent('00-550e8400e29b41d4-a716446655440000-01'), null);
});

Deno.test('parseTraceparent: should return null for invalid span ID length', () => {
  assertEquals(
    parseTraceparent('00-550e8400e29b41d4a716446655440000-a71644665544-01'),
    null
  );
});

Deno.test('parseTraceparent: should return null for all-zero trace ID', () => {
  assertEquals(
    parseTraceparent('00-00000000000000000000000000000000-a716446655440000-01'),
    null
  );
});

Deno.test('parseTraceparent: should return null for all-zero span ID', () => {
  assertEquals(
    parseTraceparent('00-550e8400e29b41d4a716446655440000-0000000000000000-01'),
    null
  );
});

Deno.test('parseTraceparent: should handle uppercase hex values', () => {
  const traceparent = '00-550E8400E29B41D4A716446655440000-A716446655440000-01';
  const result = parseTraceparent(traceparent);

  assertExists(result);
  assertEquals(result!.traceId, '550e8400e29b41d4a716446655440000'); // lowercased
});

// =============================================================================
// buildTraceparent Tests
// =============================================================================

Deno.test('buildTraceparent: should build valid traceparent header', () => {
  const traceId = '550e8400e29b41d4a716446655440000';
  const spanId = 'a716446655440000';

  const result = buildTraceparent(traceId, spanId, true);

  assertEquals(result, '00-550e8400e29b41d4a716446655440000-a716446655440000-01');
});

Deno.test('buildTraceparent: should build unsampled traceparent', () => {
  const traceId = '550e8400e29b41d4a716446655440000';
  const spanId = 'a716446655440000';

  const result = buildTraceparent(traceId, spanId, false);

  assertEquals(result, '00-550e8400e29b41d4a716446655440000-a716446655440000-00');
});

Deno.test('buildTraceparent: should default to sampled=true', () => {
  const result = buildTraceparent('550e8400e29b41d4a716446655440000', 'a716446655440000');

  assertEquals(result.endsWith('-01'), true);
});

// =============================================================================
// extractTracingContext Tests
// =============================================================================

Deno.test('extractTracingContext: should extract from W3C traceparent header', () => {
  const req = new Request('https://example.com', {
    headers: {
      traceparent: '00-550e8400e29b41d4a716446655440000-a716446655440000-01',
      'x-correlation-id': 'corr-123',
      'x-session-id': 'sess-456',
    },
  });

  const context = extractTracingContext(req);

  assertEquals(context.traceId, '550e8400e29b41d4a716446655440000');
  assertEquals(context.parentSpanId, 'a716446655440000');
  assertEquals(context.correlationId, 'corr-123');
  assertEquals(context.sessionId, 'sess-456');
  assertEquals(context.sampled, true);
  // New span ID should be generated for this operation
  assertMatch(context.spanId, /^[0-9a-f]{16}$/);
  assertNotEquals(context.spanId, context.parentSpanId);
});

Deno.test('extractTracingContext: should generate new trace when no traceparent', () => {
  const req = new Request('https://example.com', {
    headers: {
      'x-correlation-id': 'corr-789',
    },
  });

  const context = extractTracingContext(req);

  assertMatch(context.traceId, /^[0-9a-f]{32}$/);
  assertMatch(context.spanId, /^[0-9a-f]{16}$/);
  assertEquals(context.parentSpanId, null);
  assertEquals(context.correlationId, 'corr-789');
  assertEquals(context.sampled, true);
});

Deno.test('extractTracingContext: should generate correlation ID when not provided', () => {
  const req = new Request('https://example.com');

  const context = extractTracingContext(req);

  // Should generate a valid UUID
  assertMatch(
    context.correlationId,
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
  );
});

Deno.test('extractTracingContext: should set sessionId to null when not provided', () => {
  const req = new Request('https://example.com');

  const context = extractTracingContext(req);

  assertEquals(context.sessionId, null);
});

// =============================================================================
// createSpan / endSpan Tests
// =============================================================================

Deno.test('createSpan: should create span with correct properties', () => {
  const req = new Request('https://example.com', {
    headers: {
      traceparent: '00-550e8400e29b41d4a716446655440000-a716446655440000-01',
      'x-correlation-id': 'corr-123',
    },
  });
  const context = extractTracingContext(req);

  const span = createSpan(context, 'test-operation');

  assertEquals(span.traceId, context.traceId);
  assertEquals(span.spanId, context.spanId);
  assertEquals(span.parentSpanId, context.parentSpanId);
  assertEquals(span.operationName, 'test-operation');
  assertEquals(span.serviceName, 'edge-function');
  assertEquals(span.status, 'ok');
  assertEquals(span.correlationId, context.correlationId);
  assertExists(span.startTime);
});

Deno.test('createSpan: should accept custom service name', () => {
  const req = new Request('https://example.com');
  const context = extractTracingContext(req);

  const span = createSpan(context, 'test-op', 'custom-service');

  assertEquals(span.serviceName, 'custom-service');
});

Deno.test('endSpan: should set end time and duration', async () => {
  const req = new Request('https://example.com');
  const context = extractTracingContext(req);
  const span = createSpan(context, 'test-operation');

  // Small delay to ensure measurable duration
  await new Promise((resolve) => setTimeout(resolve, 10));

  const endedSpan = endSpan(span, 'ok');

  assertExists(endedSpan.endTime);
  assertExists(endedSpan.durationMs);
  assertEquals(endedSpan.durationMs! >= 10, true);
  assertEquals(endedSpan.status, 'ok');
});

Deno.test('endSpan: should set error status', () => {
  const req = new Request('https://example.com');
  const context = extractTracingContext(req);
  const span = createSpan(context, 'test-operation');

  const endedSpan = endSpan(span, 'error');

  assertEquals(endedSpan.status, 'error');
});

// =============================================================================
// addSpanAttribute Tests
// =============================================================================

Deno.test('addSpanAttribute: should add string attribute', () => {
  const req = new Request('https://example.com');
  const context = extractTracingContext(req);
  const span = createSpan(context, 'test-operation');

  addSpanAttribute(span, 'user.email', 'test@example.com');

  assertEquals(span.attributes['user.email'], 'test@example.com');
});

Deno.test('addSpanAttribute: should add number attribute', () => {
  const req = new Request('https://example.com');
  const context = extractTracingContext(req);
  const span = createSpan(context, 'test-operation');

  addSpanAttribute(span, 'http.status_code', 200);

  assertEquals(span.attributes['http.status_code'], 200);
});

Deno.test('addSpanAttribute: should add boolean attribute', () => {
  const req = new Request('https://example.com');
  const context = extractTracingContext(req);
  const span = createSpan(context, 'test-operation');

  addSpanAttribute(span, 'cache.hit', true);

  assertEquals(span.attributes['cache.hit'], true);
});

// =============================================================================
// buildTracingHeaders Tests
// =============================================================================

Deno.test('buildTracingHeaders: should build all required headers', () => {
  const req = new Request('https://example.com', {
    headers: {
      traceparent: '00-550e8400e29b41d4a716446655440000-a716446655440000-01',
      'x-correlation-id': 'corr-123',
      'x-session-id': 'sess-456',
    },
  });
  const context = extractTracingContext(req);

  const headers = buildTracingHeaders(context);

  assertExists(headers['traceparent']);
  assertMatch(headers['traceparent'], /^00-[0-9a-f]{32}-[0-9a-f]{16}-0[01]$/);
  assertEquals(headers['x-correlation-id'], 'corr-123');
  assertEquals(headers['x-session-id'], 'sess-456');
});

Deno.test('buildTracingHeaders: should omit x-session-id when null', () => {
  const req = new Request('https://example.com', {
    headers: {
      'x-correlation-id': 'corr-123',
    },
  });
  const context = extractTracingContext(req);

  const headers = buildTracingHeaders(context);

  assertEquals(headers['x-session-id'], undefined);
});

// =============================================================================
// validateCorrelationId Tests
// =============================================================================

Deno.test('validateCorrelationId: should return valid UUID unchanged', () => {
  const validUuid = '550e8400-e29b-41d4-a716-446655440000';

  const result = validateCorrelationId(validUuid);

  assertEquals(result, validUuid);
});

Deno.test('validateCorrelationId: should generate new UUID for null', () => {
  const result = validateCorrelationId(null);

  assertMatch(
    result,
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
  );
});

Deno.test('validateCorrelationId: should generate new UUID for invalid format', () => {
  const result = validateCorrelationId('invalid-uuid');

  assertMatch(
    result,
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
  );
  assertNotEquals(result, 'invalid-uuid');
});

// =============================================================================
// extractClientInfo Tests
// =============================================================================

Deno.test('extractClientInfo: should extract IP from x-forwarded-for', () => {
  const req = new Request('https://example.com', {
    headers: {
      'x-forwarded-for': '192.168.1.100, 10.0.0.1',
      'user-agent': 'Mozilla/5.0',
    },
  });

  const info = extractClientInfo(req);

  assertEquals(info.ipAddress, '192.168.1.100');
  assertEquals(info.userAgent, 'Mozilla/5.0');
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

Deno.test('extractClientInfo: should prefer x-forwarded-for over x-real-ip', () => {
  const req = new Request('https://example.com', {
    headers: {
      'x-forwarded-for': '192.168.1.100',
      'x-real-ip': '10.0.0.50',
    },
  });

  const info = extractClientInfo(req);

  assertEquals(info.ipAddress, '192.168.1.100');
});

Deno.test('extractClientInfo: should return null when no headers', () => {
  const req = new Request('https://example.com');

  const info = extractClientInfo(req);

  assertEquals(info.ipAddress, null);
  assertEquals(info.userAgent, null);
});
