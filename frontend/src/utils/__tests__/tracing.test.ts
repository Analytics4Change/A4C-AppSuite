/**
 * Unit tests for frontend tracing utilities
 *
 * Tests W3C Trace Context compatible tracing functions for:
 * - ID generation (correlation, trace, span)
 * - Header building (traceparent format)
 * - Session extraction from JWT
 * - Context creation and propagation
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import {
  generateCorrelationId,
  generateTraceId,
  generateSpanId,
  generateTraceparent,
  parseTraceparent,
  getSessionId,
  buildTracingHeaders,
  buildTracingHeadersSync,
  buildHeadersFromContext,
  createTracingContext,
  createTracingContextSync,
  type TracingContext,
} from '../tracing';

// Mock the supabase service
vi.mock('@/services/auth/supabase.service', () => ({
  supabaseService: {
    getClient: vi.fn(),
  },
}));

import { supabaseService } from '@/services/auth/supabase.service';

describe('Tracing Utilities', () => {
  describe('generateCorrelationId', () => {
    it('should return a valid UUID format', () => {
      const correlationId = generateCorrelationId();

      // UUID v4 format: xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx
      const uuidRegex =
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
      expect(correlationId).toMatch(uuidRegex);
    });

    it('should generate unique IDs on each call', () => {
      const ids = new Set<string>();
      for (let i = 0; i < 100; i++) {
        ids.add(generateCorrelationId());
      }
      expect(ids.size).toBe(100);
    });
  });

  describe('generateTraceId', () => {
    it('should return exactly 32 hex characters', () => {
      const traceId = generateTraceId();

      expect(traceId).toHaveLength(32);
      expect(traceId).toMatch(/^[0-9a-f]{32}$/);
    });

    it('should not contain dashes (unlike UUID)', () => {
      const traceId = generateTraceId();

      expect(traceId).not.toContain('-');
    });

    it('should generate unique IDs on each call', () => {
      const ids = new Set<string>();
      for (let i = 0; i < 100; i++) {
        ids.add(generateTraceId());
      }
      expect(ids.size).toBe(100);
    });
  });

  describe('generateSpanId', () => {
    it('should return exactly 16 hex characters', () => {
      const spanId = generateSpanId();

      expect(spanId).toHaveLength(16);
      expect(spanId).toMatch(/^[0-9a-f]{16}$/);
    });

    it('should generate unique IDs on each call', () => {
      const ids = new Set<string>();
      for (let i = 0; i < 100; i++) {
        ids.add(generateSpanId());
      }
      expect(ids.size).toBe(100);
    });
  });

  describe('generateTraceparent', () => {
    it('should return valid W3C traceparent format', () => {
      const result = generateTraceparent();

      // Format: 00-{trace_id}-{span_id}-01
      // Example: 00-550e8400e29b41d4a716446655440000-a716446655440000-01
      const traceparentRegex = /^00-[0-9a-f]{32}-[0-9a-f]{16}-01$/;
      expect(result.header).toMatch(traceparentRegex);
    });

    it('should return correct version (00)', () => {
      const result = generateTraceparent();

      expect(result.version).toBe('00');
    });

    it('should return 32-char trace ID', () => {
      const result = generateTraceparent();

      expect(result.traceId).toHaveLength(32);
      expect(result.traceId).toMatch(/^[0-9a-f]{32}$/);
    });

    it('should return 16-char span ID', () => {
      const result = generateTraceparent();

      expect(result.spanId).toHaveLength(16);
      expect(result.spanId).toMatch(/^[0-9a-f]{16}$/);
    });

    it('should return sampled flag (01)', () => {
      const result = generateTraceparent();

      expect(result.flags).toBe('01');
    });

    it('should use provided trace ID when given', () => {
      const customTraceId = '550e8400e29b41d4a716446655440000';
      const result = generateTraceparent(customTraceId);

      expect(result.traceId).toBe(customTraceId);
      expect(result.header).toContain(customTraceId);
    });

    it('should use provided span ID when given', () => {
      const customSpanId = 'a716446655440000';
      const result = generateTraceparent(undefined, customSpanId);

      expect(result.spanId).toBe(customSpanId);
      expect(result.header).toContain(customSpanId);
    });

    it('should use both provided IDs when given', () => {
      const customTraceId = '550e8400e29b41d4a716446655440000';
      const customSpanId = 'a716446655440000';
      const result = generateTraceparent(customTraceId, customSpanId);

      expect(result.header).toBe(`00-${customTraceId}-${customSpanId}-01`);
    });
  });

  describe('parseTraceparent', () => {
    it('should parse valid traceparent header', () => {
      const traceparent = '00-550e8400e29b41d4a716446655440000-a716446655440000-01';
      const result = parseTraceparent(traceparent);

      expect(result).not.toBeNull();
      expect(result?.version).toBe('00');
      expect(result?.traceId).toBe('550e8400e29b41d4a716446655440000');
      expect(result?.spanId).toBe('a716446655440000');
      expect(result?.flags).toBe('01');
    });

    it('should return null for invalid format (wrong number of parts)', () => {
      expect(parseTraceparent('00-550e8400e29b41d4a716446655440000')).toBeNull();
      expect(parseTraceparent('00-trace-span-01-extra')).toBeNull();
      expect(parseTraceparent('')).toBeNull();
    });

    it('should return null for invalid version length', () => {
      expect(
        parseTraceparent('0-550e8400e29b41d4a716446655440000-a716446655440000-01')
      ).toBeNull();
      expect(
        parseTraceparent('000-550e8400e29b41d4a716446655440000-a716446655440000-01')
      ).toBeNull();
    });

    it('should return null for invalid trace ID length', () => {
      expect(parseTraceparent('00-550e8400e29b41d4-a716446655440000-01')).toBeNull();
      expect(
        parseTraceparent('00-550e8400e29b41d4a716446655440000extra-a716446655440000-01')
      ).toBeNull();
    });

    it('should return null for invalid span ID length', () => {
      expect(parseTraceparent('00-550e8400e29b41d4a716446655440000-a71644665544-01')).toBeNull();
      expect(
        parseTraceparent('00-550e8400e29b41d4a716446655440000-a716446655440000extra-01')
      ).toBeNull();
    });

    it('should return null for invalid flags length', () => {
      expect(
        parseTraceparent('00-550e8400e29b41d4a716446655440000-a716446655440000-1')
      ).toBeNull();
      expect(
        parseTraceparent('00-550e8400e29b41d4a716446655440000-a716446655440000-011')
      ).toBeNull();
    });

    it('should return null for non-hex characters', () => {
      expect(
        parseTraceparent('00-550e8400e29b41d4a716446655440000-GHIJKLMNOPQRSTUV-01')
      ).toBeNull();
      expect(
        parseTraceparent('00-notahexvalue00000000000000000000-a716446655440000-01')
      ).toBeNull();
    });

    it('should handle case insensitivity for hex values', () => {
      const result = parseTraceparent(
        '00-550E8400E29B41D4A716446655440000-A716446655440000-01'
      );

      expect(result).not.toBeNull();
      expect(result?.traceId).toBe('550E8400E29B41D4A716446655440000');
    });
  });

  describe('getSessionId', () => {
    beforeEach(() => {
      vi.resetAllMocks();
    });

    it('should extract session_id from valid JWT', async () => {
      // Create a mock JWT with session_id claim
      const mockPayload = {
        sub: 'user-123',
        session_id: 'session-456',
        exp: Math.floor(Date.now() / 1000) + 3600,
      };
      const mockToken = `header.${btoa(JSON.stringify(mockPayload))}.signature`;

      vi.mocked(supabaseService.getClient).mockReturnValue({
        auth: {
          getSession: vi.fn().mockResolvedValue({
            data: {
              session: {
                access_token: mockToken,
              },
            },
          }),
        },
      } as unknown as ReturnType<typeof supabaseService.getClient>);

      const sessionId = await getSessionId();

      expect(sessionId).toBe('session-456');
    });

    it('should return null when no session exists', async () => {
      vi.mocked(supabaseService.getClient).mockReturnValue({
        auth: {
          getSession: vi.fn().mockResolvedValue({
            data: { session: null },
          }),
        },
      } as unknown as ReturnType<typeof supabaseService.getClient>);

      const sessionId = await getSessionId();

      expect(sessionId).toBeNull();
    });

    it('should return null when JWT has no session_id claim', async () => {
      const mockPayload = {
        sub: 'user-123',
        exp: Math.floor(Date.now() / 1000) + 3600,
        // No session_id
      };
      const mockToken = `header.${btoa(JSON.stringify(mockPayload))}.signature`;

      vi.mocked(supabaseService.getClient).mockReturnValue({
        auth: {
          getSession: vi.fn().mockResolvedValue({
            data: {
              session: {
                access_token: mockToken,
              },
            },
          }),
        },
      } as unknown as ReturnType<typeof supabaseService.getClient>);

      const sessionId = await getSessionId();

      expect(sessionId).toBeNull();
    });

    it('should return null when JWT decode fails', async () => {
      vi.mocked(supabaseService.getClient).mockReturnValue({
        auth: {
          getSession: vi.fn().mockResolvedValue({
            data: {
              session: {
                access_token: 'invalid-jwt-format',
              },
            },
          }),
        },
      } as unknown as ReturnType<typeof supabaseService.getClient>);

      const sessionId = await getSessionId();

      expect(sessionId).toBeNull();
    });

    it('should return null when getSession throws', async () => {
      vi.mocked(supabaseService.getClient).mockReturnValue({
        auth: {
          getSession: vi.fn().mockRejectedValue(new Error('Auth error')),
        },
      } as unknown as ReturnType<typeof supabaseService.getClient>);

      const sessionId = await getSessionId();

      expect(sessionId).toBeNull();
    });
  });

  describe('buildHeadersFromContext', () => {
    it('should build all headers from tracing context', () => {
      const context: TracingContext = {
        correlationId: 'corr-123',
        sessionId: 'sess-456',
        traceId: '550e8400e29b41d4a716446655440000',
        spanId: 'a716446655440000',
      };

      const headers = buildHeadersFromContext(context);

      expect(headers['traceparent']).toBe('00-550e8400e29b41d4a716446655440000-a716446655440000-01');
      expect(headers['X-Correlation-ID']).toBe('corr-123');
      expect(headers['X-Session-ID']).toBe('sess-456');
    });

    it('should omit X-Session-ID when sessionId is null', () => {
      const context: TracingContext = {
        correlationId: 'corr-123',
        sessionId: null,
        traceId: '550e8400e29b41d4a716446655440000',
        spanId: 'a716446655440000',
      };

      const headers = buildHeadersFromContext(context);

      expect(headers['traceparent']).toBeDefined();
      expect(headers['X-Correlation-ID']).toBe('corr-123');
      expect(headers['X-Session-ID']).toBeUndefined();
    });
  });

  describe('buildTracingHeaders', () => {
    beforeEach(() => {
      vi.resetAllMocks();
      // Default mock: no session
      vi.mocked(supabaseService.getClient).mockReturnValue({
        auth: {
          getSession: vi.fn().mockResolvedValue({
            data: { session: null },
          }),
        },
      } as unknown as ReturnType<typeof supabaseService.getClient>);
    });

    it('should include traceparent header', async () => {
      const headers = await buildTracingHeaders();

      expect(headers['traceparent']).toBeDefined();
      expect(headers['traceparent']).toMatch(/^00-[0-9a-f]{32}-[0-9a-f]{16}-01$/);
    });

    it('should include X-Correlation-ID header', async () => {
      const headers = await buildTracingHeaders();

      expect(headers['X-Correlation-ID']).toBeDefined();
      expect(headers['X-Correlation-ID']).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
      );
    });

    it('should include X-Session-ID when session exists', async () => {
      const mockPayload = {
        sub: 'user-123',
        session_id: 'sess-789',
      };
      const mockToken = `header.${btoa(JSON.stringify(mockPayload))}.signature`;

      vi.mocked(supabaseService.getClient).mockReturnValue({
        auth: {
          getSession: vi.fn().mockResolvedValue({
            data: {
              session: {
                access_token: mockToken,
              },
            },
          }),
        },
      } as unknown as ReturnType<typeof supabaseService.getClient>);

      const headers = await buildTracingHeaders();

      expect(headers['X-Session-ID']).toBe('sess-789');
    });

    it('should not include X-Session-ID when no session', async () => {
      const headers = await buildTracingHeaders();

      expect(headers['X-Session-ID']).toBeUndefined();
    });
  });

  describe('buildTracingHeadersSync', () => {
    it('should build headers synchronously with provided session', () => {
      const headers = buildTracingHeadersSync('session-123');

      expect(headers['traceparent']).toMatch(/^00-[0-9a-f]{32}-[0-9a-f]{16}-01$/);
      expect(headers['X-Correlation-ID']).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
      );
      expect(headers['X-Session-ID']).toBe('session-123');
    });

    it('should omit X-Session-ID when session is null', () => {
      const headers = buildTracingHeadersSync(null);

      expect(headers['traceparent']).toBeDefined();
      expect(headers['X-Correlation-ID']).toBeDefined();
      expect(headers['X-Session-ID']).toBeUndefined();
    });

    it('should omit X-Session-ID when session is undefined', () => {
      const headers = buildTracingHeadersSync();

      expect(headers['X-Session-ID']).toBeUndefined();
    });
  });

  describe('createTracingContext', () => {
    beforeEach(() => {
      vi.resetAllMocks();
    });

    it('should create full tracing context', async () => {
      const mockPayload = {
        sub: 'user-123',
        session_id: 'sess-456',
      };
      const mockToken = `header.${btoa(JSON.stringify(mockPayload))}.signature`;

      vi.mocked(supabaseService.getClient).mockReturnValue({
        auth: {
          getSession: vi.fn().mockResolvedValue({
            data: {
              session: {
                access_token: mockToken,
              },
            },
          }),
        },
      } as unknown as ReturnType<typeof supabaseService.getClient>);

      const context = await createTracingContext();

      expect(context.correlationId).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
      );
      expect(context.sessionId).toBe('sess-456');
      expect(context.traceId).toMatch(/^[0-9a-f]{32}$/);
      expect(context.spanId).toMatch(/^[0-9a-f]{16}$/);
    });

    it('should set sessionId to null when no session', async () => {
      vi.mocked(supabaseService.getClient).mockReturnValue({
        auth: {
          getSession: vi.fn().mockResolvedValue({
            data: { session: null },
          }),
        },
      } as unknown as ReturnType<typeof supabaseService.getClient>);

      const context = await createTracingContext();

      expect(context.sessionId).toBeNull();
      expect(context.correlationId).toBeDefined();
      expect(context.traceId).toBeDefined();
      expect(context.spanId).toBeDefined();
    });
  });

  describe('createTracingContextSync', () => {
    it('should create context synchronously with provided session', () => {
      const context = createTracingContextSync('session-123');

      expect(context.correlationId).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
      );
      expect(context.sessionId).toBe('session-123');
      expect(context.traceId).toMatch(/^[0-9a-f]{32}$/);
      expect(context.spanId).toMatch(/^[0-9a-f]{16}$/);
    });

    it('should set sessionId to null when not provided', () => {
      const context = createTracingContextSync();

      expect(context.sessionId).toBeNull();
    });

    it('should set sessionId to null when explicitly null', () => {
      const context = createTracingContextSync(null);

      expect(context.sessionId).toBeNull();
    });
  });

  describe('Integration: context to headers consistency', () => {
    it('should produce consistent IDs when using context + buildHeadersFromContext', async () => {
      vi.mocked(supabaseService.getClient).mockReturnValue({
        auth: {
          getSession: vi.fn().mockResolvedValue({
            data: { session: null },
          }),
        },
      } as unknown as ReturnType<typeof supabaseService.getClient>);

      const context = await createTracingContext();
      const headers = buildHeadersFromContext(context);

      // Extract IDs from traceparent header
      const traceparentMatch = headers['traceparent'].match(
        /^00-([0-9a-f]{32})-([0-9a-f]{16})-01$/
      );

      expect(traceparentMatch).not.toBeNull();
      expect(traceparentMatch![1]).toBe(context.traceId);
      expect(traceparentMatch![2]).toBe(context.spanId);
      expect(headers['X-Correlation-ID']).toBe(context.correlationId);
    });
  });
});
