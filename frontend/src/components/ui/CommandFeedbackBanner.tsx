/**
 * Generic command-result banner — the authoritative surface for command
 * success/failure feedback per the command-feedback standard.
 *
 *   - `kind="error"`   → `role="alert"` (assertive). Owns the single announcement.
 *   - `kind="success"` → `role="status"` (polite).
 *
 * The container is programmatically focusable (`tabIndex={-1}`) so callers can
 * move focus to it on a form-blocking failure (via `useEffect`, never
 * `setTimeout`). Renders nothing when `message` is empty.
 *
 * See `documentation/frontend/patterns/command-feedback.md`. The specialized
 * role-violation / partial-failure variants remain a `UsersManagePage`
 * composition (`UsersErrorBanner`); this is the plain message banner.
 */

import { forwardRef } from 'react';
import { AlertTriangle, CheckCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';

export type CommandFeedbackKind = 'error' | 'success';

export interface CommandFeedbackBannerProps {
  /** Which surface — drives role/aria-live and styling. */
  kind: CommandFeedbackKind;
  /** Message to display; when empty/null the banner renders nothing. */
  message: string | null | undefined;
  /** Optional dismiss handler; when omitted, no dismiss control is shown. */
  onDismiss?: () => void;
  /** Overrides the default container test id. */
  'data-testid'?: string;
}

const STYLES: Record<
  CommandFeedbackKind,
  {
    container: string;
    icon: string;
    heading: string;
    body: string;
    title: string;
    Icon: typeof AlertTriangle;
  }
> = {
  error: {
    container: 'border-red-300 bg-red-50',
    icon: 'text-red-600',
    heading: 'text-red-800',
    body: 'text-red-700',
    title: 'Error',
    Icon: AlertTriangle,
  },
  success: {
    container: 'border-green-300 bg-green-50',
    icon: 'text-green-600',
    heading: 'text-green-800',
    body: 'text-green-700',
    title: 'Success',
    Icon: CheckCircle,
  },
};

export const CommandFeedbackBanner = forwardRef<HTMLDivElement, CommandFeedbackBannerProps>(
  function CommandFeedbackBanner({ kind, message, onDismiss, ...rest }, ref) {
    if (!message) return null;

    const s = STYLES[kind];
    const testId = rest['data-testid'] ?? 'command-feedback-banner';

    return (
      <div
        ref={ref}
        tabIndex={-1}
        role={kind === 'error' ? 'alert' : 'status'}
        className={`mb-6 p-4 rounded-lg border outline-none ${s.container}`}
        data-testid={testId}
      >
        <div className="flex items-start gap-3">
          <s.Icon className={`w-5 h-5 flex-shrink-0 mt-0.5 ${s.icon}`} aria-hidden="true" />
          <div className="flex-1">
            <h3 className={`font-semibold ${s.heading}`}>{s.title}</h3>
            <p className={`text-sm mt-1 ${s.body}`}>{message}</p>
          </div>
          {onDismiss && (
            <Button
              variant="outline"
              size="sm"
              onClick={onDismiss}
              className={`${s.body} ${kind === 'error' ? 'border-red-300' : 'border-green-300'}`}
              data-testid="command-feedback-banner-dismiss"
            >
              Dismiss
            </Button>
          )}
        </div>
      </div>
    );
  }
);
