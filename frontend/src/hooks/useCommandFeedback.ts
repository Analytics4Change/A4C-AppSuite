/**
 * useCommandFeedback — orchestrates the *presentation* of command results per
 * the command-feedback standard (documentation/frontend/patterns/command-feedback.md).
 *
 * Division of labor:
 *   - The **banner** (`<CommandFeedbackBanner>`, driven by ViewModel state) is the
 *     authoritative surface and owns the single ARIA announcement (INV-1).
 *   - This hook sanitizes + logs the raw error and drives the **failure toast echo** —
 *     an `aria-hidden`, non-announcing, persistent visual echo (rendered by the page via
 *     `<CommandFeedbackEcho message={echoMessage} />`) so a failure is seen even when the
 *     banner is scrolled off-screen.
 *   - It writes NOTHING to domain state; all mutations stay on the ViewModel path.
 *
 * The echo is a plain, non-Sonner `aria-hidden` element, so INV-2 (no focusable content
 * under `aria-hidden`) holds by construction — there is nothing to neutralize. Success has
 * NO echo (banner only). Focus-to-banner on form-blocking failures is the consumer's
 * responsibility (a `useEffect` keyed on the error — never setTimeout).
 */

import { useCallback, useState } from 'react';
import { sanitizeCommandError } from '@/utils/sanitizeCommandError';
import { Logger } from '@/utils/logger';

const log = Logger.getLogger('component');

export interface CommandFailureOptions {
  /** Operation-specific friendly fallback when the raw error looks internal. */
  fallback?: string;
  /** Correlation id for the log line (never displayed). */
  correlationId?: string;
}

export interface UseCommandFeedbackResult {
  /**
   * Handle a command failure: sanitize + `log.warn` the raw error, set the echo
   * message, and return the display string for the banner.
   */
  failed: (raw: unknown, opts?: CommandFailureOptions) => string;
  /** Success path — no echo; clears any lingering echo. */
  succeeded: () => void;
  /** Clear the echo (call when the banner is dismissed/cleared). */
  clear: () => void;
  /** Current echo message; render `<CommandFeedbackEcho message={echoMessage} />`. */
  echoMessage: string | null;
}

/**
 * @param scope Optional label prefixing log lines (e.g. 'users', 'roles').
 */
export function useCommandFeedback(scope = 'command'): UseCommandFeedbackResult {
  const [echoMessage, setEchoMessage] = useState<string | null>(null);

  const failed = useCallback(
    (raw: unknown, opts?: CommandFailureOptions): string => {
      const { display, raw: rawStr } = sanitizeCommandError(raw, opts?.fallback);
      log.warn(`${scope}: command failed`, {
        raw: rawStr,
        correlationId: opts?.correlationId,
      });
      setEchoMessage(display);
      return display;
    },
    [scope]
  );

  const clear = useCallback(() => setEchoMessage(null), []);

  return { failed, succeeded: clear, clear, echoMessage };
}
