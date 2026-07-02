/**
 * useCommandFeedback — orchestrates the *presentation* of command results per
 * the command-feedback standard (documentation/frontend/patterns/command-feedback.md).
 *
 * Division of labor:
 *   - The **banner** (`<CommandFeedbackBanner>`, driven by ViewModel state) is the
 *     authoritative surface and owns the single ARIA announcement (INV-1).
 *   - This hook adds the **failure toast echo** — an `aria-hidden`, non-announcing,
 *     persistent (`duration: Infinity`) visual echo so a failure is seen even when
 *     the banner is scrolled off-screen — and sanitizes + logs the raw error.
 *   - It writes NOTHING to domain state; all mutations stay on the ViewModel path.
 *
 * INV-2 (no focusable content under `aria-hidden`): Sonner v2 renders each toast as
 * `<li tabIndex=0>` plus (optionally) a focusable close button. We render the echo
 * with `closeButton: false` and a scoped class, then a once-installed MutationObserver
 * neutralizes our echo toasts only — setting `aria-hidden="true"` (also silences the
 * polite container announcement, satisfying INV-1) and `tabIndex="-1"`.
 *
 * Success has NO toast (banner only). Focus-to-banner on form-blocking failures is
 * the consumer's responsibility (a `useEffect` keyed on the error — never setTimeout).
 */

import { useCallback, useRef } from 'react';
import { toast } from 'sonner';
import { sanitizeCommandError } from '@/utils/sanitizeCommandError';
import { Logger } from '@/utils/logger';

const log = Logger.getLogger('component');

/** Class applied to echo toasts so the neutralizer targets only them. */
export const CF_ECHO_CLASS = 'cf-echo-toast';

export interface CommandFailureOptions {
  /** Operation-specific friendly fallback when the raw error looks internal. */
  fallback?: string;
  /** Correlation id for the log line (never displayed). */
  correlationId?: string;
}

export interface UseCommandFeedbackResult {
  /**
   * Handle a command failure: sanitize + `log.warn` the raw error, fire the
   * `aria-hidden` echo toast, and return the display string for the banner.
   */
  failed: (raw: unknown, opts?: CommandFailureOptions) => string;
  /** Success path — no toast; dismisses any lingering echo. */
  succeeded: () => void;
  /** Dismiss the paired echo toast (call when the banner is dismissed/cleared). */
  clear: () => void;
}

let neutralizerInstalled = false;

function neutralize(li: Element): void {
  li.setAttribute('aria-hidden', 'true');
  (li as HTMLElement).tabIndex = -1;
}

function applyNeutralize(root: Element): void {
  root.querySelectorAll?.(`.${CF_ECHO_CLASS}`).forEach((el) => {
    const li =
      el.closest('li[data-sonner-toast]') ?? (el.matches('li[data-sonner-toast]') ? el : null);
    if (li) neutralize(li);
  });
}

/** Install (once) a scoped observer that strips focusability + announcement from echo toasts. */
function ensureEchoNeutralizer(): void {
  if (neutralizerInstalled || typeof document === 'undefined') return;
  neutralizerInstalled = true;
  const observer = new MutationObserver((mutations) => {
    for (const m of mutations) {
      m.addedNodes.forEach((n) => {
        if (n.nodeType !== 1) return;
        applyNeutralize(n as Element);
      });
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });
  applyNeutralize(document.body); // catch any echo already mounted
}

/**
 * @param scope Optional label prefixing log lines (e.g. 'users', 'roles').
 */
export function useCommandFeedback(scope = 'command'): UseCommandFeedbackResult {
  const echoId = useRef<string | number | null>(null);

  const dismissEcho = useCallback(() => {
    if (echoId.current != null) {
      toast.dismiss(echoId.current);
      echoId.current = null;
    }
  }, []);

  const failed = useCallback(
    (raw: unknown, opts?: CommandFailureOptions): string => {
      const { display, raw: rawStr } = sanitizeCommandError(raw, opts?.fallback);
      log.warn(`${scope}: command failed`, {
        raw: rawStr,
        correlationId: opts?.correlationId,
      });
      dismissEcho();
      ensureEchoNeutralizer();
      echoId.current = toast.error(display, {
        duration: Infinity,
        closeButton: false,
        className: CF_ECHO_CLASS,
      });
      return display;
    },
    [scope, dismissEcho]
  );

  const succeeded = useCallback(() => dismissEcho(), [dismissEcho]);

  return { failed, succeeded, clear: dismissEcho };
}
