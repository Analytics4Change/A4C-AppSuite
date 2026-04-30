/**
 * PII masking for error strings surfaced to UI consumers.
 *
 * Defense-in-depth layer for HIPAA-relevant text returned by Pattern A v2 RPCs and
 * PostgREST errors. The trigger persistence layer (process_domain_event) drops
 * PG_EXCEPTION_DETAIL into a separate gated column; this utility is the SDK-boundary
 * mask applied via unwrapApiEnvelope so any consumer that reads result.error sees
 * structurally-redacted text.
 *
 * Strategy: structural strip on the canonical PG shapes (Key (col)=(value),
 * Failing row contains (...)) preserves diagnostic value (column names) while
 * erasing all values. UUID/email regex is a belt for free-form RAISE EXCEPTION
 * text and PostgREST messages.
 *
 * Idempotent: passing already-masked text returns it unchanged.
 */

const PG_DETAIL_RE = /Key \(([^)]+)\)=\(([^)]+)\)/g;
const FAILING_ROW_RE = /Failing row contains \(([^)]+)\)/g;
const UUID_RE = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;
const EMAIL_RE = /\b[\w.+-]+@[\w-]+\.[\w.-]+\b/g;

export function maskPii(text: string | null | undefined): string {
  if (!text) return '';
  return text
    .replace(PG_DETAIL_RE, 'Key ($1)=(<redacted>)')
    .replace(FAILING_ROW_RE, 'Failing row contains (<redacted>)')
    .replace(UUID_RE, '<uuid>')
    .replace(EMAIL_RE, '<email>');
}
