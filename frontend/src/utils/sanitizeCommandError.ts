/**
 * Display-layer sanitizer for command-result errors.
 *
 * `api.*` RPC envelopes can leak handler internals (e.g.
 * `Event processing failed: <constraint>`, Postgres SQLSTATE codes). Those must
 * never reach the UI. This is the third, presentation-tier guard that sits
 * *after* the SDK-boundary PII mask (`unwrapApiEnvelope`/`apiRpcEnvelope`),
 * consistent with the three-layer PII model.
 *
 * Contract:
 *   - The caller renders ONLY `display`.
 *   - The caller MUST `log.warn` the `raw` value (with the correlation id) — this
 *     util is pure and does not log.
 *   - `display` never contains an interpolated identifier / constraint name.
 *
 * See `documentation/frontend/patterns/command-feedback.md`.
 */

export interface SanitizedCommandError {
  /** User-safe message to render. */
  display: string;
  /** Original error text — for `log.warn`, never for display. */
  raw: string;
}

/** Generic fallback when no operation-specific one is supplied. */
export const DEFAULT_COMMAND_ERROR = 'Something went wrong. Please try again.';

/**
 * Markers that identify a raw string as handler-internal (unsafe to display).
 * Kept conservative so legitimate, user-friendly messages pass through unchanged.
 */
const INTERNAL_MARKERS: readonly RegExp[] = [
  /^Event processing failed:/i,
  /\bERRCODE\b/i,
  /\b[A-Z]\d{4}\b/, // Postgres SQLSTATE-style codes, e.g. P9002
];

function toRawString(raw: unknown): string {
  if (raw instanceof Error) return raw.message;
  if (typeof raw === 'string') return raw;
  if (raw == null) return '';
  return String(raw);
}

/**
 * Sanitize a raw command error for display.
 *
 * @param raw      The raw error (string, Error, or envelope `error` field).
 * @param fallback Operation-specific friendly message shown when `raw` looks
 *                 internal or is empty. Defaults to {@link DEFAULT_COMMAND_ERROR}.
 */
export function sanitizeCommandError(
  raw: unknown,
  fallback: string = DEFAULT_COMMAND_ERROR
): SanitizedCommandError {
  const rawStr = toRawString(raw);
  const looksInternal = INTERNAL_MARKERS.some((re) => re.test(rawStr));
  const display = !rawStr || looksInternal ? fallback : rawStr;
  return { display, raw: rawStr };
}
