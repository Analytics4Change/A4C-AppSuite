/**
 * PII masking for error strings echoed to HTTP response bodies from Edge Functions.
 *
 * Byte-equivalent Deno port of frontend/src/utils/maskPii.ts. Two consumer copies must
 * stay in lockstep: any change to the regexes here must be mirrored in the frontend file
 * and vice versa.
 *
 * Strategy: structural strip on canonical PG shapes (Key (col)=(value), Failing row
 * contains (...)) preserves diagnostic value (column names) while erasing values.
 * UUID/email regex is a belt for free-form RAISE EXCEPTION text and PostgREST messages.
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
