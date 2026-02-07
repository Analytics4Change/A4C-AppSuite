/**
 * Pure tracing ID generators — zero dependencies.
 *
 * Used by supabase-ssr.ts (fetch wrapper) and tracing.ts.
 * Extracted to avoid circular dependency:
 *   supabase-ssr.ts → tracing.ts → supabase.service.ts → supabase-ssr.ts
 *
 * @module utils/trace-ids
 */

/**
 * Generate a UUID v4 correlation ID.
 *
 * @returns UUID v4 string (e.g., "550e8400-e29b-41d4-a716-446655440000")
 */
export function generateCorrelationId(): string {
  if (typeof globalThis.crypto !== 'undefined' && globalThis.crypto.randomUUID) {
    return globalThis.crypto.randomUUID();
  }

  // Fallback for older browsers
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/**
 * Generate a W3C traceparent header string.
 *
 * Format: 00-{trace_id}-{span_id}-01
 *
 * NOTE: This returns a plain string. For the rich object version
 * (with .header, .traceId, .spanId, .flags properties), use
 * generateTraceparent() from tracing.ts.
 *
 * @returns traceparent header value (e.g., "00-550e8400e29b41d4a716446655440000-a716446655440000-01")
 */
export function generateTraceparentHeader(): string {
  const traceId = generateCorrelationId().replace(/-/g, '');
  const bytes = new Uint8Array(8);
  if (typeof globalThis.crypto !== 'undefined' && globalThis.crypto.getRandomValues) {
    globalThis.crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < 8; i++) {
      bytes[i] = Math.floor(Math.random() * 256);
    }
  }
  const spanId = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `00-${traceId}-${spanId}-01`;
}
