/**
 * CommandFeedbackEcho — the non-Sonner failure toast echo (command-feedback standard).
 *
 * A fixed-position, **`aria-hidden`** visual echo of a command failure, so the failure
 * is seen even when the authoritative `role="alert"` banner is scrolled off-screen.
 * It never announces (the banner owns the single announcement — INV-1) and carries
 * **no focusable descendant** (INV-2 by construction — nothing to neutralize, unlike a
 * Sonner toast's `<li tabIndex=0>` + close button). Persists until cleared by the hook
 * (INV-3). Renders nothing when `message` is empty.
 *
 * No transition/animation → reduced-motion-safe by construction.
 * See `documentation/frontend/patterns/command-feedback.md`.
 */

export interface CommandFeedbackEchoProps {
  /** Sanitized failure message; empty/null renders nothing. */
  message: string | null | undefined;
}

export function CommandFeedbackEcho({ message }: CommandFeedbackEchoProps) {
  if (!message) return null;

  return (
    <div
      aria-hidden="true"
      data-testid="command-feedback-toast-error"
      className="fixed top-4 right-4 z-[9999] max-w-sm rounded-lg bg-red-600 px-4 py-3 text-sm text-white shadow-lg"
    >
      {message}
    </div>
  );
}
